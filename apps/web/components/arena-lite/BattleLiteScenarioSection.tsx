'use client';

import { useMemo, useState } from 'react';

import { ScenarioPresetGridPicker } from '@/components/ScenarioPresetGridPicker';
import { CollapsibleSection } from '@/components/shared/CollapsibleSection';
import { ScenarioPickerPanel } from '@/components/shared/ScenarioPickerPanel';
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

  const [presetPage, setPresetPage] = useState(1);
  const [loadingScenarioPreset, setLoadingScenarioPreset] = useState<string | null>(null);
  const scenarioPresetQuery = useScenarioPresetQuery();

  const selectedScenarioPresetFilenames = useMemo(() => {
    const presets = scenarioPresetQuery.data;
    if (!presets) return [];

    const title = getScenarioTitle(scenario.content);
    return presets
      .filter((preset) => scenario.fileName === preset.filename || (title && preset.title === title))
      .map((preset) => preset.filename);
  }, [scenario.content, scenario.fileName, scenarioPresetQuery.data]);

  const scenarioSummary = useMemo(() => {
    const title = getScenarioTitle(scenario.content);
    return title || scenario.fileName || '未选择主情景';
  }, [scenario.content, scenario.fileName]);

  const handleToggleScenarioPreset = async (preset: ScenarioPreset) => {
    if (isGenerating) return;

    const currentTitle = getScenarioTitle(scenario.content);
    const isSelected = scenario.fileName === preset.filename || (currentTitle && preset.title === currentTitle);

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
      await handleScenarioPaste(text, { fileName: preset.filename });
      setError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法加载预设情景';
      setError(`❌ ${message}`);
    } finally {
      setLoadingScenarioPreset(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="battle-lite-surface-card rounded-2xl px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="battle-lite-subtle-text text-[11px] font-semibold uppercase tracking-[0.24em]">当前主情景</div>
            <div className="battle-lite-strong-text mt-2 text-sm font-semibold">{scenarioSummary}</div>
            {scenario.isNative ? <div className="battle-lite-link mt-1 text-xs">该情景已识别为原生格式。</div> : null}
          </div>
          <button
            type="button"
            onClick={() => {
              clearScenario();
              setError(null);
            }}
            disabled={isGenerating || !scenario.content}
            className="battle-lite-danger-button rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
          >
            清空情景
          </button>
        </div>
      </div>

      <ScenarioPickerPanel
        onOpenScenarioModal={onOpenScenarioModal}
        onRandomMatchScenario={() => handleRandomMatch('scenario')}
        onScenarioUpload={handleScenarioUpload}
        onScenarioPaste={handleScenarioPaste}
        onActionError={(error) => setError(`❌ ${error.message}`)}
        isAuthenticated={isAuthenticated}
        isGenerating={isGenerating}
        isMatchingBlocked={isMatching !== null}
        isMatchingScenario={isMatching === 'scenario'}
        scenarioFileName={scenario.fileName || null}
        isScenarioNative={scenario.isNative}
      />

      <CollapsibleSection
        title="推荐预设情景"
        description="使用当前最新预设；点击即可设为主情景，再次点击已选项可移除"
        defaultOpen={false}
        disabled={isGenerating}
        storageKey="battle-lite.section.scenarioPreset.open"
      >
        {scenarioPresetQuery.error ? (
          <div className="text-sm text-red-600">
            无法加载预设情景：{(scenarioPresetQuery.error as Error).message}
          </div>
        ) : scenarioPresetQuery.isLoading || !scenarioPresetQuery.data ? (
          <div className="battle-lite-subtle-text text-sm">正在加载预设情景...</div>
        ) : (
          <ScenarioPresetGridPicker
            title="选择预设情景"
            presets={scenarioPresetQuery.data}
            currentPage={presetPage}
            onPageChange={setPresetPage}
            disabled={isGenerating}
            selectedFilenames={selectedScenarioPresetFilenames}
            loadingFilename={loadingScenarioPreset}
            onToggle={handleToggleScenarioPreset}
          />
        )}
      </CollapsibleSection>
    </div>
  );
}
