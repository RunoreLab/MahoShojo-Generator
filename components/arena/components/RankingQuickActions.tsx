'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';
import { isStrictRankedModelBlacklisted } from '@/lib/arena/ranked-model-policy';
import { authStorage } from '@/lib/auth';
import { deriveSeasonStrictRules, formatSeasonTitle, getCurrentSeason, type SeasonBattleMode, type SeasonsConfig } from '@/lib/seasons';
import { getScenarioPresetByFilename } from '@/lib/scenario-presets';
import { useAuth } from '@/lib/useAuth';

import { useBattleActions } from '../hooks/useBattleActions';
import { useBattleStore } from '../stores/useBattleStore';
import type { BattleStoreState, CombatantData } from '../types';

type StrictRangeInfo = {
  absDiff: number;
  maxAbsDiff: number;
  exceededBy: number;
  aRating: number;
  bRating: number;
};

type StrictPreflightResponse =
  | {
      success: true;
      willCount: boolean;
      reasons: string[];
      daily: {
        used: number | null;
        limit: number;
        exceeded: boolean | null;
        sinceIso: string | null;
      };
      range?: StrictRangeInfo | null;
    }
  | { success: false; error: string };

const fetchJson = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
};

const normalizeStrictStoryGuidance = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.slice(0, 200);
};

const formatBattleModeLabel = (mode: SeasonBattleMode): string => {
  const map: Record<SeasonBattleMode, string> = {
    classic: '经典',
    scenario: '情景',
    daily: '日常',
    kizuna: '羁绊',
  };
  return map[mode] ?? mode;
};

const buildStrictSetupMissingReasons = (input: {
  isAuthenticated: boolean;
  battleMode: string;
  requiredMode: SeasonBattleMode;
  requiredStoryGuidance: string;
  requiredScenarioPresetFilename: string | null;
  scenarioFileName: string | null;
  rankableCombatants: CombatantData[];
  userGuidance: string;
  selectedLevel: string;
  selectedLanguage: string;
  readArenaHistory: boolean;
  readCurrentState: boolean;
  readNarrativeHistory: boolean;
  adjudicationEventCount: number;
  userProviderConfigModelId: string | null;
  scenarioEnabled: boolean;
  auxScenarioCount: number;
  questionnaireLoreEnabled: boolean;
  questionnaireLoreAllowed: boolean;
}): string[] => {
  const reasons: string[] = [];
  if (!input.isAuthenticated) reasons.push('需要先登录');
  if (input.battleMode !== input.requiredMode) reasons.push(`模式需为「${formatBattleModeLabel(input.requiredMode)}」`);
  if (input.rankableCombatants.length <= 0) reasons.push('需先选择 1 位可计分的参战角色（数据卡/预设）');
  if (input.selectedLevel.trim()) reasons.push('等级需为「默认」');
  if (input.selectedLanguage !== 'zh-CN') reasons.push('生成语言需为「简体中文」');

  const actualStoryGuidance = normalizeStrictStoryGuidance(input.userGuidance);
  if (input.requiredStoryGuidance) {
    if (actualStoryGuidance !== input.requiredStoryGuidance) {
      reasons.push('需使用赛季指定的「故事引导」');
    }
  } else if (actualStoryGuidance) {
    reasons.push('需清空「故事引导」');
  }

  if (input.readArenaHistory) reasons.push('需关闭「读取历战」');
  if (input.readCurrentState) reasons.push('需关闭「读取当前状态」');
  if (input.readNarrativeHistory) reasons.push('需关闭「读取叙事历史」');
  if (input.adjudicationEventCount > 0) reasons.push('需清空「随机判定器事件」');
  if (input.rankableCombatants.some((c) => (c.characterGuidance ?? '').trim())) reasons.push('需清空「角色行动引导」');
  if (input.questionnaireLoreEnabled && !input.questionnaireLoreAllowed) {
    reasons.push('需关闭「问卷/设定卡 Lore 注入」');
  }

  if (input.requiredMode === 'scenario') {
    if (!input.scenarioEnabled) reasons.push('需启用「情景模式」并选择主情景');
    if (input.requiredScenarioPresetFilename) {
      const fileName = typeof input.scenarioFileName === 'string' ? input.scenarioFileName.trim() : '';
      if (fileName !== input.requiredScenarioPresetFilename) reasons.push('需选择赛季指定的「预设情景」');
    }
  } else if (input.scenarioEnabled) {
    reasons.push('需关闭「情景模式」');
  }

  if (input.auxScenarioCount > 0) reasons.push('需移除「辅助情景」');
  if (input.userProviderConfigModelId && isStrictRankedModelBlacklisted(input.userProviderConfigModelId)) {
    reasons.push('需改用支持严格排位计分的 AI 模型');
  }
  return reasons;
};

const pickNonBlacklistedModelForProvider = (providerId: string): string | null => {
  if (providerId === 'system') return 'default';

  const provider = AI_PROVIDER_CATALOG.find((item) => item.id === providerId) ?? null;
  if (!provider) return null;

  const preferred: string[] = [
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash',
    'gemini-3-flash-preview',
    'gemini-3-pro-preview',
    'google/gemini-2.5-flash-lite',
    'google/gemini-2.5-flash',
    'google/gemini-2.0-flash-lite',
    'google/gemini-2.0-flash',
    'google/gemini-3-flash-preview',
    'google/gemini-3-pro-preview',
  ];

  for (const value of preferred) {
    const exists = provider.models.some((model) => model.value === value);
    if (!exists) continue;
    if (isStrictRankedModelBlacklisted(value)) continue;
    return value;
  }

  const firstNonBlacklisted = provider.models.find((model) => !isStrictRankedModelBlacklisted(model.value));
  return firstNonBlacklisted?.value ?? null;
};

const formatStrictReason = (code: string): string => {
  const map: Record<string, string> = {
    'need-login': '需要先登录',
    'mode-not-classic': '需使用「经典模式」',
    'mode-not-season': '需使用赛季指定模式',
    'combatant-count-not-2': '需 2 人对战',
    'combatants-unrankable': '参战者需为数据卡/预设',
    'season-questionnaire-lore-not-allowed': '赛季规则不允许使用「问卷/设定卡 Lore 注入」',
    'strict-card-missing': '数据卡不存在/已删除（严格排位不计分）',
    'strict-not-character': '仅“角色”数据卡可参与严格排位计分',
    'strict-not-public': '严格排位仅允许公开角色卡',
    'strict-not-approved': '严格排位仅允许已审核通过的公开角色卡',
    'strict-out-of-range': '对手分差过大（不计严格排位）',
    'dedup-user-pair': '短时间同一对手重复对局（严格去重）',
    'strict-check-failed': '严格计分检查失败（已降级为不计）',
    'language-not-zh-cn': '生成语言需为「简体中文」',
    'level-not-default': '等级需为「默认」',
    'has-user-guidance': '需清空「故事引导」',
    'season-user-guidance-missing': '需填写赛季指定「故事引导」',
    'season-user-guidance-mismatch': '「故事引导」与赛季规则不一致',
    'has-adjudication-events': '需清空「随机判定器事件」',
    'read-arena-history': '需关闭「读取历战」',
    'read-current-state': '需关闭「读取当前状态」',
    'read-narrative-history': '需关闭「读取叙事历史」',
    'has-character-guidance': '需清空「角色行动引导」',
    'season-scenario-missing': '需选择主情景（赛季规则）',
    'season-scenario-preset-mismatch': '主情景需为赛季指定预设',
    'season-aux-scenarios-not-allowed': '需移除「辅助情景」（赛季规则）',
    'daily-limit': '今日严格排位计分次数已达上限（按 UTC 00:00/北京时间 08:00 刷新）',
    'ai-model-blacklisted': '选择了不支持严格排位计分的模型',
  };
  return map[code] ?? code;
};

const formatStrictReasonWithDetails = (
  code: string,
  range: StrictRangeInfo | null,
): string => {
  if (code !== 'strict-out-of-range') return formatStrictReason(code);
  if (!range || typeof range !== 'object') return formatStrictReason(code);

  const absDiff = Number.isFinite(range.absDiff) ? Math.max(0, Math.floor(range.absDiff)) : null;
  const maxAbsDiff = Number.isFinite(range.maxAbsDiff) ? Math.max(0, Math.floor(range.maxAbsDiff)) : null;
  if (absDiff == null || maxAbsDiff == null) return formatStrictReason(code);

  const exceededBy = Math.max(0, absDiff - maxAbsDiff);
  const aRating = Number.isFinite(range.aRating) ? Math.floor(range.aRating) : null;
  const bRating = Number.isFinite(range.bRating) ? Math.floor(range.bRating) : null;
  const ratings = aRating != null && bRating != null ? `；双方分 ${aRating} vs ${bRating}` : '';
  return `对手分差过大：允许 ≤${maxAbsDiff}，当前差 ${absDiff}（超出 ${exceededBy}${ratings}）`;
};

export function RankingQuickActions() {
  const { isAuthenticated } = useAuth();
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const { handleScenarioPaste } = useBattleActions();

  const battleMode = useBattleSelector((state) => state.battleMode);
  const setBattleMode = useBattleSelector((state) => state.setBattleMode);
  const selectedLevel = useBattleSelector((state) => state.selectedLevel);
  const setSelectedLevel = useBattleSelector((state) => state.setSelectedLevel);
  const selectedLanguage = useBattleSelector((state) => state.selectedLanguage);
  const setSelectedLanguage = useBattleSelector((state) => state.setSelectedLanguage);
  const arenaFreeRankingEnabled = useBattleSelector((state) => state.arenaFreeRankingEnabled);
  const setArenaFreeRankingEnabled = useBattleSelector((state) => state.setArenaFreeRankingEnabled);
  const storyLength = useBattleSelector((state) => state.storyLength);
  const settings = useBattleSelector((state) => state.settings);
  const updateSettings = useBattleSelector((state) => state.updateSettings);
  const adjudicationEvents = useBattleSelector((state) => state.adjudicationEvents);
  const setAdjudicationEvents = useBattleSelector((state) => state.setAdjudicationEvents);
  const combatants = useBattleSelector((state) => state.combatants);
  const userProviderConfig = useBattleSelector((state) => state.userProviderConfig);
  const setUserProviderConfig = useBattleSelector((state) => state.setUserProviderConfig);
  const scenario = useBattleSelector((state) => state.scenario);
  const auxScenarios = useBattleSelector((state) => state.auxScenarios);
  const selectedQuestionnaires = useBattleSelector((state) => state.selectedQuestionnaires);
  const setQuestionnaireSelections = useBattleSelector((state) => state.setQuestionnaireSelections);
  const updateCombatantCharacterGuidance = useBattleSelector((state) => state.updateCombatantCharacterGuidance);
  const clearScenario = useBattleSelector((state) => state.clearScenario);
  const clearAuxScenarios = useBattleSelector((state) => state.clearAuxScenarios);
  const isGenerating = useBattleSelector((state) => state.isGenerating);
  const setError = useBattleSelector((state) => state.setError);

  const seasonsQuery = useQuery({
    queryKey: ['seasonsConfig'],
    queryFn: () => fetchJson<SeasonsConfig>('/config/seasons.json'),
    staleTime: 60_000,
  });
  const currentSeason = useMemo(() => getCurrentSeason(seasonsQuery.data), [seasonsQuery.data]);
  const seasonStrictRules = useMemo(() => deriveSeasonStrictRules(currentSeason), [currentSeason]);

  const [strictPreflight, setStrictPreflight] = useState<StrictPreflightResponse | null>(null);
  const [isCheckingStrictPreflight, setIsCheckingStrictPreflight] = useState(false);

  const questionnaireLoreEnabled = useMemo(() => {
    return selectedQuestionnaires.some((selection) => {
      if (selection.useLore === false) return false;
      const lore = selection.questionnaire?.loreMarkdown;
      return typeof lore === 'string' && Boolean(lore.trim());
    });
  }, [selectedQuestionnaires]);

  const readableCombatants = useMemo(
    () => combatants.filter((c): c is CombatantData => c && typeof c === 'object' && 'data' in c),
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

  const strictSetupMissingReasons = useMemo(
    () =>
      buildStrictSetupMissingReasons({
        isAuthenticated,
        battleMode,
        requiredMode: seasonStrictRules.mode,
        requiredStoryGuidance: seasonStrictRules.storyGuidance,
        requiredScenarioPresetFilename: seasonStrictRules.scenarioPresetFilename,
        scenarioFileName: typeof scenario.fileName === 'string' ? scenario.fileName : null,
        rankableCombatants,
        userGuidance: settings.userGuidance,
        selectedLevel,
        selectedLanguage,
        readArenaHistory: settings.readArenaHistory,
        readCurrentState: settings.readCurrentState,
        readNarrativeHistory: settings.readNarrativeHistory,
        adjudicationEventCount: Array.isArray(adjudicationEvents) ? adjudicationEvents.length : 0,
        userProviderConfigModelId: userProviderConfig?.modelId ?? null,
        scenarioEnabled: battleMode === 'scenario' && Boolean(scenario.content),
        auxScenarioCount: auxScenarios.length,
        questionnaireLoreEnabled,
        questionnaireLoreAllowed: seasonStrictRules.questionnaireLoreAllowed,
      }),
    [
      adjudicationEvents,
      auxScenarios.length,
      battleMode,
      isAuthenticated,
      questionnaireLoreEnabled,
      rankableCombatants,
      scenario.content,
      scenario.fileName,
      selectedLanguage,
      selectedLevel,
      seasonStrictRules.mode,
      seasonStrictRules.questionnaireLoreAllowed,
      seasonStrictRules.scenarioPresetFilename,
      seasonStrictRules.storyGuidance,
      settings.readArenaHistory,
      settings.readCurrentState,
      settings.readNarrativeHistory,
      settings.userGuidance,
      userProviderConfig?.modelId,
    ],
  );

  const handleApplyStrictSetup = async () => {
    if (isGenerating) return;

    const seasonLabel = currentSeason ? formatSeasonTitle(currentSeason) : null;
    const seasonPreset = seasonStrictRules.scenarioPresetFilename
      ? getScenarioPresetByFilename(seasonStrictRules.scenarioPresetFilename)
      : null;

    const shouldFixBlacklistedModel = Boolean(
      userProviderConfig && userProviderConfig.modelId !== 'default' && isStrictRankedModelBlacklisted(userProviderConfig.modelId),
    );
    let modelFixMessage: string | null = null;

    if (shouldFixBlacklistedModel) {
      const providerId = userProviderConfig?.providerId || 'system';
      const pickedModelId = pickNonBlacklistedModelForProvider(providerId);
      const nextProviderId = pickedModelId ? (providerId === 'system' ? 'system' : providerId) : 'system';
      const nextModelId = pickedModelId ?? 'default';
      const nextConfig = {
        providerId: nextProviderId,
        modelId: nextModelId,
        apiKey: nextProviderId === 'system' ? '' : (userProviderConfig?.apiKey ?? ''),
      };

      setUserProviderConfig(nextConfig);
      modelFixMessage =
        nextProviderId === 'system' && nextModelId === 'default'
          ? '已将 AI 模型恢复为「默认策略」'
          : `已将 AI 模型切换为「${nextModelId}」`;

      try {
        window.localStorage.setItem('arena.customProvider.selected', nextProviderId);
        window.localStorage.setItem(`arena.customProvider.model.${nextProviderId}`, nextModelId);
        window.dispatchEvent(
          new CustomEvent('mahoshojo:set-ai-provider-config', {
            detail: { providerId: nextProviderId, modelId: nextModelId },
          }),
        );
      } catch {
        // localStorage 在部分隐私模式/受限环境下可能不可用，忽略即可
      }
    }

    setBattleMode(seasonStrictRules.mode);
    setSelectedLevel('');
    setSelectedLanguage('zh-CN');
    updateSettings({
      userGuidance: seasonStrictRules.storyGuidance ? seasonStrictRules.storyGuidance : '',
      readArenaHistory: false,
      readCurrentState: false,
      readNarrativeHistory: false,
    });
    setAdjudicationEvents([]);
    readableCombatants.forEach((c) => updateCombatantCharacterGuidance(c.filename, ''));
    if (seasonStrictRules.mode !== 'scenario') {
      clearScenario();
    }
    clearAuxScenarios();

    const disabledQuestionnaireLoreCount = (() => {
      if (seasonStrictRules.questionnaireLoreAllowed) return 0;
      if (!questionnaireLoreEnabled) return 0;
      const nextSelections = selectedQuestionnaires.map((selection) => {
        if (selection.useLore === false) return selection;
        return { ...selection, useLore: false };
      });
      let disabledCount = 0;
      nextSelections.forEach((selection, index) => {
        if (selection.useLore === false && selectedQuestionnaires[index]?.useLore !== false) disabledCount += 1;
      });
      setQuestionnaireSelections(nextSelections);
      return disabledCount;
    })();

    let seasonRuleMessage: string | null = null;
    if (seasonLabel) {
      const parts: string[] = [];
      parts.push(`赛季：${seasonLabel}`);
      if (seasonStrictRules.mode !== 'classic') parts.push(`模式：${formatBattleModeLabel(seasonStrictRules.mode)}`);
      if (seasonStrictRules.storyGuidance) parts.push('已应用赛季故事引导');
      if (seasonPreset) parts.push(`预设情景：${seasonPreset.title}`);
      if (!seasonStrictRules.questionnaireLoreAllowed) parts.push('禁止问卷设定注入');
      seasonRuleMessage = parts.length > 0 ? parts.join(' / ') : null;
    }

    if (seasonStrictRules.mode === 'scenario' && seasonStrictRules.scenarioPresetFilename) {
      try {
        const filename = seasonStrictRules.scenarioPresetFilename;
        const res = await fetch(`/scenario-presets/${encodeURIComponent(filename)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        await handleScenarioPaste(text, { fileName: filename });
        setAdjudicationEvents([]);
      } catch (error) {
        setError(`❌ 无法应用赛季预设情景：${error instanceof Error ? error.message : '未知错误'}`);
        return;
      }
    } else if (seasonStrictRules.mode === 'scenario') {
      setError('✅ 已切换为情景模式（赛季规则）：请继续选择主情景后再开始排位。');
      return;
    }

    setError(
      `✅ 已应用严格排位设置：${formatBattleModeLabel(seasonStrictRules.mode)}模式 / 默认等级 / 简体中文 / ${
        seasonStrictRules.storyGuidance ? '应用赛季故事引导' : '清空引导'
      } / 关闭读取 / 清空判定与行动引导${
        seasonRuleMessage ? ` / ${seasonRuleMessage}` : ''
      }${disabledQuestionnaireLoreCount > 0 ? ` / 已关闭问卷设定注入 ${disabledQuestionnaireLoreCount} 张` : ''}${
        modelFixMessage ? ` / ${modelFixMessage}` : ''
      }`,
    );
  };

  const strictPreflightPayload = useMemo(() => {
    const minimalCombatants = combatants.map((c) => {
      if (!c || typeof c !== 'object') return null;
      if (!('data' in c)) return { placeholder: true };
      const dataCombatant = c as CombatantData;
      return {
        isPreset: Boolean(dataCombatant.isPreset),
        filename: typeof dataCombatant.filename === 'string' ? dataCombatant.filename : null,
        sourceDataCardId: typeof dataCombatant.sourceDataCardId === 'string' ? dataCombatant.sourceDataCardId : null,
        characterGuidance: typeof dataCombatant.characterGuidance === 'string' ? dataCombatant.characterGuidance : null,
      };
    });

    return {
      battleMode,
      selectedLevel,
      language: selectedLanguage,
      storyLength,
      scenarioEnabled: battleMode === 'scenario' && Boolean(scenario.content),
      scenarioFileName: battleMode === 'scenario' ? scenario.fileName : null,
      auxScenarioCount: auxScenarios.length,
      questionnaireLoreEnabled,
      settings: {
        userGuidance: settings.userGuidance,
        readArenaHistory: settings.readArenaHistory,
        readCurrentState: settings.readCurrentState,
        readNarrativeHistory: settings.readNarrativeHistory,
      },
      combatants: minimalCombatants,
      adjudicationEventCount: Array.isArray(adjudicationEvents) ? adjudicationEvents.length : 0,
      ...(userProviderConfig && userProviderConfig.modelId !== 'default'
        ? { customProvider: { providerId: userProviderConfig.providerId, modelId: userProviderConfig.modelId } }
        : {}),
    };
  }, [
    adjudicationEvents,
    auxScenarios.length,
    battleMode,
    combatants,
    scenario.content,
    scenario.fileName,
    selectedLanguage,
    selectedLevel,
    questionnaireLoreEnabled,
    settings.readArenaHistory,
    settings.readCurrentState,
    settings.readNarrativeHistory,
    settings.userGuidance,
    storyLength,
    userProviderConfig,
  ]);

  const localStrictReasons = useMemo(() => {
    const reasons: string[] = [];
    if (!isAuthenticated) reasons.push('need-login');
    if (battleMode !== seasonStrictRules.mode) {
      reasons.push(seasonStrictRules.mode === 'classic' ? 'mode-not-classic' : 'mode-not-season');
    }
    if (combatants.length !== 2) reasons.push('combatant-count-not-2');
    if (selectedLanguage !== 'zh-CN') reasons.push('language-not-zh-cn');
    if (selectedLevel.trim()) reasons.push('level-not-default');

    const actualStoryGuidance = normalizeStrictStoryGuidance(settings.userGuidance);
    if (seasonStrictRules.storyGuidance) {
      if (!actualStoryGuidance) reasons.push('season-user-guidance-missing');
      else if (actualStoryGuidance !== seasonStrictRules.storyGuidance) reasons.push('season-user-guidance-mismatch');
    } else if (actualStoryGuidance) {
      reasons.push('has-user-guidance');
    }

    if (questionnaireLoreEnabled && !seasonStrictRules.questionnaireLoreAllowed) {
      reasons.push('season-questionnaire-lore-not-allowed');
    }

    if (settings.readArenaHistory) reasons.push('read-arena-history');
    if (settings.readCurrentState) reasons.push('read-current-state');
    if (settings.readNarrativeHistory) reasons.push('read-narrative-history');
    if (Array.isArray(adjudicationEvents) && adjudicationEvents.length > 0) reasons.push('has-adjudication-events');
    if (readableCombatants.some((c) => (c.characterGuidance ?? '').trim())) reasons.push('has-character-guidance');
    if (userProviderConfig?.modelId && userProviderConfig.modelId !== 'default' && isStrictRankedModelBlacklisted(userProviderConfig.modelId)) {
      reasons.push('ai-model-blacklisted');
    }

    if (seasonStrictRules.mode === 'scenario') {
      if (!scenario.content) reasons.push('season-scenario-missing');
      if (seasonStrictRules.scenarioPresetFilename) {
        const fileName = typeof scenario.fileName === 'string' ? scenario.fileName.trim() : '';
        if (fileName !== seasonStrictRules.scenarioPresetFilename) reasons.push('season-scenario-preset-mismatch');
      }
      if (auxScenarios.length > 0) reasons.push('season-aux-scenarios-not-allowed');
    }

    if (combatants.length === 2) {
      const invalid = readableCombatants.some((c) => {
        if (c.isPreset) return !(typeof c.filename === 'string' && c.filename.trim());
        return !(typeof c.sourceDataCardId === 'string' && c.sourceDataCardId.trim());
      });
      if (invalid) reasons.push('combatants-unrankable');
    }

    return reasons;
  }, [
    adjudicationEvents,
    auxScenarios.length,
    battleMode,
    combatants.length,
    isAuthenticated,
    readableCombatants,
    scenario.content,
    scenario.fileName,
    selectedLanguage,
    selectedLevel,
    questionnaireLoreEnabled,
    seasonStrictRules.mode,
    seasonStrictRules.questionnaireLoreAllowed,
    seasonStrictRules.scenarioPresetFilename,
    seasonStrictRules.storyGuidance,
    settings.readArenaHistory,
    settings.readCurrentState,
    settings.readNarrativeHistory,
    settings.userGuidance,
    userProviderConfig?.modelId,
  ]);

  useEffect(() => {
    if (!isAuthenticated) {
      setStrictPreflight(null);
      setIsCheckingStrictPreflight(false);
      return;
    }
    if (localStrictReasons.length > 0) {
      setStrictPreflight(null);
      setIsCheckingStrictPreflight(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      (async () => {
        try {
          setIsCheckingStrictPreflight(true);
          const authHeader = await authStorage.getAuthHeader();
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (authHeader) headers.Authorization = authHeader;

          const res = await fetch('/api/arena/strict-preflight', {
            method: 'POST',
            headers,
            body: JSON.stringify(strictPreflightPayload),
            signal: controller.signal,
          });
          const json = (await res.json()) as StrictPreflightResponse;
          if (!res.ok) {
            const err = (json as any)?.error || `HTTP ${res.status}`;
            throw new Error(err);
          }
          setStrictPreflight(json);
        } catch (error) {
          if (controller.signal.aborted) return;
          setStrictPreflight({ success: false, error: error instanceof Error ? error.message : '无法检查严格排位计分状态' });
        } finally {
          if (!controller.signal.aborted) setIsCheckingStrictPreflight(false);
        }
      })();
    }, 350);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [isAuthenticated, localStrictReasons.length, strictPreflightPayload]);

  const strictIndicator = useMemo(() => {
    if (strictPreflight?.success === true) {
      return {
        willCount: strictPreflight.willCount,
        reasons: strictPreflight.reasons,
        range: strictPreflight.range ?? null,
        daily: strictPreflight.daily,
        source: 'server' as const,
      };
    }
    return { willCount: localStrictReasons.length === 0, reasons: localStrictReasons, range: null, daily: null, source: 'local' as const };
  }, [localStrictReasons, strictPreflight]);

  const freeRankingToggleId = 'arena-free-ranking-enabled';
  const strictSetupReady = strictSetupMissingReasons.length === 0;
  const strictCountReady = strictIndicator.willCount;

  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white/70 shadow-sm ring-1 ring-black/5">
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-900">排位赛</h3>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  strictCountReady ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                }`}
              >
                {strictCountReady ? '可计分' : '不计分'}
              </span>
              {strictIndicator.source === 'server' ? (
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700">
                  服务器预检
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700">
                  本地预检
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <button
              type="button"
              onClick={handleApplyStrictSetup}
              disabled={isGenerating}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              title="将严格排位相关设置一键安排到位"
            >
              一键严格设置
            </button>
          </div>
        </div>

        <label
          htmlFor={freeRankingToggleId}
          className={`flex items-start justify-between gap-3 rounded-xl border border-gray-200 bg-white/60 p-3 ${
            isGenerating ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'
          }`}
        >
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-900">自由排位计分</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-gray-600">{arenaFreeRankingEnabled ? '已开启' : '已关闭'}</span>
            <span className="relative inline-flex h-6 w-11 flex-none items-center">
              <input
                id={freeRankingToggleId}
                type="checkbox"
                role="switch"
                checked={arenaFreeRankingEnabled}
                onChange={(e) => setArenaFreeRankingEnabled(e.target.checked)}
                disabled={isGenerating}
                className="peer sr-only"
                aria-label="启用自由排位计分"
              />
              <span className="h-6 w-11 rounded-full bg-gray-300 transition-colors peer-checked:bg-pink-500 peer-disabled:opacity-60" />
              <span className="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5 peer-disabled:opacity-60" />
            </span>
          </div>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-white/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-gray-900">严格计分基础条件</div>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  strictSetupReady ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                }`}
              >
                {strictSetupReady ? '已就绪' : `缺少 ${strictSetupMissingReasons.length} 项`}
              </span>
            </div>
            {strictSetupReady ? (
              <div className="mt-2 text-xs text-gray-600">配置已对齐，可尝试计分。</div>
            ) : (
              <details className="group mt-2">
                <summary className="flex cursor-pointer items-center justify-between gap-2 text-xs font-medium text-gray-700 hover:text-gray-900 [&::-webkit-details-marker]:hidden">
                  <span>查看缺少项</span>
                  <span className="text-gray-400 transition-transform group-open:rotate-180">▾</span>
                </summary>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-gray-700">
                  {strictSetupMissingReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          <div className="rounded-xl border border-gray-200 bg-white/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="text-xs font-semibold text-gray-900">严格排位计分</div>
                {isCheckingStrictPreflight ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-gray-500" />
                    检查中
                  </span>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                {strictIndicator.source === 'server' && strictIndicator.daily?.used != null ? (
                  <span
                    className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700"
                    title={
                      strictIndicator.daily.sinceIso
                        ? `按 UTC 统计：每日 UTC 00:00 刷新（北京时间 08:00）；统计起点：${strictIndicator.daily.sinceIso}`
                        : '按 UTC 统计：每日 UTC 00:00 刷新（北京时间 08:00）'
                    }
                  >
                    今日严格 {strictIndicator.daily.used}/{strictIndicator.daily.limit}
                  </span>
                ) : null}
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    strictCountReady ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                  }`}
                >
                  {strictCountReady ? '可计分' : '不可计分'}
                </span>
              </div>
            </div>

            {strictCountReady ? (
              <div className="mt-2 text-xs text-gray-600">
                备注：最终仍可能因战报未给出/无法识别胜者、或结算异常而跳过计分。
              </div>
            ) : (
              <>
                <div className="mt-2 text-xs text-gray-600">
                  {strictIndicator.reasons.length > 0
                    ? `原因（${strictIndicator.reasons.length} 项）：${formatStrictReasonWithDetails(strictIndicator.reasons[0], strictIndicator.range)}`
                    : '原因：未知（建议刷新页面或稍后重试）'}
                </div>
                {strictIndicator.reasons.length > 1 ? (
                  <details className="group mt-2">
                    <summary className="flex cursor-pointer items-center justify-between gap-2 text-xs font-medium text-gray-700 hover:text-gray-900 [&::-webkit-details-marker]:hidden">
                      <span>查看全部原因</span>
                      <span className="text-gray-400 transition-transform group-open:rotate-180">▾</span>
                    </summary>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-gray-700">
                      {strictIndicator.reasons.map((reason) => (
                        <li key={reason}>{formatStrictReasonWithDetails(reason, strictIndicator.range)}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </>
            )}

            {strictPreflight?.success === false ? (
              <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                严格排位状态检查失败：{strictPreflight.error}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
