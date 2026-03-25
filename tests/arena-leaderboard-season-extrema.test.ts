import { beforeAll, describe, expect, mock, test } from 'bun:test';

mock.module('server-only', () => ({}));

let buildLeaderboardItemFromRow: typeof import('@/pages/api/arena/leaderboard').buildLeaderboardItemFromRow;

beforeAll(async () => {
  const mod = await import('@/pages/api/arena/leaderboard');
  buildLeaderboardItemFromRow = mod.buildLeaderboardItemFromRow;
});

describe('buildLeaderboardItemFromRow', () => {
  test('strict item 返回 seasonPeak / seasonPeakTier / seasonLow', () => {
    const item = buildLeaderboardItemFromRow(
      {
        entityType: 'data_card',
        entityId: 'card_1',
        rating: 1320,
        games: 18,
        wins: 10,
        losses: 7,
        draws: 1,
        updatedAt: '2026-03-25T10:00:00.000Z',
        dataCardName: '测试角色A',
        authorName: '作者A',
        techScore: 89,
        techLevel: 'A',
        isNative: true,
        tagIds: ['tag-a'],
        seasonPeakRating: 1600,
        seasonPeakGames: 28,
        seasonPeakAt: '2026-03-20T10:00:00.000Z',
        seasonPeakTier: '女王',
        seasonLowRating: 900,
        seasonLowGames: 6,
        seasonLowAt: '2026-02-01T10:00:00.000Z',
      },
      {
        queue: 'strict',
        rank: 1,
        presetNameByFilename: new Map<string, string>(),
        isQueen: false,
      },
    );

    expect(item.seasonPeak).toEqual({
      rating: 1600,
      games: 28,
      occurredAt: '2026-03-20T10:00:00.000Z',
      tier: '权杖',
    });
    expect(item.seasonPeakTier).toBe('女王');
    expect(item.seasonLow).toEqual({
      rating: 900,
      games: 6,
      occurredAt: '2026-02-01T10:00:00.000Z',
      tier: '白牌',
    });
  });

  test('seasonPeak / seasonLow 的 tier 使用现场推导结果', () => {
    const item = buildLeaderboardItemFromRow(
      {
        entityType: 'data_card',
        entityId: 'card_2',
        rating: 1400,
        games: 20,
        wins: 12,
        losses: 7,
        draws: 1,
        updatedAt: '2026-03-25T10:00:00.000Z',
        dataCardName: '测试角色B',
        authorName: '作者B',
        techScore: 77,
        techLevel: 'B',
        isNative: false,
        tagIds: [],
        seasonPeakRating: 1450,
        seasonPeakGames: 22,
        seasonPeakAt: '2026-03-12T10:00:00.000Z',
        seasonPeakTier: '无牌',
        seasonLowRating: 750,
        seasonLowGames: 5,
        seasonLowAt: '2026-01-15T10:00:00.000Z',
      },
      {
        queue: 'strict',
        rank: 2,
        presetNameByFilename: new Map<string, string>(),
        isQueen: false,
      },
    );

    expect(item.seasonPeak?.tier).toBe('花牌');
    expect(item.seasonLow?.tier).toBe('无牌');
  });

  test('free item 的 season 字段全部为 null', () => {
    const item = buildLeaderboardItemFromRow(
      {
        entityType: 'preset',
        entityId: 'preset_1',
        rating: 1200,
        games: 18,
        wins: 9,
        losses: 8,
        draws: 1,
        updatedAt: '2026-03-25T10:00:00.000Z',
        dataCardName: null,
        authorName: null,
        techScore: null,
        techLevel: null,
        isNative: null,
        tagIds: [],
        seasonPeakRating: 1550,
        seasonPeakGames: 22,
        seasonPeakAt: '2026-03-12T10:00:00.000Z',
        seasonPeakTier: '权杖',
        seasonLowRating: 700,
        seasonLowGames: 5,
        seasonLowAt: '2026-01-15T10:00:00.000Z',
      },
      {
        queue: 'free',
        rank: 3,
        presetNameByFilename: new Map([['preset_1', '预设一号']]),
        isQueen: false,
      },
    );

    expect(item.seasonPeak).toBeNull();
    expect(item.seasonPeakTier).toBeNull();
    expect(item.seasonLow).toBeNull();
  });
});
