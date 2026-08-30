import { type ArenaBaseTier, type ArenaQueue, type ArenaTier, computeArenaBaseTier } from '@/lib/arena/tier';

export type LeaderboardSeasonExtreme = {
  rating: number;
  games: number;
  occurredAt: string;
  tier: ArenaBaseTier;
};

export type LeaderboardSeasonExtremaRecord = {
  seasonPeakRating?: number | null;
  seasonPeakGames?: number | null;
  seasonPeakAt?: string | null;
  seasonPeakTier?: string | null;
  seasonLowRating?: number | null;
  seasonLowGames?: number | null;
  seasonLowAt?: string | null;
};

export type LeaderboardSeasonExtremaView = {
  seasonPeak: LeaderboardSeasonExtreme | null;
  seasonPeakTier: ArenaTier | null;
  seasonLow: LeaderboardSeasonExtreme | null;
};

const ARENA_LEADERBOARD_TIER_WHITELIST = new Set<ArenaTier>([
  '无牌',
  '白牌',
  '字牌',
  '花牌',
  '权杖',
  '女王',
]);

const buildSeasonExtreme = (
  rating: number | null | undefined,
  games: number | null | undefined,
  occurredAt: string | null | undefined,
): LeaderboardSeasonExtreme | null => {
  if (typeof rating !== 'number' || typeof games !== 'number' || typeof occurredAt !== 'string') {
    return null;
  }

  return {
    rating,
    games,
    occurredAt,
    tier: computeArenaBaseTier(rating, games),
  };
};

export const normalizeStrictSeasonPeakTier = (queue: ArenaQueue, seasonPeakTier: unknown): ArenaTier | null => {
  if (queue !== 'strict') return null;
  if (typeof seasonPeakTier !== 'string') return null;

  const normalized = seasonPeakTier.trim();
  if (!normalized) return null;

  const normalizedTier = normalized as ArenaTier;
  return ARENA_LEADERBOARD_TIER_WHITELIST.has(normalizedTier) ? normalizedTier : null;
};

export const buildStrictLeaderboardSeasonExtrema = (
  queue: ArenaQueue,
  raw: LeaderboardSeasonExtremaRecord | null | undefined,
): LeaderboardSeasonExtremaView => {
  if (queue !== 'strict') {
    return {
      seasonPeak: null,
      seasonPeakTier: null,
      seasonLow: null,
    };
  }

  const record = raw ?? {};

  return {
    seasonPeak: buildSeasonExtreme(record.seasonPeakRating ?? null, record.seasonPeakGames ?? null, record.seasonPeakAt ?? null),
    seasonPeakTier: normalizeStrictSeasonPeakTier(queue, record.seasonPeakTier),
    seasonLow: buildSeasonExtreme(record.seasonLowRating ?? null, record.seasonLowGames ?? null, record.seasonLowAt ?? null),
  };
};
