import type { SeasonArchiveQueueSnapshot } from '@/lib/seasons';
import { normalizeStrictSeasonPeakTier } from '@/lib/ranking/season-extrema';

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
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
};

const buildSeasonExtremeTuple = (
  rating: unknown,
  games: unknown,
  occurredAt: unknown,
): { rating: number; games: number; occurredAt: string } | null => {
  const normalizedRating = toNullableNumber(rating);
  const normalizedGames = toNullableNumber(games);
  const normalizedOccurredAt = toNullableString(occurredAt);
  if (normalizedRating == null || normalizedGames == null || normalizedOccurredAt == null) return null;
  return {
    rating: normalizedRating,
    games: normalizedGames,
    occurredAt: normalizedOccurredAt,
  };
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

  const peak = buildSeasonExtremeTuple(row.seasonPeakRating, row.seasonPeakGames, row.seasonPeakAt);
  const low = buildSeasonExtremeTuple(row.seasonLowRating, row.seasonLowGames, row.seasonLowAt);
  const seasonPeakTier = peak ? normalizeStrictSeasonPeakTier('strict', row.seasonPeakTier) : null;

  return {
    ...base,
    seasonPeakRating: peak?.rating ?? null,
    seasonPeakGames: peak?.games ?? null,
    seasonPeakAt: peak?.occurredAt ?? null,
    seasonPeakTier: seasonPeakTier ?? null,
    seasonLowRating: low?.rating ?? null,
    seasonLowGames: low?.games ?? null,
    seasonLowAt: low?.occurredAt ?? null,
  };
};
