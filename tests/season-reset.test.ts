import { describe, expect, test } from 'bun:test';

import { computeSeasonStartRating } from '@/lib/arena/season-reset';

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

