import { describe, expect, test } from 'bun:test';

import { arenaRatings } from '@/lib/db/schema';

describe('data-card meta season extrema schema', () => {
  test('arena_ratings 季度极值字段名保持 snake_case', () => {
    const columns = arenaRatings as Record<string, { name: string } | undefined>;

    expect(columns.seasonPeakRating?.name).toBe('season_peak_rating');
    expect(columns.seasonPeakGames?.name).toBe('season_peak_games');
    expect(columns.seasonPeakAt?.name).toBe('season_peak_at');
    expect(columns.seasonPeakTier?.name).toBe('season_peak_tier');
    expect(columns.seasonLowRating?.name).toBe('season_low_rating');
    expect(columns.seasonLowGames?.name).toBe('season_low_games');
    expect(columns.seasonLowAt?.name).toBe('season_low_at');
  });
});
