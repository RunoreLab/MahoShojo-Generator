import { describe, expect, test } from 'vitest';

import { applyQueenTier, computeArenaBaseTier, isArenaScepterTier } from '@/lib/arena/tier';

describe('arena tier', () => {
  test('computeArenaBaseTier: 阈值映射', () => {
    expect(computeArenaBaseTier(1000, 0)).toBe('无牌');
    expect(computeArenaBaseTier(2000, 4)).toBe('无牌');
    expect(computeArenaBaseTier(799, 99)).toBe('无牌');

    expect(computeArenaBaseTier(800, 5)).toBe('白牌');
    expect(computeArenaBaseTier(999, 5)).toBe('白牌');
    expect(computeArenaBaseTier(1000, 5)).toBe('字牌');
    expect(computeArenaBaseTier(1199, 5)).toBe('字牌');
    expect(computeArenaBaseTier(1200, 5)).toBe('花牌');
    expect(computeArenaBaseTier(1499, 5)).toBe('花牌');
    expect(computeArenaBaseTier(1500, 5)).toBe('权杖');
  });

  test('applyQueenTier: 仅能从权杖晋升为女王', () => {
    expect(applyQueenTier('权杖', true)).toBe('女王');
    expect(applyQueenTier('权杖', false)).toBe('权杖');
    expect(applyQueenTier('花牌', true)).toBe('花牌');
  });

  test('isArenaScepterTier: 权杖判定', () => {
    expect(isArenaScepterTier(1500, 5)).toBe(true);
    expect(isArenaScepterTier(2000, 4)).toBe(false);
    expect(isArenaScepterTier(1499, 5)).toBe(false);
  });
});
