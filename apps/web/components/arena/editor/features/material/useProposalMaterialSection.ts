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
    upload: () => undefined,
    paste: () => undefined,
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

    return {
      disabled,
      items: state.materials.map((item) => ({
        key: item.key,
        name: item.name,
        sourceLabel: proposalSourceLabel(item.source),
        fileName: null,
      })),
      statsLine: null,
      notice: PROPOSAL_MATERIAL_NOTICE,
      hasReferenceCapacity: true,
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
        upload: () => undefined,
        paste: () => undefined,
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
  }, [session, state, disabled, onActionError, onOpenModal]);
};
