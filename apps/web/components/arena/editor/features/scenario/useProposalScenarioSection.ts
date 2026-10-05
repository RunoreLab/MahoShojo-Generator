'use client';

import { useMemo } from 'react';

import type { ArenaRoomSharedConfig } from '@mahoshojo/contracts/arena-room';

import {
  useArenaEditorSelector,
  useArenaEditorSession,
} from '../../context';
import type { RoomProposalArenaEditorSession } from '../../types';
import { moveItemInList } from '../move-item';
import type { ArenaScenarioSectionModel } from './scenario-contract';
import { SCENARIO_PRESET_LIST, type ScenarioPreset } from '@/lib/scenario-presets';
import { ARENA_ROOM_PRESET_CATALOG } from '@/lib/arena-room/generated/arena-room-preset-catalog';
import { MAX_ARENA_REFERENCE_ITEMS } from '@/lib/arena/resource-budget';
import {
  arenaRoomReferenceSourcePrefix,
  dataCardReferenceRequest,
  formatArenaRoomReferenceName,
  presetReferenceRequest,
  resolveArenaRoomReferenceName,
  useArenaRoomReferenceNames,
  type ArenaRoomReferenceRequest,
} from '@/lib/arena-room/reference-presentation';

const PRESET_KEY_PREFIX = 'preset:';

/** 房间策展目录内的预设情景（与角色预设同一 catalog 约束）。 */
const proposalScenarioPresets: ScenarioPreset[] = SCENARIO_PRESET_LIST.filter((preset) => (
  ARENA_ROOM_PRESET_CATALOG.some((entry) => entry.kind === 'scenario' && entry.id === preset.filename)
));

const inertModel: ArenaScenarioSectionModel = {
  disabled: true,
  isAuthenticated: false,
  isMatchingBlocked: false,
  isMatchingScenario: false,
  mainName: null,
  mainIsNative: false,
  auxScenarios: [],
  auxBudgetLine: null,
  auxBudgetExhausted: false,
  presets: [],
  presetsLoading: false,
  presetsError: null,
  selectedPresetFilenames: [],
  loadingPresetFilename: null,
  capabilities: {
    browseMain: false,
    randomMatchMain: false,
    clearMain: false,
    uploadMain: false,
    pasteMain: false,
    presetRefs: false,
    auxSection: false,
    addAux: false,
    browseAux: false,
    randomMatchAux: false,
    uploadAux: false,
    pasteAux: false,
    reorderAux: false,
    removeAux: false,
    clearAux: false,
  },
  actions: {
    openMainModal: () => undefined,
    randomMatchMain: () => undefined,
    clearMain: () => undefined,
    uploadMain: async () => undefined,
    pasteMain: async () => undefined,
    openAuxModal: () => undefined,
    randomMatchAux: () => undefined,
    uploadAux: async () => undefined,
    pasteAux: async () => undefined,
    togglePreset: () => undefined,
    moveAux: () => undefined,
    removeAux: () => undefined,
    clearAux: () => undefined,
  },
};

/**
 * Proposal 情景区块 adapter：只暴露能进入 Room Shared Config 的安全引用能力
 * （preset exact ref / 在线情景 exact ref / 重排 / 删除），上传粘贴与随机匹配不开放。
 */
export const useProposalScenarioSectionModel = (input: {
  disabled: boolean;
  onActionError(message: string): void;
  onOpenMainModal(): void;
  onOpenAuxModal(): void;
}): ArenaScenarioSectionModel => {
  const session = useArenaEditorSession();
  const state = useArenaEditorSelector((value) => value);
  const { disabled, onActionError, onOpenMainModal, onOpenAuxModal } = input;

  // 请求绑定房间引用的 versionToken：同 ID 不同版本不会命中彼此的名称缓存。
  const scenarioReferenceRequests: ArenaRoomReferenceRequest[] = [
    ...(state.scenario && state.scenario.source !== 'host-local'
      ? (state.scenario.source === 'preset'
          ? [presetReferenceRequest(
              'scenario',
              state.scenario.key.slice(PRESET_KEY_PREFIX.length),
              state.scenario.reference?.versionToken,
            )]
          : (() => {
              const request = dataCardReferenceRequest('scenario', state.scenario.reference);
              return request ? [request] : [];
            })())
      : []),
    ...state.auxScenarios.flatMap((item): ArenaRoomReferenceRequest[] => {
      if (item.source === 'preset') {
        return [presetReferenceRequest(
          'scenario',
          item.key.slice(PRESET_KEY_PREFIX.length),
          item.reference?.versionToken,
        )];
      }
      if (item.source === 'data-card') {
        const request = dataCardReferenceRequest('scenario', item.reference);
        return request ? [request] : [];
      }
      return [];
    }),
  ];
  const referenceNames = useArenaRoomReferenceNames(scenarioReferenceRequests);

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

    const scenarioNameOf = (item: { source: string; key: string; reference: { id: string; versionToken?: string } | null; name: string }): string => {
      if (item.source === 'preset') {
        const request = presetReferenceRequest(
          'scenario',
          item.key.slice(PRESET_KEY_PREFIX.length),
          item.reference?.versionToken,
        );
        return formatArenaRoomReferenceName(request, resolveArenaRoomReferenceName(request, referenceNames));
      }
      if (item.source === 'data-card') {
        const request = dataCardReferenceRequest('scenario', item.reference);
        if (request) {
          return formatArenaRoomReferenceName(request, resolveArenaRoomReferenceName(request, referenceNames));
        }
      }
      return item.name;
    };

    const selectedPresetFilenames = [
      ...(state.scenario?.source === 'preset' ? [state.scenario.key.slice(PRESET_KEY_PREFIX.length)] : []),
      ...state.auxScenarios
        .filter((item) => item.source === 'preset')
        .map((item) => item.key.slice(PRESET_KEY_PREFIX.length)),
    ];

    // Shared Config contract 的联合预算：auxScenarios + materials 合计上限。
    const referenceItemCount = state.auxScenarios.length + state.materials.length;
    const hasReferenceCapacity = referenceItemCount < MAX_ARENA_REFERENCE_ITEMS;

    const togglePreset = (filename: string) => {
      const key = `${PRESET_KEY_PREFIX}${filename}`;
      const entry = ARENA_ROOM_PRESET_CATALOG.find((item) => item.kind === 'scenario' && item.id === filename);
      if (!entry) {
        onActionError('预设情景元数据不可用，请刷新后重试');
        return;
      }
      update((draft) => {
        if (draft.scenario?.key === key) return { ...draft, scenario: null };
        if (draft.auxScenarios.some((item) => item.key === key)) {
          return { ...draft, auxScenarios: draft.auxScenarios.filter((item) => item.key !== key) };
        }
        const next = { key, ref: { id: entry.id, kind: 'scenario' as const, versionToken: entry.versionToken } };
        return draft.scenario === null
          ? { ...draft, scenario: next }
          : { ...draft, auxScenarios: [...draft.auxScenarios, next] };
      });
    };

    return {
      disabled,
      // Proposal 编辑者必然已登录（进入房间需认证），且私有数据卡被提案安全边界
      // 整体禁止、与登录态无关；isAuthenticated 仅用于 solo 的“登录后可访问私有
      // 数据卡”提示，此处恒为 true 以避免误导用户重复登录。
      isAuthenticated: true,
      isMatchingBlocked: false,
      isMatchingScenario: false,
      mainName: state.scenario
        ? `${state.scenario.source === 'preset' || state.scenario.source === 'data-card'
          ? `${arenaRoomReferenceSourcePrefix(state.scenario.source === 'preset' ? 'preset' : 'data-card')}:`
          : ''}${scenarioNameOf(state.scenario)}`
        : null,
      mainIsNative: false,
      auxScenarios: state.auxScenarios.map((item) => ({
        key: item.key,
        title: `${item.source === 'preset' || item.source === 'data-card'
          ? `${arenaRoomReferenceSourcePrefix(item.source === 'preset' ? 'preset' : 'data-card')}:`
          : ''}${scenarioNameOf(item)}`,
        isNative: false,
      })),
      auxBudgetLine: `参考项合计 ${referenceItemCount}/${MAX_ARENA_REFERENCE_ITEMS}`,
      auxBudgetExhausted: !hasReferenceCapacity,
      presets: proposalScenarioPresets,
      presetsLoading: false,
      presetsError: null,
      selectedPresetFilenames,
      loadingPresetFilename: null,
      capabilities: {
        browseMain: true,
        randomMatchMain: false,
        clearMain: true,
        uploadMain: false,
        pasteMain: false,
        presetRefs: editor.capabilities.canAddPresetRefs,
        auxSection: true,
        // 与 solo 相同的用户级门槛：先有主情景，且参考项联合预算未用尽
        // （Shared Config 对 auxScenarios + materials 有合计上限）。
        addAux: state.scenario !== null && hasReferenceCapacity,
        browseAux: true,
        randomMatchAux: false,
        uploadAux: false,
        pasteAux: false,
        reorderAux: true,
        removeAux: true,
        clearAux: true,
      },
      actions: {
        openMainModal: onOpenMainModal,
        randomMatchMain: () => undefined,
        clearMain: () => update((draft) => ({ ...draft, scenario: null })),
        uploadMain: async () => undefined,
        pasteMain: async () => undefined,
        openAuxModal: onOpenAuxModal,
        randomMatchAux: () => undefined,
        uploadAux: async () => undefined,
        pasteAux: async () => undefined,
        togglePreset,
        moveAux: (fromIndex, toIndex) => update((draft) => ({
          ...draft,
          auxScenarios: moveItemInList(draft.auxScenarios, fromIndex, toIndex),
        })),
        removeAux: (key) => update((draft) => ({
          ...draft,
          auxScenarios: draft.auxScenarios.filter((item) => item.key !== key),
        })),
        clearAux: () => update((draft) => ({ ...draft, auxScenarios: [] })),
      },
    };
  }, [session, state, disabled, onActionError, onOpenMainModal, onOpenAuxModal, referenceNames]);
};
