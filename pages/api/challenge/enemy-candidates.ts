import type { ChallengeWorldId, StrengthTier } from '@/lib/challenge/types';
import {
  resolveChallengeEnemyCandidates,
  type ResolveChallengeEnemyCandidatesResult,
} from '@/lib/challenge/server/enemy-candidates';

export const runtime = 'edge';

type HandlerDeps = {
  resolveChallengeEnemyCandidates: (input: {
    worldId: ChallengeWorldId;
    tier: StrengthTier;
    sourceMode: 'online-first' | 'preset-only';
    runSeed?: string | null;
    limit?: number;
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

export const createChallengeEnemyCandidatesHandler = (
  deps: HandlerDeps = {
    resolveChallengeEnemyCandidates,
  }
) => {
  return async function handler(req: Request): Promise<Response> {
    if (req.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      const url = new URL(req.url);
      const worldId = (url.searchParams.get('worldId') ?? 'arena') as ChallengeWorldId;
      if (worldId !== 'arena') {
        return new Response(JSON.stringify({ error: '暂不支持该挑战世界' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const tier = parseTier(url.searchParams.get('tier'));
      if (!tier) {
        return new Response(JSON.stringify({ error: '无效的敌人强度档位' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const sourceMode = url.searchParams.get('sourceMode') === 'preset-only' ? 'preset-only' : 'online-first';
      const runSeedRaw = url.searchParams.get('runSeed');
      const runSeed = typeof runSeedRaw === 'string' && runSeedRaw.trim() ? runSeedRaw.trim() : null;
      const limit = parseLimit(url.searchParams.get('limit'));

      const result = await deps.resolveChallengeEnemyCandidates({
        worldId,
        tier,
        sourceMode,
        runSeed,
        limit,
        baseUrl: url.origin,
      });

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
        }
      );
    } catch (error) {
      console.error('获取挑战敌人候选失败:', error);
      return new Response(JSON.stringify({ error: '获取挑战敌人候选失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  };
};

export default createChallengeEnemyCandidatesHandler();
