'use client';

import { ChangeEvent, useRef, useState } from 'react';

import { DisclosureButton } from '@/components/shared/CollapsibleSection';
import { ArenaMaterialList } from '../editor/presentation/ArenaMaterialList';

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

      <ArenaMaterialList
        items={materials.map((material) => ({
          key: material.id,
          name: material.name,
          sourceLabel: formatSourceLabel(material.sourceKind, material.sourceType),
          fileName: material.fileName,
        }))}
        disabled={isGenerating}
        onMove={moveMaterial}
        onRemove={removeMaterial}
      />
    </div>
  );
}
