import { describe, expect, test } from 'bun:test';

import type { ChallengeResolvedSourceCardLite, EnemySnapshotV1 } from '@/lib/challenge/types';

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

const createResolvedSourceCardLite = (id: string, name: string): ChallengeResolvedSourceCardLite => ({
  id,
  name,
  data: JSON.stringify({ codename: name, appearance: {}, magicConstruct: {}, wonderlandRule: {}, blooming: {}, analysis: {} }),
  updatedAt: '2026-04-05T11:30:00.000Z',
});

describe('api/challenge/enemy-candidates', () => {
  test('compatibility 模式返回 candidates，并省略 enemySnapshot / resolvedSourceCardLite', async () => {
    const { createChallengeEnemyCandidatesHandler } = await import('@/pages/api/challenge/enemy-candidates');

    const handler = createChallengeEnemyCandidatesHandler({
      resolveChallengeEnemyCandidates: async (input) => {
        expect(input).toMatchObject({
          worldId: 'arena',
          tier: 'boss',
          sourceMode: 'online-first',
          runSeed: 'run-a',
          limit: 4,
          selectionSeed: null,
        });

        return {
          mode: 'compatibility',
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
        { method: 'GET' },
      ),
    );

    const payload = (await response.json()) as {
      success?: boolean;
      worldId?: string;
      tier?: string;
      resolvedSourceMode?: string;
      candidates?: EnemySnapshotV1[];
      enemySnapshot?: EnemySnapshotV1;
      resolvedSourceCardLite?: ChallengeResolvedSourceCardLite | null;
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
    expect(payload.enemySnapshot).toBeUndefined();
    expect(payload.resolvedSourceCardLite).toBeUndefined();
  });

  test('selectionSeed 模式返回 enemySnapshot 和 resolvedSourceCardLite，不返回 candidates', async () => {
    const { createChallengeEnemyCandidatesHandler } = await import('@/pages/api/challenge/enemy-candidates');

    const handler = createChallengeEnemyCandidatesHandler({
      resolveChallengeEnemyCandidates: async (input) => {
        expect(input).toMatchObject({
          worldId: 'arena',
          tier: 'elite',
          sourceMode: 'online-first',
          runSeed: 'run-selection',
          limit: 6,
          selectionSeed: 'run-selection:L2-N1:elite',
        });

        return {
          mode: 'selection',
          worldId: 'arena',
          tier: 'elite',
          resolvedSourceMode: 'remote',
          enemySnapshot: createEnemySnapshot({
            sourceType: 'public-card',
            sourceId: 'card-elite-1',
            displayName: '雪绒',
            strengthTier: 'elite',
          }),
          resolvedSourceCardLite: createResolvedSourceCardLite('card-elite-1', '雪绒'),
        };
      },
    });

    const response = await handler(
      new Request(
        'https://example.com/api/challenge/enemy-candidates?worldId=arena&tier=elite&sourceMode=online-first&runSeed=run-selection&selectionSeed=run-selection%3AL2-N1%3Aelite',
        { method: 'GET' },
      ),
    );

    const payload = (await response.json()) as {
      success?: boolean;
      enemySnapshot?: EnemySnapshotV1;
      resolvedSourceCardLite?: ChallengeResolvedSourceCardLite | null;
      candidates?: EnemySnapshotV1[];
    };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.enemySnapshot?.sourceId).toBe('card-elite-1');
    expect(payload.resolvedSourceCardLite?.id).toBe('card-elite-1');
    expect(payload.candidates).toBeUndefined();
  });

  test('selectionSeed 模式在 remote 不足阈值时仍返回 preset-only enemySnapshot 和 null sidecar', async () => {
    const { createChallengeEnemyCandidatesHandler } = await import('@/pages/api/challenge/enemy-candidates');

    const handler = createChallengeEnemyCandidatesHandler({
      resolveChallengeEnemyCandidates: async () => ({
        mode: 'selection',
        worldId: 'arena',
        tier: 'elite',
        resolvedSourceMode: 'preset-only',
        enemySnapshot: createEnemySnapshot({
          sourceType: 'preset',
          sourceId: 'M01_centaurea.json',
          displayName: '矢车菊',
          strengthTier: 'elite',
        }),
        resolvedSourceCardLite: null,
      }),
    });

    const response = await handler(
      new Request(
        'https://example.com/api/challenge/enemy-candidates?worldId=arena&tier=elite&selectionSeed=run-b%3AL4-N1%3Aelite',
        { method: 'GET' },
      ),
    );

    const payload = (await response.json()) as {
      success?: boolean;
      resolvedSourceMode?: string;
      enemySnapshot?: EnemySnapshotV1;
      resolvedSourceCardLite?: ChallengeResolvedSourceCardLite | null;
      candidates?: EnemySnapshotV1[];
    };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.resolvedSourceMode).toBe('preset-only');
    expect(payload.enemySnapshot?.sourceType).toBe('preset');
    expect(payload.resolvedSourceCardLite).toBeNull();
    expect(payload.candidates).toBeUndefined();
  });

  test('非 GET 请求会返回 success=false 的 405', async () => {
    const { createChallengeEnemyCandidatesHandler } = await import('@/pages/api/challenge/enemy-candidates');
    const handler = createChallengeEnemyCandidatesHandler({
      resolveChallengeEnemyCandidates: async () => {
        throw new Error('should not be called');
      },
    });

    const response = await handler(
      new Request('https://example.com/api/challenge/enemy-candidates', {
        method: 'POST',
      }),
    );

    const payload = (await response.json()) as { success?: boolean; error?: string };
    expect(response.status).toBe(405);
    expect(payload.success).toBe(false);
    expect(payload.error).toBe('Method not allowed');
  });

  test('非法 tier 参数会返回 success=false 的 400', async () => {
    const { createChallengeEnemyCandidatesHandler } = await import('@/pages/api/challenge/enemy-candidates');
    const handler = createChallengeEnemyCandidatesHandler({
      resolveChallengeEnemyCandidates: async () => {
        throw new Error('should not be called');
      },
    });

    const response = await handler(
      new Request('https://example.com/api/challenge/enemy-candidates?worldId=arena&tier=legendary', {
        method: 'GET',
      }),
    );

    const payload = (await response.json()) as { success?: boolean; error?: string };
    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
    expect(payload.error).toBe('无效的敌人强度档位');
  });

  test('暂不支持的 worldId 会返回 success=false 的 400', async () => {
    const { createChallengeEnemyCandidatesHandler } = await import('@/pages/api/challenge/enemy-candidates');
    const handler = createChallengeEnemyCandidatesHandler({
      resolveChallengeEnemyCandidates: async () => {
        throw new Error('should not be called');
      },
    });

    const response = await handler(
      new Request('https://example.com/api/challenge/enemy-candidates?worldId=unknown&tier=common', {
        method: 'GET',
      }),
    );

    const payload = (await response.json()) as { success?: boolean; error?: string };
    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
    expect(payload.error).toBe('暂不支持该挑战世界');
  });

  test('server resolver 在 selection 模式下 remote 失败时会回退 preset-only，并返回 enemySnapshot + null sidecar', async () => {
    const { resolveChallengeEnemyCandidates } = await import('@/lib/challenge/server/enemy-candidates');

    const result = await resolveChallengeEnemyCandidates(
      {
        worldId: 'arena',
        tier: 'elite',
        sourceMode: 'online-first',
        runSeed: 'run-fallback',
        limit: 6,
        selectionSeed: 'run-fallback:L4-N1:elite',
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
      },
    );

    expect(result.mode).toBe('selection');
    expect(result.resolvedSourceMode).toBe('preset-only');
    expect(result.enemySnapshot.sourceType).toBe('preset');
    expect(result.resolvedSourceCardLite).toBeNull();
  });
});
