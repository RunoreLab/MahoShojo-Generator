'use client';

import { useEffect, useMemo, useState } from 'react';

import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';
import { isStrictRankedModelBlacklisted } from '@/lib/arena/ranked-model-policy';
import { authStorage } from '@/lib/auth';
import { useAuth } from '@/lib/useAuth';

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
  userProviderConfigModelId: string | null;
  scenarioEnabled: boolean;
  auxScenarioCount: number;
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
  if (input.scenarioEnabled) reasons.push('需关闭「情景模式」');
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
    'combatant-count-not-2': '需 2 人对战',
    'combatants-unrankable': '参战者需为数据卡/预设',
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
    'has-adjudication-events': '需清空「随机判定器事件」',
    'read-arena-history': '需关闭「读取历战」',
    'read-current-state': '需关闭「读取当前状态」',
    'read-narrative-history': '需关闭「读取叙事历史」',
    'has-character-guidance': '需清空「角色行动引导」',
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
  const updateCombatantCharacterGuidance = useBattleSelector((state) => state.updateCombatantCharacterGuidance);
  const clearScenario = useBattleSelector((state) => state.clearScenario);
  const clearAuxScenarios = useBattleSelector((state) => state.clearAuxScenarios);
  const isGenerating = useBattleSelector((state) => state.isGenerating);
  const setError = useBattleSelector((state) => state.setError);

  const [strictPreflight, setStrictPreflight] = useState<StrictPreflightResponse | null>(null);
  const [isCheckingStrictPreflight, setIsCheckingStrictPreflight] = useState(false);

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
      }),
    [
      adjudicationEvents,
      auxScenarios.length,
      battleMode,
      isAuthenticated,
      rankableCombatants,
      scenario.content,
      selectedLanguage,
      selectedLevel,
      settings.readArenaHistory,
      settings.readCurrentState,
      settings.readNarrativeHistory,
      settings.userGuidance,
      userProviderConfig?.modelId,
    ],
  );

  const handleApplyStrictSetup = () => {
    if (isGenerating) return;

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
    setError(
      `✅ 已应用严格排位设置：经典模式 / 默认等级 / 简体中文 / 清空引导 / 关闭读取 / 清空判定与行动引导${modelFixMessage ? ` / ${modelFixMessage}` : ''}`,
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
    battleMode,
    combatants,
    selectedLanguage,
    selectedLevel,
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
    if (battleMode !== 'classic') reasons.push('mode-not-classic');
    if (combatants.length !== 2) reasons.push('combatant-count-not-2');
    if (selectedLanguage !== 'zh-CN') reasons.push('language-not-zh-cn');
    if (selectedLevel.trim()) reasons.push('level-not-default');
    if (settings.userGuidance.trim()) reasons.push('has-user-guidance');
    if (settings.readArenaHistory) reasons.push('read-arena-history');
    if (settings.readCurrentState) reasons.push('read-current-state');
    if (settings.readNarrativeHistory) reasons.push('read-narrative-history');
    if (Array.isArray(adjudicationEvents) && adjudicationEvents.length > 0) reasons.push('has-adjudication-events');
    if (readableCombatants.some((c) => (c.characterGuidance ?? '').trim())) reasons.push('has-character-guidance');
    if (userProviderConfig?.modelId && userProviderConfig.modelId !== 'default' && isStrictRankedModelBlacklisted(userProviderConfig.modelId)) {
      reasons.push('ai-model-blacklisted');
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
    battleMode,
    combatants.length,
    isAuthenticated,
    readableCombatants,
    selectedLanguage,
    selectedLevel,
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

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white/70 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900">
            排位赛
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
          <button
            type="button"
            onClick={handleApplyStrictSetup}
            disabled={isGenerating}
            className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
            title="将严格排位相关设置一键安排到位"
          >
            严格设置
          </button>
          <div className="mt-1 w-full sm:w-72">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                className="h-4 w-4 text-pink-600 border-gray-300 rounded"
                checked={arenaFreeRankingEnabled}
                onChange={(e) => setArenaFreeRankingEnabled(e.target.checked)}
                disabled={isGenerating}
              />
              启用自由排位计分
            </label>
          </div>
        </div>
      </div>

      <div className="mt-2 text-xs text-gray-600">
        {strictSetupMissingReasons.length === 0 ? (
          <span className="text-emerald-700 font-semibold">当前设置：已满足严格排位计分基础条件</span>
        ) : (
          <span>
            当前仍缺少：<span className="text-gray-800">{strictSetupMissingReasons.join('、')}</span>
          </span>
        )}
      </div>

      <div className="mt-2 text-xs">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className={strictIndicator.willCount ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'}>
            {strictIndicator.willCount ? '严格排位计分：可以' : '严格排位计分：不行'}
          </span>
          {strictIndicator.source === 'server' && strictIndicator.daily?.used != null ? (
            <span
              className="text-gray-600"
              title={
                strictIndicator.daily.sinceIso
                  ? `按 UTC 统计：每日 UTC 00:00 刷新（北京时间 08:00）；统计起点：${strictIndicator.daily.sinceIso}`
                  : '按 UTC 统计：每日 UTC 00:00 刷新（北京时间 08:00）'
              }
            >
              今日严格：{strictIndicator.daily.used}/{strictIndicator.daily.limit}
            </span>
          ) : null}
          {isCheckingStrictPreflight ? <span className="text-gray-500">检查中…</span> : null}
        </div>
        {!strictIndicator.willCount ? (
          <div className="mt-1 text-gray-600">
            原因：<span className="text-gray-800">{strictIndicator.reasons.map((r) => formatStrictReasonWithDetails(r, strictIndicator.range)).join('、')}</span>
          </div>
        ) : (
          <div className="mt-1 text-gray-500">
            备注：最终仍可能因战报未给出/无法识别胜者、或结算异常而跳过计分。
          </div>
        )}
        {strictPreflight?.success === false ? (
          <div className="mt-1 text-xs text-red-600">严格排位状态检查失败：{strictPreflight.error}</div>
        ) : null}
      </div>
    </div>
  );
}
