import { describe, expect, test } from 'bun:test';

import type { EnemySnapshotV1 } from '@/lib/challenge/types';

const createEnemySnapshot = (input: {
  sourceType: EnemySnapshotV1['sourceType'];
  sourceId: string;
  displayName: string;
  strengthTier: EnemySnapshotV1['strengthTier'];
}): EnemySnapshotV1 => ({
  version: 1,
  sourceType: input.sourceType,
  sourceId: input.sourceId,
  displayName: input.displayName,
  strengthTier: input.strengthTier,
  combatProfile: {},
  tags: [input.strengthTier],
  promptSummary: `${input.displayName}的竞技场挑战快照`,
});

describe('api/challenge/enemy-candidates', () => {
  test('GET 会返回归一化后的敌人快照候选与实际来源模式', async () => {
    const { createChallengeEnemyCandidatesHandler } = await import('@/pages/api/challenge/enemy-candidates');

    const handler = createChallengeEnemyCandidatesHandler({
      resolveChallengeEnemyCandidates: async (input) => {
        expect(input).toMatchObject({
          worldId: 'arena',
          tier: 'boss',
          sourceMode: 'online-first',
          runSeed: 'run-a',
          limit: 4,
        });

        return {
          worldId: 'arena',
          tier: 'boss',
          resolvedSourceMode: 'remote',
          candidates: [
            createEnemySnapshot({
              sourceType: 'public-card',
              sourceId: 'card-boss-1',
              displayName: '千日红',
              strengthTier: 'boss',
            }),
          ],
        };
      },
    });

    const response = await handler(
      new Request(
        'https://example.com/api/challenge/enemy-candidates?worldId=arena&tier=boss&sourceMode=online-first&runSeed=run-a&limit=4',
        {
          method: 'GET',
        }
      )
    );

    const payload = (await response.json()) as {
      success?: boolean;
      worldId?: string;
      tier?: string;
      resolvedSourceMode?: string;
      candidates?: EnemySnapshotV1[];
    };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      success: true,
      worldId: 'arena',
      tier: 'boss',
      resolvedSourceMode: 'remote',
    });
    expect(payload.candidates).toEqual([
      createEnemySnapshot({
        sourceType: 'public-card',
        sourceId: 'card-boss-1',
        displayName: '千日红',
        strengthTier: 'boss',
      }),
    ]);
  });

  test('非 GET 请求会返回 405', async () => {
    const { createChallengeEnemyCandidatesHandler } = await import('@/pages/api/challenge/enemy-candidates');
    const handler = createChallengeEnemyCandidatesHandler({
      resolveChallengeEnemyCandidates: async () => {
        throw new Error('should not be called');
      },
    });

    const response = await handler(
      new Request('https://example.com/api/challenge/enemy-candidates', {
        method: 'POST',
      })
    );

    expect(response.status).toBe(405);
  });

  test('非法 tier 参数会返回 400', async () => {
    const { createChallengeEnemyCandidatesHandler } = await import('@/pages/api/challenge/enemy-candidates');
    const handler = createChallengeEnemyCandidatesHandler({
      resolveChallengeEnemyCandidates: async () => {
        throw new Error('should not be called');
      },
    });

    const response = await handler(
      new Request('https://example.com/api/challenge/enemy-candidates?worldId=arena&tier=legendary', {
        method: 'GET',
      })
    );

    const payload = (await response.json()) as { error?: string };
    expect(response.status).toBe(400);
    expect(payload.error).toBe('无效的敌人强度档位');
  });

  test('暂不支持的 worldId 会返回 400', async () => {
    const { createChallengeEnemyCandidatesHandler } = await import('@/pages/api/challenge/enemy-candidates');
    const handler = createChallengeEnemyCandidatesHandler({
      resolveChallengeEnemyCandidates: async () => {
        throw new Error('should not be called');
      },
    });

    const response = await handler(
      new Request('https://example.com/api/challenge/enemy-candidates?worldId=unknown&tier=common', {
        method: 'GET',
      })
    );

    const payload = (await response.json()) as { error?: string };
    expect(response.status).toBe(400);
    expect(payload.error).toBe('暂不支持该挑战世界');
  });

  test('server resolver 在 online-first 失败时会回退 preset-only，并返回可用候选', async () => {
    const { resolveChallengeEnemyCandidates } = await import('@/lib/challenge/server/enemy-candidates');

    const result = await resolveChallengeEnemyCandidates(
      {
        worldId: 'arena',
        tier: 'elite',
        sourceMode: 'online-first',
        runSeed: 'run-fallback',
        limit: 3,
        baseUrl: 'https://example.com',
      },
      {
        fetcher: async (input) => {
          const url = typeof input === 'string' ? input : input.url;
          if (url.includes('/api/arena/leaderboard')) {
            return new Response(JSON.stringify({ success: false, error: 'unavailable' }), {
              status: 503,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          throw new Error(`unexpected fetch: ${url}`);
        },
      }
    );

    expect(result.resolvedSourceMode).toBe('preset-only');
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.every((candidate) => candidate.strengthTier === 'elite')).toBe(true);
  });
});
