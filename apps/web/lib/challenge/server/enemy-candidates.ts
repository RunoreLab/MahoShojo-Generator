import type {
  ChallengeResolvedSourceCardLite,
  ChallengeWorldId,
  EnemySnapshotV1,
  StrengthTier,
} from '@/lib/challenge/types';
import {
  resolveArenaEnemyCandidates,
  selectArenaEnemySnapshot,
} from '@/lib/challenge/worlds/arena/enemy-source';
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
  selectionSeed?: string | null;
  baseUrl: string;
};

export type ResolveChallengeEnemyCandidatesCompatibilityResult = {
  mode: 'compatibility';
  worldId: ChallengeWorldId;
  tier: StrengthTier;
  resolvedSourceMode: 'remote' | 'preset-only';
  candidates: EnemySnapshotV1[];
};

export type ResolveChallengeEnemyCandidatesSelectionResult = {
  mode: 'selection';
  worldId: ChallengeWorldId;
  tier: StrengthTier;
  resolvedSourceMode: 'remote' | 'preset-only';
  enemySnapshot: EnemySnapshotV1;
  resolvedSourceCardLite: ChallengeResolvedSourceCardLite | null;
};

export type ResolveChallengeEnemyCandidatesResult =
  | ResolveChallengeEnemyCandidatesCompatibilityResult
  | ResolveChallengeEnemyCandidatesSelectionResult;

type ChallengeEnemyCandidatesMetrics = {
  mode: 'compatibility' | 'selection';
  tier: StrengthTier;
  resolvedSourceMode: 'remote' | 'preset-only';
  leaderboardWindowRequestCount: number;
  bulkPublicCardQueryCount: number;
  validatedCandidateCount: number;
  selectedFromWindow: number | null;
  fallbackReason: string | null;
};

type ResolverDeps = {
  fetcher?: typeof fetch;
  getDb?: () => AppDrizzleDb | null;
  loadPublicCardsByIds?: (ids: string[]) => Promise<Map<string, unknown>>;
  logMetrics?: (metrics: ChallengeEnemyCandidatesMetrics) => void;
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
      return Object.fromEntries(Object.entries(COMMON_FILTERS).map(([key, value]) => [key, String(value)]));
    case 'elite':
      return Object.fromEntries(Object.entries(ELITE_FILTERS).map(([key, value]) => [key, String(value)]));
    case 'boss':
      return Object.fromEntries(Object.entries(BOSS_FILTERS).map(([key, value]) => [key, String(value)]));
    default:
      return {};
  }
};

const fetchRankedArenaEntities = async (
  input: {
    baseUrl: string;
    tier: StrengthTier;
    limit: number;
    offset: number;
  },
  deps: ResolverDeps = {},
): Promise<RankedLeaderboardItem[]> => {
  const fetcher = deps.fetcher ?? fetch;
  const url = new URL('/api/arena/leaderboard', input.baseUrl);
  url.searchParams.set('queue', 'strict');
  url.searchParams.set('sort', 'rating');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('includePresets', '1');
  url.searchParams.set('limit', String(input.limit));
  url.searchParams.set('offset', String(input.offset));

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
        (item.entityType === 'data_card' || item.entityType === 'preset') && typeof item.entityId === 'string',
    )
    .map((item) => ({
      entityType: item.entityType,
      entityId: item.entityId,
      displayName: typeof item.displayName === 'string' ? item.displayName : null,
      rating: typeof item.rating === 'number' ? item.rating : null,
      tier: typeof item.tier === 'string' ? item.tier : null,
    }));
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

const loadChallengePublicCardsByIds = async (
  ids: string[],
  deps: ResolverDeps = {},
): Promise<Map<string, unknown>> => {
  if (deps.loadPublicCardsByIds) {
    return deps.loadPublicCardsByIds(ids);
  }

  const [{ getDrizzleDbFromRuntime }, { listChallengePublicCharacterCardsByIds }] = await Promise.all([
    import('@/lib/db/drizzle'),
    import('@/lib/db/repositories/challenge-public-card-read'),
  ]);
  const db = (deps.getDb ?? getDrizzleDbFromRuntime)();
  if (!db) return new Map();

  const rows = await listChallengePublicCharacterCardsByIds(db, ids);
  return new Map(rows.map((row) => [row.id, row]));
};

const readSelectedFromWindow = (enemySnapshot: EnemySnapshotV1, windows: string[][]): number | null => {
  const matchedWindowIndex = windows.findIndex((ids) => ids.includes(enemySnapshot.sourceId));
  return matchedWindowIndex >= 0 ? matchedWindowIndex + 1 : null;
};

const emitMetrics = (
  input: {
    mode: 'compatibility' | 'selection';
    tier: StrengthTier;
    resolvedSourceMode: 'remote' | 'preset-only';
    validatedCandidateCount: number;
    enemySnapshot?: EnemySnapshotV1;
    leaderboardWindowEntityIds: string[][];
    leaderboardWindowRequestCount: number;
    bulkPublicCardQueryCount: number;
    fallbackReason: string | null;
  },
  deps: ResolverDeps = {},
): void => {
  const metrics: ChallengeEnemyCandidatesMetrics = {
    mode: input.mode,
    tier: input.tier,
    resolvedSourceMode: input.resolvedSourceMode,
    leaderboardWindowRequestCount: input.leaderboardWindowRequestCount,
    bulkPublicCardQueryCount: input.bulkPublicCardQueryCount,
    validatedCandidateCount: input.validatedCandidateCount,
    selectedFromWindow: input.enemySnapshot ? readSelectedFromWindow(input.enemySnapshot, input.leaderboardWindowEntityIds) : null,
    fallbackReason: input.fallbackReason,
  };

  if (deps.logMetrics) {
    deps.logMetrics(metrics);
    return;
  }

  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
    return;
  }

  console.info('challenge enemy candidates metrics', metrics);
};

export const resolveChallengeEnemyCandidates = async (
  input: ResolveChallengeEnemyCandidatesInput,
  deps: ResolverDeps = {},
): Promise<ResolveChallengeEnemyCandidatesResult> => {
  if (input.worldId !== 'arena') {
    throw new Error(`CHALLENGE_WORLD_UNSUPPORTED:${input.worldId}`);
  }

  const leaderboardWindowEntityIds: string[][] = [];
  let leaderboardWindowRequestCount = 0;
  let bulkPublicCardQueryCount = 0;
  let leaderboardFetchFailed = false;
  let bulkPublicCardReadFailed = false;

  const arenaDeps = {
    loadRankedEntityWindow:
      input.sourceMode === 'preset-only'
        ? undefined
        : async ({ tier, limit, offset }: { tier: StrengthTier; limit: number; offset: number }) => {
            leaderboardWindowRequestCount += 1;
            try {
              const rankedItems = await fetchRankedArenaEntities(
                {
                  baseUrl: input.baseUrl,
                  tier,
                  limit,
                  offset,
                },
                deps,
              );
              leaderboardWindowEntityIds.push(rankedItems.map((item) => item.entityId));
              return rankedItems.map((item) => ({
                entityType: item.entityType,
                entityId: item.entityId,
                displayName: item.displayName ?? null,
                rating: item.rating ?? null,
                tierLabel: item.tier ?? null,
              }));
            } catch (error) {
              leaderboardFetchFailed = true;
              throw error;
            }
          },
    loadPublicCardsByIds: async (ids: string[]) => {
      if (ids.length > 0) {
        bulkPublicCardQueryCount += 1;
      }
      try {
        return await loadChallengePublicCardsByIds(ids, deps);
      } catch (error) {
        bulkPublicCardReadFailed = true;
        throw error;
      }
    },
    loadPresetById,
  };

  if (input.selectionSeed) {
    const arenaResult = await selectArenaEnemySnapshot(
      {
        tier: input.tier,
        sourceMode: input.sourceMode,
        runSeed: input.runSeed,
        limit: input.limit,
        selectionSeed: input.selectionSeed,
      },
      arenaDeps,
    );

    emitMetrics(
      {
        mode: 'selection',
        tier: input.tier,
        resolvedSourceMode: arenaResult.resolvedSourceMode,
        validatedCandidateCount: arenaResult.resolvedSourceMode === 'remote' ? 1 : 0,
        enemySnapshot: arenaResult.enemySnapshot,
        leaderboardWindowEntityIds,
        leaderboardWindowRequestCount,
        bulkPublicCardQueryCount,
        fallbackReason:
          input.sourceMode === 'preset-only'
            ? 'explicit-preset-only'
            : arenaResult.resolvedSourceMode === 'remote'
              ? null
              : leaderboardFetchFailed
                ? 'leaderboard-fetch-failed'
                : bulkPublicCardReadFailed
                  ? 'bulk-public-card-read-failed'
                  : 'remote-threshold-not-met',
      },
      deps,
    );

    return {
      mode: 'selection',
      worldId: input.worldId,
      tier: input.tier,
      resolvedSourceMode: arenaResult.resolvedSourceMode,
      enemySnapshot: arenaResult.enemySnapshot,
      resolvedSourceCardLite: arenaResult.resolvedSourceCardLite,
    };
  }

  const arenaResult = await resolveArenaEnemyCandidates(
    {
      tier: input.tier,
      sourceMode: input.sourceMode,
      runSeed: input.runSeed,
      limit: input.limit,
    },
    arenaDeps,
  );

  emitMetrics(
    {
      mode: 'compatibility',
      tier: input.tier,
      resolvedSourceMode: arenaResult.resolvedSourceMode,
      validatedCandidateCount: arenaResult.candidates.length,
      leaderboardWindowEntityIds,
      leaderboardWindowRequestCount,
      bulkPublicCardQueryCount,
      fallbackReason:
        input.sourceMode === 'preset-only'
          ? 'explicit-preset-only'
          : arenaResult.resolvedSourceMode === 'remote'
            ? null
            : leaderboardFetchFailed
              ? 'leaderboard-fetch-failed'
              : bulkPublicCardReadFailed
                ? 'bulk-public-card-read-failed'
                : 'remote-threshold-not-met',
    },
    deps,
  );

  return {
    mode: 'compatibility',
    worldId: input.worldId,
    tier: input.tier,
    resolvedSourceMode: arenaResult.resolvedSourceMode,
    candidates: arenaResult.candidates,
  };
};
import type { AppDrizzleDb } from '@/lib/db/drizzle';
