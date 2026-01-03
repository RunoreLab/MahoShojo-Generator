'use client';

import { useMemo } from 'react';

import { useAuth } from '@/lib/useAuth';

import { useBattleStore } from '../stores/useBattleStore';
import type { BattleStoreState, CombatantData } from '../types';

const buildStrictSetupMissingReasons = (input: {
  isAuthenticated: boolean;
  battleMode: string;
  readableCombatants: CombatantData[];
  userGuidance: string;
  readArenaHistory: boolean;
  readCurrentState: boolean;
  readNarrativeHistory: boolean;
  adjudicationEventCount: number;
}): string[] => {
  const reasons: string[] = [];
  if (!input.isAuthenticated) reasons.push('需要先登录');
  if (input.battleMode !== 'classic') reasons.push('模式需为「经典」');
  if (input.readableCombatants.length !== 2) reasons.push('参战角色需为 2 位');
  if (input.userGuidance.trim()) reasons.push('需清空「故事引导」');
  if (input.readArenaHistory) reasons.push('需关闭「读取历战」');
  if (input.readCurrentState) reasons.push('需关闭「读取当前状态」');
  if (input.readNarrativeHistory) reasons.push('建议关闭「读取叙事历史」');
  if (input.adjudicationEventCount > 0) reasons.push('需清空「随机判定器事件」');
  if (input.readableCombatants.some((c) => (c.characterGuidance ?? '').trim())) reasons.push('需清空「角色行动引导」');
  return reasons;
};

export function RankingQuickActions() {
  const { isAuthenticated } = useAuth();
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const battleMode = useBattleSelector((state) => state.battleMode);
  const setBattleMode = useBattleSelector((state) => state.setBattleMode);
  const settings = useBattleSelector((state) => state.settings);
  const updateSettings = useBattleSelector((state) => state.updateSettings);
  const adjudicationEvents = useBattleSelector((state) => state.adjudicationEvents);
  const setAdjudicationEvents = useBattleSelector((state) => state.setAdjudicationEvents);
  const combatants = useBattleSelector((state) => state.combatants);
  const updateCombatantCharacterGuidance = useBattleSelector((state) => state.updateCombatantCharacterGuidance);
  const clearScenario = useBattleSelector((state) => state.clearScenario);
  const clearAuxScenarios = useBattleSelector((state) => state.clearAuxScenarios);
  const isGenerating = useBattleSelector((state) => state.isGenerating);
  const setError = useBattleSelector((state) => state.setError);

  const readableCombatants = useMemo(
    () => combatants.filter((c): c is CombatantData => 'data' in c),
    [combatants],
  );

  const missingReasons = useMemo(
    () =>
      buildStrictSetupMissingReasons({
        isAuthenticated,
        battleMode,
        readableCombatants,
        userGuidance: settings.userGuidance,
        readArenaHistory: settings.readArenaHistory,
        readCurrentState: settings.readCurrentState,
        readNarrativeHistory: settings.readNarrativeHistory,
        adjudicationEventCount: Array.isArray(adjudicationEvents) ? adjudicationEvents.length : 0,
      }),
    [
      adjudicationEvents,
      battleMode,
      isAuthenticated,
      readableCombatants,
      settings.readArenaHistory,
      settings.readCurrentState,
      settings.readNarrativeHistory,
      settings.userGuidance,
    ],
  );

  const handleApplyStrictSetup = () => {
    if (isGenerating) return;

    setBattleMode('classic');
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
    setError('✅ 已应用严格排位设置：经典模式 / 清空引导 / 关闭读取 / 清空判定与行动引导');
  };

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white/70 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900">一键严格排位</div>
          <div className="mt-1 text-xs text-gray-600">
            自动切换为经典模式，并清空/关闭严格排位所需的关键设置。
          </div>
        </div>
        <button
          type="button"
          onClick={handleApplyStrictSetup}
          disabled={isGenerating}
          className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
          title="将严格排位相关设置一键安排到位"
        >
          应用严格排位设置
        </button>
      </div>

      <div className="mt-2 text-xs text-gray-600">
        {missingReasons.length === 0 ? (
          <span className="text-emerald-700 font-semibold">当前设置：已满足严格排位前置条件</span>
        ) : (
          <span>
            当前仍缺少：<span className="text-gray-800">{missingReasons.join('、')}</span>
          </span>
        )}
      </div>
    </div>
  );
}

