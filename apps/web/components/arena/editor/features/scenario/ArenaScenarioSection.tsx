'use client';

import { useRef, useState, type ChangeEvent } from 'react';

import { ScenarioPickerPanel } from '@/components/shared/ScenarioPickerPanel';
import { ScenarioPresetGridPicker } from '@/components/ScenarioPresetGridPicker';
import { CollapsibleSection, DisclosureButton } from '@/components/shared/CollapsibleSection';
import { ArenaAuxScenarioList } from '../../presentation/ArenaScenarioList';
import type { ScenarioPreset } from '@/lib/scenario-presets';

import type { ArenaScenarioSectionModel } from './scenario-contract';

const MAX_PRESET_PAGE_ITEMS = 12;

/**
 * 单人与 Proposal 共用的“情景设置”区块组装：
 * ScenarioPickerPanel（主情景入口）+ 预设情景 + 辅助情景，
 * 能力差异全部来自 adapter 提供的 capabilities/actions。
 */
export function ArenaScenarioSection({ model }: Readonly<{ model: ArenaScenarioSectionModel }>) {
  const { capabilities, actions } = model;
  const [presetPage, setPresetPage] = useState(1);
  const [isAuxPasteVisible, setIsAuxPasteVisible] = useState(false);
  const [auxPastedJson, setAuxPastedJson] = useState('');
  const auxInputRef = useRef<HTMLInputElement>(null);

  const hasMain = Boolean(model.mainName);
  const canAddAux = capabilities.addAux;

  const onAuxFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    try {
      await actions.uploadAux(files);
    } finally {
      if (auxInputRef.current) {
        auxInputRef.current.value = '';
      }
    }
  };

  const onAuxPaste = async () => {
    await actions.pasteAux(auxPastedJson);
    setAuxPastedJson('');
  };

  return (
    <>
      <ScenarioPickerPanel
        onOpenScenarioModal={actions.openMainModal}
        onRandomMatchScenario={capabilities.randomMatchMain ? actions.randomMatchMain : undefined}
        enableLocalInput={capabilities.uploadMain && capabilities.pasteMain}
        onScenarioUpload={capabilities.uploadMain ? actions.uploadMain : undefined}
        onScenarioPaste={capabilities.pasteMain ? actions.pasteMain : undefined}
        isAuthenticated={model.isAuthenticated}
        isGenerating={model.disabled}
        isMatchingBlocked={model.isMatchingBlocked}
        isMatchingScenario={model.isMatchingScenario}
        scenarioFileName={model.mainName}
        isScenarioNative={model.mainIsNative}
      />

      {capabilities.clearMain && hasMain ? (
        <button
          type="button"
          onClick={actions.clearMain}
          disabled={model.disabled}
          className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          清除主情景
        </button>
      ) : null}

      {capabilities.presetRefs ? (
        <CollapsibleSection
          title="预设情景（内置）"
          description="未选择主情景时点击将设为主情景；已有主情景时会加入辅助情景。再次点击已选项可移除对应情景。"
          defaultOpen={false}
          disabled={model.disabled}
          storageKey="arena.section.scenarioPreset.open"
          className="mt-2"
        >
          {model.presetsError ? (
            <div className="text-sm text-red-600">无法加载预设情景：{model.presetsError}</div>
          ) : model.presetsLoading || model.presets.length === 0 ? (
            <div className="text-sm text-gray-500">
              {model.presetsLoading ? '正在加载预设情景...' : '暂无可用的预设情景。'}
            </div>
          ) : (
            <ScenarioPresetGridPicker
              title="选择预设情景"
              presets={model.presets as ScenarioPreset[]}
              currentPage={Math.min(presetPage, Math.max(1, Math.ceil(model.presets.length / MAX_PRESET_PAGE_ITEMS)))}
              onPageChange={setPresetPage}
              disabled={model.disabled}
              selectedFilenames={[...model.selectedPresetFilenames]}
              loadingFilename={model.loadingPresetFilename}
              onToggle={(preset) => actions.togglePreset(preset.filename)}
            />
          )}
        </CollapsibleSection>
      ) : null}

      {capabilities.auxSection ? (
        <CollapsibleSection
          title="辅助情景（可选）"
          description={model.auxBudgetLine
            ? `已选辅助情景 ${model.auxScenarios.length}；${model.auxBudgetLine}`
            : `已选辅助情景 ${model.auxScenarios.length}`}
          defaultOpen={false}
          disabled={model.disabled}
          storageKey="arena.section.auxScenario.open"
          className="mt-2"
          headerRight={capabilities.clearAux ? (
            <button
              type="button"
              onClick={actions.clearAux}
              disabled={model.disabled || model.auxScenarios.length === 0}
              className="text-xs text-red-600 hover:underline cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              清空
            </button>
          ) : null}
        >
          <p className="text-xs text-gray-500">
            辅助情景会和主情景一起加入提示词。
            {!hasMain && <span className="text-red-500 ml-1">（请先选择主情景）</span>}
            {hasMain && model.auxBudgetExhausted && (
              <span className="text-red-500 ml-1">（参考项总预算已用尽）</span>
            )}
          </p>

          {capabilities.browseAux || capabilities.randomMatchAux || capabilities.uploadAux || capabilities.pasteAux ? (
            <>
              <div className="flex gap-2 mt-3">
                {capabilities.browseAux ? (
                  <button
                    type="button"
                    onClick={actions.openAuxModal}
                    disabled={model.disabled || !canAddAux}
                    className="flex-1 px-3 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                    浏览在线情景库
                  </button>
                ) : null}
                {capabilities.randomMatchAux ? (
                  <button
                    type="button"
                    onClick={actions.randomMatchAux}
                    disabled={model.disabled || !canAddAux || model.isMatchingBlocked}
                    className="flex-1 px-3 py-2 bg-indigo-500 text-white rounded hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                    {model.isMatchingScenario ? '匹配中...' : '随机匹配情景'}
                  </button>
                ) : null}
              </div>

              {capabilities.uploadAux ? (
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
                    onChange={(event) => { void onAuxFileChange(event); }}
                    disabled={model.disabled || !canAddAux}
                    className="cursor-pointer input-field file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
              ) : null}

              {capabilities.pasteAux ? (
                <div className="mt-3">
                  <DisclosureButton
                    open={isAuxPasteVisible}
                    onToggle={() => setIsAuxPasteVisible((prev) => !prev)}
                    disabled={model.disabled || !canAddAux}
                    className="text-purple-700 hover:underline"
                  >
                    {isAuxPasteVisible ? '收起辅助情景粘贴区域' : '展开辅助情景粘贴区域'}
                  </DisclosureButton>

                  {isAuxPasteVisible && (
                    <div className="input-group mt-2">
                      <textarea
                        value={auxPastedJson}
                        onChange={(event) => setAuxPastedJson(event.target.value)}
                        placeholder="在此处粘贴一个辅助情景的设定文件(.json)内容..."
                        className="input-field resize-y h-24"
                        disabled={model.disabled || !canAddAux}
                      />
                      <button
                        type="button"
                        onClick={() => { void onAuxPaste(); }}
                        disabled={!auxPastedJson.trim() || model.disabled || !canAddAux}
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
              ) : null}
            </>
          ) : null}

          <ArenaAuxScenarioList
            items={model.auxScenarios}
            disabled={model.disabled}
            onMove={capabilities.reorderAux ? actions.moveAux : undefined}
            onRemove={actions.removeAux}
          />
        </CollapsibleSection>
      ) : null}
    </>
  );
}
