import { beforeEach, describe, expect, test } from 'bun:test';
import '@/tests/helpers/fake-indexeddb';

import { __resetAiSessionDbForTest, requestToPromise, transactionToPromise } from '@/lib/ai-session/storage';
import { AI_SESSION_DB_NAME, AI_SESSION_STORE_NAMES } from '@/lib/ai-session/types';
import { openChallengeDb } from '@/lib/challenge/storage';
import {
  cleanupExpiredPublicCardCache,
  getPublicCardCacheRecord,
  putPublicCardCacheRecord,
  trimPublicCardCacheToLimit,
} from '@/lib/public-card-cache/storage';

describe('public card cache storage', () => {
  beforeEach(async () => {
    await __resetAiSessionDbForTest();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(AI_SESSION_DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('deleteDatabase failed'));
      request.onblocked = () => resolve();
    });
  });

  test('创建 public_card_cache store 与索引', async () => {
    const db = await openChallengeDb();
    expect(db.objectStoreNames.contains(AI_SESSION_STORE_NAMES.publicCardCache)).toBe(true);

    const store = db.transaction(AI_SESSION_STORE_NAMES.publicCardCache, 'readonly')
      .objectStore(AI_SESSION_STORE_NAMES.publicCardCache);
    expect(store.indexNames.contains('by_expiresAt')).toBe(true);
    expect(store.indexNames.contains('by_lastAccessedAt')).toBe(true);
    expect(store.indexNames.contains('by_cacheKind_lastAccessedAt')).toBe(true);
  });

  test('cleanupExpiredPublicCardCache 只清理已过期项', async () => {
    await putPublicCardCacheRecord({
      id: 'card-expired',
      cacheKind: 'card',
      name: '过期卡',
      data: '{"name":"过期卡"}',
      updatedAt: null,
      fetchedAtMs: 100,
      lastAccessedAtMs: 100,
      expiresAtMs: 199,
      renderableTemplate: 'general',
      isRenderable: true,
      source: 'public-data-card-api',
    });
    await putPublicCardCacheRecord({
      id: 'card-fresh',
      cacheKind: 'card',
      name: '新鲜卡',
      data: '{"name":"新鲜卡"}',
      updatedAt: null,
      fetchedAtMs: 100,
      lastAccessedAtMs: 100,
      expiresAtMs: 300,
      renderableTemplate: 'general',
      isRenderable: true,
      source: 'public-data-card-api',
    });

    const removedCount = await cleanupExpiredPublicCardCache(200);

    expect(removedCount).toBe(1);
    expect(await getPublicCardCacheRecord('card-expired')).toBeNull();
    expect(await getPublicCardCacheRecord('card-fresh')).not.toBeNull();
  });

  test('trimPublicCardCacheToLimit 会按 cacheKind + lastAccessedAtMs 裁剪旧项', async () => {
    for (let index = 0; index < 257; index += 1) {
      await putPublicCardCacheRecord({
        id: `card-${index}`,
        cacheKind: 'card',
        name: `卡 ${index}`,
        data: `{"name":"卡 ${index}"}`,
        updatedAt: null,
        fetchedAtMs: 1000 + index,
        lastAccessedAtMs: 1000 + index,
        expiresAtMs: 999999,
        renderableTemplate: 'general',
        isRenderable: true,
        source: 'public-data-card-api',
      });
    }

    for (let index = 0; index < 129; index += 1) {
      await putPublicCardCacheRecord({
        id: `negative-${index}`,
        cacheKind: 'negative',
        statusCode: 404,
        fetchedAtMs: 2000 + index,
        lastAccessedAtMs: 2000 + index,
        expiresAtMs: 999999,
        reason: 'not-found',
      });
    }

    await trimPublicCardCacheToLimit();

    expect(await getPublicCardCacheRecord('card-0')).toBeNull();
    expect(await getPublicCardCacheRecord('negative-0')).toBeNull();
    expect(await getPublicCardCacheRecord('card-256')).not.toBeNull();
    expect(await getPublicCardCacheRecord('negative-128')).not.toBeNull();

    const db = await openChallengeDb();
    const transaction = db.transaction([AI_SESSION_STORE_NAMES.publicCardCache], 'readonly');
    const store = transaction.objectStore(AI_SESSION_STORE_NAMES.publicCardCache);
    const count = await requestToPromise(store.count());
    await transactionToPromise(transaction);

    expect(count).toBe(256 + 128);
  });
});
