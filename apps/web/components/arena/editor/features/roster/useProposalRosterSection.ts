'use client';

import { useMemo, useState } from 'react';

import { MAX_COMBATANTS, type ArenaRoomSharedConfig } from '@mahoshojo/contracts/arena-room';

import { useArenaEditorSelector, useArenaEditorSession } from '../../context';
import type { RoomProposalArenaEditorSession } from '../../types';
import { moveItemInList } from '../move-item';
import type {
  ArenaRosterSectionModel,
  ArenaRosterRowView,
  ArenaRosterTeamView,
} from './roster-contract';

const TEAM_KEY_PREFIX = 'team:';

const proposalTypeLabel = (
  item: { type: string | null; source: string; access: string },
): string => (
  item.type ?? (item.source === 'preset' ? '内置预设' : item.access === 'stub' ? '房主本地角色' : '在线角色')
);

const inertModel: ArenaRosterSectionModel = {
  rows: [],
  teams: [],
  capabilities: {
    reorderRows: false,
    removeRows: false,
    editGuidance: false,
    ranking: false,
    addPlaceholders: false,
    clearRoster: false,
    createTeams: false,
    renameTeams: false,
    removeTeams: false,
    reorderTeams: false,
    assignTeamMembers: false,
    reorderTeamMembers: false,
    collapseTeams: false,
  },
  disabled: true,
  combatantCountLabel: '0',
  combatantCapReached: true,
  actions: {
    moveRow: () => undefined,
    removeRow: () => undefined,
    setGuidance: () => undefined,
    addPlaceholder: () => undefined,
    clearRoster: () => undefined,
    createTeam: () => '',
    renameTeam: () => undefined,
    removeTeam: () => undefined,
    moveTeam: () => undefined,
    assignCombatant: () => undefined,
    moveTeamMember: () => undefined,
    toggleTeamCollapsed: () => undefined,
  },
};

/**
 * Proposal roster/分队 adapter：从 RoomProposalArenaEditorSession 归一化视图
 * 构建共享 ArenaRosterSection 模型；所有写路径经由 editor.update 的 typed 校验。
 */
export const useProposalRosterSectionModel = (input: {
  disabled: boolean;
  onActionError(message: string): void;
}): ArenaRosterSectionModel => {
  const session = useArenaEditorSession();
  const state = useArenaEditorSelector((value) => value);
  const [collapsedTeams, setCollapsedTeams] = useState<ReadonlySet<string>>(new Set());
  const { disabled, onActionError } = input;

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

    const rows: readonly ArenaRosterRowView[] = state.combatants.map((item, index) => Object.freeze({
      key: item.key,
      displayName: item.name,
      typeLabel: proposalTypeLabel(item),
      guidance: item.characterGuidance,
      index,
      teamKey: item.teamKey,
      isPlaceholder: false,
    }));
    const teams: readonly ArenaRosterTeamView[] = state.teams.map((team) => Object.freeze({
      key: team.key,
      name: team.name,
      memberKeys: team.combatantKeys,
      collapsed: collapsedTeams.has(team.key),
    }));

    return {
      rows,
      teams,
      capabilities: {
        reorderRows: true,
        removeRows: true,
        editGuidance: true,
        ranking: false,
        addPlaceholders: false,
        clearRoster: false,
        createTeams: true,
        renameTeams: true,
        removeTeams: true,
        reorderTeams: true,
        assignTeamMembers: true,
        reorderTeamMembers: true,
        collapseTeams: true,
      },
      disabled,
      combatantCountLabel: `${state.combatants.length}/${MAX_COMBATANTS}`,
      combatantCapReached: state.combatants.length >= MAX_COMBATANTS,
      actions: {
        moveRow: (fromIndex, toIndex) => update((draft) => ({
          ...draft,
          combatants: moveItemInList(draft.combatants, fromIndex, toIndex),
        })),
        removeRow: (key) => update((draft) => ({
          ...draft,
          combatants: draft.combatants.filter((item) => item.key !== key),
          teams: draft.teams.map((team) => ({
            ...team,
            combatantKeys: team.combatantKeys.filter((item) => item !== key),
          })),
        })),
        setGuidance: (key, value) => update((draft) => ({
          ...draft,
          combatants: draft.combatants.map((item) => item.key === key
            ? { ...item, ...(value.trim() ? { characterGuidance: value } : { characterGuidance: undefined }) }
            : item),
        })),
        addPlaceholder: () => undefined,
        clearRoster: () => undefined,
        createTeam: () => {
          const key = `${TEAM_KEY_PREFIX}${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
          const displayName = `分队 ${state.teams.length + 1}`;
          update((draft) => ({
            ...draft,
            teams: [...draft.teams, { key, displayName, combatantKeys: [] }],
          }));
          return key;
        },
        renameTeam: (key, name) => {
          const trimmed = name.trim();
          if (!trimmed) return;
          update((draft) => ({
            ...draft,
            teams: draft.teams.map((item) => item.key === key ? { ...item, displayName: trimmed } : item),
          }));
        },
        removeTeam: (key) => update((draft) => ({
          ...draft,
          teams: draft.teams.filter((item) => item.key !== key),
        })),
        moveTeam: (key, direction) => update((draft) => {
          const index = draft.teams.findIndex((item) => item.key === key);
          if (index < 0) return draft;
          return { ...draft, teams: moveItemInList(draft.teams, index, index + direction) };
        }),
        assignCombatant: (combatantKey, teamKey) => update((draft) => ({
          ...draft,
          teams: draft.teams.map((team) => ({
            ...team,
            combatantKeys: team.key === teamKey
              ? [...team.combatantKeys.filter((item) => item !== combatantKey), combatantKey]
              : team.combatantKeys.filter((item) => item !== combatantKey),
          })),
        })),
        moveTeamMember: (teamKey, fromIndex, toIndex) => update((draft) => ({
          ...draft,
          teams: draft.teams.map((team) => team.key === teamKey
            ? { ...team, combatantKeys: moveItemInList(team.combatantKeys, fromIndex, toIndex) }
            : team),
        })),
        toggleTeamCollapsed: (key) => setCollapsedTeams((current) => {
          const next = new Set(current);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        }),
      },
    };
  }, [session, state, collapsedTeams, disabled, onActionError]);
};
