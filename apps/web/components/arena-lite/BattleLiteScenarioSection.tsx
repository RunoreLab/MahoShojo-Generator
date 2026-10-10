'use client';

import { useMemo, useState } from 'react';

import { ArenaScenarioSection } from '@/components/arena/editor/features/scenario/ArenaScenarioSection';
import type { ScenarioPreset } from '@/lib/scenario-presets';

import { useBattleActions } from '@/components/arena/hooks/useBattleActions';
import { useScenarioPresetQuery } from '@/components/arena/hooks/useArenaData';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';
import type { BattleStoreState } from '@/components/arena/types';

const getScenarioTitle = (content: Record<string, unknown> | null) => {
  if (!content) return '';
  const rawTitle = (content as any)?.title ?? (content as any)?.name;
  return typeof rawTitle === 'string' ? rawTitle.trim() : '';
};

type BattleLiteScenarioSectionProps = {
  onOpenScenarioModal: () => void;
  isAuthenticated: boolean;
};

export function BattleLiteScenarioSection({
  onOpenScenarioModal,
  isAuthenticated,
}: BattleLiteScenarioSectionProps) {
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const scenario = useBattleSelector((state) => state.scenario);
  const isGenerating = useBattleSelector((state) => state.isGenerating);
  const isMatching = useBattleSelector((state) => state.isMatching);
  const setError = useBattleSelector((state) => state.setError);
  const clearScenario = useBattleSelector((state) => state.clearScenario);
  const { handleScenarioUpload, handleScenarioPaste, handleRandomMatch } = useBattleActions();

  const [loadingScenarioPreset, setLoadingScenarioPreset] = useState<string | null>(null);
  const scenarioPresetQuery = useScenarioPresetQuery();

  const selectedScenarioPresetFilenames = useMemo(() => {
    const presets = scenarioPresetQuery.data;
    if (!presets) return [];

    const title = getScenarioTitle(scenario.content);
    return presets
      .filter((preset) => scenario.isPreset === true && (
        scenario.fileName === preset.filename || (title && preset.title === title)
      ))
      .map((preset) => preset.filename);
  }, [scenario.content, scenario.fileName, scenario.isPreset, scenarioPresetQuery.data]);

  const scenarioSummary = useMemo(() => {
    const title = getScenarioTitle(scenario.content);
    return title || scenario.fileName || '未选择主情景';
  }, [scenario.content, scenario.fileName]);

  const handleToggleScenarioPreset = async (preset: ScenarioPreset) => {
    if (isGenerating) return;

    const currentTitle = getScenarioTitle(scenario.content);
    const isSelected = scenario.isPreset === true && (
      scenario.fileName === preset.filename || (currentTitle && preset.title === currentTitle)
    );

    if (isSelected) {
      clearScenario();
      setError(null);
      return;
    }

    setLoadingScenarioPreset(preset.filename);
    try {
      const response = await fetch(`/scenario-presets/${encodeURIComponent(preset.filename)}`);
      if (!response.ok) {
        throw new Error(`无法加载预设情景：${preset.title}`);
      }
      const text = await response.text();
      await handleScenarioPaste(text, { fileName: preset.filename, isPreset: true });
      setError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法加载预设情景';
      setError(`❌ ${message}`);
    } finally {
      setLoadingScenarioPreset(null);
    }
  };

  return (
    <ArenaScenarioSection
      presentation={{ variant: 'lite', summary: scenarioSummary, hasMain: Boolean(scenario.content) }}
      onActionError={(error) => setError(`❌ ${error.message}`)}
      model={{
        disabled: isGenerating,
        isAuthenticated,
        isMatchingBlocked: isMatching !== null,
        isMatchingScenario: isMatching === 'scenario',
        mainName: scenario.fileName || null,
        mainIsNative: scenario.isNative,
        auxScenarios: [],
        auxBudgetLine: null,
        auxBudgetExhausted: false,
        presets: scenarioPresetQuery.data ?? [],
        presetsLoading: scenarioPresetQuery.isLoading || !scenarioPresetQuery.data,
        presetsError: scenarioPresetQuery.error ? (scenarioPresetQuery.error as Error).message : null,
        selectedPresetFilenames: selectedScenarioPresetFilenames,
        loadingPresetFilename: loadingScenarioPreset,
        capabilities: {
          browseMain: true, randomMatchMain: true, clearMain: true, uploadMain: true, pasteMain: true,
          presetRefs: true, auxSection: false, addAux: false, browseAux: false, randomMatchAux: false,
          uploadAux: false, pasteAux: false, reorderAux: false, removeAux: false, clearAux: false,
        },
        actions: {
          openMainModal: onOpenScenarioModal,
          randomMatchMain: () => void handleRandomMatch('scenario'),
          clearMain: () => { clearScenario(); setError(null); },
          uploadMain: handleScenarioUpload,
          pasteMain: handleScenarioPaste,
          togglePreset: (filename) => {
            const preset = scenarioPresetQuery.data?.find((item) => item.filename === filename);
            if (preset) void handleToggleScenarioPreset(preset);
          },
          openAuxModal: () => {}, randomMatchAux: () => {}, uploadAux: async () => {},
          pasteAux: async () => {}, moveAux: () => {}, removeAux: () => {}, clearAux: () => {},
        },
      }}
    />
  );
}
