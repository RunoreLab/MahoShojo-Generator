import { describe, expect, test } from 'bun:test';

import { buildSeasonArchiveQueueSnapshot } from '@/lib/season-archive/snapshot';

describe('season archive ranking extrema snapshot helper', () => {
  test('strict 快照会写入 season extrema facts', () => {
    const row = {
      rating: 1520,
      games: 20,
      wins: 12,
      losses: 6,
      draws: 2,
      ratingUpdatedAt: '2026-03-24T10:00:00.000Z',
      seasonPeakRating: 1666,
      seasonPeakGames: 30,
      seasonPeakAt: '2026-03-24T09:00:00.000Z',
      seasonPeakTier: '女王',
      seasonLowRating: 880,
      seasonLowGames: 5,
      seasonLowAt: '2026-02-03T00:00:00.000Z',
    };

    const snapshot = buildSeasonArchiveQueueSnapshot('strict', row);

    expect(snapshot).toEqual({
      rating: 1520,
      games: 20,
      wins: 12,
      losses: 6,
      draws: 2,
      ratingUpdatedAt: '2026-03-24T10:00:00.000Z',
      seasonPeakRating: 1666,
      seasonPeakGames: 30,
      seasonPeakAt: '2026-03-24T09:00:00.000Z',
      seasonPeakTier: '女王',
      seasonLowRating: 880,
      seasonLowGames: 5,
      seasonLowAt: '2026-02-03T00:00:00.000Z',
    });
  });

  test('free 快照不写 season extrema facts', () => {
    const row = {
      rating: 1400,
      games: 18,
      wins: 9,
      losses: 8,
      draws: 1,
      ratingUpdatedAt: '2026-03-24T08:00:00.000Z',
      seasonPeakRating: 1666,
      seasonPeakGames: 30,
      seasonPeakAt: '2026-03-24T09:00:00.000Z',
      seasonPeakTier: '女王',
      seasonLowRating: 880,
      seasonLowGames: 5,
      seasonLowAt: '2026-02-03T00:00:00.000Z',
    };

    const snapshot = buildSeasonArchiveQueueSnapshot('free', row);

    expect(snapshot).toEqual({
      rating: 1400,
      games: 18,
      wins: 9,
      losses: 8,
      draws: 1,
      ratingUpdatedAt: '2026-03-24T08:00:00.000Z',
    });
    expect(snapshot).not.toHaveProperty('seasonPeakRating');
    expect(snapshot).not.toHaveProperty('seasonLowRating');
  });

  test('strict 快照会过滤非法 seasonPeakTier', () => {
    const row = {
      rating: 1520,
      games: 20,
      wins: 12,
      losses: 6,
      draws: 2,
      ratingUpdatedAt: '2026-03-24T10:00:00.000Z',
      seasonPeakRating: 1666,
      seasonPeakGames: 30,
      seasonPeakAt: '2026-03-24T09:00:00.000Z',
      seasonPeakTier: '非法段位',
      seasonLowRating: 880,
      seasonLowGames: 5,
      seasonLowAt: '2026-02-03T00:00:00.000Z',
    };

    const snapshot = buildSeasonArchiveQueueSnapshot('strict', row);

    expect(snapshot.seasonPeakRating).toBe(1666);
    expect(snapshot.seasonPeakGames).toBe(30);
    expect(snapshot.seasonPeakAt).toBe('2026-03-24T09:00:00.000Z');
    expect(snapshot.seasonPeakTier).toBeNull();
  });

  test('strict 快照不会写入 peak 半残 tuple', () => {
    const row = {
      rating: 1500,
      games: 20,
      wins: 12,
      losses: 6,
      draws: 2,
      ratingUpdatedAt: '2026-03-24T10:00:00.000Z',
      seasonPeakRating: 1666,
      seasonPeakGames: null,
      seasonPeakAt: '2026-03-24T09:00:00.000Z',
      seasonPeakTier: '女王',
      seasonLowRating: 880,
      seasonLowGames: 5,
      seasonLowAt: '2026-02-03T00:00:00.000Z',
    };

    const snapshot = buildSeasonArchiveQueueSnapshot('strict', row);

    expect(snapshot.seasonPeakRating).toBeNull();
    expect(snapshot.seasonPeakGames).toBeNull();
    expect(snapshot.seasonPeakAt).toBeNull();
    expect(snapshot.seasonPeakTier).toBeNull();
  });

  test('strict 快照不会写入 low 半残 tuple', () => {
    const row = {
      rating: 1500,
      games: 20,
      wins: 12,
      losses: 6,
      draws: 2,
      ratingUpdatedAt: '2026-03-24T10:00:00.000Z',
      seasonPeakRating: 1666,
      seasonPeakGames: 30,
      seasonPeakAt: '2026-03-24T09:00:00.000Z',
      seasonPeakTier: '女王',
      seasonLowRating: 880,
      seasonLowGames: 5,
      seasonLowAt: null,
    };

    const snapshot = buildSeasonArchiveQueueSnapshot('strict', row);

    expect(snapshot.seasonLowRating).toBeNull();
    expect(snapshot.seasonLowGames).toBeNull();
    expect(snapshot.seasonLowAt).toBeNull();
  });

  test('strict 快照不会写入包含 NaN 的 extrema tuple', () => {
    const row = {
      rating: 1500,
      games: 20,
      wins: 12,
      losses: 6,
      draws: 2,
      ratingUpdatedAt: '2026-03-24T10:00:00.000Z',
      seasonPeakRating: Number.NaN,
      seasonPeakGames: 30,
      seasonPeakAt: '2026-03-24T09:00:00.000Z',
      seasonPeakTier: '女王',
      seasonLowRating: 880,
      seasonLowGames: Number.NaN,
      seasonLowAt: '2026-02-03T00:00:00.000Z',
    };

    const snapshot = buildSeasonArchiveQueueSnapshot('strict', row);

    expect(snapshot.seasonPeakRating).toBeNull();
    expect(snapshot.seasonPeakGames).toBeNull();
    expect(snapshot.seasonPeakAt).toBeNull();
    expect(snapshot.seasonPeakTier).toBeNull();
    expect(snapshot.seasonLowRating).toBeNull();
    expect(snapshot.seasonLowGames).toBeNull();
    expect(snapshot.seasonLowAt).toBeNull();
  });
});
