'use client';

import { useMemo } from 'react';
import { Download } from 'lucide-react';

import type { Preset } from '@/lib/presets';

const PRESETS_PER_PAGE = 4;

export interface PresetGridPickerProps {
  title: string;
  presets: Preset[];
  currentPage: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
  maxSelected?: number;
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
  const hasSelectionLimit = typeof maxSelected === 'number' && Number.isFinite(maxSelected) && maxSelected > 0;
  const selectedLimit = hasSelectionLimit ? maxSelected : null;

  return (
    <div className="mb-6">
      <h3 className="input-label" style={{ marginTop: '0.5rem' }}>
        {title}
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {paged.map((preset) => {
          const isSelected = selectedFilenames.includes(preset.filename);
          const isLoading = loadingFilename === preset.filename;
          const itemDisabled = disabled || (!isSelected && selectedLimit !== null && selectedCount >= selectedLimit);
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
              className={`relative p-3 border rounded-lg transition-all duration-200 ${
                itemDisabled ? 'bg-gray-200 border-gray-300 text-gray-500 cursor-not-allowed' : `${bgColor} cursor-pointer`
              }`}
            >
              <button
                type="button"
                aria-label={`${isSelected ? '取消选择' : '选择'}预设角色：${preset.name}`}
                aria-pressed={isSelected}
                disabled={itemDisabled}
                onClick={() => onToggle(preset)}
                className="absolute inset-0 z-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed"
              />
              <a
                href={`/presets/${encodeURIComponent(preset.filename)}`}
                download={preset.filename}
                title="下载预设 JSON"
                aria-label={`下载预设：${preset.name}`}
                className="absolute right-2 top-2 z-20 inline-flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white/80 text-gray-600 shadow-sm backdrop-blur transition-colors hover:bg-white hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 after:absolute after:-inset-2 after:rounded-full after:content-['']"
              >
                <Download className="h-4 w-4" />
              </a>
              <div className="pointer-events-none relative z-10 pr-8">
                <p className={`font-semibold ${textColor}`}>{isLoading ? '加载中...' : preset.name}</p>
                <p
                  className={`text-xs mt-1 ${
                    isSelected ? (preset.type === 'canshou' ? 'text-red-800' : 'text-pink-800') : 'text-gray-600'
                  }`}
                >
                  {preset.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {presets.length > PRESETS_PER_PAGE && (
        <div className="flex justify-center items-center mt-4 space-x-2">
          <button
            type="button"
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={disabled || currentPage === 1}
            className={`min-h-10 px-3 py-1 rounded text-sm ${
              currentPage === 1 || disabled ? 'bg-gray-200 text-gray-400' : 'bg-pink-100 text-pink-700 hover:bg-pink-200'
            }`}
          >
            上一页
          </button>
          <span className="text-sm text-gray-600">
            第 {currentPage} / {totalPages} 页
          </span>
          <button
            type="button"
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={disabled || currentPage === totalPages}
            className={`min-h-10 px-3 py-1 rounded text-sm ${
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
