'use client';

import { useBattleStore } from '../stores/useBattleStore';
import { BattleStoreState, GenerationMode, StreamTransportMode } from '../types';
import { GenerationModeSwitcher as GenerationModeSwitcherUi } from '@/components/shared/GenerationModeSwitcher';

export function GenerationModeSwitcher() {
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const generationMode = useBattleSelector((state) => state.generationMode);
  const streamTransport = useBattleSelector((state) => state.settings.streamTransport);
  const setGenerationMode = useBattleSelector((state) => state.setGenerationMode);
  const updateSettings = useBattleSelector((state) => state.updateSettings);
  const isGenerating = useBattleSelector((state) => state.isGenerating);

  return (
    <>
      <GenerationModeSwitcherUi
        label="选择生成方式"
        value={generationMode}
        disabled={isGenerating}
        onChange={(mode) => setGenerationMode(mode as GenerationMode)}
      />
      {generationMode === 'stream' && (
        <div className="mt-3 p-3 bg-white border border-gray-200 rounded-lg">
          <div className="text-xs font-semibold text-gray-700 mb-2">流式传输策略</div>
          <div className="flex items-center space-x-1 bg-gray-100 p-1 rounded-full">
            {[
              { key: 'sse', label: 'SSE（默认）', helper: '结构化事件更完整（reasoning/meta/telemetry）' },
              { key: 'plain-stream', label: '纯文本流', helper: '兼容模式（不走 SSE 事件）' },
            ].map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => updateSettings({ streamTransport: option.key as StreamTransportMode })}
                disabled={isGenerating}
                className={`w-1/2 py-2 text-xs font-semibold rounded-full transition-colors duration-300 ${
                  streamTransport === option.key ? 'bg-white text-purple-700 shadow' : 'text-gray-600 hover:bg-gray-200'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
                title={option.helper}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
