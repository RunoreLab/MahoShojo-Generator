import { describe, expect, test } from 'bun:test';

import { createBattleReportWriteContext } from '@/lib/arena/battle-report-write-context';

describe('battle-report-write-context', () => {
  test('在创建时立即预热用户与赛季读取，并缓存结果供后续异步写库复用', async () => {
    let authCalls = 0;
    let seasonCalls = 0;

    const context = createBattleReportWriteContext({
      requestUrl: 'https://example.com/api/arena/generate-stream',
      authUserResolver: {
        getUser: async () => {
          authCalls += 1;
          return {
            id: 20,
            username: '未代之夜',
            prefix: null,
            is_banned: null,
            is_admin: 0,
            is_review_exempt: 0,
          };
        },
      },
      fetchCurrentSeason: async (origin) => {
        seasonCalls += 1;
        expect(origin).toBe('https://example.com');
        return {
          id: 'S1',
          name: '测试赛季',
          startsAt: '2026-03-01T00:00:00.000Z',
          endsAt: null,
          status: 'current',
          description: 'desc',
          specialRules: {
            mode: 'scenario',
            storyGuidance: '双方全力以赴',
            scenarioPresetFilename: 'S01_queen_will',
          },
        };
      },
    });

    expect(authCalls).toBe(1);
    expect(seasonCalls).toBe(1);

    const [userA, userB, season, strictRules] = await Promise.all([
      context.getAuthUser(),
      context.getAuthUser(),
      context.getCurrentSeason(),
      context.getSeasonStrictRules(),
    ]);

    expect(userA?.id).toBe(20);
    expect(userB?.username).toBe('未代之夜');
    expect(season?.id).toBe('S1');
    expect(strictRules).toEqual({
      mode: 'scenario',
      storyGuidance: '双方全力以赴',
      scenarioPresetFilename: 'S01_queen_will.json',
      questionnaireLoreAllowed: false,
      questionnaireLorePresetIds: [],
    });
    expect(authCalls).toBe(1);
    expect(seasonCalls).toBe(1);
  });

  test('预热依赖抛错时降级为空，不阻断成功战报写库', async () => {
    const context = createBattleReportWriteContext({
      requestUrl: 'https://example.com/api/generate-battle-story',
      authUserResolver: {
        getUser: async () => {
          throw new Error('auth expired');
        },
      },
      fetchCurrentSeason: async () => {
        throw new Error('origin fetch failed');
      },
    });

    expect(await context.getAuthUser()).toBeNull();
    expect(await context.getCurrentSeason()).toBeNull();
    expect(await context.getSeasonStrictRules()).toEqual({
      mode: 'classic',
      storyGuidance: '',
      scenarioPresetFilename: null,
      questionnaireLoreAllowed: false,
      questionnaireLorePresetIds: [],
    });
  });
});
