import { describe, expect, test } from 'bun:test';

import {
  buildStrictLeaderboardSeasonExtrema,
  normalizeStrictSeasonPeakTier,
} from '@/lib/ranking/season-extrema';

describe('leaderboard season extrema helper', () => {
  test('strict queue maps raw season extrema fields to view model', () => {
    const raw = {
      seasonPeakRating: 1620,
      seasonPeakGames: 21,
      seasonPeakAt: '2026-03-24T10:00:00.000Z',
      seasonPeakTier: '女王',
      seasonLowRating: 870,
      seasonLowGames: 6,
      seasonLowAt: '2026-02-01T00:00:00.000Z',
    };

    const result = buildStrictLeaderboardSeasonExtrema('strict', raw);

    expect(result.seasonPeak).toEqual({
      rating: 1620,
      games: 21,
      occurredAt: '2026-03-24T10:00:00.000Z',
      tier: '权杖',
    });
    expect(result.seasonPeakTier).toBe('女王');
    expect(result.seasonLow).toEqual({
      rating: 870,
      games: 6,
      occurredAt: '2026-02-01T00:00:00.000Z',
      tier: '白牌',
    });
  });

  test('free queue always returns null season extrema', () => {
    const raw = {
      seasonPeakRating: 1620,
      seasonPeakGames: 21,
      seasonPeakAt: '2026-03-24T10:00:00.000Z',
      seasonPeakTier: '女王',
      seasonLowRating: 870,
      seasonLowGames: 6,
      seasonLowAt: '2026-02-01T00:00:00.000Z',
    };

    const result = buildStrictLeaderboardSeasonExtrema('free', raw);

    expect(result.seasonPeak).toBeNull();
    expect(result.seasonPeakTier).toBeNull();
    expect(result.seasonLow).toBeNull();
  });

  test('invalid seasonPeakTier and missing extrema fields degrade to null', () => {
    const raw = {
      seasonPeakRating: 1700,
      seasonPeakGames: null,
      seasonPeakAt: '2026-03-12T10:00:00.000Z',
      seasonPeakTier: '  非法段位  ',
      seasonLowRating: 900,
      seasonLowGames: 5,
      seasonLowAt: null,
    };

    const result = buildStrictLeaderboardSeasonExtrema('strict', raw);

    expect(result.seasonPeak).toBeNull();
    expect(result.seasonPeakTier).toBeNull();
    expect(result.seasonLow).toBeNull();
  });

  test('seasonPeakTier can survive without seasonPeak when queue is strict', () => {
    const raw = {
      seasonPeakTier: '白牌',
    };

    const result = buildStrictLeaderboardSeasonExtrema('strict', raw);

    expect(result.seasonPeak).toBeNull();
    expect(result.seasonPeakTier).toBe('白牌');
    expect(result.seasonLow).toBeNull();
  });

  test('normalizeStrictSeasonPeakTier enforces whitelist for strict queue', () => {
    expect(normalizeStrictSeasonPeakTier('strict', '  女王  ')).toBe('女王');
    expect(normalizeStrictSeasonPeakTier('strict', '非法')).toBeNull();
    expect(normalizeStrictSeasonPeakTier('free', '女王')).toBeNull();
  });
});
