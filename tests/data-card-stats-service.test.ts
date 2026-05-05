import { describe, expect, test } from 'bun:test';

import { recordDataCardStatInteraction } from '@/lib/data-card-stats/service';

describe('data-card stats service', () => {
  test('首次 interaction 插入成功后才递增计数', async () => {
    const calls: string[] = [];

    const result = await recordDataCardStatInteraction(
      { db: true },
      {
        dataCardId: 'card-1',
        eventType: 'like',
        actorScope: 'anonymous',
        actorKeyHash: 'hash-a',
        nowIso: '2026-05-05T12:00:00.000Z',
      },
      {
        insertInteractionIgnore: async () => {
          calls.push('insert');
          return true;
        },
        incrementLikeCount: async () => {
          calls.push('increment-like');
          return 1;
        },
        incrementUsageCount: async () => {
          calls.push('increment-usage');
          return 1;
        },
        deleteInteraction: async () => {
          calls.push('delete');
        },
      },
    );

    expect(result).toEqual({ success: true, alreadyExists: false });
    expect(calls).toEqual(['insert', 'increment-like']);
  });

  test('重复 interaction 命中唯一约束时不递增计数', async () => {
    const calls: string[] = [];

    const result = await recordDataCardStatInteraction(
      { db: true },
      {
        dataCardId: 'card-1',
        eventType: 'usage',
        actorScope: 'anonymous',
        actorKeyHash: 'hash-a',
        nowIso: '2026-05-05T12:00:00.000Z',
      },
      {
        insertInteractionIgnore: async () => {
          calls.push('insert');
          return false;
        },
        incrementLikeCount: async () => {
          calls.push('increment-like');
          return 1;
        },
        incrementUsageCount: async () => {
          calls.push('increment-usage');
          return 1;
        },
        deleteInteraction: async () => {
          calls.push('delete');
        },
      },
    );

    expect(result).toEqual({ success: true, alreadyExists: true });
    expect(calls).toEqual(['insert']);
  });

  test('卡片不可操作时回滚已插入的 interaction', async () => {
    const calls: string[] = [];

    const result = await recordDataCardStatInteraction(
      { db: true },
      {
        dataCardId: 'card-private',
        eventType: 'usage',
        actorScope: 'anonymous',
        actorKeyHash: 'hash-a',
        nowIso: '2026-05-05T12:00:00.000Z',
      },
      {
        insertInteractionIgnore: async () => {
          calls.push('insert');
          return true;
        },
        incrementLikeCount: async () => {
          calls.push('increment-like');
          return 1;
        },
        incrementUsageCount: async () => {
          calls.push('increment-usage');
          return 0;
        },
        deleteInteraction: async () => {
          calls.push('delete');
        },
      },
    );

    expect(result).toEqual({ success: false, notFound: true });
    expect(calls).toEqual(['insert', 'increment-usage', 'delete']);
  });

  test('计数递增异常时回滚已插入的 interaction 并继续抛出错误', async () => {
    const calls: string[] = [];

    await expect(
      recordDataCardStatInteraction(
        { db: true },
        {
          dataCardId: 'card-1',
          eventType: 'like',
          actorScope: 'anonymous',
          actorKeyHash: 'hash-a',
          nowIso: '2026-05-05T12:00:00.000Z',
        },
        {
          insertInteractionIgnore: async () => {
            calls.push('insert');
            return true;
          },
          incrementLikeCount: async () => {
            calls.push('increment-like');
            throw new Error('db write failed');
          },
          incrementUsageCount: async () => {
            calls.push('increment-usage');
            return 1;
          },
          deleteInteraction: async () => {
            calls.push('delete');
          },
        },
      ),
    ).rejects.toThrow('db write failed');

    expect(calls).toEqual(['insert', 'increment-like', 'delete']);
  });
});
