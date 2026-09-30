import {
  DesktopListLocalCardsRequestSchema,
  DesktopListLocalCardsResponseSchema,
  DesktopSaveLocalCardRequestSchema,
  type DesktopListLocalCardsRequest,
  type DesktopLocalCardCursor,
  type DesktopLocalCardIndex,
  type DesktopStoreErrorCode,
} from '@mahoshojo/contracts/desktop-ipc';
import {
  LocalCardPageSchema,
  LocalCardQuerySchema,
  type LocalCardPage,
  type LocalCardQuery,
  type CardRepository,
} from '@mahoshojo/local-library/repository';
import { LocalCardRecordV1Schema, type LocalCardRecordV1 } from '@mahoshojo/local-library/record';

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
  readonly code: DesktopStoreErrorCode | 'invalid-card' | 'bridge-failure';

  constructor(command: string, code: DesktopLocalCardError['code'], message: string) {
    super(message);
    this.name = 'DesktopLocalCardError';
    this.command = command;
    this.code = code;
  }
}

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
    return newDesktopLocalCardError(command, code, message);
  }
  return new DesktopLocalCardError(command, 'bridge-failure', '本地库调用失败');
};

const newDesktopLocalCardError = (
  command: string,
  code: string,
  message: string,
): DesktopLocalCardError => {
  const known: readonly string[] = [
    'store-unavailable',
    'invalid-document',
    'document-too-large',
    'index-mismatch',
    'record-tombstoned',
    'non-monotonic-timestamp',
    'invalid-query',
    'store-failure',
  ];
  // native 的 message 是固定文案，可以透传；code 不在契约枚举内则不采信，避免把
  // 未知形状当作已知失败类别交给上层做重试决策。
  return new DesktopLocalCardError(
    command,
    (known.includes(code) ? code : 'bridge-failure') as DesktopLocalCardError['code'],
    known.includes(code) ? message : '本地库调用失败',
  );
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
const toDocumentText = (record: LocalCardRecordV1): string => JSON.stringify(record);

/**
 * keyset 游标在渲染层保持不透明。
 *
 * 契约层不透明是有意的：Web 的 IndexedDB adapter 可以用 offset 游标，Desktop 用 keyset，
 * 两者都不必迁就对方。这里因此**原样透传** native 返回的游标，不解析它的内部结构。
 */
const toRequestCursor = (cursor: string | undefined): DesktopLocalCardCursor | undefined => {
  if (cursor === undefined) return undefined;
  const parsed = DesktopListLocalCardsRequestSchema.shape.cursor.safeParse(JSON.parse(cursor));
  if (!parsed.success) {
    throw new DesktopLocalCardError(
      LIST_LOCAL_CARDS_COMMAND,
      'invalid-card',
      '本地库返回了无法识别的分页游标',
    );
  }
  return parsed.data;
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
      : { cursor: toRequestCursor(parsedQuery.cursor) }),
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

    const parsed = LocalCardRecordV1Schema.safeParse(JSON.parse(raw as string));
    if (!parsed.success) {
      throw new DesktopLocalCardError(
        GET_LOCAL_CARD_COMMAND,
        'invalid-card',
        '本地库中存在无法解析的数据卡记录。',
      );
    }
    return parsed.data;
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
      throw new DesktopLocalCardError(LIST_LOCAL_CARDS_COMMAND, 'bridge-failure', '本地库返回了无法识别的分页结果');
    }

    // 逐行解析：一条 schema 漂移的旧行不该让用户看到"本地库读取失败"的空列表。
    // 解析失败分两种，都必须归入 unreadable 而不是抛出：document 不是合法 JSON，
    // 以及 JSON 合法但不满足 LocalCardRecordV1Schema。把 JSON.parse 放在 try 之外会让
    // 前者直接掀翻整页——那正是这条用例要防的情况。
    const unreadable: string[] = [];
    const items = response.data.documents.flatMap((document) => {
      let raw: unknown;
      try {
        raw = JSON.parse(document);
      } catch {
        unreadable.push('(未知)');
        return [];
      }
      const parsed = LocalCardRecordV1Schema.safeParse(raw);
      if (parsed.success) return [parsed.data];
      unreadable.push(typeof (raw as { id?: unknown })?.id === 'string' ? String((raw as { id: string }).id) : '(未知)');
      return [];
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
    // 先校验再投影：投影必须来自已通过契约的记录，否则调用方传入的多余字段能影响选择器。
    const validated = LocalCardRecordV1Schema.parse(record);
    const request = DesktopSaveLocalCardRequestSchema.parse({
      document: toDocumentText(validated),
      index: toLocalCardIndex(validated),
    });
    try {
      await this.invoke(SAVE_LOCAL_CARD_COMMAND, { request });
    } catch (cause) {
      throw toBridgeError(SAVE_LOCAL_CARD_COMMAND, cause);
    }
  }

  async delete(id: string): Promise<void> {
    // 时间戳由渲染层生成：native 不引入时间库，也就不会出现两端对"现在"的定义不一致。
    // 软删**只**写 tombstone、保留 document，使 `restore` 能真正恢复可用状态。
    try {
      await this.invoke(DELETE_LOCAL_CARD_COMMAND, { id, deletedAt: new Date().toISOString() });
    } catch (cause) {
      throw toBridgeError(DELETE_LOCAL_CARD_COMMAND, cause);
    }
  }

  async restore(id: string): Promise<void> {
    try {
      await this.invoke(RESTORE_LOCAL_CARD_COMMAND, { id });
    } catch (cause) {
      throw toBridgeError(RESTORE_LOCAL_CARD_COMMAND, cause);
    }
  }
}
