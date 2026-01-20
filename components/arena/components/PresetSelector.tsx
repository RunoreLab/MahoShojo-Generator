'use client';

import { useMemo, useState } from 'react';

import type { Preset } from '@/lib/presets';
import { PresetGridPicker } from '@/components/PresetGridPicker';

import { useBattleStore } from '../stores/useBattleStore';
import { BattleStoreState, Combatant, MAX_COMBATANTS } from '../types';
import { usePresetQuery } from '../hooks/useArenaData';
import { validateCanshouData, validateMagicalGirlData } from '../utils/characterValidator';

export function PresetSelector() {
  const { grouped, isLoading, error } = usePresetQuery();
  const [mgPage, setMgPage] = useState(1);
  const [canshouPage, setCanshouPage] = useState(1);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const combatants = useBattleSelector((state) => state.combatants);
  const addCombatant = useBattleSelector((state) => state.addCombatant);
  const removeCombatant = useBattleSelector((state) => state.removeCombatant);
  const isGenerating = useBattleSelector((state) => state.isGenerating);
  const setError = useBattleSelector((state) => state.setError);
  const loadingPreset = useBattleSelector((state) => state.loadingPreset);
  const setLoadingPreset = useBattleSelector((state) => state.setLoadingPreset);

  const combatantFilenames = useMemo(
    () =>
      combatants
        .filter((item): item is Combatant & { filename: string } => 'filename' in item)
        .map((item) => item.filename),
    [combatants]
  );

  const handleSelect = async (preset: Preset) => {
    setLoadingPreset(preset.filename);
    try {
      if (combatantFilenames.includes(preset.filename)) {
        removeCombatant(preset.filename);
        setError(null);
        return;
      }

      const response = await fetch(`/presets/${preset.filename}`);
      if (!response.ok) {
        throw new Error(`无法加载 ${preset.name} 的设定文件。`);
      }
      const data = await response.json();

      const validation =
        preset.type === 'magical-girl' ? validateMagicalGirlData(data) : validateCanshouData(data);
      if (!validation.success) {
        throw new Error(validation.errors?.[0] || '格式校验失败');
      }

      if (validation.warnings?.length) {
        setError(validation.warnings.join('\n'));
      } else {
        setError(null);
      }

      addCombatant({
        type: preset.type,
        data: validation.data ?? data,
        filename: preset.filename,
        isValid: true,
        isPreset: true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法选择预设角色');
    } finally {
      setLoadingPreset(null);
    }
  };

  if (error) {
    return (
      <div className="mb-6">
        <p className="text-sm text-red-600">无法加载预设列表：{(error as Error).message}</p>
      </div>
    );
  }

  if (isLoading || !grouped) {
    return <p className="text-sm text-gray-500 mb-6">正在加载预设...</p>;
  }

  const presetFilenameSet = new Set<string>([
    ...grouped.magicalGirl.map((p) => p.filename),
    ...grouped.canshou.map((p) => p.filename),
  ]);
  const selectedPresetCount = combatantFilenames.filter((filename) => presetFilenameSet.has(filename)).length;

  return (
    <>
      <div className="mb-2">
        <button
          type="button"
          onClick={() => setIsCollapsed((prev) => !prev)}
          className="text-purple-700 hover:underline cursor-pointer font-semibold"
          disabled={isGenerating}
        >
          {isCollapsed ? '▶ 展开预设角色' : '▼ 折叠预设角色'}
        </button>
        {isCollapsed && (
          <div className="text-xs text-gray-500 mt-1">
            已选择 {selectedPresetCount} 个预设角色（上限 {MAX_COMBATANTS}）。
          </div>
        )}
      </div>

      {!isCollapsed && (
        <>
          <PresetGridPicker
            title="选择预设魔法少女"
            presets={grouped.magicalGirl}
            currentPage={mgPage}
            onPageChange={setMgPage}
            disabled={isGenerating}
            maxSelected={MAX_COMBATANTS}
            selectedFilenames={combatantFilenames}
            loadingFilename={loadingPreset}
            onToggle={handleSelect}
          />
          <PresetGridPicker
            title="选择预设残兽"
            presets={grouped.canshou}
            currentPage={canshouPage}
            onPageChange={setCanshouPage}
            disabled={isGenerating}
            maxSelected={MAX_COMBATANTS}
            selectedFilenames={combatantFilenames}
            loadingFilename={loadingPreset}
            onToggle={handleSelect}
          />
        </>
      )}
    </>
  );
}
