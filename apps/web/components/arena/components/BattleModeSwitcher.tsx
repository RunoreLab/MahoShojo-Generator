'use client';

import { useArenaEditorActions, useArenaEditorSelector } from '../editor';
import { BattleModeControl } from '../editor/presentation/BattleModeControl';

export function BattleModeSwitcher() {
  const battleMode = useArenaEditorSelector((state) => state.battleMode);
  const isGenerating = useArenaEditorSelector((state) => state.busy);
  const { setBattleMode } = useArenaEditorActions();

  return (
    <BattleModeControl
      value={battleMode}
      onChange={(next) => setBattleMode(next)}
      disabled={isGenerating}
    />
  );
}
