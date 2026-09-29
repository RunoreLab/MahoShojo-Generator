import {
  LocalWebPackagePageSchema,
  LocalWebPackageQuerySchema,
  LocalWebPackageRecordV1Schema,
  type LocalWebPackagePage,
  type LocalWebPackageQuery,
  type LocalWebPackageRecordV1,
  type WebPackageRepository,
} from '@mahoshojo/local-library/web-package-record';

import {
  LOCAL_LIBRARY_INDEX_NAMES,
  LOCAL_LIBRARY_STORE_NAMES,
  deleteLocalLibraryRecord,
  getAllLocalLibraryRecords,
  getLocalLibraryRecord,
  monotonicNowIso,
  putLocalLibraryRecord,
  runLocalLibraryTransaction,
  toDetachedArrayBuffer,
  toStoredBytes,
} from './db';

const parseCursor = (cursor: string | undefined): number => {
  if (cursor === undefined) return 0;
  const offset = Number(cursor);
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
};

/**
 * 本地库记录的 Web 包 ID 由 canonical digest 派生：同一次导入永远落在同一行，
 * 修改过任何一个字节的包则是另一行。这正是「重新导入＝更新而不是新增」的身份基础。
 */
export const deriveLocalWebPackageId = (digest: string): string => `wp_${digest.replace(/^sha256:/u, '').slice(0, 32)}`;

export class IndexedDbWebPackageRepository implements WebPackageRepository {
  async get(id: string): Promise<LocalWebPackageRecordV1 | null> {
    const stored = await runLocalLibraryTransaction(LOCAL_LIBRARY_STORE_NAMES.webPackages, 'readonly', (transaction) =>
      getLocalLibraryRecord<LocalWebPackageRecordV1>(transaction.objectStore(LOCAL_LIBRARY_STORE_NAMES.webPackages), id),
    );
    if (stored === undefined) return null;
    const parsed = LocalWebPackageRecordV1Schema.safeParse(stored);
    if (!parsed.success) {
      throw new Error('本地库中存在无法解析的 Web 包记录。');
    }
    return parsed.data;
  }

  async findByDigest(digest: string): Promise<LocalWebPackageRecordV1 | null> {
    const stored = await runLocalLibraryTransaction(LOCAL_LIBRARY_STORE_NAMES.webPackages, 'readonly', (transaction) =>
      getLocalLibraryRecord<LocalWebPackageRecordV1>(
        transaction.objectStore(LOCAL_LIBRARY_STORE_NAMES.webPackages).index(LOCAL_LIBRARY_INDEX_NAMES.byDigest),
        digest,
      ),
    );
    if (stored === undefined) return null;
    const parsed = LocalWebPackageRecordV1Schema.safeParse(stored);
    return parsed.success ? parsed.data : null;
  }

  async list(query: LocalWebPackageQuery): Promise<LocalWebPackagePage> {
    const parsedQuery = LocalWebPackageQuerySchema.parse(query);
    const offset = parseCursor(parsedQuery.cursor);
    const rows = await runLocalLibraryTransaction(LOCAL_LIBRARY_STORE_NAMES.webPackages, 'readonly', (transaction) =>
      getAllLocalLibraryRecords<LocalWebPackageRecordV1>(
        transaction.objectStore(LOCAL_LIBRARY_STORE_NAMES.webPackages).index(LOCAL_LIBRARY_INDEX_NAMES.byUpdatedAt),
      ),
    );

    const matching = rows
      .filter((row) => parsedQuery.includeDeleted === true || row.deletedAt === undefined)
      .sort((left, right) => {
        if (left.updatedAt !== right.updatedAt) return right.updatedAt.localeCompare(left.updatedAt);
        return left.id.localeCompare(right.id);
      });

    const page = matching.slice(offset, offset + parsedQuery.limit);
    const nextOffset = offset + page.length;
    return LocalWebPackagePageSchema.parse({
      items: page.map((row) => LocalWebPackageRecordV1Schema.parse(row)),
      ...(nextOffset < matching.length ? { nextCursor: String(nextOffset) } : {}),
    });
  }

  async put(record: LocalWebPackageRecordV1, archive: Uint8Array): Promise<void> {
    const parsed = LocalWebPackageRecordV1Schema.parse(record);
    if (parsed.id !== deriveLocalWebPackageId(parsed.ref.digest)) {
      throw new Error('本地库 Web 包 ID 与其内容摘要不一致。');
    }
    const bytes = toDetachedArrayBuffer(archive);
    await runLocalLibraryTransaction(
      [LOCAL_LIBRARY_STORE_NAMES.webPackages, LOCAL_LIBRARY_STORE_NAMES.webPackageArchives],
      'readwrite',
      async (transaction) => {
        const recordStore = transaction.objectStore(LOCAL_LIBRARY_STORE_NAMES.webPackages);
        const existing = await getLocalLibraryRecord<LocalWebPackageRecordV1>(recordStore, parsed.id);
        if (existing?.deletedAt !== undefined && parsed.deletedAt === undefined) {
          throw new Error('本地库中的 Web 包已被删除；请先恢复再保存。');
        }
        await putLocalLibraryRecord(recordStore, parsed);
        await putLocalLibraryRecord(
          transaction.objectStore(LOCAL_LIBRARY_STORE_NAMES.webPackageArchives),
          {
            digest: parsed.ref.digest,
            bytes,
            cachedAt: monotonicNowIso(parsed.updatedAt),
          },
        );
      },
    );
  }

  async delete(id: string): Promise<void> {
    await runLocalLibraryTransaction(
      [LOCAL_LIBRARY_STORE_NAMES.webPackages, LOCAL_LIBRARY_STORE_NAMES.webPackageArchives],
      'readwrite',
      async (transaction) => {
        const recordStore = transaction.objectStore(LOCAL_LIBRARY_STORE_NAMES.webPackages);
        const existing = await getLocalLibraryRecord<LocalWebPackageRecordV1>(recordStore, id);
        if (existing === undefined || existing.deletedAt !== undefined) return;
        await putLocalLibraryRecord(recordStore, { ...existing, deletedAt: monotonicNowIso(existing.updatedAt) });
        // 软删只回收不再可达的字节；被 tombstone 独占的 archive 没有任何读取路径。
        await deleteLocalLibraryRecord(
          transaction.objectStore(LOCAL_LIBRARY_STORE_NAMES.webPackageArchives),
          existing.ref.digest,
        );
      },
    );
  }

  async restore(id: string): Promise<void> {
    await runLocalLibraryTransaction(LOCAL_LIBRARY_STORE_NAMES.webPackages, 'readwrite', async (transaction) => {
      const store = transaction.objectStore(LOCAL_LIBRARY_STORE_NAMES.webPackages);
      const existing = await getLocalLibraryRecord<LocalWebPackageRecordV1>(store, id);
      if (existing === undefined || existing.deletedAt === undefined) return;
      const restored = { ...existing, updatedAt: monotonicNowIso(existing.updatedAt) };
      delete restored.deletedAt;
      await putLocalLibraryRecord(store, restored);
    });
  }

  async readArchive(digest: string): Promise<Uint8Array | null> {
    const stored = await runLocalLibraryTransaction(
      LOCAL_LIBRARY_STORE_NAMES.webPackageArchives,
      'readonly',
      (transaction) =>
        getLocalLibraryRecord<{ digest: string; bytes: unknown }>(
          transaction.objectStore(LOCAL_LIBRARY_STORE_NAMES.webPackageArchives),
          digest,
        ),
    );
    if (stored === undefined) return null;
    return toStoredBytes(stored.bytes);
  }

  /**
   * 只判断字节是否还在，不解包。列表渲染要判断"记录是否可用"，
   * 每张卡都解一次 ZIP 会让本地库在打开时卡住。
   */
  async hasArchive(digest: string): Promise<boolean> {
    const stored = await runLocalLibraryTransaction(
      LOCAL_LIBRARY_STORE_NAMES.webPackageArchives,
      'readonly',
      (transaction) =>
        getLocalLibraryRecord<{ digest: string; bytes: unknown }>(
          transaction.objectStore(LOCAL_LIBRARY_STORE_NAMES.webPackageArchives),
          digest,
        ),
    );
    return stored !== undefined;
  }
}

let sharedRepository: IndexedDbWebPackageRepository | null = null;

export const getLocalWebPackageRepository = (): IndexedDbWebPackageRepository => {
  sharedRepository ??= new IndexedDbWebPackageRepository();
  return sharedRepository;
};

export const resetLocalWebPackageRepository = (): void => {
  sharedRepository = null;
};
