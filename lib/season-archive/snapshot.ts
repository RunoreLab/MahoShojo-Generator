import type { SeasonArchiveQueueSnapshot } from '@/lib/seasons';

type SeasonArchiveQueue = 'strict' | 'free';

type SeasonArchiveSnapshotRow = {
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  ratingUpdatedAt: string | null;
  seasonPeakRating?: number | null;
  seasonPeakGames?: number | null;
  seasonPeakAt?: string | null;
  seasonPeakTier?: string | null;
  seasonLowRating?: number | null;
  seasonLowGames?: number | null;
  seasonLowAt?: string | null;
};

const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return fallback;
};

const toNullableNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
};

const toNullableString = (value: unknown): string | null => {
  return typeof value === 'string' ? value : null;
};

export const buildSeasonArchiveQueueSnapshot = (
  queue: SeasonArchiveQueue,
  row: SeasonArchiveSnapshotRow,
): SeasonArchiveQueueSnapshot => {
  const base: SeasonArchiveQueueSnapshot = {
    rating: toNumber(row.rating, 0),
    games: toNumber(row.games, 0),
    wins: toNumber(row.wins, 0),
    losses: toNumber(row.losses, 0),
    draws: toNumber(row.draws, 0),
    ratingUpdatedAt: toNullableString(row.ratingUpdatedAt),
  };

  if (queue !== 'strict') return base;

  return {
    ...base,
    seasonPeakRating: toNullableNumber(row.seasonPeakRating),
    seasonPeakGames: toNullableNumber(row.seasonPeakGames),
    seasonPeakAt: toNullableString(row.seasonPeakAt),
    seasonPeakTier: toNullableString(row.seasonPeakTier),
    seasonLowRating: toNullableNumber(row.seasonLowRating),
    seasonLowGames: toNullableNumber(row.seasonLowGames),
    seasonLowAt: toNullableString(row.seasonLowAt),
  };
};
