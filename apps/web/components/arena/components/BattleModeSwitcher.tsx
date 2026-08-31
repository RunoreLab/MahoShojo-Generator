'use client';

import { useBattleStore } from '../stores/useBattleStore';
import { BattleStoreState } from '../types';
import { BattleModeControl } from '../editor/presentation/BattleModeControl';

export function BattleModeSwitcher() {
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const battleMode = useBattleSelector((state) => state.battleMode);
  const setBattleMode = useBattleSelector((state) => state.setBattleMode);
  const isGenerating = useBattleSelector((state) => state.isGenerating);

  return (
    <BattleModeControl
      value={battleMode}
      onChange={(next) => setBattleMode(next)}
      disabled={isGenerating}
    />
  );
}
