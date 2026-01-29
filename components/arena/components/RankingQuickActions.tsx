'use client';

import { useEffect, useMemo, useState } from 'react';

import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';
import { isStrictRankedModelBlacklisted } from '@/lib/arena/ranked-model-policy';
import { authStorage } from '@/lib/auth';
import { PRESET_LIST } from '@/lib/presets';
import { useAuth } from '@/lib/useAuth';

import { useBattleStore } from '../stores/useBattleStore';
import type { BattleStoreState, CombatantData } from '../types';
import { inferCombatantType, validateCanshouData, validateMagicalGirlData } from '../utils/characterValidator';

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

const hashString = (input: string): number => {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
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
  const userProviderConfig = useBattleSelector((state) => state.userProviderConfig);
  const setUserProviderConfig = useBattleSelector((state) => state.setUserProviderConfig);
  const scenario = useBattleSelector((state) => state.scenario);
  const auxScenarios = useBattleSelector((state) => state.auxScenarios);
  const updateCombatantCharacterGuidance = useBattleSelector((state) => state.updateCombatantCharacterGuidance);
  const clearScenario = useBattleSelector((state) => state.clearScenario);
  const clearAuxScenarios = useBattleSelector((state) => state.clearAuxScenarios);
  const isGenerating = useBattleSelector((state) => state.isGenerating);
  const setError = useBattleSelector((state) => state.setError);

  const [selectedPlayerFilename, setSelectedPlayerFilename] = useState<string>('');
  const [presetCursor, setPresetCursor] = useState<number>(0);
  const [isSelectingOpponent, setIsSelectingOpponent] = useState(false);
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

  const selectedPlayer = useMemo(() => {
    const byFilename = rankableCombatants.find((c) => c.filename === selectedPlayerFilename);
    return byFilename ?? rankableCombatants[0] ?? null;
  }, [rankableCombatants, selectedPlayerFilename]);

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
        daily: strictPreflight.daily,
        source: 'server' as const,
      };
    }
    return { willCount: localStrictReasons.length === 0, reasons: localStrictReasons, daily: null, source: 'local' as const };
  }, [localStrictReasons, strictPreflight]);

  const presetPool = useMemo(() => {
    if (!selectedPlayer) return [];
    const playerFilename = selectedPlayer.isPreset ? selectedPlayer.filename : '';
    const pool = PRESET_LIST.filter((p) => p.filename !== playerFilename);
    if (pool.length <= 0) return [];

    const pivotKey = selectedPlayer.isPreset
      ? `preset:${selectedPlayer.filename}`
      : `data_card:${(selectedPlayer.sourceDataCardId ?? '').trim()}`;
    const pivot = hashString(pivotKey) + presetCursor * 17;
    const offset = pool.length > 0 ? pivot % pool.length : 0;
    const rotated = [...pool.slice(offset), ...pool.slice(0, offset)];
    return rotated.slice(0, Math.min(5, rotated.length));
  }, [presetCursor, selectedPlayer]);

  const recommendedPresets = useMemo(() => presetPool.slice(0, 3), [presetPool]);
  const extraPresets = useMemo(() => presetPool.slice(3), [presetPool]);

  const handlePickPresetOpponent = async (filename: string) => {
    if (isGenerating || isSelectingOpponent) return;
    if (!selectedPlayer) {
      setError('❌ 请先选择 1 位参战角色（我方）。');
      return;
    }

    const preset = PRESET_LIST.find((p) => p.filename === filename) ?? null;
    if (!preset) {
      setError('❌ 预设对手不存在。');
      return;
    }

    setIsSelectingOpponent(true);
    try {
      handleApplyStrictSetup();

      const keepPlayer: CombatantData = {
        ...selectedPlayer,
        teamId: undefined,
        characterGuidance: '',
      } as CombatantData;

      const presetRes = await fetch(`/presets/${preset.filename}`);
      if (!presetRes.ok) {
        throw new Error(`无法加载预设对手：${preset.name}`);
      }
      const presetData = await presetRes.json();
      const validation = preset.type === 'magical-girl' ? validateMagicalGirlData(presetData) : validateCanshouData(presetData);
      if (!validation.success) {
        throw new Error(validation.errors?.[0] || '预设对手格式校验失败');
      }

      const inferredType = inferCombatantType(validation.data ?? presetData);

      const opponent: CombatantData = {
        type: inferredType,
        data: validation.data ?? presetData,
        filename: preset.filename,
        isValid: true,
        isPreset: true,
        teamId: undefined,
        characterGuidance: '',
      };

      setCombatants([keepPlayer, opponent]);
      setError(`✅ 已选择对手：${preset.name}。现在可以直接生成战报。`);
    } catch (error) {
      setError(`❌ 选择对手失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsSelectingOpponent(false);
    }
  };

  const handleRefreshPresets = () => {
    setPresetCursor((v) => v + 1);
  };

  const playerLabel = selectedPlayer
    ? (selectedPlayer.data?.codename || selectedPlayer.data?.name || selectedPlayer.filename).toString().slice(0, 40)
    : '';

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white/70 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900">
            排位赛
          </div>
          <div className="mt-1 text-xs text-gray-600">
            请自行挑选符合条件的对手。默认推荐 3 位，你也可以从上方排行榜里挑选公开角色卡作为对手。
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
          <select
            className="w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm sm:w-72"
            value={selectedPlayerFilename}
            onChange={(e) => setSelectedPlayerFilename(e.target.value)}
            disabled={isGenerating || isSelectingOpponent || rankableCombatants.length <= 0}
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
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleApplyStrictSetup}
              disabled={isGenerating || isSelectingOpponent}
              className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
              title="将严格排位相关设置一键安排到位"
            >
              严格设置
            </button>
            <button
              type="button"
              onClick={handleRefreshPresets}
              disabled={isGenerating || isSelectingOpponent || !selectedPlayer}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              title="刷新推荐对手（来自系统预设池）"
            >
              换一批对手
            </button>
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
            原因：<span className="text-gray-800">{strictIndicator.reasons.map(formatStrictReason).join('、')}</span>
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

      <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
        <div className="text-xs font-semibold text-gray-900">
          推荐对手（系统预设池）{playerLabel ? `：${playerLabel}` : ''}
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {recommendedPresets.map((preset) => (
            <button
              key={preset.filename}
              type="button"
              onClick={() => void handlePickPresetOpponent(preset.filename)}
              disabled={isGenerating || isSelectingOpponent || !selectedPlayer}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50"
              title={preset.description}
            >
              <div className="font-semibold text-gray-900">{preset.name}</div>
              <div className="text-xs text-gray-600">{preset.type === 'magical-girl' ? '魔法少女' : '残兽'}</div>
            </button>
          ))}
        </div>

        {extraPresets.length > 0 ? (
          <>
            <div className="mt-2 text-[11px] text-gray-500">更多可选对手：</div>
            <div className="mt-1 flex flex-wrap gap-2">
              {extraPresets.map((preset) => (
                <button
                  key={preset.filename}
                  type="button"
                  onClick={() => void handlePickPresetOpponent(preset.filename)}
                  disabled={isGenerating || isSelectingOpponent || !selectedPlayer}
                  className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
                  title={preset.description}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </>
        ) : null}

        <div className="mt-2 text-[11px] text-gray-500">
          提示：如果你希望挑战公开角色卡，请用「快速查看排行榜」把对手加入参战列表；严格计分仍以“严格设置”为前提。
        </div>
      </div>
    </div>
  );
}
