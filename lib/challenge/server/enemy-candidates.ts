import type { ChallengeWorldId, EnemySnapshotV1, StrengthTier } from '@/lib/challenge/types';
import { resolveArenaEnemyCandidates } from '@/lib/challenge/worlds/arena/enemy-source';
import { getBundledPresetData } from '@/lib/pvp/preset-bundled';

type RankedLeaderboardItem = {
  entityType: 'data_card' | 'preset';
  entityId: string;
  displayName?: string | null;
  rating?: number | null;
  tier?: string | null;
};

type ResolveChallengeEnemyCandidatesInput = {
  worldId: ChallengeWorldId;
  tier: StrengthTier;
  sourceMode: 'online-first' | 'preset-only';
  runSeed?: string | null;
  limit?: number;
  baseUrl: string;
};

export type ResolveChallengeEnemyCandidatesResult = {
  worldId: ChallengeWorldId;
  tier: StrengthTier;
  resolvedSourceMode: 'remote' | 'preset-only';
  candidates: EnemySnapshotV1[];
};

type ResolverDeps = {
  fetcher?: typeof fetch;
};

const COMMON_FILTERS = {
  minGames: 5,
  minRating: 900,
  maxRating: 1199,
};

const ELITE_FILTERS = {
  minGames: 5,
  minRating: 1200,
  maxRating: 1499,
};

const BOSS_FILTERS = {
  minGames: 5,
  minRating: 1500,
};

const getTierQueryFilters = (tier: StrengthTier): Record<string, string> => {
  switch (tier) {
    case 'common':
      return Object.fromEntries(
        Object.entries(COMMON_FILTERS).map(([key, value]) => [key, String(value)])
      );
    case 'elite':
      return Object.fromEntries(
        Object.entries(ELITE_FILTERS).map(([key, value]) => [key, String(value)])
      );
    case 'boss':
      return Object.fromEntries(
        Object.entries(BOSS_FILTERS).map(([key, value]) => [key, String(value)])
      );
    default:
      return {};
  }
};

const fetchRankedArenaEntities = async (
  input: {
    baseUrl: string;
    tier: StrengthTier;
    limit: number;
  },
  deps: ResolverDeps = {}
): Promise<RankedLeaderboardItem[]> => {
  const fetcher = deps.fetcher ?? fetch;
  const url = new URL('/api/arena/leaderboard', input.baseUrl);
  url.searchParams.set('queue', 'strict');
  url.searchParams.set('sort', 'rating');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('includePresets', '1');
  url.searchParams.set('limit', String(input.limit));

  Object.entries(getTierQueryFilters(input.tier)).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const response = await fetcher(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`ARENA_LEADERBOARD_FETCH_FAILED:${response.status}`);
  }

  const payload = (await response.json()) as { success?: boolean; items?: RankedLeaderboardItem[] };
  if (!payload.success || !Array.isArray(payload.items)) {
    return [];
  }

  return payload.items
    .filter(
      (item): item is RankedLeaderboardItem =>
        (item.entityType === 'data_card' || item.entityType === 'preset') && typeof item.entityId === 'string'
    )
    .map((item) => ({
      entityType: item.entityType,
      entityId: item.entityId,
      displayName: typeof item.displayName === 'string' ? item.displayName : null,
      rating: typeof item.rating === 'number' ? item.rating : null,
      tier: typeof item.tier === 'string' ? item.tier : null,
    }));
};

const fetchPublicCardById = async (
  input: { baseUrl: string; entityId: string },
  deps: ResolverDeps = {}
): Promise<unknown | null> => {
  const fetcher = deps.fetcher ?? fetch;
  const url = new URL('/api/public-data-cards', input.baseUrl);
  url.searchParams.set('id', input.entityId);

  const response = await fetcher(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) return null;

  const payload = (await response.json()) as { success?: boolean; card?: unknown };
  if (!payload.success) return null;
  return payload.card ?? null;
};

const loadPresetById = async (entityId: string): Promise<unknown | null> => {
  const preset = getBundledPresetData(entityId);
  if (!preset || typeof preset !== 'object') return null;
  return {
    ...(preset as Record<string, unknown>),
    id: entityId,
    sourceId: entityId,
    sourceType: 'preset',
    isPreset: true,
  };
};

export const resolveChallengeEnemyCandidates = async (
  input: ResolveChallengeEnemyCandidatesInput,
  deps: ResolverDeps = {}
): Promise<ResolveChallengeEnemyCandidatesResult> => {
  if (input.worldId !== 'arena') {
    throw new Error(`CHALLENGE_WORLD_UNSUPPORTED:${input.worldId}`);
  }

  const arenaResult = await resolveArenaEnemyCandidates(
    {
      tier: input.tier,
      sourceMode: input.sourceMode,
      runSeed: input.runSeed,
      limit: input.limit,
    },
    {
      loadRankedEntities:
        input.sourceMode === 'preset-only'
          ? undefined
          : async ({ tier, limit }) => {
              const rankedItems = await fetchRankedArenaEntities(
                {
                  baseUrl: input.baseUrl,
                  tier,
                  limit,
                },
                deps
              );
              return rankedItems.map((item) => ({
                entityType: item.entityType,
                entityId: item.entityId,
                displayName: item.displayName ?? null,
                rating: item.rating ?? null,
                tierLabel: item.tier ?? null,
              }));
            },
      loadPublicCardById: async (entityId) =>
        fetchPublicCardById(
          {
            baseUrl: input.baseUrl,
            entityId,
          },
          deps
        ),
      loadPresetById,
    }
  );

  return {
    worldId: input.worldId,
    tier: input.tier,
    resolvedSourceMode: arenaResult.resolvedSourceMode,
    candidates: arenaResult.candidates,
  };
};
