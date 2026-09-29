'use client';

import { ArenaReportFormatSelector } from './ArenaWebReport';
import { SoloArenaWebPackageSection } from '../editor/features/web-package/SoloArenaWebPackageSection';
import { useBattleStore } from '../stores/useBattleStore';
import { BattleStoreState, GenerationMode } from '../types';
import { GenerationModeSwitcher as GenerationModeSwitcherUi } from '@/components/shared/GenerationModeSwitcher';

export function GenerationModeSwitcher({ showReportFormat = false }: { showReportFormat?: boolean }) {
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const generationMode = useBattleSelector((state) => state.generationMode);
  const setGenerationMode = useBattleSelector((state) => state.setGenerationMode);
  const reportFormat = useBattleSelector((state) => state.reportFormat);
  const setReportFormat = useBattleSelector((state) => state.setReportFormat);
  const isGenerating = useBattleSelector((state) => state.isGenerating);

  return (
    <>
      <GenerationModeSwitcherUi
        label="选择生成方式"
        value={generationMode}
        disabled={isGenerating}
        onChange={(mode) => setGenerationMode(mode as GenerationMode)}
      />
      {showReportFormat ? (
        <ArenaReportFormatSelector value={reportFormat} onChange={setReportFormat} disabled={isGenerating}>
          <SoloArenaWebPackageSection reportFormat={reportFormat} disabled={isGenerating} />
        </ArenaReportFormatSelector>
      ) : null}
    </>
  );
}
