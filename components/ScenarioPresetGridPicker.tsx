'use client';

import { useMemo } from 'react';
import { Download } from 'lucide-react';

import type { ScenarioPreset } from '@/lib/scenario-presets';

const PRESETS_PER_PAGE = 4;

export interface ScenarioPresetGridPickerProps {
  title: string;
  presets: ScenarioPreset[];
  currentPage: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
  selectedFilenames: string[];
  loadingFilename?: string | null;
  onToggle: (preset: ScenarioPreset) => void;
}

export function ScenarioPresetGridPicker({
  title,
  presets,
  currentPage,
  onPageChange,
  disabled = false,
  selectedFilenames,
  loadingFilename = null,
  onToggle,
}: ScenarioPresetGridPickerProps) {
  const totalPages = useMemo(() => Math.max(1, Math.ceil(presets.length / PRESETS_PER_PAGE)), [presets.length]);
  const paged = useMemo(() => presets.slice((currentPage - 1) * PRESETS_PER_PAGE, currentPage * PRESETS_PER_PAGE), [presets, currentPage]);

  return (
    <div className="mb-4">
      <h3 className="input-label" style={{ marginTop: '0.5rem' }}>
        {title}
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {paged.map((preset) => {
          const isSelected = selectedFilenames.includes(preset.filename);
          const isLoading = loadingFilename === preset.filename;
          const itemDisabled = disabled;
          const templateLabel = preset.template === 'general-scenario' ? '通用情景' : '情景卡';
          const bgColor = isSelected
            ? 'bg-purple-200 border-purple-400 hover:bg-purple-300'
            : 'bg-white border-gray-300 hover:border-purple-400 hover:bg-purple-50';
          const titleColor = isSelected ? 'text-purple-900' : 'text-purple-800';
          const descriptionColor = isSelected ? 'text-purple-800' : 'text-gray-600';
          return (
            <div
              key={preset.filename}
              onClick={() => !itemDisabled && onToggle(preset)}
              className={`relative p-3 border rounded-lg transition-all duration-200 ${
                itemDisabled ? 'bg-gray-200 border-gray-300 text-gray-500 cursor-not-allowed' : `${bgColor} cursor-pointer`
              }`}
            >
              <a
                href={`/scenario-presets/${encodeURIComponent(preset.filename)}`}
                download={preset.filename}
                onClick={(e) => e.stopPropagation()}
                title="下载预设 JSON"
                aria-label={`下载预设情景：${preset.title}`}
                className="absolute right-2 top-2 z-10 inline-flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white/80 text-gray-600 shadow-sm backdrop-blur transition-colors hover:bg-white hover:text-blue-600"
              >
                <Download className="h-4 w-4" />
              </a>

              <div className="flex items-center gap-2 pr-8">
                <p className={`font-semibold ${titleColor}`}>{isLoading ? '加载中...' : preset.title}</p>
                <span className="inline-flex items-center rounded-full border border-gray-200 bg-white/70 px-2 py-0.5 text-[10px] font-medium text-gray-700">
                  {templateLabel}
                </span>
              </div>
              <p className={`text-xs mt-1 ${descriptionColor}`}>
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
              currentPage === 1 || disabled ? 'bg-gray-200 text-gray-400' : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
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
              currentPage === totalPages || disabled ? 'bg-gray-200 text-gray-400' : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
            }`}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}

