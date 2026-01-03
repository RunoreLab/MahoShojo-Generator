'use client';

import { useMemo } from 'react';

import type { Preset } from '@/lib/presets';

const PRESETS_PER_PAGE = 4;

export interface PresetGridPickerProps {
  title: string;
  presets: Preset[];
  currentPage: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
  maxSelected: number;
  selectedFilenames: string[];
  selectedCountOverride?: number;
  loadingFilename?: string | null;
  onToggle: (preset: Preset) => void;
}

export function PresetGridPicker({
  title,
  presets,
  currentPage,
  onPageChange,
  disabled = false,
  maxSelected,
  selectedFilenames,
  selectedCountOverride,
  loadingFilename = null,
  onToggle,
}: PresetGridPickerProps) {
  const totalPages = useMemo(() => Math.max(1, Math.ceil(presets.length / PRESETS_PER_PAGE)), [presets.length]);
  const paged = useMemo(() => presets.slice((currentPage - 1) * PRESETS_PER_PAGE, currentPage * PRESETS_PER_PAGE), [presets, currentPage]);
  const selectedCount = typeof selectedCountOverride === 'number' ? selectedCountOverride : selectedFilenames.length;

  return (
    <div className="mb-6">
      <h3 className="input-label" style={{ marginTop: '0.5rem' }}>
        {title}
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {paged.map((preset) => {
          const isSelected = selectedFilenames.includes(preset.filename);
          const isLoading = loadingFilename === preset.filename;
          const itemDisabled = disabled || (!isSelected && selectedCount >= maxSelected);
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
              onClick={() => !itemDisabled && onToggle(preset)}
              className={`p-3 border rounded-lg transition-all duration-200 ${
                itemDisabled ? 'bg-gray-200 border-gray-300 text-gray-500 cursor-not-allowed' : `${bgColor} cursor-pointer`
              }`}
            >
              <p className={`font-semibold ${textColor}`}>{isLoading ? '加载中...' : preset.name}</p>
              <p
                className={`text-xs mt-1 ${
                  isSelected ? (preset.type === 'canshou' ? 'text-red-800' : 'text-pink-800') : 'text-gray-600'
                }`}
              >
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
            disabled={disabled || currentPage === 1}
            className={`px-3 py-1 rounded text-sm ${
              currentPage === 1 || disabled ? 'bg-gray-200 text-gray-400' : 'bg-pink-100 text-pink-700 hover:bg-pink-200'
            }`}
          >
            上一页
          </button>
          <span className="text-sm text-gray-600">
            第 {currentPage} / {totalPages} 页
          </span>
          <button
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={disabled || currentPage === totalPages}
            className={`px-3 py-1 rounded text-sm ${
              currentPage === totalPages || disabled ? 'bg-gray-200 text-gray-400' : 'bg-pink-100 text-pink-700 hover:bg-pink-200'
            }`}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
