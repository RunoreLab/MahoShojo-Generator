'use client';

import { useMemo } from 'react';

import { useBattleStore } from '../stores/useBattleStore';
import { BattleStoreState, CombatantData } from '../types';
import { SharedBattleSettingsControl } from '../editor/presentation/SharedBattleSettingsControl';
import { BattleReportCardWidthSettings } from './BattleReportCardWidthSettings';

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
      <SharedBattleSettingsControl
        value={settings}
        onChange={updateSettings}
        disabled={isGenerating}
        combatantCountForEstimate={readableCombatantCount}
      />
      <BattleReportCardWidthSettings value={settings} onChange={updateSettings} disabled={isGenerating} />
    </>
  );
}
