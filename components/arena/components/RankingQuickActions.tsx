'use client';

import { useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/lib/useAuth';
import { authStorage } from '@/lib/auth';

import { useBattleStore } from '../stores/useBattleStore';
import type { BattleStoreState, CombatantData } from '../types';
import { getCombatantDisplayName, inferCombatantType, validateCanshouData, validateMagicalGirlData } from '../utils/characterValidator';

const removePrivateKeys = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(removePrivateKeys);
  }
  const cleaned: any = {};
  for (const key of Object.keys(obj)) {
    if (!key.startsWith('_')) {
      cleaned[key] = removePrivateKeys(obj[key]);
    }
  }
  return cleaned;
};

const verifyOrigin = async (payload: any): Promise<boolean> => {
  const response = await fetch('/api/verify-origin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) return false;
  const { isValid } = await response.json();
  return Boolean(isValid);
};

type RankedMatchmakingResponse =
  | {
      success: true;
      ticket: any;
      opponent:
        | {
            entityType: 'data_card';
            card: {
              id: string;
              name: string;
              description: string | null;
              data: string;
              is_public: number | boolean | null;
              updated_at: string | null;
              created_at: string | null;
              username: string | null;
              like_count?: number | null;
              favorite_count?: number | null;
              usage_count?: number | null;
            };
          }
        | { entityType: 'preset'; preset: { name: string; filename: string; type: 'magical-girl' | 'canshou' } };
      note?: string;
    }
  | { success: false; error: string };

const buildRankedMatchLockKey = (input: {
  battleMode: string;
  selectedLevel: string;
  selectedLanguage: string;
  storyLength: string;
  settings: {
    userGuidance: string;
    readArenaHistory: boolean;
    readCurrentState: boolean;
    readNarrativeHistory: boolean;
    writeArenaHistory: boolean;
    writeCurrentState: boolean;
    writeNarrativeHistory: boolean;
  };
  adjudicationEventCount: number;
  scenarioEnabled: boolean;
  auxScenarioCount: number;
  combatants: Array<{
    isPreset: boolean;
    filename: string;
    sourceDataCardId?: string;
    teamId?: number;
    characterGuidance?: string;
  }>;
}): string => {
  const combatantKeys = input.combatants.map((c) => {
    const entityKey = c.isPreset
      ? `preset:${String(c.filename || '').trim()}`
      : `data_card:${String(c.sourceDataCardId || '').trim()}`;
    return {
      entityKey,
      teamId: typeof c.teamId === 'number' ? c.teamId : null,
      hasCharacterGuidance: Boolean((c.characterGuidance ?? '').trim()),
    };
  });

  return JSON.stringify({
    battleMode: input.battleMode,
    selectedLevel: input.selectedLevel.trim(),
    selectedLanguage: input.selectedLanguage,
    storyLength: input.storyLength,
    settings: {
      userGuidance: input.settings.userGuidance.trim(),
      readArenaHistory: input.settings.readArenaHistory,
      readCurrentState: input.settings.readCurrentState,
      readNarrativeHistory: input.settings.readNarrativeHistory,
      writeArenaHistory: input.settings.writeArenaHistory,
      writeCurrentState: input.settings.writeCurrentState,
      writeNarrativeHistory: input.settings.writeNarrativeHistory,
    },
    adjudicationEventCount: input.adjudicationEventCount,
    scenarioEnabled: input.scenarioEnabled,
    auxScenarioCount: input.auxScenarioCount,
    combatants: combatantKeys,
  });
};

const buildStrictSetupMissingReasons = (input: {
  isAuthenticated: boolean;
  battleMode: string;
  rankableCombatants: CombatantData[];
  userGuidance: string;
  selectedLevel: string;
  selectedLanguage: string;
  readArenaHistory: boolean;
  readCurrentState: boolean;
  readNarrativeHistory: boolean;
  adjudicationEventCount: number;
}): string[] => {
  const reasons: string[] = [];
  if (!input.isAuthenticated) reasons.push('需要先登录');
  if (input.battleMode !== 'classic') reasons.push('模式需为「经典」');
  if (input.rankableCombatants.length <= 0) reasons.push('需先选择 1 位可计分的参战角色（数据卡/预设）');
  if (input.selectedLevel.trim()) reasons.push('等级需为「默认」');
  if (input.selectedLanguage !== 'zh-CN') reasons.push('生成语言需为「简体中文」');
  if (input.userGuidance.trim()) reasons.push('需清空「故事引导」');
  if (input.readArenaHistory) reasons.push('需关闭「读取历战」');
  if (input.readCurrentState) reasons.push('需关闭「读取当前状态」');
  if (input.readNarrativeHistory) reasons.push('需关闭「读取叙事历史」');
  if (input.adjudicationEventCount > 0) reasons.push('需清空「随机判定器事件」');
  if (input.rankableCombatants.some((c) => (c.characterGuidance ?? '').trim())) reasons.push('需清空「角色行动引导」');
  return reasons;
};

export function RankingQuickActions() {
  const { isAuthenticated } = useAuth();
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const battleMode = useBattleSelector((state) => state.battleMode);
  const setBattleMode = useBattleSelector((state) => state.setBattleMode);
  const selectedLevel = useBattleSelector((state) => state.selectedLevel);
  const setSelectedLevel = useBattleSelector((state) => state.setSelectedLevel);
  const selectedLanguage = useBattleSelector((state) => state.selectedLanguage);
  const setSelectedLanguage = useBattleSelector((state) => state.setSelectedLanguage);
  const storyLength = useBattleSelector((state) => state.storyLength);
  const settings = useBattleSelector((state) => state.settings);
  const updateSettings = useBattleSelector((state) => state.updateSettings);
  const adjudicationEvents = useBattleSelector((state) => state.adjudicationEvents);
  const setAdjudicationEvents = useBattleSelector((state) => state.setAdjudicationEvents);
  const combatants = useBattleSelector((state) => state.combatants);
  const setCombatants = useBattleSelector((state) => state.setCombatants);
  const scenario = useBattleSelector((state) => state.scenario);
  const auxScenarios = useBattleSelector((state) => state.auxScenarios);
  const updateCombatantCharacterGuidance = useBattleSelector((state) => state.updateCombatantCharacterGuidance);
  const clearScenario = useBattleSelector((state) => state.clearScenario);
  const clearAuxScenarios = useBattleSelector((state) => state.clearAuxScenarios);
  const isGenerating = useBattleSelector((state) => state.isGenerating);
  const setError = useBattleSelector((state) => state.setError);
  const rankedMatch = useBattleSelector((state) => state.rankedMatch);
  const setRankedMatch = useBattleSelector((state) => state.setRankedMatch);
  const clearRankedMatch = useBattleSelector((state) => state.clearRankedMatch);

  const [selectedPlayerFilename, setSelectedPlayerFilename] = useState<string>('');
  const [isRankedMatching, setIsRankedMatching] = useState(false);

  const readableCombatants = useMemo(
    () => combatants.filter((c): c is CombatantData => 'data' in c),
    [combatants],
  );

  const rankableCombatants = useMemo(
    () =>
      readableCombatants.filter((c) => {
        if (c.isPreset) return Boolean((c.filename ?? '').trim());
        return Boolean((c.sourceDataCardId ?? '').trim());
      }),
    [readableCombatants],
  );

  useEffect(() => {
    if (rankableCombatants.length <= 0) {
      if (selectedPlayerFilename) setSelectedPlayerFilename('');
      return;
    }
    const exists = rankableCombatants.some((c) => c.filename === selectedPlayerFilename);
    if (!exists) {
      setSelectedPlayerFilename(rankableCombatants[0]!.filename);
    }
  }, [rankableCombatants, selectedPlayerFilename]);

  const missingReasons = useMemo(
    () =>
      buildStrictSetupMissingReasons({
        isAuthenticated,
        battleMode,
        rankableCombatants,
        userGuidance: settings.userGuidance,
        selectedLevel,
        selectedLanguage,
        readArenaHistory: settings.readArenaHistory,
        readCurrentState: settings.readCurrentState,
        readNarrativeHistory: settings.readNarrativeHistory,
        adjudicationEventCount: Array.isArray(adjudicationEvents) ? adjudicationEvents.length : 0,
      }),
    [
      adjudicationEvents,
      battleMode,
      isAuthenticated,
      rankableCombatants,
      selectedLanguage,
      selectedLevel,
      settings.readArenaHistory,
      settings.readCurrentState,
      settings.readNarrativeHistory,
      settings.userGuidance,
    ],
  );

  const handleApplyStrictSetup = () => {
    if (isGenerating) return;

    clearRankedMatch();
    setBattleMode('classic');
    setSelectedLevel('');
    setSelectedLanguage('zh-CN');
    updateSettings({
      userGuidance: '',
      readArenaHistory: false,
      readCurrentState: false,
      readNarrativeHistory: false,
    });
    setAdjudicationEvents([]);
    readableCombatants.forEach((c) => updateCombatantCharacterGuidance(c.filename, ''));
    clearScenario();
    clearAuxScenarios();
    setError('✅ 已应用严格排位设置：经典模式 / 默认等级 / 简体中文 / 清空引导 / 关闭读取 / 清空判定与行动引导');
  };

  const currentLockKey = useMemo(() => buildRankedMatchLockKey({
    battleMode,
    selectedLevel,
    selectedLanguage,
    storyLength,
    settings: {
      userGuidance: settings.userGuidance,
      readArenaHistory: settings.readArenaHistory,
      readCurrentState: settings.readCurrentState,
      readNarrativeHistory: settings.readNarrativeHistory,
      writeArenaHistory: settings.writeArenaHistory,
      writeCurrentState: settings.writeCurrentState,
      writeNarrativeHistory: settings.writeNarrativeHistory,
    },
    adjudicationEventCount: Array.isArray(adjudicationEvents) ? adjudicationEvents.length : 0,
    scenarioEnabled: battleMode === 'scenario' && Boolean(scenario.content),
    auxScenarioCount: auxScenarios.length,
    combatants: readableCombatants.map((c) => ({
      isPreset: c.isPreset,
      filename: c.filename,
      sourceDataCardId: c.sourceDataCardId,
      teamId: c.teamId,
      characterGuidance: c.characterGuidance,
    })),
  }), [
    adjudicationEvents,
    auxScenarios.length,
    battleMode,
    readableCombatants,
    scenario.content,
    selectedLanguage,
    selectedLevel,
    settings.readArenaHistory,
    settings.readCurrentState,
    settings.readNarrativeHistory,
    settings.userGuidance,
    settings.writeArenaHistory,
    settings.writeCurrentState,
    settings.writeNarrativeHistory,
    storyLength,
  ]);

  useEffect(() => {
    if (!rankedMatch) return;
    if (rankedMatch.lockKey === currentLockKey) return;
    clearRankedMatch();
    setError('⚠️ 你已修改参战列表或设置，本次排位匹配已失效；严格排位将不计分，请重新匹配。');
  }, [clearRankedMatch, currentLockKey, rankedMatch, setError]);

  const handleRankedMatch = async () => {
    if (isGenerating || isRankedMatching) return;

    if (!isAuthenticated) {
      setError('❌ 需要先登录才能进行严格排位匹配。');
      return;
    }

    const selectedPlayer = rankableCombatants.find((c) => c.filename === selectedPlayerFilename) ?? rankableCombatants[0] ?? null;
    if (!selectedPlayer) {
      setError('❌ 请先从数据库/预设中选择 1 位参战角色。');
      return;
    }

    const playerEntity = selectedPlayer.isPreset
      ? ({ entityType: 'preset', entityId: selectedPlayer.filename } as const)
      : ({ entityType: 'data_card', entityId: (selectedPlayer.sourceDataCardId ?? '').trim() } as const);
    if (!playerEntity.entityId) {
      setError('❌ 当前选择的参战角色未登记为数据卡/预设，无法进行排位匹配。');
      return;
    }

    clearRankedMatch();
    handleApplyStrictSetup();

    const state = useBattleStore.getState();
    const guidanceCount = (state.combatants as any[])
      .filter((c) => c && typeof c === 'object' && 'data' in c)
      .map((c) => typeof c.characterGuidance === 'string' ? c.characterGuidance.trim() : '')
      .filter((g) => Boolean(g)).length;

    const authHeader = await authStorage.getAuthHeader();
    const requestHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authHeader) requestHeaders.Authorization = authHeader;

    const payload = {
      player: playerEntity,
      mode: state.battleMode,
      selectedLevel: state.selectedLevel,
      language: state.selectedLanguage,
      storyLength: state.storyLength,
      settings: {
        userGuidance: state.settings.userGuidance,
        readArenaHistory: state.settings.readArenaHistory,
        readCurrentState: state.settings.readCurrentState,
        readNarrativeHistory: state.settings.readNarrativeHistory,
      },
      adjudicationEventCount: Array.isArray(state.adjudicationEvents) ? state.adjudicationEvents.length : 0,
      characterGuidanceCount: guidanceCount,
      scenarioEnabled: state.battleMode === 'scenario' && Boolean(state.scenario.content),
      auxScenarioCount: state.auxScenarios.length,
    };

    setIsRankedMatching(true);
    setError('正在匹配合适的对手…');
    try {
      const res = await fetch('/api/arena/ranked-matchmaking', {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as RankedMatchmakingResponse;
      if (!res.ok || !json.success) {
        const err = (json as any)?.error || `HTTP ${res.status}`;
        throw new Error(err);
      }

      const keepPlayer = {
        ...selectedPlayer,
        teamId: undefined,
        characterGuidance: '',
      } as CombatantData;

      // 固定为 1v1：保留我方参战者，准备插入对手
      if (json.opponent.entityType === 'data_card') {
        const card = json.opponent.card;
        let cardData: any;
        try {
          cardData = JSON.parse(card.data);
        } catch {
          throw new Error('匹配到的对手数据卡解析失败');
        }

        const cleaned = removePrivateKeys(cardData);
        const resolvedName = getCombatantDisplayName(cleaned);
        const inferredType = inferCombatantType(cleaned);
        const isValid = await verifyOrigin(cleaned);

        const baseFilename = `${card.name || resolvedName}.json`;
        const filename = baseFilename === keepPlayer.filename ? `${(card.name || resolvedName)}（对手）.json` : baseFilename;
        const sourceIsPublic = card.is_public === 1 || card.is_public === true;

        const opponent: CombatantData = {
          type: inferredType,
          data: cleaned,
          filename,
          isValid,
          isPreset: false,
          teamId: undefined,
          characterGuidance: '',
          sourceDataCardId: card.id,
          sourceDataCardName: card.name,
          sourceDataCardDescription: card.description || '',
          sourceDataCardCreatedAt: card.created_at || undefined,
          sourceDataCardUpdatedAt: card.updated_at || undefined,
          sourceIsPublic,
          sourceAuthor: card.username || undefined,
          sourceDataCardUsageCount: typeof card.usage_count === 'number' ? card.usage_count : undefined,
          sourceDataCardLikeCount: typeof card.like_count === 'number' ? card.like_count : undefined,
          sourceDataCardFavoriteCount: typeof card.favorite_count === 'number' ? card.favorite_count : undefined,
        };

        setCombatants([keepPlayer, opponent]);
      } else {
        const preset = json.opponent.preset;
        const presetRes = await fetch(`/presets/${preset.filename}`);
        if (!presetRes.ok) {
          throw new Error(`无法加载预设对手：${preset.name}`);
        }
        const presetData = await presetRes.json();
        const validation = preset.type === 'magical-girl' ? validateMagicalGirlData(presetData) : validateCanshouData(presetData);
        if (!validation.success) {
          throw new Error(validation.errors?.[0] || '预设对手格式校验失败');
        }

        const opponent: CombatantData = {
          type: preset.type,
          data: validation.data ?? presetData,
          filename: preset.filename,
          isValid: true,
          isPreset: true,
          teamId: undefined,
          characterGuidance: '',
        };

        setCombatants([keepPlayer, opponent]);
      }

      const nextState = useBattleStore.getState();
      const lockKey = buildRankedMatchLockKey({
        battleMode: nextState.battleMode,
        selectedLevel: nextState.selectedLevel,
        selectedLanguage: nextState.selectedLanguage,
        storyLength: nextState.storyLength,
        settings: {
          userGuidance: nextState.settings.userGuidance,
          readArenaHistory: nextState.settings.readArenaHistory,
          readCurrentState: nextState.settings.readCurrentState,
          readNarrativeHistory: nextState.settings.readNarrativeHistory,
          writeArenaHistory: nextState.settings.writeArenaHistory,
          writeCurrentState: nextState.settings.writeCurrentState,
          writeNarrativeHistory: nextState.settings.writeNarrativeHistory,
        },
        adjudicationEventCount: Array.isArray(nextState.adjudicationEvents) ? nextState.adjudicationEvents.length : 0,
        scenarioEnabled: nextState.battleMode === 'scenario' && Boolean(nextState.scenario.content),
        auxScenarioCount: nextState.auxScenarios.length,
        combatants: nextState.combatants.filter((c): c is CombatantData => c && typeof c === 'object' && 'data' in c).map((c) => ({
          isPreset: c.isPreset,
          filename: c.filename,
          sourceDataCardId: c.sourceDataCardId,
          teamId: c.teamId,
          characterGuidance: c.characterGuidance,
        })),
      });

      setRankedMatch({ ticket: json.ticket, lockKey });
      const note = typeof json.note === 'string' && json.note.trim() ? `\n${json.note.trim()}` : '';
      setError(`✅ 匹配成功！现在可以直接生成战报。\n提示：匹配后修改参战列表/设置会使严格排位不计分，请重新匹配。${note}`);
    } catch (error) {
      setError(`❌ 排位匹配失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsRankedMatching(false);
    }
  };

  const rankedMatchBadge = useMemo(() => {
    if (!rankedMatch) return null;
    const ticket = rankedMatch.ticket as any;
    const expiresAt = typeof ticket?.expiresAt === 'string' ? ticket.expiresAt.trim() : '';
    const matchId = typeof ticket?.matchId === 'string' ? ticket.matchId.trim() : '';
    const show = expiresAt ? `有效期至 ${expiresAt}` : (matchId ? `matchId: ${matchId}` : '已锁定');
    return <span className="ml-2 inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{show}</span>;
  }, [rankedMatch]);

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white/70 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900">
            排位匹配{rankedMatchBadge}
          </div>
          <div className="mt-1 text-xs text-gray-600">
            严格排位不允许自由挑选对手；选择一位参战角色后，点击一键匹配随机匹配合适对手。
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <select
            className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm"
            value={selectedPlayerFilename}
            onChange={(e) => setSelectedPlayerFilename(e.target.value)}
            disabled={isGenerating || isRankedMatching || rankableCombatants.length <= 0}
            title="选择参战角色（我方）"
          >
            {rankableCombatants.length <= 0 ? (
              <option value="">暂无可计分参战者</option>
            ) : (
              rankableCombatants.map((c) => (
                <option key={c.filename} value={c.filename}>
                  {(c.data?.codename || c.data?.name || c.filename).toString().slice(0, 40)}{c.isPreset ? '（预设）' : ''}
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            onClick={handleRankedMatch}
            disabled={isGenerating || isRankedMatching || rankableCombatants.length <= 0}
            className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            title="匹配对手（严格排位计分需要先匹配）"
          >
            {isRankedMatching ? '匹配中…' : (rankedMatch ? '重新匹配' : '一键匹配')}
          </button>
          <button
            type="button"
            onClick={handleApplyStrictSetup}
            disabled={isGenerating || isRankedMatching}
            className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
            title="将严格排位相关设置一键安排到位"
          >
            严格设置
          </button>
        </div>
      </div>

      <div className="mt-2 text-xs text-gray-600">
        {missingReasons.length === 0 ? (
          <span className="text-emerald-700 font-semibold">当前设置：已满足排位匹配前置条件</span>
        ) : (
          <span>
            当前仍缺少：<span className="text-gray-800">{missingReasons.join('、')}</span>
          </span>
        )}
      </div>

      <div className="mt-2 text-[11px] text-gray-500">
        提示：排位匹配后如修改参战列表/设置，会自动取消本次匹配；该局仅计入自由排位（若符合条件）。
      </div>
    </div>
  );
}
