import { describe, expect, test } from 'bun:test';

import {
  buildPairKey,
  computeEloUpdate,
  computeKFactor,
  isStrictEligible,
  parseWinnerSlot,
  type ArenaEligibilitySnapshot,
  type ArenaRatingSnapshot,
} from '@/lib/database/arena-ratings';
import type { BattleReportGenerationCombatantRow } from '@/lib/database/battle-report-generation-combatants';

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

  test('winner 解析：保留 codename 下划线并可匹配（I_moly（墨澧））', () => {
    const parsed = parseWinnerSlot('I_moly（墨澧）', ['I_moly', '天子']);
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

  test('winner 解析：带分隔符但仅命中唯一参战者时可计分（别名/备注场景）', () => {
    const parsed = parseWinnerSlot('雪绒、别名', ['雪绒', '鸢']);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.winnerSlot).toBe(1);
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

describe('arena-ratings: 严格排位资格判定', () => {
  const buildCombatant = (name: string, characterGuidance: string | null): BattleReportGenerationCombatantRow => ({
    generation_id: 'gen',
    sort_index: 0,
    name,
    type: null,
    template_id: null,
    is_native: null,
    is_preset: null,
    team_id: null,
    character_guidance: characterGuidance,
    data_card_id: null,
    data_card_updated_at: null,
    size_chars: null,
    size_bytes: null,
    created_at: new Date(0).toISOString(),
  });

  const baseSnapshot: ArenaEligibilitySnapshot = {
    status: 'completed',
    mode: 'classic',
    userId: 1,
    ipAnonymized: '203.0.113.0',
    language: 'zh-CN',
    selectedLevel: null,
    hasUserGuidance: 0,
    hasAdjudicationEvents: 0,
    readArenaHistory: 0,
    readCurrentState: 0,
    combatantCount: 2,
    winner: '甲',
    extraJson: JSON.stringify({ readNarrativeHistory: false, narrativeHistoryReadCount: 0 }),
  };

  const baseCombatants: BattleReportGenerationCombatantRow[] = [buildCombatant('甲', null), buildCombatant('乙', null)];

  test('满足：默认等级 + 不读叙事/历战/状态 + 简体中文', () => {
    expect(isStrictEligible(baseSnapshot, baseCombatants)).toBe(true);
  });

  test('不满足：语言非简体中文', () => {
    expect(isStrictEligible({ ...baseSnapshot, language: 'en' }, baseCombatants)).toBe(false);
  });

  test('不满足：等级非默认', () => {
    expect(isStrictEligible({ ...baseSnapshot, selectedLevel: '花级' }, baseCombatants)).toBe(false);
  });

  test('不满足：extra_json 缺失 readNarrativeHistory（宁可漏算）', () => {
    expect(isStrictEligible({ ...baseSnapshot, extraJson: JSON.stringify({}) }, baseCombatants)).toBe(false);
    expect(isStrictEligible({ ...baseSnapshot, extraJson: null }, baseCombatants)).toBe(false);
  });

  test('不满足：读取叙事历史开启', () => {
    expect(isStrictEligible({ ...baseSnapshot, extraJson: JSON.stringify({ readNarrativeHistory: true }) }, baseCombatants)).toBe(false);
  });
});
