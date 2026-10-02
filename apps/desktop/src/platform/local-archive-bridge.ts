import {
  DesktopAppendArchiveExportChunkResponseSchema,
  DesktopArchiveExportErrorCodeSchema,
  DesktopBeginArchiveExportResponseSchema,
  type DesktopArchiveExportErrorCode,
} from '@mahoshojo/contracts/desktop-ipc';
import {
  collectLocalLibraryArchive,
  type LocalLibraryArchiveSource,
} from '@mahoshojo/local-library/archive-export';
import {
  LOCAL_LIBRARY_ARCHIVE_TOO_LARGE_CODE,
  LocalLibraryArchiveTooLargeError,
  MAX_LOCAL_LIBRARY_ARCHIVE_INPUT_BYTES,
  packLocalLibraryArchive,
} from '@mahoshojo/local-library/archive-pack';

import type { CardRepository } from '@mahoshojo/local-library/repository';
import type { WebPackageRepository } from '@mahoshojo/local-library/web-package-record';

/**
 * 单次 raw IPC 请求体的字节上限（`DESK-070` 三个上限里的第三个）。
 *
 * ## 这个数字不是拍脑袋，但它仍缺一块实测
 *
 * **内存安全是能算出来的**，因此本值现在就有依据。导出期间同时存在的字节是：`zipSync` 的 1×
 * 输入（≤ 256 MiB）+ 完整输出归档（≤ 256 MiB）+ native 侧追加到 temp 的一块。取 4 MiB 时峰值
 * 约 772 MiB，与 `zipSync` 本身的 512 MiB 相比可忽略——也就是说**它不是内存约束的绑定项**，因此
 * 选 4 MiB 不会把峰值推高到需要重跑内存实测的程度。
 *
 * **吞吐与回退阈值仍待实测**，`DESK-071b`"raw IPC 的静默回退"把它列为退出门禁：块越小，调用次数
 * 越多、总开销越大；块越大，越接近某个阈值时 Tauri 可能不再走自定义协议。定这条门禁需要一个
 * 真实运行的 Tauri 应用，因此它在 D2.3b2 的验收里**仍然开放**——本常量带着"内存侧已论证、吞吐
 * 侧未实测"的标注，而不是宣称已经验过。
 *
 * 结论会写在计划的未落地项里。改本值 MUST 同时重跑 `scripts/measure-archive-memory.mjs`。
 */
export const MAX_LOCAL_LIBRARY_IPC_CHUNK_BYTES = 4 * 1024 * 1024;

export const BEGIN_ARCHIVE_EXPORT_COMMAND = 'begin_local_archive_export' as const;
export const APPEND_ARCHIVE_EXPORT_CHUNK_COMMAND = 'append_local_archive_export_chunk' as const;

/** raw 请求体携带的会话 id 的 header 名。与 `lib.rs` 的 `export_id_header` 同一字符串。 */
export const ARCHIVE_EXPORT_ID_HEADER = 'x-export-id';

export interface StructuredInvokeFn {
  (command: string, args?: Record<string, unknown>): Promise<unknown>;
}

/**
 * raw IPC 调用。
 *
 * 与 {@link StructuredInvokeFn} 分成两个类型而不是靠运行时分支，是因为它们**不能互换**：raw 形式
 * 的第二个参数是整个请求体，给它一个对象等于把对象序列化成 JSON 载荷——对 4 MiB 块来说那是一次
 * 无意义的拷贝，而对整包来说是一次灾难。让类型系统挡住"顺手传了对象"比在运行时检查便宜。
 */
export type RawInvokeFn = (
  command: string,
  body: Uint8Array,
  options: { headers: Record<string, string> },
) => Promise<unknown>;

/**
 * 导出失败。
 *
 * `code` 覆盖两侧的失败：native 的 `export-*` 与打包器的 `archive-too-large`。把它们放进同一个
 * 错误类型，是因为 UI 的动作是一样的（告诉用户这次导出没成、为什么），而分成两个类型只会让每个
 * 调用点都要写两遍 try/catch。
 */
export class LocalArchiveExportError extends Error {
  readonly code: DesktopArchiveExportErrorCode | typeof LOCAL_LIBRARY_ARCHIVE_TOO_LARGE_CODE;

  constructor(code: DesktopArchiveExportErrorCode | typeof LOCAL_LIBRARY_ARCHIVE_TOO_LARGE_CODE, message: string) {
    super(message);
    this.name = 'LocalArchiveExportError';
    this.code = code;
  }
}

const EXPORT_ERROR_CODES = DesktopArchiveExportErrorCodeSchema.options;

const toExportError = (cause: unknown): LocalArchiveExportError => {
  if (
    cause !== null
    && typeof cause === 'object'
    && typeof (cause as { code?: unknown }).code === 'string'
    && typeof (cause as { message?: unknown }).message === 'string'
  ) {
    const { code, message } = cause as { code: string; message: string };
    if ((EXPORT_ERROR_CODES as readonly string[]).includes(code)) {
      return new LocalArchiveExportError(
        code as DesktopArchiveExportErrorCode,
        message,
      );
    }
  }
  return new LocalArchiveExportError('export-failure', '导出归档失败');
};

export interface ExportLocalLibraryArchiveOptions {
  /** 覆盖块大小。**只供测试使用**；生产路径走 {@link MAX_LOCAL_LIBRARY_IPC_CHUNK_BYTES}。 */
  readonly chunkBytes?: number;
  /** 覆盖上限。**只供测试使用**；生产路径走输入预算。 */
  readonly maxTotalBytes?: number;
  /** 覆盖 `manifest.exportedAt`。**只供测试使用**。 */
  readonly exportedAt?: string;
  /** 每块送达后的进度回调。用于 UI 进度条；缺省时导出器不做任何进度汇报。 */
  readonly onProgress?: (written: number, total: number) => void;
}

export interface ExportedLocalLibraryArchive {
  /** 最终归档的绝对路径。它与 `begin` 回显的计划路径相同。 */
  readonly absolutePath: string;
  readonly byteLength: number;
  readonly entryCount: number;
  /**
   * 导出的一致性口径。
   *
   * `'self-consistent-enumeration'` 的含义是：**一次成功产出的归档，其内部的记录、digest 与 blob
   * 必然自洽**。并发修改可能被纳入、可能被遗漏，也可能让本次导出显式失败；但它不会产出一个
   * record / blob 错配的归档（`DESK-071b`）。
   *
   * 它**不是** point-in-time 快照。当前算法先分页列举、再逐个读取 Web 包 ZIP，中间任何一次并发
   * 写入都可能改变结果范围——"点击那一刻的库"这个承诺算法给不出，因此类型上也不给。恒为单一取值
   * 是刻意的：把这行写成字面量而不是省掉，是为了让这条语义在类型上可见、并且在算法真的变成
   * point-in-time 之前无法被悄悄改成别的东西。
   */
  readonly consistency: 'self-consistent-enumeration';
}

/**
 * 把本地库导出成一个 portable archive 并落到磁盘。
 *
 * 顺序是**先打包、后传输**：`packLocalLibraryArchive` 已经在内存里产出完整归档，因此 native 只
 * 需要追加字节。反过来（边打包边传输）需要流式打包器，而 `zipSync` 不提供——那是 D2.3e 的一处替换。
 *
 * 整个过程**不取维护窗口**（`DESK-071b`）。理由记在那条规范里；此处值得重复的一句是：本函数
 * 对并发变更的反应只能是失败，不能是产出错误结果——`readArchive` 读的每个字节在 native 侧已被
 * 摘要校验过。
 */
export const exportLocalLibraryArchive = async (
  invoke: StructuredInvokeFn,
  rawInvoke: RawInvokeFn,
  source: LocalLibraryArchiveSource,
  options: ExportLocalLibraryArchiveOptions = {},
): Promise<ExportedLocalLibraryArchive> => {
  // 块大小**先**校验，而且必须早于打包：`NaN <= 0` 是 false，所以此前 NaN 能穿过这道检查，
  // 接着 `offset += NaN` 让分块循环一次都不执行，函数就把 `begun.absolutePath` 当成一次成功导出
  // 返回——而一个字节都没送出去。`Infinity` 同样能穿过，并把整份归档当成一次请求发出去，
  // 于是 `DESK-070` 那三个上限里的第三个被静默架空。
  const chunkBytes = options.chunkBytes ?? MAX_LOCAL_LIBRARY_IPC_CHUNK_BYTES;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) {
    throw new LocalArchiveExportError('export-failure', '块大小必须是正的安全整数');
  }

  const collected = await collectLocalLibraryArchive(source, {
    ...(options.exportedAt === undefined ? {} : { exportedAt: options.exportedAt }),
  });

  let packed;
  try {
    packed = await packLocalLibraryArchive(collected.manifest, collected.read, {
      ...(options.maxTotalBytes === undefined
        ? {}
        : { maxTotalBytes: options.maxTotalBytes }),
    });
  } catch (cause) {
    if (cause instanceof LocalLibraryArchiveTooLargeError) throw cause;
    throw new LocalArchiveExportError('export-failure', '组装导出归档失败');
  }

  let begun;
  try {
    begun = DesktopBeginArchiveExportResponseSchema.parse(
      await invoke(BEGIN_ARCHIVE_EXPORT_COMMAND, {
        declaredTotalByteLength: packed.bytes.byteLength,
      }),
    );
  } catch (cause) {
    throw toExportError(cause);
  }

  const total = packed.bytes.byteLength;
  // 桥必须逐块确认 native 真的**收下了自己刚送达的那些字节**，而不是只把 `writtenByteLength`
  // 喂给进度条。契约把 `complete` 定义成"文件已经 sync 并原子 rename"的确认信号，因此它是一个
  // 可以断言的事实，而不是一个可以忽略的提示位——忽略它的症状是导出一个"能打开但少东西"的
  // 归档，而 UI 显示的是成功。
  let expectedWritten = 0;
  for (let offset = 0; offset < total; offset += chunkBytes) {
    const chunk = packed.bytes.subarray(offset, Math.min(offset + chunkBytes, total));
    let response;
    try {
      const raw = await rawInvoke(APPEND_ARCHIVE_EXPORT_CHUNK_COMMAND, chunk, {
        headers: { [ARCHIVE_EXPORT_ID_HEADER]: String(begun.exportId) },
      });
      response = DesktopAppendArchiveExportChunkResponseSchema.parse(raw);
    } catch (cause) {
      throw toExportError(cause);
    }

    expectedWritten += chunk.byteLength;
    if (response.writtenByteLength !== expectedWritten) {
      throw new LocalArchiveExportError(
        'export-failure',
        `导出进度与实际送达不符：native 报 ${response.writtenByteLength}，已送达 ${expectedWritten}`,
      );
    }
    // 收满当轮就是最后一块，因此"是否完成"是本地已知的，而不是等 native 告诉我们的。
    const isFinalBlock = expectedWritten === total;
    if (response.complete !== isFinalBlock) {
      throw new LocalArchiveExportError(
        'export-failure',
        isFinalBlock
          ? '导出已送完全部字节，但 native 未确认完成'
          : `导出尚未送完（${expectedWritten}/${total}），native 却报告已完成`,
      );
    }
    // 最终路径必须与 `begin` 回显的那个一致。让 native 在最后换一个名字会把 `begin` 的回显
    // 降级成"仅供参考"，契约复杂度随之上升；因此这里选择失败而不是接受一个不同的路径。
    if (isFinalBlock && response.absolutePath !== begun.absolutePath) {
      throw new LocalArchiveExportError('export-failure', 'native 回显的最终路径与 begin 不一致');
    }
    options.onProgress?.(expectedWritten, total);
  }

  return {
    absolutePath: begun.absolutePath,
    byteLength: total,
    entryCount: packed.entryCount,
    consistency: 'self-consistent-enumeration',
  };
};

/**
 * 把既有的两个仓库端口接成导出所需的读取面。
 *
 * 分页 MUST 传 `includeDeleted: true`：portable archive 必须携带墓碑，否则导入侧看不到"这条被删过"，
 * 而下一次同步会把它当新记录重新拉回来。`DESK-074` 的 existing-wins 冲突策略依赖 `deletedAt`。
 *
 * `readWebPackageArchive` 按 **manifest 摘要**而不是包 id 调用，与 `WebPackageRepository.readArchive`
 * 的既有约定一致（见 `web-package-bridge.ts` 里关于这个参数曾经搞错的记录）。
 */
export const createArchiveExportSource = (
  cards: CardRepository,
  packages: WebPackageRepository,
): LocalLibraryArchiveSource => ({
  listCards: async (cursor) => {
    const page = await cards.list({ includeDeleted: true, limit: 100, ...(cursor === undefined ? {} : { cursor }) });
    return { items: page.items, nextCursor: page.nextCursor };
  },
  listWebPackages: async (cursor) => {
    const page = await packages.list({ includeDeleted: true, limit: 100, ...(cursor === undefined ? {} : { cursor }) });
    return { items: page.items, nextCursor: page.nextCursor };
  },
  readWebPackageArchive: async (packageId) => {
    const record = await packages.get(packageId);
    if (record === null) {
      throw new LocalArchiveExportError('export-failure', `Web 包不存在：${packageId}`);
    }
    const bytes = await packages.readArchive(record.ref.digest);
    if (bytes === null) {
      // 记录在但字节不在。这是 native 侧 GC 与 purge 之间的窗口；报告它而不是跳过，
      // 因为跳过的结果是一个"少一个包但能打开"的归档。
      throw new LocalArchiveExportError('export-failure', `Web 包字节缺失：${packageId}`);
    }
    return bytes;
  },
});

/** 导出侧用到的两个上限，供 UI 提前判定而不是等一次 4 分钟的导出失败。 */
export const LOCAL_LIBRARY_ARCHIVE_LIMITS = {
  inputBytes: MAX_LOCAL_LIBRARY_ARCHIVE_INPUT_BYTES,
  chunkBytes: MAX_LOCAL_LIBRARY_IPC_CHUNK_BYTES,
} as const;