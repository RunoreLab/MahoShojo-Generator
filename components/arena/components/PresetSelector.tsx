'use client';

import { useMemo, useState } from 'react';

import { Preset } from '@/pages/api/get-presets';

import { useBattleStore } from '../stores/useBattleStore';
import { MAX_COMBATANTS } from '../types';
import { usePresetQuery } from '../hooks/useArenaData';
import { validateCanshouData, validateMagicalGirlData } from '../utils/characterValidator';

const PRESETS_PER_PAGE = 4;

interface PresetSectionProps {
  title: string;
  presets: Preset[];
  currentPage: number;
  onPageChange: (page: number) => void;
  isGenerating: boolean;
  onSelect: (preset: Preset) => void;
  combatantFilenames: string[];
  loadingPreset: string | null;
}

const PresetSection = ({
  title,
  presets,
  currentPage,
  onPageChange,
  isGenerating,
  onSelect,
  combatantFilenames,
  loadingPreset,
}: PresetSectionProps) => {
  const totalPages = Math.max(1, Math.ceil(presets.length / PRESETS_PER_PAGE));
  const paged = presets.slice((currentPage - 1) * PRESETS_PER_PAGE, currentPage * PRESETS_PER_PAGE);

  return (
    <div className="mb-6">
      <h3 className="input-label" style={{ marginTop: '0.5rem' }}>
        {title}
      </h3>
      <div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {paged.map((preset) => {
            const isSelected = combatantFilenames.includes(preset.filename);
            const isLoading = loadingPreset === preset.filename;
            const disabled = isGenerating || (!isSelected && combatantFilenames.length >= MAX_COMBATANTS);
            const bgColor =
              preset.type === 'canshou'
                ? isSelected
                  ? 'bg-red-200 border-red-400 hover:bg-red-300'
                  : 'bg-white border-gray-300 hover:border-red-400 hover:bg-red-50'
                : isSelected
                  ? 'bg-pink-200 border-pink-400 hover:bg-pink-300'
                  : 'bg-white border-gray-300 hover:border-pink-400 hover:bg-pink-50';
            const textColor =
              preset.type === 'canshou'
                ? isSelected
                  ? 'text-red-900'
                  : 'text-red-800'
                : isSelected
                  ? 'text-pink-900'
                  : 'text-pink-800';

            return (
              <div
                key={preset.filename}
                onClick={() => !disabled && onSelect(preset)}
                className={`p-3 border rounded-lg transition-all duration-200 ${
                  disabled ? 'bg-gray-200 border-gray-300 text-gray-500 cursor-not-allowed' : `${bgColor} cursor-pointer`
                }`}
              >
                <p className={`font-semibold ${textColor}`}>{isLoading ? '加载中...' : preset.name}</p>
                <p className={`text-xs mt-1 ${isSelected ? (preset.type === 'canshou' ? 'text-red-800' : 'text-pink-800') : 'text-gray-600'}`}>
                  {preset.description}
                </p>
              </div>
            );
          })}
        </div>
        {presets.length > PRESETS_PER_PAGE && (
          <div className="flex justify-center items-center mt-4 space-x-2">
            <button
              onClick={() => onPageChange(Math.max(1, currentPage - 1))}
              disabled={isGenerating || currentPage === 1}
              className={`px-3 py-1 rounded text-sm ${
                currentPage === 1 || isGenerating ? 'bg-gray-200 text-gray-400' : 'bg-pink-100 text-pink-700 hover:bg-pink-200'
              }`}
            >
              上一页
            </button>
            <span className="text-sm text-gray-600">
              第 {currentPage} / {totalPages} 页
            </span>
            <button
              onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
              disabled={isGenerating || currentPage === totalPages}
              className={`px-3 py-1 rounded text-sm ${
                currentPage === totalPages || isGenerating ? 'bg-gray-200 text-gray-400' : 'bg-pink-100 text-pink-700 hover:bg-pink-200'
              }`}
            >
              下一页
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export function PresetSelector() {
  const { grouped, isLoading, error } = usePresetQuery();
  const [mgPage, setMgPage] = useState(1);
  const [canshouPage, setCanshouPage] = useState(1);
  const combatants = useBattleStore((state) => state.combatants);
  const addCombatant = useBattleStore((state) => state.addCombatant);
  const removeCombatant = useBattleStore((state) => state.removeCombatant);
  const isGenerating = useBattleStore((state) => state.isGenerating);
  const setError = useBattleStore((state) => state.setError);
  const loadingPreset = useBattleStore((state) => state.loadingPreset);
  const setLoadingPreset = useBattleStore((state) => state.setLoadingPreset);

  const combatantFilenames = useMemo(
    () => combatants.filter((item): item is { filename: string } => 'filename' in item).map((item) => item.filename),
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

  return (
    <>
      <PresetSection
        title="选择预设魔法少女"
        presets={grouped.magicalGirl}
        currentPage={mgPage}
        onPageChange={setMgPage}
        isGenerating={isGenerating}
        onSelect={handleSelect}
        combatantFilenames={combatantFilenames}
        loadingPreset={loadingPreset}
      />
      <PresetSection
        title="选择预设残兽"
        presets={grouped.canshou}
        currentPage={canshouPage}
        onPageChange={setCanshouPage}
        isGenerating={isGenerating}
        onSelect={handleSelect}
        combatantFilenames={combatantFilenames}
        loadingPreset={loadingPreset}
      />
    </>
  );
}
