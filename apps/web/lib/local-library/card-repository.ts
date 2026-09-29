import {
  LocalCardPageSchema,
  LocalCardQuerySchema,
  type CardRepository,
  type LocalCardPage,
  type LocalCardQuery,
} from '@mahoshojo/local-library/repository';
import { LocalCardRecordV1Schema, type LocalCardRecordV1 } from '@mahoshojo/local-library/record';

import {
  LOCAL_LIBRARY_INDEX_NAMES,
  LOCAL_LIBRARY_STORE_NAMES,
  deleteLocalLibraryRecord,
  getAllLocalLibraryRecords,
  getLocalLibraryRecord,
  monotonicNowIso,
  putLocalLibraryRecord,
  runLocalLibraryTransaction,
} from './db';

const parseCursor = (cursor: string | undefined): number => {
  if (cursor === undefined) return 0;
  const offset = Number(cursor);
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
};

/**
 * Web 本地库的数据卡仓储。
 *
 * 契约语义（软删、幂等、不得隐式复活、不消耗线上卡槽）来自 `CardRepository`；
 * 这里只决定它们在 IndexedDB 上如何落地。
 */
export class IndexedDbCardRepository implements CardRepository {
  async get(id: string): Promise<LocalCardRecordV1 | null> {
    const stored = await runLocalLibraryTransaction(LOCAL_LIBRARY_STORE_NAMES.dataCards, 'readonly', (transaction) =>
      getLocalLibraryRecord<LocalCardRecordV1>(transaction.objectStore(LOCAL_LIBRARY_STORE_NAMES.dataCards), id),
    );
    if (stored === undefined) return null;
    const parsed = LocalCardRecordV1Schema.safeParse(stored);
    // 损坏行不能静默变成“空库”：调用方需要知道这条记录已经不可用。
    if (!parsed.success) {
      throw new Error('本地库中存在无法解析的数据卡记录。');
    }
    return parsed.data;
  }

  /** `unreadable` 列出被跳过的损坏行 ID；为空表示全部可读。 */
  async list(query: LocalCardQuery): Promise<LocalCardPage & { unreadable: string[] }> {
    const parsedQuery = LocalCardQuerySchema.parse(query);
    const offset = parseCursor(parsedQuery.cursor);
    const rows = await runLocalLibraryTransaction(LOCAL_LIBRARY_STORE_NAMES.dataCards, 'readonly', (transaction) =>
      getAllLocalLibraryRecords<LocalCardRecordV1>(
        transaction.objectStore(LOCAL_LIBRARY_STORE_NAMES.dataCards).index(LOCAL_LIBRARY_INDEX_NAMES.byUpdatedAt),
      ),
    );

    // 逐行解析而不是一次性 parse 整个列表：一条 schema 漂移的旧行不该让用户
    // 看到"本地库读取失败"的空列表。坏行被跳过，但数量会报出来。
    const unreadable: string[] = [];
    const parsed = rows.flatMap((row) => {
      const result = LocalCardRecordV1Schema.safeParse(row);
      if (result.success) return [result.data];
      unreadable.push(typeof row?.id === 'string' ? row.id : '(未知)');
      return [];
    });

    const matching = parsed
      .filter((row) => parsedQuery.includeDeleted === true || row.deletedAt === undefined)
      .filter((row) => parsedQuery.cardTypes === undefined || parsedQuery.cardTypes.includes(row.cardType))
      .sort((left, right) => {
        if (left.updatedAt !== right.updatedAt) return right.updatedAt.localeCompare(left.updatedAt);
        return left.id.localeCompare(right.id);
      });

    const page = matching.slice(offset, offset + parsedQuery.limit);
    const nextOffset = offset + page.length;
    return {
      ...LocalCardPageSchema.parse({
        items: page,
        ...(nextOffset < matching.length ? { nextCursor: String(nextOffset) } : {}),
      }),
      unreadable,
    };
  }

  async put(record: LocalCardRecordV1): Promise<void> {
    const parsed = LocalCardRecordV1Schema.parse(record);
    await runLocalLibraryTransaction(LOCAL_LIBRARY_STORE_NAMES.dataCards, 'readwrite', async (transaction) => {
      const store = transaction.objectStore(LOCAL_LIBRARY_STORE_NAMES.dataCards);
      const existing = await getLocalLibraryRecord<LocalCardRecordV1>(store, parsed.id);
      if (existing?.deletedAt !== undefined && parsed.deletedAt === undefined) {
        throw new Error('本地库中的数据卡已被删除；请先恢复再保存。');
      }
      await putLocalLibraryRecord(store, parsed);
    });
  }

  async delete(id: string): Promise<void> {
    await runLocalLibraryTransaction(LOCAL_LIBRARY_STORE_NAMES.dataCards, 'readwrite', async (transaction) => {
      const store = transaction.objectStore(LOCAL_LIBRARY_STORE_NAMES.dataCards);
      const existing = await getLocalLibraryRecord<LocalCardRecordV1>(store, id);
      if (existing === undefined || existing.deletedAt !== undefined) return;
      await putLocalLibraryRecord(store, { ...existing, deletedAt: monotonicNowIso(existing.updatedAt) });
    });
  }

  async restore(id: string): Promise<void> {
    await runLocalLibraryTransaction(LOCAL_LIBRARY_STORE_NAMES.dataCards, 'readwrite', async (transaction) => {
      const store = transaction.objectStore(LOCAL_LIBRARY_STORE_NAMES.dataCards);
      const existing = await getLocalLibraryRecord<LocalCardRecordV1>(store, id);
      if (existing === undefined || existing.deletedAt === undefined) return;
      const restored = { ...existing, updatedAt: monotonicNowIso(existing.updatedAt) };
      delete restored.deletedAt;
      await putLocalLibraryRecord(store, restored);
    });
  }

  /** 回收站视图与「彻底忘记」共用同一张表，不引入第二个存储。 */
  async purge(id: string): Promise<void> {
    await runLocalLibraryTransaction(LOCAL_LIBRARY_STORE_NAMES.dataCards, 'readwrite', (transaction) =>
      deleteLocalLibraryRecord(transaction.objectStore(LOCAL_LIBRARY_STORE_NAMES.dataCards), id),
    );
  }
}

let sharedRepository: IndexedDbCardRepository | null = null;

export const getLocalCardRepository = (): IndexedDbCardRepository => {
  sharedRepository ??= new IndexedDbCardRepository();
  return sharedRepository;
};

export const resetLocalCardRepository = (): void => {
  sharedRepository = null;
};
