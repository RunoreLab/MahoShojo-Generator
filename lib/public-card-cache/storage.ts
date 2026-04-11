import { openAiSessionDb, requestToPromise, transactionToPromise } from '@/lib/ai-session/storage';
import { AI_SESSION_STORE_NAMES } from '@/lib/ai-session/types';
import {
  PUBLIC_CARD_CACHE_MAX_CARD_ENTRIES,
  PUBLIC_CARD_CACHE_MAX_NEGATIVE_ENTRIES,
  type PublicCardCacheEntry,
} from '@/lib/public-card-cache/types';

const PUBLIC_CARD_CACHE_STORE = AI_SESSION_STORE_NAMES.publicCardCache;
const EXPIRED_CLEANUP_LIMIT = 256;

const openPublicCardCacheStore = async (mode: IDBTransactionMode): Promise<{
  transaction: IDBTransaction;
  store: IDBObjectStore;
}> => {
  const db = await openAiSessionDb();
  const transaction = db.transaction([PUBLIC_CARD_CACHE_STORE], mode);
  return {
    transaction,
    store: transaction.objectStore(PUBLIC_CARD_CACHE_STORE),
  };
};

export const getPublicCardCacheRecord = async (id: string): Promise<PublicCardCacheEntry | null> => {
  const normalizedId = id.trim();
  if (!normalizedId) return null;

  const { transaction, store } = await openPublicCardCacheStore('readonly');
  const result = await requestToPromise(store.get(normalizedId));
  await transactionToPromise(transaction);
  return (result as PublicCardCacheEntry | undefined) ?? null;
};

export const putPublicCardCacheRecord = async (record: PublicCardCacheEntry): Promise<void> => {
  const { transaction, store } = await openPublicCardCacheStore('readwrite');
  store.put(record);
  await transactionToPromise(transaction);
};

export const touchPublicCardCacheRecord = async (id: string, nowMs: number): Promise<void> => {
  const normalizedId = id.trim();
  if (!normalizedId) return;

  const { transaction, store } = await openPublicCardCacheStore('readwrite');
  const current = (await requestToPromise(store.get(normalizedId)) as PublicCardCacheEntry | undefined) ?? null;
  if (current) {
    store.put({
      ...current,
      lastAccessedAtMs: nowMs,
    } satisfies PublicCardCacheEntry);
  }
  await transactionToPromise(transaction);
};

export const deletePublicCardCacheRecord = async (id: string): Promise<void> => {
  const normalizedId = id.trim();
  if (!normalizedId) return;

  const { transaction, store } = await openPublicCardCacheStore('readwrite');
  store.delete(normalizedId);
  await transactionToPromise(transaction);
};

export const cleanupExpiredPublicCardCache = async (nowMs: number): Promise<number> => {
  const { transaction, store } = await openPublicCardCacheStore('readwrite');
  const index = store.index('by_expiresAt');
  let removedCount = 0;

  await new Promise<void>((resolve, reject) => {
    const request = index.openCursor(IDBKeyRange.upperBound(nowMs), 'next');

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || removedCount >= EXPIRED_CLEANUP_LIMIT) {
        resolve();
        return;
      }

      store.delete(cursor.primaryKey);
      removedCount += 1;
      cursor.continue();
    };

    request.onerror = () => reject(request.error ?? new Error('清理过期 public card cache 失败'));
  });

  await transactionToPromise(transaction);
  return removedCount;
};

const trimCacheKind = async (input: {
  store: IDBObjectStore;
  cacheKind: PublicCardCacheEntry['cacheKind'];
  limit: number;
}): Promise<void> =>
  await new Promise<void>((resolve, reject) => {
    const index = input.store.index('by_cacheKind_lastAccessedAt');
    const range = IDBKeyRange.bound(
      [input.cacheKind, Number.MIN_SAFE_INTEGER],
      [input.cacheKind, Number.MAX_SAFE_INTEGER],
    );

    const idsToDelete: IDBValidKey[] = [];
    let seen = 0;
    const request = index.openCursor(range, 'prev');

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        for (const id of idsToDelete) {
          input.store.delete(id);
        }
        resolve();
        return;
      }

      seen += 1;
      if (seen > input.limit) {
        idsToDelete.push(cursor.primaryKey);
      }
      cursor.continue();
    };

    request.onerror = () => reject(request.error ?? new Error(`裁剪 ${input.cacheKind} public card cache 失败`));
  });

export const trimPublicCardCacheToLimit = async (): Promise<void> => {
  const { transaction, store } = await openPublicCardCacheStore('readwrite');

  await trimCacheKind({
    store,
    cacheKind: 'card',
    limit: PUBLIC_CARD_CACHE_MAX_CARD_ENTRIES,
  });
  await trimCacheKind({
    store,
    cacheKind: 'negative',
    limit: PUBLIC_CARD_CACHE_MAX_NEGATIVE_ENTRIES,
  });

  await transactionToPromise(transaction);
};
