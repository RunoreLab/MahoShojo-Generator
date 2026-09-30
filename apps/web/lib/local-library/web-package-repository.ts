import {
  LocalWebPackageArchiveSchema,
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
const promisifyKeys = (request: IDBRequest<IDBValidKey[]>): Promise<IDBValidKey[]> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败。'));
  });

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

  /** `unreadable` 列出被跳过的损坏行 ID；为空表示全部可读。 */
  async list(query: LocalWebPackageQuery): Promise<LocalWebPackagePage & { unreadable: string[] }> {
    const parsedQuery = LocalWebPackageQuerySchema.parse(query);
    const offset = parseCursor(parsedQuery.cursor);
    const rows = await runLocalLibraryTransaction(LOCAL_LIBRARY_STORE_NAMES.webPackages, 'readonly', (transaction) =>
      getAllLocalLibraryRecords<LocalWebPackageRecordV1>(
        transaction.objectStore(LOCAL_LIBRARY_STORE_NAMES.webPackages).index(LOCAL_LIBRARY_INDEX_NAMES.byUpdatedAt),
      ),
    );

    // 逐行解析：一条坏行不该让整个本地库显示为"读取失败"的空列表。
    const unreadable: string[] = [];
    const parsed = rows.flatMap((row) => {
      const result = LocalWebPackageRecordV1Schema.safeParse(row);
      if (result.success) return [result.data];
      unreadable.push(typeof row?.id === 'string' ? row.id : '(未知)');
      return [];
    });

    const matching = parsed
      .filter((row) => parsedQuery.includeDeleted === true || row.deletedAt === undefined)
      .sort((left, right) => {
        if (left.updatedAt !== right.updatedAt) return right.updatedAt.localeCompare(left.updatedAt);
        return left.id.localeCompare(right.id);
      });

    const page = matching.slice(offset, offset + parsedQuery.limit);
    const nextOffset = offset + page.length;
    return {
      ...LocalWebPackagePageSchema.parse({
        items: page,
        ...(nextOffset < matching.length ? { nextCursor: String(nextOffset) } : {}),
      }),
      unreadable,
    };
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
        // 走契约 schema：收紧 LocalWebPackageArchiveSchema 时才真的能传导到实现，
        // 而不是各自维护一份"看起来一样"的读取判断。
        await putLocalLibraryRecord(
          transaction.objectStore(LOCAL_LIBRARY_STORE_NAMES.webPackageArchives),
          LocalWebPackageArchiveSchema.parse({
            digest: parsed.ref.digest,
            bytes,
            cachedAt: monotonicNowIso(parsed.updatedAt),
          }),
        );
      },
    );
  }

  /**
   * 幂等软删：只写 tombstone，**保留** archive 字节。
   *
   * 丢弃字节的时机是 `purge` 而不是这里。提前丢弃会让 `restore` 产出一条"记录在、字节缺"
   * 的行，而 `readArchive` 对它返回 `null`——与真正的存储损坏无法区分，用户恢复后只会看到
   * 一个打不开的包。
   */
  async delete(id: string): Promise<void> {
    await runLocalLibraryTransaction(LOCAL_LIBRARY_STORE_NAMES.webPackages, 'readwrite', async (transaction) => {
      const recordStore = transaction.objectStore(LOCAL_LIBRARY_STORE_NAMES.webPackages);
      const existing = await getLocalLibraryRecord<LocalWebPackageRecordV1>(recordStore, id);
      if (existing === undefined || existing.deletedAt !== undefined) return;
      await putLocalLibraryRecord(recordStore, { ...existing, deletedAt: monotonicNowIso(existing.updatedAt) });
    });
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

  /**
   * 彻底删除记录与它独占的 archive 字节。记录与字节在同一个事务里消失，
   * 因此不会出现"记录没了但字节还在"的中间态。
   */
  async purge(id: string): Promise<void> {
    await runLocalLibraryTransaction(
      [LOCAL_LIBRARY_STORE_NAMES.webPackages, LOCAL_LIBRARY_STORE_NAMES.webPackageArchives],
      'readwrite',
      async (transaction) => {
        const recordStore = transaction.objectStore(LOCAL_LIBRARY_STORE_NAMES.webPackages);
        const existing = await getLocalLibraryRecord<LocalWebPackageRecordV1>(recordStore, id);
        if (existing === undefined) return;
        await deleteLocalLibraryRecord(recordStore, id);
        await deleteLocalLibraryRecord(
          transaction.objectStore(LOCAL_LIBRARY_STORE_NAMES.webPackageArchives),
          existing.ref.digest,
        );
      },
    );
  }

  async readArchive(digest: string): Promise<Uint8Array | null> {
    const row = await this.readArchiveRow(digest);
    return row === null ? null : toStoredBytes(row.bytes);
  }

  /** 归档行读取；解析失败视为损坏行（返回 null），不冒充空包。 */
  private async readArchiveRow(digest: string): Promise<{ digest: string; bytes: ArrayBufferLike } | null> {
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
    const parsed = LocalWebPackageArchiveSchema.safeParse(stored);
    return parsed.success ? (parsed.data as { digest: string; bytes: ArrayBufferLike }) : null;
  }

  /**
   * 一次读出所有已存 archive 的 digest。
   *
   * 列表渲染要判断每条记录"字节是否还在"，逐条查询等于 N 次事务；ZIP 库常有几十条，
   * 在移动端会明显卡顿。keyPath 就是 digest，所以 `getAllKeys` 一次就够。
   */
  async listArchiveDigests(): Promise<Set<string>> {
    const keys = await runLocalLibraryTransaction(
      LOCAL_LIBRARY_STORE_NAMES.webPackageArchives,
      'readonly',
      (transaction) =>
        promisifyKeys(transaction.objectStore(LOCAL_LIBRARY_STORE_NAMES.webPackageArchives).getAllKeys()),
    );
    return new Set(keys.filter((key): key is string => typeof key === 'string'));
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
