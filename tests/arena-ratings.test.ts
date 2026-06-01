import { describe, expect, test } from 'vitest';

import {
  buildPairKey,
  buildInitialStrictSeasonState,
  computeEloUpdate,
  computeKFactor,
  computeStrictSeasonExtremaAfterApplied,
  getStrictRangeCheckResult,
  isFreeEligible,
  isStrictEligible,
  parseCombatantEntity,
  parseGenerationCombatantsFallback,
  parseWinnerSlot,
  STRICT_DAILY_LIMIT,
  STRICT_DEDUP_WINDOW_MS,
  STRICT_LOW_GAMES_MAX_ABS_DIFF,
  STRICT_SAME_PAIR_DAILY_LIMIT,
  type ArenaEligibilitySnapshot,
  type ArenaRatingSnapshot,
} from '@/lib/database/arena-ratings';
import { compareArenaTier, pickHigherArenaTier } from '@/lib/arena/tier';
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

  test('winner 解析：相似度匹配可消除少量异体字差异（冰川/氷川）', () => {
    const parsed = parseWinnerSlot('氷川羽真', ['冰川羽真', '对手']);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.winnerSlot).toBe(1);
  });

  test('winner 解析：称号导致文本变长时仍可匹配少量异体字差异（冰川/氷川 + 「称号」）', () => {
    const parsed = parseWinnerSlot('氷川日菜', ['冰川日菜「今日も、君の笑顔が答え」', '对手']);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.winnerSlot).toBe(1);
  });

  test('winner 解析：多胜者中存在异体字时不应误判为唯一胜者（避免“对手在前就判对手赢”）', () => {
    const parsed = parseWinnerSlot('对手、氷川羽真', ['对手', '冰川羽真']);
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

describe('arena-ratings: season extrema / tier helpers', () => {
  test('tier 比较：女王高于权杖', () => {
    expect(compareArenaTier('女王', '权杖')).toBeGreaterThan(0);
  });

  test('season extrema：更高 afterRating 刷新 peak，不改 low', () => {
    const nowIso = new Date(0).toISOString();
    const appliedAtIso = new Date(1000).toISOString();
    const current = {
      seasonPeakRating: 1200,
      seasonPeakGames: 4,
      seasonPeakAt: nowIso,
      seasonLowRating: 900,
      seasonLowGames: 2,
      seasonLowAt: nowIso,
    };
    const updated = computeStrictSeasonExtremaAfterApplied({
      current,
      afterRating: 1300,
      afterGames: 5,
      appliedAtIso,
    });
    expect(updated.seasonPeakRating).toBe(1300);
    expect(updated.seasonPeakGames).toBe(5);
    expect(updated.seasonPeakAt).toBe(appliedAtIso);
    expect(updated.seasonLowRating).toBe(900);
    expect(updated.seasonLowGames).toBe(2);
    expect(updated.seasonLowAt).toBe(nowIso);
  });

  test('season extrema：更低 afterRating 刷新 low，不改 peak', () => {
    const nowIso = new Date(0).toISOString();
    const appliedAtIso = new Date(1000).toISOString();
    const current = {
      seasonPeakRating: 1200,
      seasonPeakGames: 4,
      seasonPeakAt: nowIso,
      seasonLowRating: 900,
      seasonLowGames: 2,
      seasonLowAt: nowIso,
    };
    const updated = computeStrictSeasonExtremaAfterApplied({
      current,
      afterRating: 800,
      afterGames: 5,
      appliedAtIso,
    });
    expect(updated.seasonLowRating).toBe(800);
    expect(updated.seasonLowGames).toBe(5);
    expect(updated.seasonLowAt).toBe(appliedAtIso);
    expect(updated.seasonPeakRating).toBe(1200);
    expect(updated.seasonPeakGames).toBe(4);
    expect(updated.seasonPeakAt).toBe(nowIso);
  });

  test('pickHigherArenaTier：花牌 < 权杖', () => {
    expect(pickHigherArenaTier('花牌', '权杖')).toBe('权杖');
  });

  test('pickHigherArenaTier：权杖 < 女王', () => {
    expect(pickHigherArenaTier('权杖', '女王')).toBe('女王');
  });

  test('buildInitialStrictSeasonState 返回默认 extrema 与 seasonPeakTier', () => {
    const nowIso = new Date(0).toISOString();
    const state = buildInitialStrictSeasonState(1000, nowIso);
    expect(state.seasonPeakRating).toBe(1000);
    expect(state.seasonPeakGames).toBe(0);
    expect(state.seasonPeakAt).toBe(nowIso);
    expect(state.seasonPeakTier).toBe('无牌');
    expect(state.seasonLowRating).toBe(1000);
    expect(state.seasonLowGames).toBe(0);
    expect(state.seasonLowAt).toBe(nowIso);
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
    hasScenario: 0,
    hasUserGuidance: 0,
    userGuidancePreview: null,
    hasAdjudicationEvents: 0,
    readArenaHistory: 0,
    readCurrentState: 0,
    combatantCount: 2,
    winner: '甲',
    extraJson: JSON.stringify({ readNarrativeHistory: false, narrativeHistoryReadCount: 0, rankedMatchOk: true }),
  };

  const baseCombatants: BattleReportGenerationCombatantRow[] = [buildCombatant('甲', null), buildCombatant('乙', null)];

  test('满足：不读叙事/历战/状态 + 简体中文', () => {
    expect(isStrictEligible(baseSnapshot, baseCombatants)).toBe(true);
  });

  test('满足：arenaStrictPolicy=1+3:v1 时不要求 rankedMatchOk', () => {
    expect(
      isStrictEligible(
        {
          ...baseSnapshot,
          extraJson: JSON.stringify({ readNarrativeHistory: false, narrativeHistoryReadCount: 0, arenaStrictPolicy: '1+3:v1' }),
        },
        baseCombatants,
      ),
    ).toBe(true);
  });

  test('满足：赛季故事引导 + arenaStrictPolicy=1+3:v1 时可计 strict（无需 rankedMatchOk）', () => {
    const guidance = '双方全力以赴禁止平局';
    expect(
      isStrictEligible(
        {
          ...baseSnapshot,
          hasUserGuidance: 1,
          userGuidancePreview: guidance,
          extraJson: JSON.stringify({
            readNarrativeHistory: false,
            narrativeHistoryReadCount: 0,
            arenaStrictPolicy: '1+3:v1',
            seasonStoryGuidance: guidance,
          }),
        },
        baseCombatants,
      ),
    ).toBe(true);
  });

  test('满足：赛季要求指定问卷 Lore 且完全匹配时可计 strict', () => {
    expect(
      isStrictEligible(
        {
          ...baseSnapshot,
          extraJson: JSON.stringify({
            readNarrativeHistory: false,
            narrativeHistoryReadCount: 0,
            rankedMatchOk: true,
            questionnaireLoreEnabled: true,
            seasonQuestionnaireLorePresetIds: ['lore-a', 'lore-b'],
            questionnaireLoreIds: ['lore-b', 'lore-a'],
          }),
        },
        baseCombatants,
      ),
    ).toBe(true);
  });

  test('不满足：赛季要求指定问卷 Lore 但缺失/多选时不可计 strict', () => {
    expect(
      isStrictEligible(
        {
          ...baseSnapshot,
          extraJson: JSON.stringify({
            readNarrativeHistory: false,
            narrativeHistoryReadCount: 0,
            rankedMatchOk: true,
            questionnaireLoreEnabled: true,
            seasonQuestionnaireLorePresetIds: ['lore-a', 'lore-b'],
            questionnaireLoreIds: ['lore-a'],
          }),
        },
        baseCombatants,
      ),
    ).toBe(false);
    expect(
      isStrictEligible(
        {
          ...baseSnapshot,
          extraJson: JSON.stringify({
            readNarrativeHistory: false,
            narrativeHistoryReadCount: 0,
            rankedMatchOk: true,
            questionnaireLoreEnabled: true,
            seasonQuestionnaireLorePresetIds: ['lore-a'],
            questionnaireLoreIds: ['lore-a', 'lore-b'],
          }),
        },
        baseCombatants,
      ),
    ).toBe(false);
  });

  test('不满足：赛季故事引导下缺失 arenaStrictPolicy 时仍要求 rankedMatchOk', () => {
    const guidance = '双方全力以赴禁止平局';
    expect(
      isStrictEligible(
        {
          ...baseSnapshot,
          hasUserGuidance: 1,
          userGuidancePreview: guidance,
          extraJson: JSON.stringify({
            readNarrativeHistory: false,
            narrativeHistoryReadCount: 0,
            seasonStoryGuidance: guidance,
          }),
        },
        baseCombatants,
      ),
    ).toBe(false);
  });

  test('不满足：使用问卷/设定卡 Lore 且赛季未许可', () => {
    expect(
      isStrictEligible(
        {
          ...baseSnapshot,
          extraJson: JSON.stringify({
            readNarrativeHistory: false,
            narrativeHistoryReadCount: 0,
            rankedMatchOk: true,
            questionnaireLoreEnabled: true,
          }),
        },
        baseCombatants,
      ),
    ).toBe(false);
  });

  test('满足：使用问卷/设定卡 Lore 且赛季已许可', () => {
    expect(
      isStrictEligible(
        {
          ...baseSnapshot,
          extraJson: JSON.stringify({
            readNarrativeHistory: false,
            narrativeHistoryReadCount: 0,
            rankedMatchOk: true,
            questionnaireLoreEnabled: true,
            seasonQuestionnaireLoreAllowed: true,
          }),
        },
        baseCombatants,
      ),
    ).toBe(true);
  });

  test('不满足：语言非简体中文', () => {
    expect(isStrictEligible({ ...baseSnapshot, language: 'en' }, baseCombatants)).toBe(false);
  });

  test('不满足：extra_json 缺失 readNarrativeHistory（宁可漏算）', () => {
    expect(isStrictEligible({ ...baseSnapshot, extraJson: JSON.stringify({ rankedMatchOk: true }) }, baseCombatants)).toBe(false);
    expect(isStrictEligible({ ...baseSnapshot, extraJson: null }, baseCombatants)).toBe(false);
  });

  test('不满足：未进行排位匹配（rankedMatchOk 缺失/非 true）', () => {
    expect(isStrictEligible({ ...baseSnapshot, extraJson: JSON.stringify({ readNarrativeHistory: false }) }, baseCombatants)).toBe(false);
    expect(isStrictEligible({ ...baseSnapshot, extraJson: JSON.stringify({ readNarrativeHistory: false, rankedMatchOk: false }) }, baseCombatants)).toBe(false);
  });

  test('不满足：读取叙事历史开启', () => {
    expect(isStrictEligible({ ...baseSnapshot, extraJson: JSON.stringify({ readNarrativeHistory: true, rankedMatchOk: true }) }, baseCombatants)).toBe(false);
  });

  test('不满足：使用通用素材', () => {
    expect(
      isStrictEligible(
        {
          ...baseSnapshot,
          extraJson: JSON.stringify({
            readNarrativeHistory: false,
            narrativeHistoryReadCount: 0,
            rankedMatchOk: true,
            materialCount: 1,
          }),
        },
        baseCombatants,
      ),
    ).toBe(false);
  });

  test('不满足：使用黑名单模型', () => {
    expect(
      isStrictEligible(
        {
          ...baseSnapshot,
          extraJson: JSON.stringify({ readNarrativeHistory: false, rankedMatchOk: true, resolvedModelOverride: 'gemma-3-4b-it' }),
        },
        baseCombatants,
      ),
    ).toBe(false);
    expect(
      isStrictEligible(
        {
          ...baseSnapshot,
          extraJson: JSON.stringify({ readNarrativeHistory: false, rankedMatchOk: true, resolvedModelOverride: 'gemma-3-1b-it' }),
        },
        baseCombatants,
      ),
    ).toBe(false);
    expect(
      isStrictEligible(
        {
          ...baseSnapshot,
          extraJson: JSON.stringify({ readNarrativeHistory: false, rankedMatchOk: true, resolvedModelOverride: 'gemma-3-270m-it' }),
        },
        baseCombatants,
      ),
    ).toBe(false);
  });
});

describe('arena-ratings: 严格排位风控参数', () => {
  test('严格排位每日上限已收紧为 20 局', () => {
    expect(STRICT_DAILY_LIMIT).toBe(20);
  });

  test('严格排位同对手组合冷却窗已调整为 360 分钟', () => {
    expect(STRICT_DEDUP_WINDOW_MS).toBe(360 * 60 * 1000);
  });

  test('严格排位同对手组合每日最多计 2 局', () => {
    expect(STRICT_SAME_PAIR_DAILY_LIMIT).toBe(2);
  });
});

describe('arena-ratings: strict 分差限制', () => {
  test('低局数高段位对局会额外收紧 strict 分差上限', () => {
    const result = getStrictRangeCheckResult(
      { rating: 1300, games: 6 },
      { rating: 1750, games: 8 },
    );
    expect(result).not.toBeNull();
    expect(result?.lowGamesTightened).toBe(true);
    expect(result?.maxAbsDiff).toBe(STRICT_LOW_GAMES_MAX_ABS_DIFF);
    expect(result?.absDiff).toBe(450);
    expect(result?.exceededBy).toBe(50);
  });

  test('高局数对局继续沿用原有 tier 分差上限', () => {
    const result = getStrictRangeCheckResult(
      { rating: 1300, games: 20 },
      { rating: 1750, games: 20 },
    );
    expect(result).not.toBeNull();
    expect(result?.lowGamesTightened).toBe(false);
    expect(result?.maxAbsDiff).toBe(1000);
    expect(result?.exceededBy).toBe(0);
  });

  test('低段位对局仍不触发 strict 分差限制', () => {
    expect(
      getStrictRangeCheckResult(
        { rating: 1000, games: 8 },
        { rating: 1180, games: 9 },
      ),
    ).toBeNull();
  });
});

describe('arena-ratings: 自由排位开关（arenaFreeRankingEnabled）', () => {
  const baseSnapshot: ArenaEligibilitySnapshot = {
    status: 'completed',
    mode: 'classic',
    userId: 1,
    ipAnonymized: '203.0.113.0',
    language: 'zh-CN',
    selectedLevel: null,
    hasScenario: 0,
    hasUserGuidance: 0,
    userGuidancePreview: null,
    hasAdjudicationEvents: 0,
    readArenaHistory: 0,
    readCurrentState: 0,
    combatantCount: 2,
    winner: '甲',
    extraJson: JSON.stringify({}),
  };

  test('未显式关闭（缺失 key / extraJson 为空）时按旧记录视为可结算', () => {
    expect(isFreeEligible({ ...baseSnapshot, extraJson: JSON.stringify({}) })).toBe(true);
    expect(isFreeEligible({ ...baseSnapshot, extraJson: null })).toBe(true);
  });

  test('显式关闭：arenaFreeRankingEnabled=false 时不可结算', () => {
    expect(isFreeEligible({ ...baseSnapshot, extraJson: JSON.stringify({ arenaFreeRankingEnabled: false }) })).toBe(false);
  });

  test('显式开启：arenaFreeRankingEnabled=true 时可结算', () => {
    expect(isFreeEligible({ ...baseSnapshot, extraJson: JSON.stringify({ arenaFreeRankingEnabled: true }) })).toBe(true);
  });
});

describe('arena-ratings: 参战者 entity 解析', () => {
  const buildCombatant = (overrides: Partial<BattleReportGenerationCombatantRow>): BattleReportGenerationCombatantRow => ({
    generation_id: 'gen',
    sort_index: 0,
    name: '雪绒',
    type: null,
    template_id: null,
    is_native: null,
    is_preset: 1,
    team_id: null,
    character_guidance: null,
    data_card_id: null,
    data_card_updated_at: null,
    size_chars: null,
    size_bytes: null,
    created_at: new Date(0).toISOString(),
    ...overrides,
  });

  test('预设：template_id 缺失时使用 name 映射到 filename（避免落库成“雪绒”）', () => {
    const entity = parseCombatantEntity(buildCombatant({ template_id: null, name: '雪绒' }));
    expect(entity).toEqual({ entityType: 'preset', entityId: 'M12_greatness_in_simplicity.json' });
  });

  test('预设：template_id 若误写为 name，也会映射到 filename', () => {
    const entity = parseCombatantEntity(buildCombatant({ template_id: '雪绒', name: '雪绒' }));
    expect(entity).toEqual({ entityType: 'preset', entityId: 'M12_greatness_in_simplicity.json' });
  });

  test('预设：template_id 为 filename 时保持不变', () => {
    const entity = parseCombatantEntity(buildCombatant({ template_id: 'M12_greatness_in_simplicity.json', name: '雪绒' }));
    expect(entity).toEqual({ entityType: 'preset', entityId: 'M12_greatness_in_simplicity.json' });
  });

  test('预设：无法解析时返回 null（宁可漏算，避免生成脏 ID）', () => {
    const entity = parseCombatantEntity(buildCombatant({ template_id: null, name: '不存在的预设名' }));
    expect(entity).toBeNull();
  });

  test('数据卡：data_card_id 优先', () => {
    const entity = parseCombatantEntity(
      buildCombatant({
        is_preset: null,
        name: '任意名',
        data_card_id: 'dc_123',
      })
    );
    expect(entity).toEqual({ entityType: 'data_card', entityId: 'dc_123' });
  });
});

describe('arena-ratings: combatants fallback 解析', () => {
  test('可从 extraJson.combatantsFallback 还原 2 名参战者', () => {
    const rows = parseGenerationCombatantsFallback(
      'gen_fallback_1',
      JSON.stringify({
        combatantsFallback: [
          {
            sortIndex: 1,
            name: '乙',
            type: 'canshou',
            isNative: false,
            isPreset: false,
            teamId: 2,
            characterGuidance: '后手反击',
            dataCardId: 'dc_b',
            dataCardUpdatedAt: '2026-03-01T00:00:00.000Z',
          },
          {
            sortIndex: 0,
            name: '雪绒',
            type: 'magical-girl',
            isNative: true,
            isPreset: true,
            templateId: 'M12_greatness_in_simplicity.json',
            teamId: 1,
            characterGuidance: '先手试探',
          },
        ],
      }),
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]?.generation_id).toBe('gen_fallback_1');
    expect(rows[0]?.sort_index).toBe(0);
    expect(rows[0]?.name).toBe('雪绒');
    expect(rows[0]?.template_id).toBe('M12_greatness_in_simplicity.json');
    expect(rows[0]?.is_preset).toBe(1);
    expect(rows[1]?.sort_index).toBe(1);
    expect(rows[1]?.data_card_id).toBe('dc_b');
    expect(rows[1]?.character_guidance).toBe('后手反击');
  });

  test('异常/缺失 extraJson 时返回空数组', () => {
    expect(parseGenerationCombatantsFallback('gen_fallback_2', null)).toEqual([]);
    expect(parseGenerationCombatantsFallback('gen_fallback_2', '{')).toEqual([]);
    expect(parseGenerationCombatantsFallback('gen_fallback_2', JSON.stringify({}))).toEqual([]);
  });
});
