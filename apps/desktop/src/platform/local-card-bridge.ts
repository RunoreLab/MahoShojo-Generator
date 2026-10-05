import {
  DesktopListLocalCardsRequestSchema,
  DesktopListLocalCardsResponseSchema,
  DesktopLocalCardCursorSchema,
  DesktopSaveLocalCardRequestSchema,
  DesktopSaveLocalCardResponseSchema,
  type DesktopLocalLibraryWriteMode,
  type DesktopListLocalCardsRequest,
  type DesktopLocalCardCursor,
  type DesktopLocalCardIndex,
  type DesktopBlobErrorCode,
  type DesktopStoreErrorCode,
} from '@mahoshojo/contracts/desktop-ipc';
import {
  LocalCardPageSchema,
  LocalCardQuerySchema,
  type LocalCardPage,
  type LocalCardQuery,
  type CardRepository,
  type CardWriteOutcome,
} from '@mahoshojo/local-library/repository';
import {
  LocalCardRecordV1Schema,
  nextLocalTimestamp,
  type LocalCardRecordV1,
} from '@mahoshojo/local-library/record';
import { serializeLocalLibraryRecord } from '@mahoshojo/local-library/archive-export';

/**
 * 本地数据卡的渲染层桥接，以及基于 IPC 的 `CardRepository` 实现。
 *
 * 职责边界（`ADR-desktop-tauri-v1` 第 7 条）：记录组装与完整校验留在 TypeScript，native 侧
 * 只存取 opaque 文档并用索引列做选择器。因此写入顺序是固定的：
 *
 * 1. 用 `LocalCardRecordV1Schema` 校验完整记录（跨字段与时序规则在这一步生效，
 *    `.transform` 同时给出防御性副本）；
 * 2. 从**这份已校验的记录**投影出索引列——不是从调用方的原始输入投影，因此调用方
 *    传入的额外字段无法影响选择器；
 * 3. native 侧从 document 里重新提取索引列并与声明值逐项比对，不一致即拒绝。
 *
 * 三步各自都会失败一次：TS 侧拦下契约违规，native 侧拦下两侧理解分歧。两层都必要——
 * 只有第一层的话，一次 `{...record, updatedAt: 伪造值}` 就能让排序与分页永久错乱。
 */

export const SAVE_LOCAL_CARD_COMMAND = 'save_local_card' as const;
export const GET_LOCAL_CARD_COMMAND = 'get_local_card' as const;
export const LIST_LOCAL_CARDS_COMMAND = 'list_local_cards' as const;
export const DELETE_LOCAL_CARD_COMMAND = 'delete_local_card' as const;
export const RESTORE_LOCAL_CARD_COMMAND = 'restore_local_card' as const;
export const PURGE_LOCAL_CARD_COMMAND = 'purge_local_card' as const;

export class DesktopLocalCardError extends Error {
  readonly command: string;
  readonly code: DesktopLocalLibraryErrorCode;

  constructor(command: string, code: DesktopLocalLibraryErrorCode, message: string) {
    super(message);
    this.name = 'DesktopLocalCardError';
    this.command = command;
    this.code = code;
  }
}

/**
 * 渲染层可能观察到的全部失败类别。
 *
 * 记录存储与 blob 存储的投影**刻意是同一个形状**（`DesktopLocalLibraryErrorSchema`），
 * 因此共用一个错误类别与一个错误类型——渲染层只需要一个解析器，而"哪种存储坏了"由 code
 * 区分而不是由类型区分。
 *
 * `invalid-card` 与 `bridge-failure` 是渲染层自己的分类（native 不会返回它们）。
 * native 的 `message` 是固定文案，可直接透传；本地库相关的 `message` **MUST NOT** 回显
 * 用户数据或 SQLite / 文件系统的原始错误串。
 */
export type DesktopLocalLibraryErrorCode =
  | DesktopStoreErrorCode
  | DesktopBlobErrorCode
  | 'invalid-card'
  | 'bridge-failure';

/** @deprecated 本地库错误已是记录与 blob 的共用类别，改用 `DesktopLocalLibraryErrorCode`。 */
export type DesktopLocalCardErrorCode = DesktopLocalLibraryErrorCode;

const NATIVE_ERROR_CODES: readonly DesktopStoreErrorCode[] = [
  'store-unavailable',
  'invalid-document',
  'document-too-large',
  'index-mismatch',
  'record-tombstoned',
  'transition-mismatch',
  'record-missing',
  'non-monotonic-timestamp',
  'invalid-query',
  // 维护窗口内的写入被拒（D2.2a / DESK-065）：可重试的时机问题，不是数据损坏。
  'maintenance-busy',
  'store-failure',
];

/**
 * 判定一个错误是否值得让用户重试。
 *
 * `maintenance-busy` 是**唯一**一个"原样重试就会成功"的类别：维护窗口结束后写入路径
 * 完全正常。UI 应当据此提示"本地库正在维护，请稍后重试"，而不是显示成一次失败——
 * 后者会让用户以为数据出了问题，进而重复导入或清库。
 */
export const isRetryableLocalLibraryError = (
  code: DesktopLocalLibraryErrorCode,
): boolean => code === 'maintenance-busy';

/**
 * 页面展示用的本地库错误文案。
 *
 * native `message` 是固定文案可直接展示；`maintenance-busy` 改说“稍后重试”。渲染层契约校验失败
 * （例如正文超过单条 document 上限）不透传 Zod 细节，只说明内容超出限制。
 */
export const describeLocalCardError = (cause: unknown): string => {
  if (cause instanceof DesktopLocalCardError) {
    return isRetryableLocalLibraryError(cause.code) ? '本地库正在维护，请稍后重试。' : cause.message;
  }
  if (cause instanceof Error && cause.name === 'ZodError') return '数据卡内容超出本地库限制或格式不受支持。';
  return '本地库操作失败，请重试。';
};

const isStoreErrorCode = (value: string): value is DesktopStoreErrorCode =>
  (NATIVE_ERROR_CODES as readonly string[]).includes(value);

export interface InvokeFn {
  (command: string, args?: Record<string, unknown>): Promise<unknown>;
}

/** 把 native 返回的失败归一成带稳定 code 的错误。未知形状一律 fail closed。 */
const toBridgeError = (command: string, cause: unknown): DesktopLocalCardError => {
  if (
    cause !== null
    && typeof cause === 'object'
    && typeof (cause as { code?: unknown }).code === 'string'
    && typeof (cause as { message?: unknown }).message === 'string'
  ) {
    const { code, message } = cause as { code: string; message: string };
    if (isStoreErrorCode(code)) {
      return new DesktopLocalCardError(command, code, message);
    }
  }
  // 未知形状不采信：既不透传可能含 SQL 片段的 message，也不新增一个错误类别，
  // 否则上层会拿一个它没准备处理的 code 做重试决策。
  return new DesktopLocalCardError(command, 'bridge-failure', '本地库调用失败');
};

/**
 * 解析 native 交回的一条 document。
 *
 * `get` 与 `list` **MUST** 共用这一个入口：分开写就会出现"list 已经把坏行进 unreadable、
 * get 却抛原始 SyntaxError"的不一致——那正是本函数被提取出来要消除的缺陷。
 */
const parseStoredDocument = (
  command: string,
  document: string,
): { record: LocalCardRecordV1 } | { unreadable: boolean; id: string } => {
  let raw: unknown;
  try {
    raw = JSON.parse(document);
  } catch {
    return { unreadable: true, id: '(未知)' };
  }
  const parsed = LocalCardRecordV1Schema.safeParse(raw);
  if (parsed.success) return { record: parsed.data };
  const id = (raw as { id?: unknown } | null)?.id;
  return { unreadable: true, id: typeof id === 'string' ? id : '(未知)' };
};

/**
 * 把已校验的记录投影成 native 的索引列。
 *
 * 只取 native 做选择器必需的五个字段。`title` / `data` / `provenance` 等留在 document 里，
 * native 不解释它们——这是 ADR 第 7 条要求的"业务语义不下沉到 Rust"。
 */
export const toLocalCardIndex = (record: LocalCardRecordV1): DesktopLocalCardIndex => {
  const parsed = LocalCardRecordV1Schema.parse(record);
  return {
    id: parsed.id,
    cardType: parsed.cardType,
    updatedAt: parsed.updatedAt,
    ...(parsed.deletedAt === undefined ? {} : { deletedAt: parsed.deletedAt }),
    contentDigest: parsed.contentDigest,
  };
};

/** 序列化为 native 落盘的 document 文本。 */
/**
 * 序列化为 native 存储的 document 文本。
 *
 * 走共享实现而非就地 `JSON.stringify`，是为了让本桥写入的行与 portable archive 里
 * `cards/*.json` 的记录**是同一份字节**——`archive-export.ts` 的 `checksum` 覆盖的就是它。
 * 两处各自序列化时，任何一边改了缩进或键序都会让"导入再导出"的 `checksum` 对不上，而症状是
 * 导入侧报内容损坏，与根因完全无关。
 */
const toDocumentText = serializeLocalLibraryRecord;

/**
 * keyset 游标在渲染层保持不透明。
 *
 * 契约层不透明是有意的：Web 的 IndexedDB adapter 可以用 offset 游标，Desktop 用 keyset，
 * 两者都不必迁就对方。这里因此**原样透传** native 返回的游标，不解释它的内部结构。
 *
 * 但"不透明"不等于"不校验"：无法识别的游标必须以稳定错误失败，而不是静默回落成第一页
 * ——后者会让同一批数据被反复读取，比报错难查得多。
 */
const toRequestCursor = (
  command: string,
  cursor: string | undefined,
): DesktopLocalCardCursor | undefined => {
  if (cursor === undefined) return undefined;
  const parsed = DesktopLocalCardCursorSchema.safeParse(parseJsonOrThrow(command, cursor));
  if (!parsed.success) {
    throw new DesktopLocalCardError(
      command,
      'invalid-card',
      '本地库返回了无法识别的分页游标',
    );
  }
  return parsed.data;
};

const parseJsonOrThrow = (command: string, text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    throw new DesktopLocalCardError(command, 'invalid-card', '本地库返回了无法解析的数据');
  }
};

const toCursorText = (cursor: DesktopLocalCardCursor): string => JSON.stringify(cursor);

export const buildLocalCardListRequest = (
  query: LocalCardQuery,
): DesktopListLocalCardsRequest => {
  const parsedQuery = LocalCardQuerySchema.parse(query);
  return DesktopListLocalCardsRequestSchema.parse({
    includeDeleted: parsedQuery.includeDeleted === true,
    cardTypes: parsedQuery.cardTypes ?? [],
    limit: parsedQuery.limit,
    ...(parsedQuery.cursor === undefined
      ? {}
      : { cursor: toRequestCursor(LIST_LOCAL_CARDS_COMMAND, parsedQuery.cursor) }),
  });
};

/**
 * 通过业务级 IPC 实现的 `CardRepository`。
 *
 * `list` 额外返回 `unreadable`：与 Web 的 IndexedDB 实现一致，一条坏行不该让整个本地库
 * 显示为"读取失败"的空列表。native 侧逐行解析 document，因此解析失败的行会被跳过并计入。
 */
export class IpcLocalCardRepository implements CardRepository {
  constructor(private readonly invoke: InvokeFn) {}

  async get(id: string): Promise<LocalCardRecordV1 | null> {
    let raw: unknown;
    try {
      raw = await this.invoke(GET_LOCAL_CARD_COMMAND, { id });
    } catch (cause) {
      throw toBridgeError(GET_LOCAL_CARD_COMMAND, cause);
    }
    if (raw === null || raw === undefined) return null;

    const parsed = parseStoredDocument(GET_LOCAL_CARD_COMMAND, raw as string);
    if ('unreadable' in parsed) {
      // 单行损坏必须报错而不是当作"不存在"：后者会让一次软删看起来成功，却什么也没删掉。
      throw new DesktopLocalCardError(
        GET_LOCAL_CARD_COMMAND,
        'invalid-card',
        `本地库中存在无法解析的数据卡记录（${parsed.id}）。`,
      );
    }
    return parsed.record;
  }

  async list(query: LocalCardQuery): Promise<LocalCardPage & { unreadable: string[] }> {
    let raw: unknown;
    try {
      raw = await this.invoke(LIST_LOCAL_CARDS_COMMAND, { request: buildLocalCardListRequest(query) });
    } catch (cause) {
      throw toBridgeError(LIST_LOCAL_CARDS_COMMAND, cause);
    }

    const response = DesktopListLocalCardsResponseSchema.safeParse(raw);
    if (!response.success) {
      throw new DesktopLocalCardError(
        LIST_LOCAL_CARDS_COMMAND,
        'bridge-failure',
        '本地库返回了无法识别的分页结果',
      );
    }

    // 与 get 共用同一个解析入口：一条坏行不该让整页变空，但也不该让 get 抛原始 SyntaxError。
    const unreadable: string[] = [];
    const items = response.data.documents.flatMap((document) => {
      const parsed = parseStoredDocument(LIST_LOCAL_CARDS_COMMAND, document);
      if ('unreadable' in parsed) {
        unreadable.push(parsed.id);
        return [];
      }
      return [parsed.record];
    });

    return {
      ...LocalCardPageSchema.parse({
        items,
        ...(response.data.nextCursor === undefined
          ? {}
          : { nextCursor: toCursorText(response.data.nextCursor) }),
      }),
      unreadable,
    };
  }

  async put(record: LocalCardRecordV1): Promise<void> {
    await this.write(SAVE_LOCAL_CARD_COMMAND, record);
  }

  /**
   * `insert-if-absent`：只在 id 尚不存在时写入，已存在（含墓碑）则整条不动。
   *
   * 不在这里自己 `get`：那会把原子性变成两次 IPC 之间的一个约定。判定在 native 的插入点上，
   * 而两种写法共用同一把写许可，所以这一路并不多事实。
   */
  async putIfAbsent(record: LocalCardRecordV1): Promise<CardWriteOutcome> {
    const alreadyPresent = await this.write(SAVE_LOCAL_CARD_COMMAND, record, 'insert-if-absent');
    return alreadyPresent ? { alreadyPresent: true } : { written: true };
  }

  /**
   * 幂等软删。
   *
   * 交出的是**组装完成的整条记录**（含 `deletedAt`），而不是 `(id, deletedAt)`：只让 native
   * 改索引列会让 document 与索引列分叉，而 `get()` 返回的正是 document。
   */
  async delete(id: string): Promise<void> {
    const existing = await this.get(id);
    // 契约：缺失 id 与已删除记录都是 no-op。
    if (existing === null || existing.deletedAt !== undefined) return;

    const deletedAt = nextLocalTimestamp(existing.updatedAt);
    await this.write(DELETE_LOCAL_CARD_COMMAND, {
      ...existing,
      updatedAt: deletedAt,
      deletedAt,
    });
  }

  /** 幂等恢复。交出的是移除 `deletedAt` 后的完整记录。 */
  async restore(id: string): Promise<void> {
    const existing = await this.get(id);
    // 契约：缺失 id 与活动记录都是 no-op。
    if (existing === null || existing.deletedAt === undefined) return;

    const restored = {
      ...existing,
      updatedAt: nextLocalTimestamp(existing.updatedAt),
    };
    delete restored.deletedAt;
    await this.write(RESTORE_LOCAL_CARD_COMMAND, restored);
  }

  /** 彻底删除。native 侧幂等，因此这里不需要先读。 */
  async purge(id: string): Promise<void> {
    try {
      await this.invoke(PURGE_LOCAL_CARD_COMMAND, { id });
    } catch (cause) {
      throw toBridgeError(PURGE_LOCAL_CARD_COMMAND, cause);
    }
  }

  /** 校验 → 投影索引列 → 序列化 document → 交给 native 原子写入整行。 */
  private async write(
    command: string,
    record: LocalCardRecordV1,
    writeMode: DesktopLocalLibraryWriteMode = 'overwrite',
  ): Promise<boolean> {
    // 先校验再投影：投影必须来自已通过契约的记录，否则调用方传入的多余字段能影响选择器。
    const validated = LocalCardRecordV1Schema.parse(record);
    const request = DesktopSaveLocalCardRequestSchema.parse({
      document: toDocumentText(validated),
      index: toLocalCardIndex(validated),
      writeMode,
    });
    let raw: unknown;
    try {
      raw = await this.invoke(command, { request });
    } catch (cause) {
      throw toBridgeError(command, cause);
    }
    // 响应必须过一遍 schema：native 版本与渲染层不一致时，"我不知道有没有写进去"应当是一次明确的
    // 失败，而不是一个被当成成功的 undefined。
    const response = DesktopSaveLocalCardResponseSchema.safeParse(raw);
    if (!response.success) {
      throw new DesktopLocalCardError(
        command,
        'bridge-failure',
        '本地库返回了无法识别的保存结果，本次写入状态未知。',
      );
    }
    return response.data.alreadyPresent;
  }
}
