import { describe, expect, test } from 'bun:test';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import {
  countBadgesById,
  grantBadgeToUsersInChunks,
  listEligibleReporterUsers,
  listRatedCharactersByQueue,
} from '@/lib/db/repositories/badges-granting';

type ExpectedCall = {
  method: 'all' | 'run';
  sqlIncludes: string;
  params: unknown[];
  result?: unknown;
  error?: Error;
};

const createMockDb = (expectedCalls: ExpectedCall[]) => {
  let index = 0;

  const invoke = async (method: 'all' | 'run', sqlText: string, params: unknown[]) => {
    const expected = expectedCalls[index];
    index += 1;

    expect(expected).toBeDefined();
    if (!expected) {
      throw new Error(`未预期的 SQL 调用: method=${method}, sql=${sqlText}`);
    }

    expect(method).toBe(expected.method);
    expect(sqlText.includes(expected.sqlIncludes)).toBeTrue();
    expect(params).toEqual(expected.params);

    if (expected.error) {
      throw expected.error;
    }

    return expected.result ?? { success: true, results: [], meta: {} };
  };

  const db = {
    $client: {
      prepare: (sqlText: string) => ({
        bind: (...params: unknown[]) => ({
          all: () => invoke('all', sqlText, params),
          run: () => invoke('run', sqlText, params),
        }),
      }),
    },
  } as unknown as AppDrizzleDb;

  const assertDone = () => {
    expect(index).toBe(expectedCalls.length);
  };

  return { db, assertDone };
};

describe('badges-granting repository', () => {
  test('countBadgesById: 解析 count 结果', async () => {
    const { db, assertDone } = createMockDb([
      {
        method: 'all',
        sqlIncludes: 'SELECT COUNT(*) as count FROM badges WHERE id = ?',
        params: ['season_s0_hana'],
        result: { success: true, results: [{ count: '2' }], meta: {} },
      },
    ]);

    const count = await countBadgesById(db, 'season_s0_hana');
    expect(count).toBe(2);
    assertDone();
  });

  test('listEligibleReporterUsers: 归一化字段类型', async () => {
    const { db, assertDone } = createMockDb([
      {
        method: 'all',
        sqlIncludes: 'FROM data_cards dc',
        params: [10, 20, 30],
        result: {
          success: true,
          results: [
            {
              userId: '12',
              username: 'Alice',
              publicCards: '3',
              totalLikes: '10',
              totalFavorites: 20,
              totalUsage: null,
            },
            {
              userId: 0,
              username: null,
              publicCards: -1,
              totalLikes: 'x',
              totalFavorites: '2',
              totalUsage: '3',
            },
          ],
          meta: {},
        },
      },
    ]);

    const rows = await listEligibleReporterUsers(db, {
      minTotalLikes: 10,
      minTotalFavorites: 20,
      minTotalUsage: 30,
    });

    expect(rows).toEqual([
      {
        userId: 12,
        username: 'Alice',
        publicCards: 3,
        totalLikes: 10,
        totalFavorites: 20,
        totalUsage: 0,
      },
      {
        userId: 0,
        username: '',
        publicCards: 0,
        totalLikes: 0,
        totalFavorites: 2,
        totalUsage: 3,
      },
    ]);
    assertDone();
  });

  test('listRatedCharactersByQueue: 归一化公开标记与字符串字段', async () => {
    const { db, assertDone } = createMockDb([
      {
        method: 'all',
        sqlIncludes: 'FROM arena_ratings ar',
        params: ['strict'],
        result: {
          success: true,
          results: [
            {
              userId: '7',
              username: 'U1',
              dataCardId: 'dc_1',
              cardName: '角色A',
              isPublic: '1',
              reviewStatus: 'approved',
              deletedAt: null,
              rating: '1201',
              games: '8',
            },
            {
              userId: 8,
              username: null,
              dataCardId: null,
              cardName: null,
              isPublic: 'false',
              reviewStatus: 123,
              deletedAt: 456,
              rating: 'bad',
              games: -3,
            },
          ],
          meta: {},
        },
      },
    ]);

    const rows = await listRatedCharactersByQueue(db, 'strict');
    expect(rows).toEqual([
      {
        userId: 7,
        username: 'U1',
        dataCardId: 'dc_1',
        cardName: '角色A',
        isPublic: 1,
        reviewStatus: 'approved',
        deletedAt: null,
        rating: 1201,
        games: 8,
      },
      {
        userId: 8,
        username: '',
        dataCardId: '',
        cardName: '',
        isPublic: false,
        reviewStatus: null,
        deletedAt: null,
        rating: 0,
        games: 0,
      },
    ]);
    assertDone();
  });

  test('grantBadgeToUsersInChunks: 去重+分块，并在失败时累计错误数', async () => {
    const { db, assertDone } = createMockDb([
      {
        method: 'run',
        sqlIncludes: 'INSERT OR IGNORE INTO user_badges',
        params: [1, 'badge_x', 2, 'badge_x'],
        result: { success: true, results: [], meta: { changes: 2 } },
      },
      {
        method: 'run',
        sqlIncludes: 'INSERT OR IGNORE INTO user_badges',
        params: [3, 'badge_x'],
        result: { success: false, error: 'write failed', results: [], meta: {} },
      },
    ]);

    const result = await grantBadgeToUsersInChunks(db, {
      badgeId: 'badge_x',
      userIds: [1, 1, 2, 0, -9, 3],
      chunkSize: 2,
    });

    expect(result).toEqual({
      inserted: 2,
      errors: 1,
    });
    assertDone();
  });

  test('grantBadgeToUsersInChunks: 全部无效 userId 时直接返回', async () => {
    const { db, assertDone } = createMockDb([]);
    const result = await grantBadgeToUsersInChunks(db, {
      badgeId: 'badge_x',
      userIds: [0, -1, -5],
      chunkSize: 2,
    });
    expect(result).toEqual({
      inserted: 0,
      errors: 0,
    });
    assertDone();
  });

  test('countBadgesById: D1 statement success=false 时抛错', async () => {
    const { db, assertDone } = createMockDb([
      {
        method: 'all',
        sqlIncludes: 'SELECT COUNT(*) as count FROM badges WHERE id = ?',
        params: ['broken_badge'],
        result: { success: false, error: 'boom', results: [], meta: {} },
      },
    ]);

    await expect(countBadgesById(db, 'broken_badge')).rejects.toThrow('boom');
    assertDone();
  });
});
