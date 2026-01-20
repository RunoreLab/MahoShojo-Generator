'use client';

import { ScenarioPickerPanel } from '@/components/shared/ScenarioPickerPanel';
import { ScenarioPresetGridPicker } from '@/components/ScenarioPresetGridPicker';

import { ChangeEvent, useRef, useState } from 'react';

import { useBattleStore } from '../stores/useBattleStore';
import { useBattleActions } from '../hooks/useBattleActions';
import { BattleStoreState } from '../types';
import { useScenarioPresetQuery } from '../hooks/useArenaData';
import type { ScenarioPreset } from '@/lib/scenario-presets';

interface ScenarioPanelProps {
  onOpenScenarioModal: () => void;
  onRandomMatchScenario: () => void;
  onOpenAuxScenarioModal: () => void;
  isAuthenticated: boolean;
}

export function ScenarioPanel({
  onOpenScenarioModal,
  onRandomMatchScenario,
  onOpenAuxScenarioModal,
  isAuthenticated,
}: ScenarioPanelProps) {
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const scenario = useBattleSelector((state) => state.scenario);
  const auxScenarios = useBattleSelector((state) => state.auxScenarios);
  const isGenerating = useBattleSelector((state) => state.isGenerating);
  const isMatching = useBattleSelector((state) => state.isMatching);
  const setError = useBattleSelector((state) => state.setError);
  const clearScenario = useBattleSelector((state) => state.clearScenario);
  const {
    handleScenarioUpload,
    handleScenarioPaste,
    handleAuxScenarioUpload,
    handleAuxScenarioPaste,
    handleRandomMatchAuxScenario,
    removeAuxScenario,
    moveAuxScenario,
    clearAuxScenarios,
  } = useBattleActions();

  const [isAuxCollapsed, setIsAuxCollapsed] = useState(true);
  const [isAuxPasteVisible, setIsAuxPasteVisible] = useState(false);
  const [auxPastedJson, setAuxPastedJson] = useState('');
  const auxInputRef = useRef<HTMLInputElement>(null);

  const [isPresetCollapsed, setIsPresetCollapsed] = useState(true);
  const [presetPage, setPresetPage] = useState(1);
  const [loadingScenarioPreset, setLoadingScenarioPreset] = useState<string | null>(null);
  const scenarioPresetQuery = useScenarioPresetQuery();

  const reportError = (error: unknown) => {
    const e = error instanceof Error ? error : new Error('未知错误');
    setError(`❌ ${e.message}`);
  };

  const selectedScenarioTitle = (() => {
    const title = (scenario.content as any)?.title;
    return typeof title === 'string' ? title.trim() : '';
  })();
  const selectedScenarioPresetFilenames = (() => {
    const presets = scenarioPresetQuery.data;
    if (!presets || !selectedScenarioTitle) return [];
    return presets.filter((preset) => preset.title === selectedScenarioTitle).map((preset) => preset.filename);
  })();

  const handleToggleScenarioPreset = async (preset: ScenarioPreset) => {
    if (isGenerating) return;
    if (selectedScenarioTitle && preset.title === selectedScenarioTitle) {
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
      await handleScenarioPaste(text);
      setError(null);
    } catch (error) {
      reportError(error);
    } finally {
      setLoadingScenarioPreset(null);
    }
  };

  const onAuxFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    if (files.length === 0) return;
    try {
      const errors: string[] = [];
      for (const file of files) {
        try {
          await handleAuxScenarioUpload(file);
        } catch (error) {
          const message = error instanceof Error ? error.message : '上传文件解析失败';
          errors.push(`${file.name}: ${message}`);
        }
      }
      if (errors.length > 0) {
        reportError(new Error(`${errors.length}/${files.length} 个文件导入失败：${errors.join('；')}`));
      } else {
        setError(null);
      }
    } catch (error) {
      reportError(error);
    } finally {
      if (auxInputRef.current) {
        auxInputRef.current.value = '';
      }
    }
  };

  const onAuxPaste = async () => {
    try {
      await handleAuxScenarioPaste(auxPastedJson);
      setAuxPastedJson('');
    } catch (error) {
      reportError(error);
    }
  };

  const canAddAuxScenario = Boolean(scenario.content);

  return (
    <>
      <ScenarioPickerPanel
        onOpenScenarioModal={onOpenScenarioModal}
        onRandomMatchScenario={onRandomMatchScenario}
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

      <div className="mt-2">
        <button
          type="button"
          onClick={() => setIsPresetCollapsed((prev) => !prev)}
          className="text-purple-700 hover:underline cursor-pointer font-semibold"
          disabled={isGenerating}
        >
          {isPresetCollapsed ? '▶ 展开预设情景（内置）' : '▼ 折叠预设情景（内置）'}
        </button>

        {!isPresetCollapsed && (
          <div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded-lg">
            {scenarioPresetQuery.error ? (
              <div className="text-sm text-red-600">
                无法加载预设情景：{(scenarioPresetQuery.error as Error).message}
              </div>
            ) : scenarioPresetQuery.isLoading || !scenarioPresetQuery.data ? (
              <div className="text-sm text-gray-500">正在加载预设情景...</div>
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
            <div className="text-xs text-gray-500">
              提示：再次点击已选的预设情景可清空主情景。
            </div>
          </div>
        )}
      </div>

      <div className="mt-2">
        <button
          type="button"
          onClick={() => setIsAuxCollapsed((prev) => !prev)}
          className="text-purple-700 hover:underline cursor-pointer font-semibold"
          disabled={isGenerating}
        >
          {isAuxCollapsed ? '▶ 展开辅助情景（可选）' : '▼ 折叠辅助情景（可选）'}
        </button>

        {!isAuxCollapsed && (
          <div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded-lg">
            <div className="flex justify-between items-center">
              <p className="font-semibold text-sm text-gray-700">已选辅助情景 ({auxScenarios.length}/10)</p>
              <button
                type="button"
                onClick={() => {
                  clearAuxScenarios();
                  setError(null);
                }}
                disabled={isGenerating || auxScenarios.length === 0}
                className="text-sm text-red-500 hover:underline cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                清空列表
              </button>
            </div>

            <p className="text-xs text-gray-500 mt-1">
              辅助情景会和主情景一起加入提示词。
              {!canAddAuxScenario && <span className="text-red-500 ml-1">（请先选择主情景）</span>}
            </p>

            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={onOpenAuxScenarioModal}
                disabled={isGenerating || !canAddAuxScenario}
                className="flex-1 px-3 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                浏览在线情景库
              </button>
              <button
                type="button"
                onClick={() => void handleRandomMatchAuxScenario()}
                disabled={isGenerating || !canAddAuxScenario || isMatching !== null}
                className="flex-1 px-3 py-2 bg-indigo-500 text-white rounded hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                {isMatching === 'scenario' ? '匹配中...' : '随机匹配情景'}
              </button>
            </div>

            <div className="mt-3">
              <label htmlFor="aux-scenario-upload" className="input-label">
                上传辅助情景文件 (.json)
              </label>
              <input
                ref={auxInputRef}
                id="aux-scenario-upload"
                type="file"
                multiple
                accept=".json"
                onChange={onAuxFileChange}
                disabled={isGenerating || !canAddAuxScenario}
                className="cursor-pointer input-field file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>

            <div className="mt-3">
              <button
                type="button"
                onClick={() => setIsAuxPasteVisible((prev) => !prev)}
                className="text-purple-700 hover:underline cursor-pointer font-semibold"
                disabled={isGenerating || !canAddAuxScenario}
              >
                {isAuxPasteVisible ? '▼ 折叠辅助情景粘贴区域' : '▶ 展开辅助情景粘贴区域'}
              </button>
              {isAuxPasteVisible && (
                <div className="input-group mt-2">
                  <textarea
                    value={auxPastedJson}
                    onChange={(e) => setAuxPastedJson(e.target.value)}
                    placeholder="在此处粘贴一个辅助情景的设定文件(.json)内容..."
                    className="input-field resize-y h-24"
                    disabled={isGenerating || !canAddAuxScenario}
                  />
                  <button
                    type="button"
                    onClick={() => void onAuxPaste()}
                    disabled={!auxPastedJson.trim() || isGenerating || !canAddAuxScenario}
                    className="generate-button mt-2 mb-0"
                    style={{
                      backgroundColor: '#8b5cf6',
                      backgroundImage: 'linear-gradient(to right, #8b5cf6, #a78bfa)',
                    }}
                  >
                    从文本添加辅助情景
                  </button>
                </div>
              )}
            </div>

            {auxScenarios.length > 0 && (
              <ul className="list-disc list-inside text-sm text-gray-600 mt-3 space-y-2">
                {auxScenarios.map((item, index) => {
                  const title =
                    (typeof (item.content as any)?.title === 'string' && (item.content as any).title.trim())
                      ? (item.content as any).title.trim()
                      : (item.fileName || `辅助情景 ${index + 1}`).replace(/\.json$/i, '');
                  const canMoveUp = index > 0;
                  const canMoveDown = index < auxScenarios.length - 1;

                  return (
                    <li key={item.id} className="flex justify-between items-start gap-2">
                      <div className="flex flex-col gap-1 pt-0.5">
                        <button
                          type="button"
                          onClick={() => moveAuxScenario(index, index - 1)}
                          disabled={isGenerating || !canMoveUp}
                          className="w-6 h-6 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                          aria-label={`上移 ${title}`}
                          title="上移"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveAuxScenario(index, index + 1)}
                          disabled={isGenerating || !canMoveDown}
                          className="w-6 h-6 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                          aria-label={`下移 ${title}`}
                          title="下移"
                        >
                          ↓
                        </button>
                      </div>

                      <div className="flex items-center flex-grow min-w-0">
                        <span className="break-words mr-2" title={title}>
                          {title}
                          {item.isNative && <span className="text-xs text-green-600 ml-1">(原生)</span>}
                        </span>
                      </div>

                      <div className="flex items-center flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            if (isGenerating) return;
                            removeAuxScenario(item.id);
                            setError(null);
                          }}
                          className={`w-5 h-5 bg-red-200 text-red-700 rounded-full flex items-center justify-center text-xs font-bold transition-colors flex-shrink-0 ${
                            isGenerating ? 'opacity-50 cursor-not-allowed' : 'hover:bg-red-300'
                          }`}
                          aria-label={`移除 ${title}`}
                          disabled={isGenerating}
                        >
                          X
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </>
  );
}
