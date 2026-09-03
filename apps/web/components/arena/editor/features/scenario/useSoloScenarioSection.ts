'use client';

import { useState } from 'react';

import { useBattleActions } from '../../../hooks/useBattleActions';
import { useBattleStore } from '../../../stores/useBattleStore';
import type { AuxiliaryScenarioState, BattleStoreState } from '../../../types';
import { useScenarioPresetQuery } from '../../../hooks/useArenaData';
import {
  canAddArenaReferenceItems,
  countArenaSelectedReferenceItems,
  MAX_ARENA_REFERENCE_ITEMS,
} from '@/lib/arena/resource-budget';

import type {
  ArenaScenarioAuxView,
  ArenaScenarioSectionModel,
} from './scenario-contract';

const getScenarioTitle = (content: Record<string, unknown> | null) => {
  if (!content) return '';
  const rawTitle = (content as any)?.title ?? (content as any)?.name;
  return typeof rawTitle === 'string' ? rawTitle.trim() : '';
};

const auxView = (scenario: AuxiliaryScenarioState, index: number): ArenaScenarioAuxView => ({
  key: scenario.id,
  title: getScenarioTitle(scenario.content)
    || (scenario.fileName || `辅助情景 ${index + 1}`).replace(/\.json$/i, ''),
  isNative: scenario.isNative,
});

/**
 * 单人情景区块 adapter：battle store + 上传/粘贴/随机匹配/预设目录。
 */
export const useSoloScenarioSectionModel = (input: {
  onOpenMainModal(): void;
  onOpenAuxModal(): void;
  onRandomMatchMain(): void;
  isAuthenticated: boolean;
}): ArenaScenarioSectionModel => {
  const { onOpenMainModal, onOpenAuxModal, onRandomMatchMain, isAuthenticated } = input;
  const scenario = useBattleStore((state: BattleStoreState) => state.scenario);
  const auxScenarios = useBattleStore((state: BattleStoreState) => state.auxScenarios);
  const materials = useBattleStore((state: BattleStoreState) => state.materials);
  const selectedQuestionnaires = useBattleStore((state: BattleStoreState) => state.selectedQuestionnaires);
  const isGenerating = useBattleStore((state: BattleStoreState) => state.isGenerating);
  const isMatching = useBattleStore((state: BattleStoreState) => state.isMatching);
  const setError = useBattleStore((state: BattleStoreState) => state.setError);
  const clearScenario = useBattleStore((state: BattleStoreState) => state.clearScenario);
  const removeAuxScenario = useBattleStore((state: BattleStoreState) => state.removeAuxScenario);
  const moveAuxScenario = useBattleStore((state: BattleStoreState) => state.moveAuxScenario);
  const clearAuxScenarios = useBattleStore((state: BattleStoreState) => state.clearAuxScenarios);
  const {
    handleScenarioUpload,
    handleScenarioPaste,
    handleAuxScenarioUpload,
    handleAuxScenarioPaste,
    handleRandomMatchAuxScenario,
  } = useBattleActions();

  const [loadingPresetFilename, setLoadingPresetFilename] = useState<string | null>(null);
  const scenarioPresetQuery = useScenarioPresetQuery();

  const reportError = (error: unknown) => {
    const e = error instanceof Error ? error : new Error('未知错误');
    setError(`❌ ${e.message}`);
  };

  const referenceItemCount = countArenaSelectedReferenceItems({
    auxScenarios,
    materials,
    selectedQuestionnaires,
  });
  const hasMainScenario = Boolean(scenario.content);
  const hasReferenceCapacity = referenceItemCount < MAX_ARENA_REFERENCE_ITEMS;

  const selectedPresetFilenames = (() => {
    const presets = scenarioPresetQuery.data;
    if (!presets) return [];
    const selected = new Set<string>();
    const mainTitle = getScenarioTitle(scenario.content);

    presets.forEach((preset) => {
      const matchesMain =
        scenario.isPreset === true &&
        Boolean(scenario.content) &&
        (scenario.fileName === preset.filename || (mainTitle && preset.title === mainTitle));
      const matchesAux = auxScenarios.some((aux) => {
        const auxTitle = getScenarioTitle(aux.content);
        return aux.isPreset === true && (
          aux.fileName === preset.filename || (auxTitle && auxTitle === preset.title)
        );
      });

      if (matchesMain || matchesAux) {
        selected.add(preset.filename);
      }
    });

    return Array.from(selected);
  })();

  const togglePreset = async (filename: string) => {
    const preset = scenarioPresetQuery.data?.find((item) => item.filename === filename);
    if (!preset) return;
    if (isGenerating) return;
    const mainTitle = getScenarioTitle(scenario.content);
    const isMainSelected =
      scenario.isPreset === true &&
      Boolean(scenario.content) &&
      (scenario.fileName === preset.filename || (mainTitle && preset.title === mainTitle));
    const matchedAux = auxScenarios.find((aux) => {
      const auxTitle = getScenarioTitle(aux.content);
      return aux.isPreset === true && (
        aux.fileName === preset.filename || (auxTitle && auxTitle === preset.title)
      );
    });

    if (isMainSelected) {
      clearScenario();
      setError(null);
      return;
    }
    if (matchedAux) {
      removeAuxScenario(matchedAux.id);
      setError(null);
      return;
    }

    if (hasMainScenario && !canAddArenaReferenceItems({
      auxScenarios,
      materials,
      selectedQuestionnaires,
    })) {
      setError(`❌ 参考项（辅助情景、素材和问卷）合计最多 ${MAX_ARENA_REFERENCE_ITEMS} 项。`);
      return;
    }

    setLoadingPresetFilename(preset.filename);
    try {
      const response = await fetch(`/scenario-presets/${encodeURIComponent(preset.filename)}`);
      if (!response.ok) {
        throw new Error(`无法加载预设情景：${preset.title}`);
      }
      const text = await response.text();
      if (hasMainScenario) {
        await handleAuxScenarioPaste(text, { fileName: preset.filename, isPreset: true });
      } else {
        await handleScenarioPaste(text, { fileName: preset.filename, isPreset: true });
      }
      setError(null);
    } catch (error) {
      reportError(error);
    } finally {
      setLoadingPresetFilename(null);
    }
  };

  const uploadAux = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const fileList = Array.from(files);
    const errors: string[] = [];
    for (const file of fileList) {
      try {
        await handleAuxScenarioUpload(file);
      } catch (error) {
        const message = error instanceof Error ? error.message : '上传文件解析失败';
        errors.push(`${file.name}: ${message}`);
      }
    }
    if (errors.length > 0) {
      setError(`❌ ${errors.length}/${fileList.length} 个文件导入失败：${errors.join('；')}`);
    } else {
      setError(null);
    }
  };

  return {
    disabled: isGenerating,
    isAuthenticated,
    isMatchingBlocked: isMatching !== null,
    isMatchingScenario: isMatching === 'scenario',
    mainName: scenario.fileName || null,
    mainIsNative: scenario.isNative,
    auxScenarios: auxScenarios.map(auxView),
    auxBudgetLine: `参考项合计 ${referenceItemCount}/${MAX_ARENA_REFERENCE_ITEMS}`,
    auxBudgetExhausted: !hasReferenceCapacity,
    presets: scenarioPresetQuery.data ?? [],
    presetsLoading: scenarioPresetQuery.isLoading || (!scenarioPresetQuery.data && !scenarioPresetQuery.error),
    presetsError: scenarioPresetQuery.error ? (scenarioPresetQuery.error as Error).message : null,
    selectedPresetFilenames,
    loadingPresetFilename,
    capabilities: {
      browseMain: true,
      randomMatchMain: true,
      clearMain: true,
      uploadMain: true,
      pasteMain: true,
      presetRefs: true,
      auxSection: true,
      addAux: hasMainScenario && hasReferenceCapacity,
      browseAux: true,
      randomMatchAux: true,
      uploadAux: true,
      pasteAux: true,
      reorderAux: true,
      removeAux: true,
      clearAux: true,
    },
    actions: {
      openMainModal: onOpenMainModal,
      randomMatchMain: onRandomMatchMain,
      clearMain: () => {
        clearScenario();
        setError(null);
      },
      uploadMain: async (file) => {
        try {
          await handleScenarioUpload(file);
        } catch (error) {
          reportError(error);
          throw error;
        }
      },
      pasteMain: async (text) => {
        try {
          await handleScenarioPaste(text);
        } catch (error) {
          reportError(error);
          throw error;
        }
      },
      openAuxModal: onOpenAuxModal,
      randomMatchAux: () => { void handleRandomMatchAuxScenario(); },
      uploadAux: (files) => uploadAux(files),
      pasteAux: async (text) => {
        try {
          await handleAuxScenarioPaste(text);
        } catch (error) {
          reportError(error);
          throw error;
        }
      },
      togglePreset: (filename) => { void togglePreset(filename); },
      moveAux: moveAuxScenario,
      removeAux: (key) => {
        removeAuxScenario(key);
        setError(null);
      },
      clearAux: () => {
        clearAuxScenarios();
        setError(null);
      },
    },
  };
};
