'use client';

import { useBattleStore } from '../stores/useBattleStore';
import { BattleStoreState, GenerationMode } from '../types';
import { GenerationModeSwitcher as GenerationModeSwitcherUi } from '@/components/shared/GenerationModeSwitcher';

export function GenerationModeSwitcher() {
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const generationMode = useBattleSelector((state) => state.generationMode);
  const setGenerationMode = useBattleSelector((state) => state.setGenerationMode);
  const isGenerating = useBattleSelector((state) => state.isGenerating);

  return (
    <GenerationModeSwitcherUi
      label="选择生成方式"
      value={generationMode}
      disabled={isGenerating}
      onChange={(mode) => setGenerationMode(mode as GenerationMode)}
    />
  );
}
