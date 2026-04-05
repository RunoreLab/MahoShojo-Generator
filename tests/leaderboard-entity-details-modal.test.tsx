import { beforeEach, describe, expect, test } from 'bun:test';

import '@/tests/helpers/fake-indexeddb';

import { __resetAiSessionDbForTest } from '@/lib/ai-session/storage';
import { AI_SESSION_DB_NAME } from '@/lib/ai-session/types';
import { clearPublicCardMemoryCacheForTest } from '@/lib/public-card-cache/shared-loader';

describe('LeaderboardEntityDetailsModal', () => {
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

  test('同一 data_card 跨组件实例二次打开详情时优先命中共享缓存，不再重复请求 /api/public-data-cards', async () => {
    const { loadLeaderboardEntityDetails } = await import('@/components/ranking/LeaderboardEntityDetailsModal');

    let fetchCount = 0;
    const fetcher = async (input: string) => {
      if (!input.startsWith('/api/public-data-cards?id=')) {
        throw new Error(`unexpected fetch: ${input}`);
      }

      fetchCount += 1;
      return new Response(
        JSON.stringify({
          success: true,
          card: {
            id: 'card-details-1',
            name: 'API 详情卡',
            description: '来自 API 的完整简介',
            type: 'character',
            data: JSON.stringify({
              templateId: '通用角色',
              name: 'API 详情卡',
              content: '# API 详情卡',
            }),
            is_public: 1,
            username: '真实作者',
            usage_count: 12,
            like_count: 34,
            favorite_count: 56,
            created_at: '2026-04-05T10:00:00.000Z',
            updated_at: '2026-04-05T12:00:00.000Z',
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    };

    const entity = {
      entityType: 'data_card' as const,
      entityId: 'card-details-1',
      displayName: '排行榜展示名',
      authorName: '排行榜作者',
      pendingNotice: '待审核版本仍在排队中',
    };

    const first = await loadLeaderboardEntityDetails(entity, { fetcher });
    expect(first.card.name).toBe('API 详情卡');
    expect(first.card.description).toBe('来自 API 的完整简介');
    expect(first.card.author).toBe('真实作者');

    clearPublicCardMemoryCacheForTest();

    const second = await loadLeaderboardEntityDetails(entity, { fetcher });
    expect(fetchCount).toBe(1);
    expect(second.card.name).toBe('API 详情卡');
    expect(second.card.description).toBe('来自 API 的完整简介');
    expect(second.card.author).toBe('真实作者');
    expect(second.card.likeCount).toBe(34);
    expect(second.pendingNotice).toBe(entity.pendingNotice);
  });
});
