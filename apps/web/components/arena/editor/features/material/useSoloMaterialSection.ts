'use client';

import { useBattleActions } from '../../../hooks/useBattleActions';
import { useBattleStore } from '../../../stores/useBattleStore';
import type { BattleStoreState } from '../../../types';
import {
  countArenaSelectedReferenceItems,
  MAX_ARENA_REFERENCE_ITEMS,
} from '@/lib/arena/resource-budget';

import type { ArenaMaterialSectionModel } from './material-contract';

const formatSourceLabel = (sourceKind: string, sourceType: string): string => {
  const kindMap: Record<string, string> = {
    'wantu-card': '万途 Card',
    'mahoshojo-data-card': '数据卡',
    'raw-json': 'JSON',
  };
  const kind = kindMap[sourceKind] ?? sourceKind;
  return sourceType ? `${kind} / ${sourceType}` : kind;
};

/**
 * 单人素材区块 adapter：battle store + 上传/粘贴/参考项预算。
 */
export const useSoloMaterialSectionModel = (input: {
  onOpenModal(): void;
}): ArenaMaterialSectionModel => {
  const { onOpenModal } = input;
  const isGenerating = useBattleStore((state: BattleStoreState) => state.isGenerating);
  const setError = useBattleStore((state: BattleStoreState) => state.setError);
  const auxScenarios = useBattleStore((state: BattleStoreState) => state.auxScenarios);
  const selectedQuestionnaires = useBattleStore((state: BattleStoreState) => state.selectedQuestionnaires);
  const {
    materials,
    handleMaterialUpload,
    handleMaterialPaste,
    removeMaterial,
    moveMaterial,
    clearMaterials,
  } = useBattleActions();

  const referenceItemCount = countArenaSelectedReferenceItems({
    auxScenarios,
    materials,
    selectedQuestionnaires,
  });
  const hasReferenceCapacity = referenceItemCount < MAX_ARENA_REFERENCE_ITEMS;

  return {
    disabled: isGenerating,
    items: materials.map((material) => ({
      key: material.id,
      name: material.name,
      sourceLabel: formatSourceLabel(material.sourceKind, material.sourceType),
      fileName: material.fileName,
    })),
    statsLine: `已选素材 ${materials.length}；参考项合计 ${referenceItemCount}/${MAX_ARENA_REFERENCE_ITEMS}`,
    notice: null,
    hasReferenceCapacity,
    capabilities: {
      browseOnline: true,
      clearAll: true,
      upload: true,
      paste: true,
      reorder: true,
    },
    actions: {
      openModal: onOpenModal,
      clearAll: () => {
        clearMaterials();
        setError(null);
      },
      upload: (files) => { void handleMaterialUpload(files); },
      paste: (text) => {
        void handleMaterialPaste(text).catch((error) => {
          setError(`❌ ${error instanceof Error ? error.message : '素材解析失败'}`);
        });
      },
      move: moveMaterial,
      remove: removeMaterial,
    },
  };
};
