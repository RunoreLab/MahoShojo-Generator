import { describe, expect, test } from 'bun:test';

import { buildPairKey, computeEloUpdate, computeKFactor, parseWinnerSlot, type ArenaRatingSnapshot } from '@/lib/database/arena-ratings';

describe('arena-ratings: Elo / winner parse', () => {
  test('K 因子分段', () => {
    expect(computeKFactor(0)).toBe(40);
    expect(computeKFactor(9)).toBe(40);
    expect(computeKFactor(10)).toBe(24);
    expect(computeKFactor(29)).toBe(24);
    expect(computeKFactor(30)).toBe(16);
  });

  test('Elo：1000 vs 1000，胜者增 20（K=40）', () => {
    const a: ArenaRatingSnapshot = { rating: 1000, games: 0, wins: 0, losses: 0, draws: 0 };
    const b: ArenaRatingSnapshot = { rating: 1000, games: 0, wins: 0, losses: 0, draws: 0 };
    const update = computeEloUpdate(a, b, 1);
    expect(update.kA).toBe(40);
    expect(update.kB).toBe(40);
    expect(update.deltaA).toBe(20);
    expect(update.deltaB).toBe(-20);
  });

  test('winner 解析：平局', () => {
    const parsed = parseWinnerSlot('平局', ['雪绒', '鸢']);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.winnerSlot).toBe(0);
  });

  test('winner 解析：括号尾注会被剔除', () => {
    const parsed = parseWinnerSlot('雪绒（P1）', ['雪绒', '鸢']);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.winnerSlot).toBe(1);
  });

  test('winner 解析：多胜者直接跳过', () => {
    const parsed = parseWinnerSlot('雪绒、鸢', ['雪绒', '鸢']);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.skipReason).toBe('multi-winner');
  });

  test('winner 解析：包含式匹配（用于 PVP 胜者行带额外描述）', () => {
    const parsed = parseWinnerSlot('看守（魔女残骸） (P2)', ['白百合', '看守']);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.winnerSlot).toBe(2);
  });

  test('pair_key 对 A/B 无序一致', () => {
    const a = { entityType: 'data_card' as const, entityId: 'aaa' };
    const b = { entityType: 'preset' as const, entityId: 'bbb.json' };
    expect(buildPairKey(a, b)).toBe(buildPairKey(b, a));
  });
});
