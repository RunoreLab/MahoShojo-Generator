'use client';

import { useBattleStore } from '../stores/useBattleStore';
import { BattleStoreState, GenerationMode } from '../types';

const MODE_OPTIONS: Array<{ key: GenerationMode; label: string }> = [
  { key: 'non-stream', label: '非流式' },
  { key: 'stream', label: '流式' },
];

export function GenerationModeSwitcher() {
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const generationMode = useBattleSelector((state) => state.generationMode);
  const setGenerationMode = useBattleSelector((state) => state.setGenerationMode);
  const isGenerating = useBattleSelector((state) => state.isGenerating);

  const renderHelper = () => {
    if (generationMode === 'stream') {
          return (
            <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
              <p className="font-bold">你已选择【流式生成（实验性）】！</p>
              <p className="mt-1">实验性功能：会实时输出正文，质量更高、体验更好，但可能出现中断、格式异常等严重问题！</p>
            </div>
          );
        }

    return (
      <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
        <p className="font-bold">你已选择【非流式生成】！</p>
        <p className="mt-1">传统生成方式：等待片刻后一次性返回完整战报。</p>
      </div>
    );
  };

  return (
    <div className="input-group">
      <label className="input-label">选择生成方式</label>
      <div className="flex items-center space-x-1 bg-gray-200 p-1 rounded-full">
        {MODE_OPTIONS.map((option) => (
          <button
            key={option.key}
            onClick={() => setGenerationMode(option.key)}
            disabled={isGenerating}
            className={`w-1/2 py-2 text-sm font-semibold rounded-full transition-colors duration-300 ${
              generationMode === option.key ? 'bg-white text-pink-600 shadow' : 'text-gray-600 hover:bg-gray-300'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {renderHelper()}
    </div>
  );
}
