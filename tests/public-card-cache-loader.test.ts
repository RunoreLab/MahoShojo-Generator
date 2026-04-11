import { beforeEach, describe, expect, test } from 'bun:test';
import '@/tests/helpers/fake-indexeddb';

import { __resetAiSessionDbForTest } from '@/lib/ai-session/storage';
import { AI_SESSION_DB_NAME } from '@/lib/ai-session/types';
import {
  getPublicCardCacheRecord,
  putPublicCardCacheRecord,
  trimPublicCardCacheToLimit,
} from '@/lib/public-card-cache/storage';
import {
  clearPublicCardMemoryCacheForTest,
  getPublicCardByIdWithSharedCache,
  writePublicCardCacheFromSidecar,
} from '@/lib/public-card-cache/shared-loader';
import {
  PUBLIC_CARD_CACHE_FRESH_TTL_MS,
  PUBLIC_CARD_CACHE_HARD_TTL_MS,
  PUBLIC_CARD_CACHE_NEGATIVE_TTL_MS,
} from '@/lib/public-card-cache/types';

const NOW_MS = 1_000_000;
const waitForAsync = async (predicate: () => Promise<boolean>, maxAttempts = 40): Promise<void> => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error('condition not met');
};

const baseSidecar = {
  id: 'card-sidecar-1',
  name: '侧载敌人',
  data: JSON.stringify({
    templateId: '通用角色',
    name: '侧载敌人',
    content: '# 侧载敌人',
  }),
  updatedAt: '2026-04-05T12:00:00.000Z',
} as const;

describe('public card cache loader', () => {
  beforeEach(async () => {
    clearPublicCardMemoryCacheForTest();
    await __resetAiSessionDbForTest();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(AI_SESSION_DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('deleteDatabase failed'));
      request.onblocked = () => resolve();
    });
  });

  test('memory 命中时不会访问 IndexedDB 或网络', async () => {
    await writePublicCardCacheFromSidecar(baseSidecar, { nowMs: NOW_MS });
    let fetchCount = 0;

    const result = await getPublicCardByIdWithSharedCache({
      id: baseSidecar.id,
      nowMs: NOW_MS,
      fetcher: async () => {
        fetchCount += 1;
        return { kind: 'error', statusCode: 500, errorKind: 'http' } as const;
      },
    });

    expect(result.source).toBe('memory');
    expect((result.card as { name?: string } | null)?.name).toBe('侧载敌人');
    expect(fetchCount).toBe(0);
  });

  test('IDB fresh 命中时直接返回缓存值', async () => {
    await writePublicCardCacheFromSidecar(baseSidecar, { nowMs: NOW_MS });
    clearPublicCardMemoryCacheForTest();
    let fetchCount = 0;

    const result = await getPublicCardByIdWithSharedCache({
      id: baseSidecar.id,
      nowMs: NOW_MS,
      fetcher: async () => {
        fetchCount += 1;
        return { kind: 'error', statusCode: 500, errorKind: 'http' } as const;
      },
    });

    expect(result.source).toBe('indexeddb');
    expect((result.card as { name?: string } | null)?.name).toBe('侧载敌人');
    expect(fetchCount).toBe(0);
  });

  test('memory 命中会刷新 L2 lastAccessedAtMs，避免 trim 误删热卡', async () => {
    await writePublicCardCacheFromSidecar(baseSidecar, { nowMs: NOW_MS });

    await getPublicCardByIdWithSharedCache({
      id: baseSidecar.id,
      nowMs: NOW_MS + 500,
      fetcher: async () => {
        throw new Error('should not fetch');
      },
    });

    for (let index = 0; index < 256; index += 1) {
      await putPublicCardCacheRecord({
        id: `card-extra-${index}`,
        cacheKind: 'card',
        name: `额外卡 ${index}`,
        data: JSON.stringify({ templateId: '通用角色', name: `额外卡 ${index}` }),
        updatedAt: null,
        fetchedAtMs: NOW_MS + index,
        lastAccessedAtMs: NOW_MS + 100 + index,
        expiresAtMs: NOW_MS + PUBLIC_CARD_CACHE_HARD_TTL_MS,
        renderableTemplate: 'general',
        isRenderable: true,
        source: 'public-data-card-api',
      });
    }

    await trimPublicCardCacheToLimit();
    clearPublicCardMemoryCacheForTest();

    expect(await getPublicCardCacheRecord(baseSidecar.id)).not.toBeNull();
    expect(await getPublicCardCacheRecord('card-extra-0')).toBeNull();
  });

  test('stale 命中时先返回缓存，再触发后台 revalidate', async () => {
    await putPublicCardCacheRecord({
      id: 'card-stale',
      cacheKind: 'card',
      name: '旧卡',
      data: JSON.stringify({ templateId: '通用角色', name: '旧卡', content: '# 旧卡' }),
      updatedAt: null,
      fetchedAtMs: NOW_MS - PUBLIC_CARD_CACHE_FRESH_TTL_MS - 1,
      lastAccessedAtMs: NOW_MS - 5,
      expiresAtMs: NOW_MS + 1_000,
      renderableTemplate: 'general',
      isRenderable: true,
      source: 'public-data-card-api',
    });
    clearPublicCardMemoryCacheForTest();

    let fetchCount = 0;
    const result = await getPublicCardByIdWithSharedCache({
      id: 'card-stale',
      nowMs: NOW_MS,
      fetcher: async () => {
        fetchCount += 1;
        return {
          kind: 'success',
          card: {
            id: 'card-stale',
            name: '新卡',
            data: JSON.stringify({ templateId: '通用角色', name: '新卡', content: '# 新卡' }),
            updated_at: '2026-04-05T13:00:00.000Z',
          },
        } as const;
      },
    });

    expect(result.source).toBe('stale-indexeddb');
    expect((result.card as { name?: string } | null)?.name).toBe('旧卡');
    expect(fetchCount).toBe(1);

    await waitForAsync(async () => {
      const record = await getPublicCardCacheRecord('card-stale');
      return record?.cacheKind === 'card' && record.name === '新卡';
    });
  });

  test('后台 revalidate 成功时，新 TTL 从完成时刻开始计算', async () => {
    await putPublicCardCacheRecord({
      id: 'card-stale-delayed-success',
      cacheKind: 'card',
      name: '旧卡',
      data: JSON.stringify({ templateId: '通用角色', name: '旧卡', content: '# 旧卡' }),
      updatedAt: null,
      fetchedAtMs: NOW_MS - PUBLIC_CARD_CACHE_FRESH_TTL_MS - 1,
      lastAccessedAtMs: NOW_MS - 5,
      expiresAtMs: NOW_MS + 1_000,
      renderableTemplate: 'general',
      isRenderable: true,
      source: 'public-data-card-api',
    });
    clearPublicCardMemoryCacheForTest();

    const delayedNowMs = NOW_MS + 5_000;
    let revalidateNowMs = NOW_MS;
    let resolveFetch: ((value: {
      kind: 'success';
      card: {
        id: string;
        name: string;
        data: string;
        updated_at: string;
      };
    }) => void) | null = null;
    const fetcher = () =>
      new Promise<{
        kind: 'success';
        card: {
          id: string;
          name: string;
          data: string;
          updated_at: string;
        };
      }>((resolve) => {
        resolveFetch = resolve;
      });

    const result = await getPublicCardByIdWithSharedCache({
      id: 'card-stale-delayed-success',
      nowMs: NOW_MS,
      fetcher,
      getNowMs: () => revalidateNowMs,
    });

    expect(result.source).toBe('stale-indexeddb');
    expect((result.card as { name?: string } | null)?.name).toBe('旧卡');

    revalidateNowMs = delayedNowMs;
    resolveFetch?.({
      kind: 'success',
      card: {
        id: 'card-stale-delayed-success',
        name: '新卡',
        data: JSON.stringify({ templateId: '通用角色', name: '新卡', content: '# 新卡' }),
        updated_at: '2026-04-05T13:00:00.000Z',
      },
    });

    await waitForAsync(async () => {
      const record = await getPublicCardCacheRecord('card-stale-delayed-success');
      return record?.cacheKind === 'card' && record.name === '新卡';
    });

    const record = await getPublicCardCacheRecord('card-stale-delayed-success');
    expect(record?.cacheKind).toBe('card');
    expect(record?.fetchedAtMs).toBe(delayedNowMs);
    expect(record?.expiresAtMs).toBe(delayedNowMs + PUBLIC_CARD_CACHE_HARD_TTL_MS);
  });

  test('后台 revalidate 返回 404 时，负缓存 TTL 从完成时刻开始计算', async () => {
    await putPublicCardCacheRecord({
      id: 'card-stale-delayed-404',
      cacheKind: 'card',
      name: '旧卡',
      data: JSON.stringify({ templateId: '通用角色', name: '旧卡', content: '# 旧卡' }),
      updatedAt: null,
      fetchedAtMs: NOW_MS - PUBLIC_CARD_CACHE_FRESH_TTL_MS - 1,
      lastAccessedAtMs: NOW_MS - 5,
      expiresAtMs: NOW_MS + 1_000,
      renderableTemplate: 'general',
      isRenderable: true,
      source: 'public-data-card-api',
    });
    clearPublicCardMemoryCacheForTest();

    const delayedNowMs = NOW_MS + 9_000;
    let revalidateNowMs = NOW_MS;
    let resolveFetch: ((value: { kind: 'not-found'; statusCode: 404 }) => void) | null = null;
    const fetcher = () =>
      new Promise<{ kind: 'not-found'; statusCode: 404 }>((resolve) => {
        resolveFetch = resolve;
      });

    const result = await getPublicCardByIdWithSharedCache({
      id: 'card-stale-delayed-404',
      nowMs: NOW_MS,
      fetcher,
      getNowMs: () => revalidateNowMs,
    });

    expect(result.source).toBe('stale-indexeddb');
    expect((result.card as { name?: string } | null)?.name).toBe('旧卡');

    revalidateNowMs = delayedNowMs;
    resolveFetch?.({ kind: 'not-found', statusCode: 404 });

    await waitForAsync(async () => {
      const record = await getPublicCardCacheRecord('card-stale-delayed-404');
      return record?.cacheKind === 'negative';
    });

    const record = await getPublicCardCacheRecord('card-stale-delayed-404');
    expect(record?.cacheKind).toBe('negative');
    expect(record?.fetchedAtMs).toBe(delayedNowMs);
    expect(record?.expiresAtMs).toBe(delayedNowMs + PUBLIC_CARD_CACHE_NEGATIVE_TTL_MS);
  });

  test('404 会写入负缓存，并在 TTL 内短路重复请求', async () => {
    let fetchCount = 0;
    const fetcher = async () => {
      fetchCount += 1;
      return { kind: 'not-found', statusCode: 404 } as const;
    };

    const first = await getPublicCardByIdWithSharedCache({
      id: 'missing-card',
      nowMs: NOW_MS,
      fetcher,
    });
    const second = await getPublicCardByIdWithSharedCache({
      id: 'missing-card',
      nowMs: NOW_MS + 1_000,
      fetcher,
    });

    expect(first.card).toBeNull();
    expect(second.card).toBeNull();
    expect(first.source).toBe('negative-cache');
    expect(second.source).toBe('negative-cache');
    expect(fetchCount).toBe(1);
  });

  test('API 成功结果写入缓存后，后续 cache hit 会保留详情字段', async () => {
    const apiRow = {
      id: 'card-details-1',
      name: '详情卡',
      description: '来自 API 的完整详情',
      type: 'character',
      data: JSON.stringify({ templateId: '通用角色', name: '详情卡', content: '# 详情卡' }),
      is_public: 1,
      username: '真实作者',
      usage_count: 12,
      like_count: 34,
      favorite_count: 56,
      created_at: '2026-04-05T10:00:00.000Z',
      updated_at: '2026-04-05T12:00:00.000Z',
    } as const;

    const first = await getPublicCardByIdWithSharedCache({
      id: apiRow.id,
      nowMs: NOW_MS,
      fetcher: async () => ({ kind: 'success', card: apiRow }) as const,
    });

    expect(first.source).toBe('network');
    clearPublicCardMemoryCacheForTest();

    const second = await getPublicCardByIdWithSharedCache({
      id: apiRow.id,
      nowMs: NOW_MS + 1_000,
      fetcher: async () => {
        throw new Error('should not fetch');
      },
    });

    const card = second.card as Record<string, unknown> | null;
    expect(second.source).toBe('indexeddb');
    expect(card?.description).toBe(apiRow.description);
    expect(card?.type).toBe(apiRow.type);
    expect(card?.username).toBe(apiRow.username);
    expect(card?.created_at).toBe(apiRow.created_at);
    expect(card?.updated_at).toBe(apiRow.updated_at);
    expect(card?.usage_count).toBe(apiRow.usage_count);
    expect(card?.like_count).toBe(apiRow.like_count);
    expect(card?.favorite_count).toBe(apiRow.favorite_count);
  });

  test('500 不会写入负缓存', async () => {
    let fetchCount = 0;
    const fetcher = async () => {
      fetchCount += 1;
      return { kind: 'error', statusCode: 500, errorKind: 'http' } as const;
    };

    await getPublicCardByIdWithSharedCache({ id: 'server-error-card', nowMs: NOW_MS, fetcher });
    await getPublicCardByIdWithSharedCache({ id: 'server-error-card', nowMs: NOW_MS + 1_000, fetcher });

    expect(fetchCount).toBe(2);
    expect(await getPublicCardCacheRecord('server-error-card')).toBeNull();
  });

  test('negative cache 过期后会重新访问网络', async () => {
    await putPublicCardCacheRecord({
      id: 'negative-expired',
      cacheKind: 'negative',
      statusCode: 404,
      fetchedAtMs: NOW_MS - 10_000,
      lastAccessedAtMs: NOW_MS - 10_000,
      expiresAtMs: NOW_MS - 1,
      reason: 'not-found',
    });
    clearPublicCardMemoryCacheForTest();

    let fetchCount = 0;
    const result = await getPublicCardByIdWithSharedCache({
      id: 'negative-expired',
      nowMs: NOW_MS,
      fetcher: async () => {
        fetchCount += 1;
        return {
          kind: 'success',
          card: {
            id: 'negative-expired',
            name: '恢复卡',
            data: JSON.stringify({ templateId: '通用角色', name: '恢复卡', content: '# 恢复卡' }),
            updated_at: null,
          },
        } as const;
      },
    });

    expect(result.source).toBe('network');
    expect((result.card as { name?: string } | null)?.name).toBe('恢复卡');
    expect(fetchCount).toBe(1);
  });

  test('HARD_TTL 到期时必须回源，而不是继续返回 stale 值', async () => {
    await putPublicCardCacheRecord({
      id: 'card-hard-expired',
      cacheKind: 'card',
      name: '硬过期旧卡',
      data: JSON.stringify({ templateId: '通用角色', name: '硬过期旧卡', content: '# 旧卡' }),
      updatedAt: null,
      fetchedAtMs: NOW_MS - PUBLIC_CARD_CACHE_HARD_TTL_MS - 1,
      lastAccessedAtMs: NOW_MS - 100,
      expiresAtMs: NOW_MS - 1,
      renderableTemplate: 'general',
      isRenderable: true,
      source: 'public-data-card-api',
    });
    clearPublicCardMemoryCacheForTest();

    const result = await getPublicCardByIdWithSharedCache({
      id: 'card-hard-expired',
      nowMs: NOW_MS,
      fetcher: async () =>
        ({
          kind: 'success',
          card: {
            id: 'card-hard-expired',
            name: '硬过期新卡',
            data: JSON.stringify({ templateId: '通用角色', name: '硬过期新卡', content: '# 新卡' }),
            updated_at: null,
          },
        }) as const,
    });

    expect(result.source).toBe('network');
    expect((result.card as { name?: string } | null)?.name).toBe('硬过期新卡');
  });

  test('IndexedDB 不可用时会安全降级为 memory-only', async () => {
    const originalIndexedDB = window.indexedDB;
    // @ts-expect-error test override
    delete window.indexedDB;
    try {
      await writePublicCardCacheFromSidecar(baseSidecar, { nowMs: NOW_MS });
      const result = await getPublicCardByIdWithSharedCache({
        id: baseSidecar.id,
        nowMs: NOW_MS,
        fetcher: async () => {
          throw new Error('should not fetch');
        },
      });

      expect(result.source).toBe('memory');
      expect((result.card as { name?: string } | null)?.name).toBe('侧载敌人');
    } finally {
      window.indexedDB = originalIndexedDB;
    }
  });

  test('sidecar write-through 后可被共享 loader 直接读出', async () => {
    await writePublicCardCacheFromSidecar(baseSidecar, { nowMs: NOW_MS });
    clearPublicCardMemoryCacheForTest();

    const result = await getPublicCardByIdWithSharedCache({
      id: baseSidecar.id,
      nowMs: NOW_MS,
      fetcher: async () => {
        throw new Error('should not fetch');
      },
    });

    expect(result.source).toBe('indexeddb');
    expect((result.card as { name?: string } | null)?.name).toBe('侧载敌人');
  });
});
