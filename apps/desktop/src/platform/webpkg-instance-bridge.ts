import {
  DESKTOP_WEBPKG_INSTANCE_ID_HEADER,
  DESKTOP_WEBPKG_RESOURCE_OFFSET_HEADER,
  DESKTOP_WEBPKG_RESOURCE_PATH_HEADER,
  MAX_DESKTOP_WEBPKG_APPEND_CHUNK_BYTES,
  DesktopAppendWebPackageResourceResponseSchema,
  DesktopBeginWebPackageInstanceRequestSchema,
  DesktopBeginWebPackageInstanceResponseSchema,
  DesktopOpenWebPackageInstanceRequestSchema,
  DesktopOpenWebPackageInstanceResponseSchema,
  DesktopWebPackageInstanceErrorCodeSchema,
  DesktopWebPackageInstanceIdSchema,
  type DesktopWebPackageInstanceErrorCode,
  type DesktopWebPackageInstanceId,
} from '@mahoshojo/contracts/desktop-ipc';
import {
  WEB_PACKAGE_INSTANCE_PREFIX,
  buildWebPackageInstanceUrl,
  type WebPackageResourceSnapshot,
} from '@mahoshojo/web-package';

import type { RawInvokeFn, StructuredInvokeFn } from './local-archive-bridge';

/**
 * Web Package 受限 webview（D4b / DESK-013）的渲染层桥接。
 *
 * ## 职责切分
 *
 * - **这里做**：把 `WebPackageResourceSnapshot`（TS 权威侧已完成 base+overlay 合并与完整性
 *   物化）翻译成 begin → 逐文件 raw append → open 三段调用；校验每一步的响应形状与回执；
 *   把 native 的 `webpkg-*` 失败归一成带稳定 code 的错误。
 * - **native 做**：instance 分配与 TTL、声明↔字节长度核对、`maho-webpkg` resolver、webview
 *   创建与 hardening（incognito / 权限拒绝 / 导航钉定 / 新窗拒绝 / 下载拒绝）、Destroyed 回收。
 * - **这里不做**：不拼 instance id、webview label 或资源 URL——三者全是 native 事实，渲染层
 *   只原样回传；不接触本地库、blob 或文件系统路径。
 *
 * ## 与导出桥的差异
 *
 * `local-archive-bridge` 的 append 是"一份大字节流按 4 MiB 切块"；这里是"每份文件
 * 按 `x-webpkg-offset` 升序分块投递"。分块的原因与导出相同——"实例预算"（256 MiB
 * 有效载荷字节）不是"单次 IPC 预算"——但完整性判据不同：导出是滑窗累计
 * （`writtenByteLength` 递增），这里是逐文件回执（`receivedByteLength` 递增到
 * `bytes.byteLength`）。
 *
 * ## 失败与孤儿会话
 *
 * 三段流程没有 abort command：中途失败留下的 Collecting 会话由 native 的 staging TTL
 * 到点回收（begin 时排定的 reaper，另有 IPC 路径上的惰性回收兜底——见
 * `webpkg_instance.rs`）。渲染层崩在中间的窗口期上限是 TTL，不是泄漏；刻意不加
 * 第四条命令，是因为它唯一的用途是"取消"——而为取消维护一份幂等语义，成本高于让 TTL
 * 自然到期。
 */

export const BEGIN_WEB_PACKAGE_INSTANCE_COMMAND = 'begin_web_package_instance' as const;
export const APPEND_WEB_PACKAGE_RESOURCE_COMMAND = 'append_web_package_resource' as const;
export const OPEN_WEB_PACKAGE_INSTANCE_COMMAND = 'open_web_package_instance' as const;

/** webpkg 失败。`code` 与 `WebpkgError::code` 逐项对应（fixture 钉住集合与顺序）。 */
export class DesktopWebPackageInstanceError extends Error {
  readonly code: DesktopWebPackageInstanceErrorCode;

  constructor(
    readonly command: string,
    code: DesktopWebPackageInstanceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DesktopWebPackageInstanceError';
    this.code = code;
  }
}

const WEBPKG_ERROR_CODES = DesktopWebPackageInstanceErrorCodeSchema.options;

const toWebpkgError = (command: string, cause: unknown): DesktopWebPackageInstanceError => {
  if (
    cause !== null
    && typeof cause === 'object'
    && typeof (cause as { code?: unknown }).code === 'string'
    && typeof (cause as { message?: unknown }).message === 'string'
  ) {
    const { code, message } = cause as { code: string; message: string };
    if ((WEBPKG_ERROR_CODES as readonly string[]).includes(code)) {
      return new DesktopWebPackageInstanceError(
        command,
        code as DesktopWebPackageInstanceErrorCode,
        message,
      );
    }
  }
  return new DesktopWebPackageInstanceError(command, 'webpkg-failure', 'Web Package 实例调用失败');
};

export interface OpenedWebPackageInstance {
  /** native 分配的 instance id（`wpk-<N>`）。与快照的物化 id 无关，也**不**回推给它。 */
  readonly instanceId: DesktopWebPackageInstanceId;
  /** native 实际创建的 webview label（`webpkg-<instanceId>`）。回显用于诊断与聚焦。 */
  readonly webviewLabel: string;
}

/**
 * 把一个已物化的资源快照送进受限 webview。
 *
 * ## 输入为什么是 snapshot 而不是 source/archive
 *
 * `createWebPackageResourceSnapshot` 已经把"不可变 base + 单文件 overlay"的合并语义执行完
 * （含 overlay 与 base 身份的钉定校验），输出的 `files` 就是权威的文件表——begin 的声明与
 * append 的字节都直接取自它。让调用方再传一份 `readFile` 只会让同一份字节有第二个读取入口。
 *
 * `snapshot.instanceId` 是物化命名空间（`resolveWebPackageInstancePath` 用它做归属判定），
 * 与 native 分配的 `wpk-<N>` 是**两个不同的 id**：本函数不读取它，native 也不知道它存在。
 *
 * ## 顺序约束
 *
 * begin 必须在 append 之前完成——native 只按"先声明、后按声明验收"接收字节，不存在
 * "先送文件再补登记"的路径。open 只在所有文件回执通过后发起：声明表与已收表在 native 侧
 * 逐条对齐，桥层用回执复核它，而不是乐观地假设送达。
 * 可选 isCurrent 在派发前及每次 await 后验证宿主 owner；过期抛本地 AbortError。
 * 已派发的 open 不能撤销，晚回执只被丢弃；未 open 的 collecting 仍由原 TTL 清理。
 */
export const openWebPackageInstanceInIsolatedWebview = async (
  invoke: StructuredInvokeFn,
  rawInvoke: RawInvokeFn,
  snapshot: WebPackageResourceSnapshot,
  title: string,
  isCurrent: () => boolean = () => true,
): Promise<OpenedWebPackageInstance> => {
  // 本地 owner 失效只停止尚未派发的步骤；不扩 Native 错误码，也不冒充撤销已发的 open。
  let openDispatched = false;
  const assertCurrent = (): void => {
    if (!isCurrent()) {
      throw new DOMException(openDispatched
        ? '打开操作已过期；窗口可能已建立，请单独关闭。'
        : '打开操作已过期，已停止后续步骤；未打开的暂存实例按原 TTL 回收。', 'AbortError');
    }
  };
  assertCurrent();
  const declaredFiles = [...snapshot.files.entries()].map(([path, file]) => ({
    path,
    mediaType: file.mediaType,
    byteLength: file.bytes.byteLength,
  }));
  const request = DesktopBeginWebPackageInstanceRequestSchema.parse({
    entry: snapshot.entry,
    title,
    files: declaredFiles,
  });

  let instanceId: DesktopWebPackageInstanceId;
  try {
    assertCurrent();
    const response = await invoke(BEGIN_WEB_PACKAGE_INSTANCE_COMMAND, { request });
    assertCurrent();
    const begun = DesktopBeginWebPackageInstanceResponseSchema.parse(response);
    instanceId = DesktopWebPackageInstanceIdSchema.parse(begun.instanceId);
  } catch (cause) {
    assertCurrent();
    throw cause instanceof DesktopWebPackageInstanceError ? cause : toWebpkgError(BEGIN_WEB_PACKAGE_INSTANCE_COMMAND, cause);
  }

  for (const [path, file] of snapshot.files) {
    // `x-webpkg-path` 的编码与资源 URL 同一条规则——借 `buildWebPackageInstanceUrl` 取
    // 逐段编码结果而不是就地重写一份 encodeURIComponent 逻辑：两侧各写一份编码器，
    // 漂移的症状是"文件已声明、路径合法、resolver 永远 404"，离根因很远。
    const encodedPath = buildWebPackageInstanceUrl(instanceId, path).slice(
      `${WEB_PACKAGE_INSTANCE_PREFIX}${instanceId}/`.length,
    );
    // 每文件按 offset 升序、以不超过 MAX_DESKTOP_WEBPKG_APPEND_CHUNK_BYTES 的块投递。
    // `subarray` 是视图不是拷贝——IPC 序列化按 byteOffset/byteLength 取视图字节，
    // 不会把整份快照随每块重发；零长文件也要发一个空块，native 按"块送达"记完成。
    const total = file.bytes.byteLength;
    for (let offset = 0; ; offset += MAX_DESKTOP_WEBPKG_APPEND_CHUNK_BYTES) {
      const end = Math.min(offset + MAX_DESKTOP_WEBPKG_APPEND_CHUNK_BYTES, total);
      const chunk = file.bytes.subarray(offset, end);
      let received;
      try {
        assertCurrent();
        const response = await rawInvoke(APPEND_WEB_PACKAGE_RESOURCE_COMMAND, chunk, {
          headers: {
            [DESKTOP_WEBPKG_INSTANCE_ID_HEADER]: instanceId,
            [DESKTOP_WEBPKG_RESOURCE_PATH_HEADER]: encodedPath,
            [DESKTOP_WEBPKG_RESOURCE_OFFSET_HEADER]: String(offset),
          },
        });
        assertCurrent();
        received = DesktopAppendWebPackageResourceResponseSchema.parse(response);
      } catch (cause) {
        assertCurrent();
        throw cause instanceof DesktopWebPackageInstanceError ? cause : toWebpkgError(APPEND_WEB_PACKAGE_RESOURCE_COMMAND, cause);
      }
      // 回执必须等于本文件已送达的累计字节数：native 按声明长度验收，桥按回执复核，
      // 双侧核对让"截断送达"没有可以钻过去的缝隙。
      if (received.receivedByteLength !== end) {
        throw new DesktopWebPackageInstanceError(
          APPEND_WEB_PACKAGE_RESOURCE_COMMAND,
          'webpkg-resource-mismatch',
          `native 回执 ${received.receivedByteLength} 字节，已送达 ${end}`,
        );
      }
      if (end === total) break;
    }
  }

  try {
    assertCurrent();
    const openRequest = DesktopOpenWebPackageInstanceRequestSchema.parse({ instanceId });
    openDispatched = true;
    const response = await invoke(OPEN_WEB_PACKAGE_INSTANCE_COMMAND, { request: openRequest });
    assertCurrent();
    const opened = DesktopOpenWebPackageInstanceResponseSchema.parse(response);
    return { instanceId, webviewLabel: opened.label };
  } catch (cause) {
    assertCurrent();
    throw cause instanceof DesktopWebPackageInstanceError ? cause : toWebpkgError(OPEN_WEB_PACKAGE_INSTANCE_COMMAND, cause);
  }
};
