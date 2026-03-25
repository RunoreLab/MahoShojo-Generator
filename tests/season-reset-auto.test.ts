import { describe, expect, test } from 'bun:test';

import { deriveSeasonResetAutoTuning } from '@/lib/arena/season-reset-auto';
import { buildSeasonSoftResetUpdateSql } from '@/lib/db/repositories/season-soft-reset';

describe('season-reset-auto: deriveSeasonResetAutoTuning', () => {
  test('基础约束：阈值与 factor 单调、合法', () => {
    const result = deriveSeasonResetAutoTuning({
      baseRating: 1000,
      maxStartRating: 1500,
      stats: {
        total: 500,
        played: 200,
        maxRatingPlayed: 1680,
        top20AvgRatingPlayed: 1420,
        aboveMaxStartPlayed: 12,
        gamesP25Played: 8,
        gamesP60Played: 25,
        inactiveP85DaysPlayed: 45,
        inactive30DaysPlayed: 60,
      },
    });

    const gf = result.gamesFactor;
    const ic = result.inactivityCap;

    expect(gf.enabled).toBe(true);
    expect(ic.enabled).toBe(true);

    expect(gf.gamesMid).toBeGreaterThanOrEqual(5);
    expect(gf.gamesHigh).toBeGreaterThan(gf.gamesMid);

    expect(gf.factorLow).toBeGreaterThanOrEqual(0);
    expect(gf.factorHigh).toBeLessThanOrEqual(1);
    expect(gf.factorLow).toBeLessThanOrEqual(gf.factorMid);
    expect(gf.factorMid).toBeLessThanOrEqual(gf.factorHigh);

    expect(ic.inactiveDays).toBeGreaterThanOrEqual(30);
    expect(ic.inactiveFactor).toBeGreaterThanOrEqual(0);
    expect(ic.inactiveFactor).toBeLessThanOrEqual(1);
  });

  test('高分段拥挤/分差过大时：会下调 factorHigh', () => {
    const result = deriveSeasonResetAutoTuning({
      baseRating: 1000,
      maxStartRating: 1500,
      stats: {
        total: 800,
        played: 300,
        maxRatingPlayed: 2100,
        top20AvgRatingPlayed: 1850,
        aboveMaxStartPlayed: 120,
        gamesP25Played: 12,
        gamesP60Played: 40,
        inactiveP85DaysPlayed: 60,
        inactive30DaysPlayed: 150,
      },
    });

    expect(result.gamesFactor.factorHigh).toBeLessThan(1);
    expect(result.gamesFactor.factorLow).toBeLessThan(result.gamesFactor.factorMid);
  });

  test('对局规模较小时：会略微减弱分段差异，避免过拟合', () => {
    const result = deriveSeasonResetAutoTuning({
      baseRating: 1000,
      maxStartRating: 1500,
      stats: {
        total: 60,
        played: 20,
        maxRatingPlayed: 1500,
        top20AvgRatingPlayed: null,
        aboveMaxStartPlayed: 0,
        gamesP25Played: 3,
        gamesP60Played: 9,
        inactiveP85DaysPlayed: 10,
        inactive30DaysPlayed: 1,
      },
    });

    expect(result.gamesFactor.gamesMid).toBeGreaterThanOrEqual(5);
    expect(result.gamesFactor.factorLow).toBeGreaterThanOrEqual(0.35);
    expect(result.inactivityCap.inactiveDays).toBeGreaterThanOrEqual(30);
  });
});

describe('season-reset-auto: queue=all helper seam', () => {
  test('queue=all 语义通过 strict/free 双调用被约束：strict 重置 season，free 不写 season', () => {
    const ratingExpr = 'CAST(ROUND(arena_ratings.rating) AS INTEGER)';
    const ratingParams: unknown[] = [];
    const nowIso = '2026-03-25T00:00:00.000Z';

    const updates = (['strict', 'free'] as const).map((queue) =>
      buildSeasonSoftResetUpdateSql({
        queue,
        ratingExpr,
        ratingParams,
        nowIso,
        includeLegacyColumns: true,
      })
    );

    const strictSql = updates[0]?.sql ?? '';
    const freeSql = updates[1]?.sql ?? '';

    expect(strictSql.includes('season_peak_rating')).toBeTrue();
    expect(strictSql.includes("season_peak_tier = '无牌'")).toBeTrue();
    expect(strictSql.includes('season_low_rating')).toBeTrue();
    expect(freeSql.includes('season_peak_rating')).toBeFalse();
    expect(freeSql.includes('season_peak_tier')).toBeFalse();
    expect(freeSql.includes('season_low_rating')).toBeFalse();
  });
});
