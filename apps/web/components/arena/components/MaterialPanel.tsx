'use client';

import { ChangeEvent, useRef, useState } from 'react';

import { DisclosureButton } from '@/components/shared/CollapsibleSection';

import { useBattleActions } from '../hooks/useBattleActions';
import { useBattleStore } from '../stores/useBattleStore';
import { BattleStoreState } from '../types';
import {
  countArenaSelectedReferenceItems,
  MAX_ARENA_REFERENCE_ITEMS,
} from '@/lib/arena/resource-budget';

type MaterialPanelProps = {
  onOpenMaterialModal: () => void;
};

const formatSourceLabel = (sourceKind: string, sourceType: string): string => {
  const kindMap: Record<string, string> = {
    'wantu-card': '万途 Card',
    'mahoshojo-data-card': '数据卡',
    'raw-json': 'JSON',
  };
  const kind = kindMap[sourceKind] ?? sourceKind;
  return sourceType ? `${kind} / ${sourceType}` : kind;
};

export function MaterialPanel({ onOpenMaterialModal }: MaterialPanelProps) {
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const isGenerating = useBattleSelector((state) => state.isGenerating);
  const setError = useBattleSelector((state) => state.setError);
  const auxScenarios = useBattleSelector((state) => state.auxScenarios);
  const selectedQuestionnaires = useBattleSelector((state) => state.selectedQuestionnaires);
  const {
    materials,
    handleMaterialUpload,
    handleMaterialPaste,
    removeMaterial,
    moveMaterial,
    clearMaterials,
  } = useBattleActions();

  const [isPasteVisible, setIsPasteVisible] = useState(false);
  const [pastedJson, setPastedJson] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const referenceItemCount = countArenaSelectedReferenceItems({
    auxScenarios,
    materials,
    selectedQuestionnaires,
  });
  const hasReferenceCapacity = referenceItemCount < MAX_ARENA_REFERENCE_ITEMS;

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    try {
      await handleMaterialUpload(event.target.files);
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const onPaste = async () => {
    try {
      await handleMaterialPaste(pastedJson);
      setPastedJson('');
    } catch (error) {
      setError(`❌ ${error instanceof Error ? error.message : '素材解析失败'}`);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onOpenMaterialModal}
          disabled={isGenerating || !hasReferenceCapacity}
          className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          浏览在线数据卡
        </button>
        <button
          type="button"
          onClick={() => {
            clearMaterials();
            setError(null);
          }}
          disabled={isGenerating || materials.length === 0}
          className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          清空
        </button>
        <div className="text-xs text-gray-500">
          已选素材 {materials.length}；参考项合计 {referenceItemCount}/{MAX_ARENA_REFERENCE_ITEMS}
        </div>
      </div>

      <div>
        <label htmlFor="arena-material-upload" className="input-label">
          上传素材 JSON
        </label>
        <input
          ref={inputRef}
          id="arena-material-upload"
          type="file"
          multiple
          accept=".json,application/json"
          onChange={onFileChange}
          disabled={isGenerating || !hasReferenceCapacity}
          className="input-field cursor-pointer file:mr-4 file:rounded-full file:border-0 file:bg-emerald-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-emerald-700 hover:file:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      <div>
        <DisclosureButton
          open={isPasteVisible}
          onToggle={() => setIsPasteVisible((prev) => !prev)}
          disabled={isGenerating || !hasReferenceCapacity}
          className="text-emerald-700 hover:underline"
        >
          {isPasteVisible ? '收起素材粘贴区域' : '展开素材粘贴区域'}
        </DisclosureButton>

        {isPasteVisible && (
          <div className="input-group mt-2">
            <textarea
              value={pastedJson}
              onChange={(event) => setPastedJson(event.target.value)}
              placeholder="在此处粘贴一个素材 JSON..."
              className="input-field h-24 resize-y"
              disabled={isGenerating}
            />
            <button
              type="button"
              onClick={() => void onPaste()}
              disabled={!pastedJson.trim() || isGenerating || !hasReferenceCapacity}
              className="generate-button mb-0 mt-2"
              style={{
                backgroundColor: '#059669',
                backgroundImage: 'linear-gradient(to right, #059669, #10b981)',
              }}
            >
              从文本添加素材
            </button>
          </div>
        )}
      </div>

      {materials.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {materials.map((material, index) => {
            const canMoveUp = index > 0;
            const canMoveDown = index < materials.length - 1;
            return (
              <li key={material.id} className="rounded-lg border border-gray-200 bg-white/80 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="break-words font-semibold text-gray-800">{material.name}</div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-500">
                      <span>{formatSourceLabel(material.sourceKind, material.sourceType)}</span>
                      {material.fileName ? <span>{material.fileName}</span> : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => moveMaterial(index, index - 1)}
                      disabled={isGenerating || !canMoveUp}
                      className="rounded border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveMaterial(index, index + 1)}
                      disabled={isGenerating || !canMoveDown}
                      className="rounded border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeMaterial(material.id)}
                      disabled={isGenerating}
                      className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      移除
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-200 bg-white/50 px-3 py-4 text-center text-sm text-gray-500">
          未添加素材
        </div>
      )}
    </div>
  );
}
