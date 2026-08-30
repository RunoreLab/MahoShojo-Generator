'use client';

import { useMemo } from 'react';

import { ArenaDataSettingsPanel } from '@/components/shared/ArenaDataSettingsPanel';

import { useBattleStore } from '../stores/useBattleStore';
import { BattleStoreState, CombatantData } from '../types';
import { BattleReportCardWidthSettings } from './BattleReportCardWidthSettings';
import { NarrativeHistorySettings } from './NarrativeHistorySettings';

export function BattleSettings() {
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const settings = useBattleSelector((state) => state.settings);
  const updateSettings = useBattleSelector((state) => state.updateSettings);
  const isGenerating = useBattleSelector((state) => state.isGenerating);
  const combatants = useBattleSelector((state) => state.combatants);

  const readableCombatantCount = useMemo(
    () => combatants.filter((item): item is CombatantData => 'data' in item).length,
    [combatants]
  );

  return (
    <>
      <ArenaDataSettingsPanel
        value={settings}
        onChange={updateSettings}
        disabled={isGenerating}
        combatantCountForEstimate={readableCombatantCount}
      />
      <NarrativeHistorySettings value={settings} onChange={updateSettings} disabled={isGenerating} />
      <BattleReportCardWidthSettings value={settings} onChange={updateSettings} disabled={isGenerating} />
    </>
  );
}
