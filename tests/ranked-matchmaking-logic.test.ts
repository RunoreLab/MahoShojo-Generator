import { describe, expect, test } from 'vitest';

import { pickStrictMatchmakingCandidate, STRICT_MATCHMAKING_BANDS } from '@/lib/arena/ranked-matchmaking-logic';

const mulberry32 = (seed: number): (() => number) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
};

const bucketFromDiff = (diff: number): string => {
  for (const band of STRICT_MATCHMAKING_BANDS) {
    if (diff >= band.minDiffInclusive && diff <= band.maxDiffInclusive) return band.bucket;
  }
  return 'unknown';
};

describe('ranked-matchmaking-logic: strict', () => {
  test('分桶抽样比例：near/mid/far 大体符合 bucketWeight（概率校验）', () => {
    const targetRating = 1000;
    const candidates = [
      ...Array.from({ length: 40 }).map((_, i) => ({ rating: targetRating + (i % 3) * 30, games: 30 })),
      ...Array.from({ length: 40 }).map((_, i) => ({ rating: targetRating + 400 + (i % 4) * 30, games: 30 })),
      ...Array.from({ length: 40 }).map((_, i) => ({ rating: targetRating + 2000 + (i % 5) * 60, games: 30 })),
    ];

    const rng = mulberry32(123456);
    const trials = 6000;
    const counts: Record<string, number> = { near: 0, mid: 0, far: 0, unknown: 0 };

    for (let i = 0; i < trials; i += 1) {
      const picked = pickStrictMatchmakingCandidate(candidates, targetRating, { rng });
      expect(picked).not.toBeNull();
      if (!picked) continue;
      const diff = Math.abs(picked.rating - targetRating);
      const bucket = bucketFromDiff(diff);
      counts[bucket] = (counts[bucket] ?? 0) + 1;
    }

    const nearRatio = counts.near / trials;
    const midRatio = counts.mid / trials;
    const farRatio = counts.far / trials;

    expect(nearRatio).toBeGreaterThan(0.51);
    expect(nearRatio).toBeLessThan(0.59);
    expect(midRatio).toBeGreaterThan(0.26);
    expect(midRatio).toBeLessThan(0.34);
    expect(farRatio).toBeGreaterThan(0.12);
    expect(farRatio).toBeLessThan(0.18);
    expect(counts.unknown).toBe(0);
  });

  test('同分差时优先低局数（概率校验）', () => {
    const targetRating = 1000;
    const lowGames = { rating: targetRating, games: 0 };
    const highGames = { rating: targetRating, games: 100 };
    const candidates = [lowGames, highGames];

    const rng = mulberry32(42);
    const trials = 2000;
    let lowCount = 0;

    for (let i = 0; i < trials; i += 1) {
      const picked = pickStrictMatchmakingCandidate(candidates, targetRating, { rng });
      expect(picked).not.toBeNull();
      if (!picked) continue;
      if (picked === lowGames) lowCount += 1;
    }

    const ratio = lowCount / trials;
    expect(ratio).toBeGreaterThan(0.63);
  });
});

