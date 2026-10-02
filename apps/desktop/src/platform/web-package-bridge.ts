import {
  DesktopBase64BytesSchema,
  DesktopListWebPackagesRequestSchema,
  DesktopListWebPackagesResponseSchema,
  DesktopReadWebPackageArchiveRequestSchema,
  DesktopSaveWebPackageRequestSchema,
  DesktopSaveWebPackageResponseSchema,
  type DesktopLocalLibraryWriteMode,
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
  type WebPackageWriteOutcome,
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
 * ## 为什么读取方向走 raw 响应，而写入方向仍走 base64
 *
 * `DESK-053` 要求 IPC 接受字节流且不得接受 renderer 提供的任意目标路径。两条方向按**各自的字节
 * 量级**分别决定，`MUST NOT` 把"是否切 raw"当成一次性全局决定：
 *
 * - **读取**（`read_web_package_archive`）返回 Tauri raw 响应，渲染层拿到 `ArrayBuffer`。D2.3 的
 *   导出对**每个** Web 包都要读一遍字节，base64 的 33% 体积开销加一次解码峰值因此直接落在导出
 *   期间的峰值内存里——它曾经让 `measure-archive-memory.mjs` 测出的 2.1× 明显偏低。
 * - **写入**（`save_web_package`）仍是结构化请求 + `{b64, len}` 载荷。改成 raw 请求体会连带丢掉
 *   它的结构化参数（记录 document 与索引列）与解码后的长度核对，而单个包的量级远没到需要那条
 *   通道的程度；此处切换的成本与收益不成比例。
 *
 * 两条方向共同的事实是：raw **请求**无法携带结构化参数，而 raw **响应**可以与结构化请求共存
 * （`tauri::ipc::Response` 只影响响应方向）。因此读取方向不需要任何自定义封包。
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
  'maintenance-busy',
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
 * 把 native 返回的 base64 载荷解成字节。
 *
 * 长度核对**不可省**：静默接受截断的 base64 会变成一个"看起来完整"的短 ZIP，而失败点会落在
 * 解包器里，离真正的原因很远。只在**写入**方向（native 侧的解包）使用。
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
 * native 的 raw 响应 → 字节。
 *
 * raw 响应没有 JSON 信封，因此长度无从声明——这正是它的好处：`ArrayBuffer` 的 `byteLength` 就是
 * 字节数，不存在"声明与实际不符"这种状态。反过来，任何**不是** `ArrayBuffer` 的返回值都必须被
 * 拒：把它当成字节数组会得到一堆 `undefined`，而症状是"解包器说这个 ZIP 坏了"，离真正的原因很远。
 *
 * 只认 `ArrayBuffer` 而不接受 `number[]` / 任意 TypedArray 是**刻意的**：接受它们会让 raw IPC 的
 * 静默回退（见 {@link IpcWebPackageRepository.readArchive} 的注释）继续悄悄生效，而那正是
 * `DESK-070` 明令禁止的形态。响亮地失败让这条回退在真机上可观测——代价是它属于 D2.3b2 那两条
 * **仍需真机实测**的门禁。
 */
const fromRawBytes = (payload: unknown): Uint8Array => {
  if (payload instanceof ArrayBuffer) {
    return new Uint8Array(payload);
  }
  throw new DesktopLocalCardError(
    READ_WEB_PACKAGE_ARCHIVE_COMMAND,
    'bridge-failure',
    '本地库返回的归档不是 raw 字节',
  );
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
    writeMode: DesktopLocalLibraryWriteMode = 'overwrite',
  ): Promise<{ blobOutcome: DesktopBlobWriteOutcome; alreadyPresent: boolean }> {
    const validated = LocalWebPackageRecordV1Schema.parse(record);
    const request = DesktopSaveWebPackageRequestSchema.parse({
      document: JSON.stringify(validated),
      index: toWebPackageIndex(validated),
      archive: toBase64Bytes(archive),
      now: new Date().toISOString(),
      writeMode,
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
    return { blobOutcome: response.data.blobOutcome, alreadyPresent: response.data.alreadyPresent };
  }

  /** `WebPackageRepository` 端口形态。丢弃 blob 结果只适用于"确定不会损坏"的调用点。 */
  async put(record: LocalWebPackageRecordV1, archive: Uint8Array): Promise<void> {
    await this.putWithOutcome(record, archive);
  }

  /**
   * `insert-if-absent`：只在 id 尚不存在时写入记录与 archive 字节，已存在则两者都不动。
   *
   * 不在这里自己 `get` 一次：那会把原子性变成两次 IPC 之间的一个约定。判定在 native 的事务里，
   * 而两种写法共用同一把写许可，所以这一路并不多事���。
   */
  async putIfAbsent(
    record: LocalWebPackageRecordV1,
    archive: Uint8Array,
  ): Promise<WebPackageWriteOutcome> {
    const outcome = await this.putWithOutcome(record, archive, 'insert-if-absent');
    return outcome.alreadyPresent ? { alreadyPresent: true } : { written: true };
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
   *
   * 响应走 raw：`invoke` 对 raw 响应返回 `ArrayBuffer`，而**请求**仍是结构化的，因此这条路径
   * 不需要任何自定义封包。
   *
   * 代价与代价的边界：这条读取路径因此依赖自定义 IPC 协议。协议不可用时 Tauri 会**静默**回退到
   * `postMessage`，那条路径把响应体序列化成 JSON——对 `Vec<u8>` 就是一串 `number[]`，于是
   * {@link fromRawBytes} 会拒绝它。也就是说静默降级在这里变成响亮失败（比旧行为好，用户至少会
   * 看到"归档不是 raw 字节"而不是悄悄多付 33% 体积），但"这条路径依赖自定义协议"这件事必须写在
   * 两处：`DESK-071b` 的开放门禁目前只覆盖写入方向的分块。
   *
   * `new Uint8Array(payload)` 是**零拷贝视图**，不是复制——它直接别名 Tauri 的传输缓冲。这正是
   * 这次改动的目的（不再多付一次解码峰值），代价是调用方 MUST NOT 修改它。共享端口的
   * `readArchive` 只把字节交给解包器，而解包器不修改输入。
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
    return fromRawBytes(raw);
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
