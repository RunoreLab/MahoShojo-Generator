'use client';

import { useBattleStore } from '../stores/useBattleStore';
import { BattleStoreState } from '../types';
import { BattleModeSelector, type BattleModeKey } from '@/components/shared/BattleModeSelector';

export function BattleModeSwitcher() {
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const battleMode = useBattleSelector((state) => state.battleMode);
  const setBattleMode = useBattleSelector((state) => state.setBattleMode);
  const isGenerating = useBattleSelector((state) => state.isGenerating);

  return (
    <BattleModeSelector
      value={battleMode as BattleModeKey}
      onChange={(next) => setBattleMode(next)}
      disabled={isGenerating}
    />
  );
}
