import {
  DesktopBase64BytesSchema,
  DesktopListWebPackagesRequestSchema,
  DesktopListWebPackagesResponseSchema,
  DesktopReadWebPackageArchiveRequestSchema,
  DesktopReadWebPackageArchiveResponseSchema,
  DesktopSaveWebPackageRequestSchema,
  DesktopSaveWebPackageResponseSchema,
  DesktopWebPackageTransitionRequestSchema,
  type DesktopBlobWriteOutcome,
  type DesktopWebPackageIndex,
} from '@mahoshojo/contracts/desktop-ipc';
import {
  LocalWebPackagePageSchema,
  LocalWebPackageQuerySchema,
  LocalWebPackageRecordV1Schema,
  type LocalWebPackagePage,
  type LocalWebPackageQuery,
  type LocalWebPackageRecordV1,
  type WebPackageRepository,
} from '@mahoshojo/local-library/web-package-record';
import { nextLocalTimestamp } from '@mahoshojo/local-library/record';

import {
  DesktopLocalCardError,
  type DesktopLocalLibraryErrorCode,
} from './local-card-bridge';

/**
 * 本地 Web 包的渲染层桥接，以及基于 IPC 的 `WebPackageRepository` 实现。
 *
 * 职责边界与 `local-card-bridge` 同构（`ADR-desktop-tauri-v1` 第 7 条）：记录组装与完整校验
 * 留在 TypeScript，native 侧只负责落盘、内容寻址与状态转移校验。archive 的**地址由 native
 * 自行从字节算出**，因此渲染层无处声明 digest，也就不存在"声明与内容不符"这种输入。
 *
 * ## 为什么用 base64 而不是 Tauri raw IPC
 *
 * `DESK-053` 要求 IPC 接受字节流且不得接受 renderer 提供的任意目标路径。Tauri 2 的原生
 * raw IPC（`InvokeBody::Raw` / `tauri::ipc::Response`）要求整个请求体是 raw 形式，无法与结构化
 * 参数并存，因此这里用一个显式的 `{b64, len}` 字段承载字节。
 *
 * 代价是约 33% 的体积开销，收益是解包路径只有一条、且长度可在解码后核对。等 D2.3 要搬整个
 * archive 时再切 raw IPC——那时一次性传输的量级才配得上自定义通道。
 */

export const SAVE_WEB_PACKAGE_COMMAND = 'save_web_package' as const;
export const GET_WEB_PACKAGE_COMMAND = 'get_web_package' as const;
export const LIST_WEB_PACKAGES_COMMAND = 'list_web_packages' as const;
export const DELETE_WEB_PACKAGE_COMMAND = 'delete_web_package' as const;
export const RESTORE_WEB_PACKAGE_COMMAND = 'restore_web_package' as const;
export const PURGE_WEB_PACKAGE_COMMAND = 'purge_web_package' as const;
export const READ_WEB_PACKAGE_ARCHIVE_COMMAND = 'read_web_package_archive' as const;

const WEB_PACKAGE_ERROR_CODES: readonly DesktopLocalLibraryErrorCode[] = [
  // 记录存储
  'store-unavailable',
  'invalid-document',
  'document-too-large',
  'index-mismatch',
  'record-tombstoned',
  'transition-mismatch',
  'record-missing',
  'non-monotonic-timestamp',
  'invalid-query',
  'store-failure',
  // blob 存储
  'blob-unavailable',
  'blob-digest-mismatch',
  'blob-corrupt',
  'blob-too-large',
  'blob-not-found',
  'blob-failure',
];

const isLibraryErrorCode = (value: string): value is DesktopLocalLibraryErrorCode =>
  (WEB_PACKAGE_ERROR_CODES as readonly string[]).includes(value);

export interface InvokeFn {
  (command: string, args?: Record<string, unknown>): Promise<unknown>;
}

/**
 * 把 native 返回的失败归一成带稳定 code 的错误。
 *
 * `blob-corrupt` 被单独保留而不是压成 `bridge-failure`：它意味着这台设备的本地库已经不健康，
 * UI 需要据此提示用户做完整性检查（那是 D2.2 的能力），而不是当成一次普通失败静默重试。
 */
const toWebPackageError = (command: string, cause: unknown): DesktopLocalCardError => {
  if (
    cause !== null
    && typeof cause === 'object'
    && typeof (cause as { code?: unknown }).code === 'string'
    && typeof (cause as { message?: unknown }).message === 'string'
  ) {
    const { code, message } = cause as { code: string; message: string };
    if (isLibraryErrorCode(code)) {
      return new DesktopLocalCardError(command, code, message);
    }
  }
  return new DesktopLocalCardError(command, 'bridge-failure', '本地库调用失败');
};

/** 已校验记录的索引列投影。只取 native 做选择器与外键校验必需的四个字段。 */
export const toWebPackageIndex = (
  record: LocalWebPackageRecordV1,
): DesktopWebPackageIndex => {
  const parsed = LocalWebPackageRecordV1Schema.parse(record);
  return {
    id: parsed.id,
    updatedAt: parsed.updatedAt,
    ...(parsed.deletedAt === undefined ? {} : { deletedAt: parsed.deletedAt }),
    contentDigest: parsed.contentDigest,
  };
};

/** 把字节编码成 native 期望的 `{b64, len}`。长度随行，解码端据此拒绝截断的载荷。 */
export const toBase64Bytes = (bytes: Uint8Array) => {
  let binary = '';
  // 分块转换：一次 `String.fromCharCode(...bytes)` 会在大包上炸掉调用栈。
  const CHUNK = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return { b64: btoa(binary), len: bytes.byteLength };
};

/**
 * native 返回的 base64 载荷。
 *
 * 长度核对**不可省**：静默接受截断的 base64 会变成一个"看起来完整"的短 ZIP，而失败点会落在
 * 解包器里，离真正的原因很远。
 */
export const fromBase64Bytes = (payload: unknown): Uint8Array => {
  const parsed = DesktopBase64BytesSchema.parse(payload);
  const binary = atob(parsed.b64);
  if (binary.length !== parsed.len) {
    throw new DesktopLocalCardError(
      READ_WEB_PACKAGE_ARCHIVE_COMMAND,
      'bridge-failure',
      '本地库返回的归档长度与声明不符',
    );
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

/**
 * 通过业务级 IPC 实现的 `WebPackageRepository`。
 *
 * 与 `IpcLocalCardRepository` 的差别：写入多一个 archive 参数，读出多一个 `readArchive`。
 * `purge` 是本实现额外提供的能力——`WebPackageRepository` 端口里没有它，因为回收站语义下
 * "彻底删除"是 UI 的选择而非仓储的必需；但它与 blob 的可达性直接相关（D2.2 的 GC 会用到），
 * 因此在 adapter 上暴露而不污染端口。
 */
export class IpcWebPackageRepository implements WebPackageRepository {
  constructor(private readonly invoke: InvokeFn) {}

  /**
   * 保存一条 Web 包及其原始 ZIP 字节。
   *
   * 返回 blob 写入结果：`repaired` 表示发现并修复了本机存储损坏，**必须**由调用方决定如何
   * 告知用户。静默吞掉它，用户永远不会知道自己的库已经不健康。
   */
  async putWithOutcome(
    record: LocalWebPackageRecordV1,
    archive: Uint8Array,
  ): Promise<{ blobOutcome: DesktopBlobWriteOutcome }> {
    const validated = LocalWebPackageRecordV1Schema.parse(record);
    const request = DesktopSaveWebPackageRequestSchema.parse({
      document: JSON.stringify(validated),
      index: toWebPackageIndex(validated),
      archive: toBase64Bytes(archive),
      now: new Date().toISOString(),
    });
    let raw: unknown;
    try {
      raw = await this.invoke(SAVE_WEB_PACKAGE_COMMAND, { request });
    } catch (cause) {
      throw toWebPackageError(SAVE_WEB_PACKAGE_COMMAND, cause);
    }
    const response = DesktopSaveWebPackageResponseSchema.safeParse(raw);
    if (!response.success) {
      throw new DesktopLocalCardError(
        SAVE_WEB_PACKAGE_COMMAND,
        'bridge-failure',
        '本地库返回了无法识别的保存结果',
      );
    }
    return { blobOutcome: response.data.blobOutcome };
  }

  /** `WebPackageRepository` 端口形态。丢弃 blob 结果只适用于"确定不会损坏"的调用点。 */
  async put(record: LocalWebPackageRecordV1, archive: Uint8Array): Promise<void> {
    await this.putWithOutcome(record, archive);
  }

  async get(id: string): Promise<LocalWebPackageRecordV1 | null> {
    let raw: unknown;
    try {
      raw = await this.invoke(GET_WEB_PACKAGE_COMMAND, { id });
    } catch (cause) {
      throw toWebPackageError(GET_WEB_PACKAGE_COMMAND, cause);
    }
    if (raw === null || raw === undefined) return null;

    const parsed = LocalWebPackageRecordV1Schema.safeParse(parseJsonOrThrow(GET_WEB_PACKAGE_COMMAND, raw as string));
    if (!parsed.success) {
      throw new DesktopLocalCardError(
        GET_WEB_PACKAGE_COMMAND,
        'invalid-card',
        '本地库中存在无法解析的 Web 包记录。',
      );
    }
    return parsed.data;
  }

  /**
 * 与卡片 adapter 的差异：`list` 在坏行上**报错**而不是返回 `unreadable`。
 *
 * `WebPackageRepository` 端口的 `LocalWebPackagePage` 没有 `unreadable` 字段（卡片那份是
 * 端口之外多带的扩展）。因此这里只有两个选择：静默丢掉坏行，或明确报错。静默丢掉会让用户
 * 以为自己的包变少了——那比一次带诊断的失败糟糕得多。
 */
  async list(query: LocalWebPackageQuery): Promise<LocalWebPackagePage> {
    const parsedQuery = LocalWebPackageQuerySchema.parse(query);
    let raw: unknown;
    try {
      raw = await this.invoke(LIST_WEB_PACKAGES_COMMAND, {
        request: DesktopListWebPackagesRequestSchema.parse({
          includeDeleted: parsedQuery.includeDeleted === true,
          limit: parsedQuery.limit,
          ...(parsedQuery.cursor === undefined
            ? {}
            : { cursor: parseJsonOrThrow(LIST_WEB_PACKAGES_COMMAND, parsedQuery.cursor) }),
        }),
      });
    } catch (cause) {
      throw toWebPackageError(LIST_WEB_PACKAGES_COMMAND, cause);
    }

    const response = DesktopListWebPackagesResponseSchema.safeParse(raw);
    if (!response.success) {
      throw new DesktopLocalCardError(
        LIST_WEB_PACKAGES_COMMAND,
        'bridge-failure',
        '本地库返回了无法识别的分页结果',
      );
    }
    return LocalWebPackagePageSchema.parse({
      items: response.data.documents.map((document) => {
        try {
          return LocalWebPackageRecordV1Schema.parse(JSON.parse(document));
        } catch {
          throw new DesktopLocalCardError(
            LIST_WEB_PACKAGES_COMMAND,
            'invalid-card',
            '本地库中存在无法解析的 Web 包记录。',
          );
        }
      }),
      ...(response.data.nextCursor === undefined
        ? {}
        : { nextCursor: JSON.stringify(response.data.nextCursor) }),
    });
  }

  /**
   * 读取原始 ZIP 字节；记录存在但字节缺失时返回 null。
   *
   * 参数是 **manifest 摘要**（`record.ref.digest`），不是包 id——共享端口
   * `WebPackageRepository.readArchive(digest)` 与 Web 的 IndexedDB adapter 都以摘要为键。
   * 曾把它当包 id 传，native 按 id 查不到任何记录，于是每次读取都返回 null，表现为
   * "包打不开"；而两侧单测都绿，因为它们用的是包 id 当参数。
   */
  async readArchive(digest: string): Promise<Uint8Array | null> {
    let raw: unknown;
    try {
      raw = await this.invoke(
        READ_WEB_PACKAGE_ARCHIVE_COMMAND,
        DesktopReadWebPackageArchiveRequestSchema.parse({ contentDigest: digest }),
      );
    } catch (cause) {
      const error = toWebPackageError(READ_WEB_PACKAGE_ARCHIVE_COMMAND, cause);
      // 字节缺失是一个可判定状态，不该以抛错呈现：调用方要的是"读不到"这个事实。
      if (error.code === 'blob-not-found') return null;
      throw error;
    }
    // native 返回 `{archive: {b64, len}}`，不是裸字符串；解包路径只有一条。
    const envelope = DesktopReadWebPackageArchiveResponseSchema.parse(raw);
    return fromBase64Bytes(envelope.archive);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.get(id);
    // 契约：缺失 id 与已删除记录都是 no-op。
    if (existing === null || existing.deletedAt !== undefined) return;

    // 交出**组装完成的整条记录**：只让 native 改索引列会让 document 与索引列分叉，
    // 而 get 返回的正是 document。
    const deletedAt = nextLocalTimestamp(existing.updatedAt);
    await this.write(DELETE_WEB_PACKAGE_COMMAND, {
      ...existing,
      updatedAt: deletedAt,
      deletedAt,
    });
  }

  async restore(id: string): Promise<void> {
    const existing = await this.get(id);
    if (existing === null || existing.deletedAt === undefined) return;

    const restored = { ...existing, updatedAt: nextLocalTimestamp(existing.updatedAt) };
    delete restored.deletedAt;
    await this.write(RESTORE_WEB_PACKAGE_COMMAND, restored);
  }

  /** 彻底删除记录与其 blob 引用。幂等；端口里没有它，但 GC 与回收站需要。 */
  async purge(id: string): Promise<void> {
    try {
      await this.invoke(PURGE_WEB_PACKAGE_COMMAND, { id });
    } catch (cause) {
      throw toWebPackageError(PURGE_WEB_PACKAGE_COMMAND, cause);
    }
  }

  private async write(command: string, record: LocalWebPackageRecordV1): Promise<void> {
    const validated = LocalWebPackageRecordV1Schema.parse(record);
    try {
      await this.invoke(command, {
        request: DesktopWebPackageTransitionRequestSchema.parse({
          document: JSON.stringify(validated),
          index: toWebPackageIndex(validated),
        }),
      });
    } catch (cause) {
      throw toWebPackageError(command, cause);
    }
  }
}

const parseJsonOrThrow = (command: string, text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    throw new DesktopLocalCardError(command, 'invalid-card', '本地库返回了无法解析的数据');
  }
};
