import { describe, expect, test } from 'bun:test';

import { computeSeasonStartRating, computeSeasonStartRatingAdvanced } from '@/lib/arena/season-reset';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import {
  buildSeasonSoftResetUpdateSql,
  executeSeasonSoftResetQueueUpdate,
} from '@/lib/db/repositories/season-soft-reset';

describe('season-reset: hundreds_toward_base', () => {
  const opts = {
    policy: 'hundreds_toward_base' as const,
    baseRating: 1000,
    factor: 1,
    step: 100,
    minStartRating: 800,
    maxStartRating: 1500,
  };

  test('示例区间：801~900 → 900', () => {
    expect(computeSeasonStartRating(801, opts)).toBe(900);
    expect(computeSeasonStartRating(850, opts)).toBe(900);
    expect(computeSeasonStartRating(900, opts)).toBe(900);
  });

  test('示例区间：901~1099 → 1000', () => {
    expect(computeSeasonStartRating(901, opts)).toBe(1000);
    expect(computeSeasonStartRating(999, opts)).toBe(1000);
    expect(computeSeasonStartRating(1000, opts)).toBe(1000);
    expect(computeSeasonStartRating(1001, opts)).toBe(1000);
    expect(computeSeasonStartRating(1099, opts)).toBe(1000);
  });

  test('示例区间：1100~1199 → 1100', () => {
    expect(computeSeasonStartRating(1100, opts)).toBe(1100);
    expect(computeSeasonStartRating(1150, opts)).toBe(1100);
    expect(computeSeasonStartRating(1199, opts)).toBe(1100);
  });

  test('新赛季初始分上下限：不得低于 800，不得高于 1500', () => {
    expect(computeSeasonStartRating(0, opts)).toBe(800);
    expect(computeSeasonStartRating(799, opts)).toBe(800);
    expect(computeSeasonStartRating(1600, opts)).toBe(1500);
    expect(computeSeasonStartRating(99999, opts)).toBe(1500);
  });

  test('可选：factor 会先做一次 soft reset，再归位', () => {
    expect(
      computeSeasonStartRating(1100, {
        ...opts,
        factor: 0.5,
      })
    ).toBe(1000);
    expect(
      computeSeasonStartRating(900, {
        ...opts,
        factor: 0.5,
      })
    ).toBe(1000);
  });
});

describe('season-reset: advanced factor', () => {
  const baseOpts = {
    policy: 'hundreds_toward_base' as const,
    baseRating: 1000,
    factor: 1,
    step: 100,
    minStartRating: 800,
    maxStartRating: 1500,
  };

  test('按 games 分段：场次少回收更强', () => {
    const nowIso = new Date('2026-01-01T00:00:00.000Z').toISOString();
    const opts = {
      ...baseOpts,
      gamesFactor: {
        enabled: true,
        gamesMid: 10,
        gamesHigh: 30,
        factorLow: 0.4,
        factorMid: 0.7,
        factorHigh: 1,
      },
    };

    expect(computeSeasonStartRatingAdvanced(1400, { games: 0, updatedAtIso: nowIso }, opts, nowIso)).toBe(
      computeSeasonStartRating(1400, { ...baseOpts, factor: 0.4 })
    );
    expect(computeSeasonStartRatingAdvanced(1400, { games: 10, updatedAtIso: nowIso }, opts, nowIso)).toBe(
      computeSeasonStartRating(1400, { ...baseOpts, factor: 0.7 })
    );
    expect(computeSeasonStartRatingAdvanced(1400, { games: 30, updatedAtIso: nowIso }, opts, nowIso)).toBe(
      computeSeasonStartRating(1400, { ...baseOpts, factor: 1 })
    );
  });

  test('不活跃额外回收：effectiveFactor 取更小值', () => {
    const nowIso = new Date('2026-01-01T00:00:00.000Z').toISOString();
    const oldIso = new Date('2025-11-01T00:00:00.000Z').toISOString();
    const opts = {
      ...baseOpts,
      factor: 1,
      inactivityCap: {
        enabled: true,
        inactiveDays: 30,
        inactiveFactor: 0.5,
      },
    };

    expect(computeSeasonStartRatingAdvanced(1300, { games: 30, updatedAtIso: oldIso }, opts, nowIso)).toBe(
      computeSeasonStartRating(1300, { ...baseOpts, factor: 0.5 })
    );
    expect(computeSeasonStartRatingAdvanced(1300, { games: 30, updatedAtIso: nowIso }, opts, nowIso)).toBe(
      computeSeasonStartRating(1300, { ...baseOpts, factor: 1 })
    );
  });

  test('games 分段 + 不活跃叠加：取更小 factor', () => {
    const nowIso = new Date('2026-01-01T00:00:00.000Z').toISOString();
    const oldIso = new Date('2025-11-01T00:00:00.000Z').toISOString();
    const opts = {
      ...baseOpts,
      gamesFactor: {
        enabled: true,
        gamesMid: 10,
        gamesHigh: 30,
        factorLow: 0.8,
        factorMid: 0.9,
        factorHigh: 1,
      },
      inactivityCap: {
        enabled: true,
        inactiveDays: 30,
        inactiveFactor: 0.5,
      },
    };

    expect(computeSeasonStartRatingAdvanced(1400, { games: 0, updatedAtIso: oldIso }, opts, nowIso)).toBe(
      computeSeasonStartRating(1400, { ...baseOpts, factor: 0.5 })
    );
  });
});

type ExpectedUpdateCall = {
  sqlIncludes: string[];
  sqlExcludes?: string[];
  params: unknown[];
  changes?: number;
};

const createSeasonResetMockDb = (expectedCalls: ExpectedUpdateCall[]) => {
  let index = 0;
  const invoke = async (sqlText: string, params: unknown[]) => {
    const expected = expectedCalls[index];
    index += 1;

    expect(expected).toBeDefined();
    if (!expected) throw new Error(`未预期的 SQL 调用: ${sqlText}`);

    for (const token of expected.sqlIncludes) {
      expect(sqlText.includes(token)).toBeTrue();
    }
    for (const token of expected.sqlExcludes ?? []) {
      expect(sqlText.includes(token)).toBeFalse();
    }
    expect(params).toEqual(expected.params);

    return {
      success: true,
      results: [],
      meta: { changes: expected.changes ?? 1 },
    };
  };

  const db = {
    $client: {
      prepare: (sqlText: string) => ({
        bind: (...params: unknown[]) => ({
          all: async () => ({ success: true, results: [], meta: {} }),
          run: () => invoke(sqlText, params),
        }),
      }),
    },
  } as unknown as AppDrizzleDb;

  const assertDone = () => {
    expect(index).toBe(expectedCalls.length);
  };

  return { db, assertDone };
};

describe('season-soft-reset SQL seam', () => {
  const ratingExpr = 'CAST(ROUND(arena_ratings.rating * ?) AS INTEGER)';
  const ratingParams = [0.75];
  const nowIso = '2026-03-25T00:00:00.000Z';

  test('buildSeasonSoftResetUpdateSql strict: 包含 season extrema 与 seasonPeakTier 重置（legacy=true）', () => {
    const result = buildSeasonSoftResetUpdateSql({
      queue: 'strict',
      ratingExpr,
      ratingParams,
      nowIso,
      includeLegacyColumns: true,
    });

    expect(result.sql.includes('last_delta = NULL')).toBeTrue();
    expect(result.sql.includes('last_applied_at = NULL')).toBeTrue();
    expect(result.sql.includes(`season_peak_rating = ${ratingExpr}`)).toBeTrue();
    expect(result.sql.includes('season_peak_games = 0')).toBeTrue();
    expect(result.sql.includes('season_peak_at = ?')).toBeTrue();
    expect(result.sql.includes("season_peak_tier = '无牌'")).toBeTrue();
    expect(result.sql.includes(`season_low_rating = ${ratingExpr}`)).toBeTrue();
    expect(result.sql.includes('season_low_games = 0')).toBeTrue();
    expect(result.sql.includes('season_low_at = ?')).toBeTrue();
    expect(result.params).toEqual([...ratingParams, ...ratingParams, nowIso, ...ratingParams, nowIso, nowIso, 'strict']);
  });

  test('buildSeasonSoftResetUpdateSql strict: legacy=false 时仍重置 season 字段', () => {
    const result = buildSeasonSoftResetUpdateSql({
      queue: 'strict',
      ratingExpr,
      ratingParams,
      nowIso,
      includeLegacyColumns: false,
    });

    expect(result.sql.includes('last_delta = NULL')).toBeFalse();
    expect(result.sql.includes('last_applied_at = NULL')).toBeFalse();
    expect(result.sql.includes(`season_peak_rating = ${ratingExpr}`)).toBeTrue();
    expect(result.sql.includes('season_peak_games = 0')).toBeTrue();
    expect(result.sql.includes("season_peak_tier = '无牌'")).toBeTrue();
    expect(result.sql.includes(`season_low_rating = ${ratingExpr}`)).toBeTrue();
    expect(result.sql.includes('season_low_games = 0')).toBeTrue();
    expect(result.params).toEqual([...ratingParams, ...ratingParams, nowIso, ...ratingParams, nowIso, nowIso, 'strict']);
  });

  test('buildSeasonSoftResetUpdateSql free: 不写 season extrema（legacy true/false 均不污染）', () => {
    const legacyTrue = buildSeasonSoftResetUpdateSql({
      queue: 'free',
      ratingExpr,
      ratingParams,
      nowIso,
      includeLegacyColumns: true,
    });
    const legacyFalse = buildSeasonSoftResetUpdateSql({
      queue: 'free',
      ratingExpr,
      ratingParams,
      nowIso,
      includeLegacyColumns: false,
    });

    expect(legacyTrue.sql.includes('last_delta = NULL')).toBeTrue();
    expect(legacyFalse.sql.includes('last_delta = NULL')).toBeFalse();
    expect(legacyTrue.sql.includes('season_peak_rating')).toBeFalse();
    expect(legacyTrue.sql.includes('season_peak_games')).toBeFalse();
    expect(legacyTrue.sql.includes('season_peak_at')).toBeFalse();
    expect(legacyTrue.sql.includes('season_peak_tier')).toBeFalse();
    expect(legacyTrue.sql.includes('season_low_rating')).toBeFalse();
    expect(legacyTrue.sql.includes('season_low_games')).toBeFalse();
    expect(legacyTrue.sql.includes('season_low_at')).toBeFalse();
    expect(legacyFalse.sql.includes('season_peak_rating')).toBeFalse();
    expect(legacyTrue.params).toEqual([...ratingParams, nowIso, 'free']);
    expect(legacyFalse.params).toEqual([...ratingParams, nowIso, 'free']);
  });

  test('executeSeasonSoftResetQueueUpdate strict: season 字段重置为新起始分 + 0 局 + 无牌语义', async () => {
    const { db, assertDone } = createSeasonResetMockDb([
      {
        sqlIncludes: [
          `rating = ${ratingExpr}`,
          `season_peak_rating = ${ratingExpr}`,
          'season_peak_games = 0',
          "season_peak_tier = '无牌'",
          `season_low_rating = ${ratingExpr}`,
          'season_low_games = 0',
        ],
        sqlExcludes: ['last_delta = NULL', 'last_applied_at = NULL'],
        params: [...ratingParams, ...ratingParams, nowIso, ...ratingParams, nowIso, nowIso, 'strict'],
        changes: 3,
      },
    ]);

    const changes = await executeSeasonSoftResetQueueUpdate(db, {
      queue: 'strict',
      ratingExpr,
      ratingParams,
      nowIso,
      includeLegacyColumns: false,
    });

    expect(changes).toBe(3);
    assertDone();
  });
});
