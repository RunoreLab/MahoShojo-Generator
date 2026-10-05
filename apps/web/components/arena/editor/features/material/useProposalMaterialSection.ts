'use client';

import { useMemo } from 'react';

import type { ArenaRoomSharedConfig } from '@mahoshojo/contracts/arena-room';

import {
  useArenaEditorSelector,
  useArenaEditorSession,
} from '../../context';
import type { RoomProposalArenaEditorSession } from '../../types';
import { moveItemInList } from '../move-item';
import type { ArenaMaterialSectionModel } from './material-contract';
import { MAX_ARENA_REFERENCE_ITEMS } from '@/lib/arena/resource-budget';
import {
  dataCardReferenceRequest,
  formatArenaRoomReferenceName,
  resolveArenaRoomReferenceName,
  useArenaRoomReferenceNames,
} from '@/lib/arena-room/reference-presentation';

const PROPOSAL_MATERIAL_NOTICE = '内置素材预设暂不可用：目前没有经过服务器确认的素材目录，避免未验证的正文进入提案。';

const proposalSourceLabel = (source: string): string => (
  source === 'preset'
    ? '内置预设'
    : source === 'host-local' ? '房主本地素材' : '公开在线数据卡'
);

const inertModel: ArenaMaterialSectionModel = {
  disabled: true,
  items: [],
  statsLine: null,
  notice: null,
  hasReferenceCapacity: false,
  capabilities: {
    browseOnline: false,
    clearAll: false,
    upload: false,
    paste: false,
    reorder: false,
  },
  actions: {
    openModal: () => undefined,
    clearAll: () => undefined,
    upload: async () => undefined,
    paste: async () => undefined,
    move: () => undefined,
    remove: () => undefined,
  },
};

/**
 * Proposal 素材区块 adapter：只暴露在线 exact ref 引用、重排与删除；
 * 上传/粘贴 host-local 正文不进入提案草稿。
 */
export const useProposalMaterialSectionModel = (input: {
  disabled: boolean;
  onActionError(message: string): void;
  onOpenModal(): void;
}): ArenaMaterialSectionModel => {
  const session = useArenaEditorSession();
  const state = useArenaEditorSelector((value) => value);
  const { disabled, onActionError, onOpenModal } = input;

  // 请求绑定引用 versionToken：同 ID 不同版本不会命中彼此的名称缓存。
  const referenceNames = useArenaRoomReferenceNames(state.materials.flatMap((item) => {
    if (item.source !== 'data-card') return [];
    const request = dataCardReferenceRequest('material', item.reference);
    return request ? [request] : [];
  }));

  return useMemo(() => {
    if (session.mode !== 'room-proposal') return inertModel;
    const editor = session as RoomProposalArenaEditorSession;
    const update = (updater: (draft: ArenaRoomSharedConfig) => ArenaRoomSharedConfig): void => {
      try {
        editor.update(updater);
      } catch {
        onActionError('该修改不满足房间安全配置约束');
      }
    };

    // Shared Config contract 的联合预算：auxScenarios + materials 合计上限。
    const referenceItemCount = state.auxScenarios.length + state.materials.length;

    return {
      disabled,
      items: state.materials.map((item) => {
        const request = item.source === 'data-card'
          ? dataCardReferenceRequest('material', item.reference)
          : null;
        return {
          key: item.key,
          name: request
            ? `在线:${formatArenaRoomReferenceName(
                request,
                resolveArenaRoomReferenceName(request, referenceNames),
              )}`
            : item.name,
          sourceLabel: proposalSourceLabel(item.source),
          fileName: null,
        };
      }),
      statsLine: `已选素材 ${state.materials.length}；参考项合计 ${referenceItemCount}/${MAX_ARENA_REFERENCE_ITEMS}`,
      notice: PROPOSAL_MATERIAL_NOTICE,
      hasReferenceCapacity: referenceItemCount < MAX_ARENA_REFERENCE_ITEMS,
      capabilities: {
        browseOnline: true,
        clearAll: true,
        upload: false,
        paste: false,
        reorder: true,
      },
      actions: {
        openModal: onOpenModal,
        clearAll: () => update((draft) => ({ ...draft, materials: [] })),
        upload: async () => undefined,
        paste: async () => undefined,
        move: (fromIndex, toIndex) => update((draft) => ({
          ...draft,
          materials: moveItemInList(draft.materials, fromIndex, toIndex),
        })),
        remove: (key) => update((draft) => ({
          ...draft,
          materials: draft.materials.filter((item) => item.key !== key),
        })),
      },
    };
  }, [session, state, disabled, onActionError, onOpenModal, referenceNames]);
};
