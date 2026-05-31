import type { ChallengeWorldId, StrengthTier } from '@/lib/challenge/types';
import {
  resolveChallengeEnemyCandidates,
  type ResolveChallengeEnemyCandidatesResult,
} from '@/lib/challenge/server/enemy-candidates';

type HandlerDeps = {
  resolveChallengeEnemyCandidates: (input: {
    worldId: ChallengeWorldId;
    tier: StrengthTier;
    sourceMode: 'online-first' | 'preset-only';
    runSeed?: string | null;
    limit?: number;
    selectionSeed?: string | null;
    baseUrl: string;
  }) => Promise<ResolveChallengeEnemyCandidatesResult>;
};

const parseTier = (value: string | null): StrengthTier | null => {
  if (value === 'common' || value === 'elite' || value === 'boss') return value;
  return null;
};

const parseLimit = (value: string | null): number => {
  if (!value) return 6;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 6;
  return Math.max(1, Math.min(12, Math.floor(parsed)));
};

const errorJson = (status: number, error: string): Response =>
  new Response(JSON.stringify({ success: false, error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const createChallengeEnemyCandidatesHandler = (
  deps: HandlerDeps = {
    resolveChallengeEnemyCandidates,
  },
) => {
  return async function handler(req: Request): Promise<Response> {
    if (req.method !== 'GET') {
      return errorJson(405, 'Method not allowed');
    }

    try {
      const url = new URL(req.url);
      const worldId = (url.searchParams.get('worldId') ?? 'arena') as ChallengeWorldId;
      if (worldId !== 'arena') {
        return errorJson(400, '暂不支持该挑战世界');
      }

      const tier = parseTier(url.searchParams.get('tier'));
      if (!tier) {
        return errorJson(400, '无效的敌人强度档位');
      }

      const sourceMode = url.searchParams.get('sourceMode') === 'preset-only' ? 'preset-only' : 'online-first';
      const runSeedRaw = url.searchParams.get('runSeed');
      const runSeed = typeof runSeedRaw === 'string' && runSeedRaw.trim() ? runSeedRaw.trim() : null;
      const selectionSeedRaw = url.searchParams.get('selectionSeed');
      const selectionSeed = typeof selectionSeedRaw === 'string' && selectionSeedRaw.trim() ? selectionSeedRaw.trim() : null;
      const limit = parseLimit(url.searchParams.get('limit'));

      const result = await deps.resolveChallengeEnemyCandidates({
        worldId,
        tier,
        sourceMode,
        runSeed,
        limit,
        selectionSeed,
        baseUrl: url.origin,
      });

      if (result.mode === 'selection') {
        return new Response(
          JSON.stringify({
            success: true,
            worldId: result.worldId,
            tier: result.tier,
            resolvedSourceMode: result.resolvedSourceMode,
            enemySnapshot: result.enemySnapshot,
            resolvedSourceCardLite: result.resolvedSourceCardLite,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          worldId: result.worldId,
          tier: result.tier,
          resolvedSourceMode: result.resolvedSourceMode,
          candidates: result.candidates,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    } catch (error) {
      console.error('获取挑战敌人候选失败:', error);
      return errorJson(500, '获取挑战敌人候选失败');
    }
  };
};

export default createChallengeEnemyCandidatesHandler();
