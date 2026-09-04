// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArenaProposal } from '@mahoshojo/contracts/arena-room';

import { ArenaProposalPanel } from '@/components/arena/multiplayer/ArenaProposalPanel';
import { createRoomProposalArenaEditorSession } from '@/components/arena/editor';
import type {
  ArenaRoomController,
  ArenaRoomControllerState,
} from '@/lib/arena-room/controller';
import type { ArenaRoomProposalWorkspace } from '@/components/arena/multiplayer/useArenaRoom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const sharedConfig = {
  battleMode: 'classic' as const,
  combatants: [{
    key: 'data-card:character-1',
    ref: { id: 'character-1', kind: 'character' as const, versionToken: 'v1' },
  }],
  teams: [],
  scenario: null,
  auxScenarios: [],
  materials: [],
  userGuidance: '',
  storyLength: 'default' as const,
  customStoryLength: null,
  selectedLanguage: 'zh-CN',
  historySettings: {
    readArenaHistory: true,
    readArenaHistoryLimit: 3,
    isArenaHistoryUnlimited: false,
    writeArenaHistory: true,
    readCurrentState: true,
    writeCurrentState: true,
    readNarrativeHistory: false,
    readNarrativeHistoryLimit: 10,
    isNarrativeHistoryUnlimited: false,
    writeNarrativeHistory: false,
  },
};

const host = {
  userId: 'host-1',
  role: 'host' as const,
  displayName: '房主',
  membershipState: 'active' as const,
};

const member = {
  userId: 'member-1',
  role: 'member' as const,
  displayName: '成员',
  membershipState: 'active' as const,
};

const proposal = {
  proposalVersion: 1 as const,
  proposalId: 'proposal-atomic',
  roomId: 'room-1',
  authorUserId: member.userId,
  baseRevision: 0,
  status: 'submitted' as const,
  changes: [{
    changeId: 'mode',
    type: 'setBattleMode' as const,
    value: 'daily' as const,
    expectedBase: { kind: 'value' as const, value: 'classic' as const },
    atomicGroupId: 'group-1',
  }, {
    changeId: 'guidance',
    type: 'setUserGuidance' as const,
    value: '一起接受',
    expectedBase: { kind: 'value' as const, value: '' },
    atomicGroupId: 'group-1',
  }],
  createdAt: '2026-08-28T00:01:00.000Z',
};

const stateFor = (
  self: typeof host | typeof member,
  proposals: readonly ArenaProposal[] = [],
): ArenaRoomControllerState => ({
  phase: 'connected',
  rooms: [],
  notice: null,
  error: null,
  unknownOperation: null,
  proposalOperation: null,
  proposalResultUnknown: false,
  session: {
    protocolVersion: 1,
    roomId: 'room-1',
    roomEpoch: 'epoch-1',
    self,
    snapshot: {
      protocolVersion: 1,
      schemaVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      revision: 0,
      controlSeq: proposals.length,
      sharedConfig,
      members: [host, member],
      proposals: [...proposals],
      activeGeneration: null,
    },
  },
});

const createController = () => ({
  reconnect: vi.fn(),
  resolveProposal: vi.fn(async () => undefined),
  submitProposal: vi.fn(async () => undefined),
  withdrawProposal: vi.fn(async () => undefined),
}) satisfies Pick<
  ArenaRoomController,
  'reconnect' | 'resolveProposal' | 'submitProposal' | 'withdrawProposal'
>;

const createWorkspace = (): ArenaRoomProposalWorkspace => ({
  editor: null,
  syncFromRoom: vi.fn(),
});

let container: HTMLDivElement;
let root: Root;

const button = (label: string): HTMLButtonElement => {
  const target = [...container.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!(target instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return target;
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('Arena Proposal panel real React interactions', () => {
  it('member 同步入口只建立 detached workspace，不在 panel 内复制配置表单', async () => {
    const controller = createController();
    const workspace = createWorkspace();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await act(async () => root.render(
      <ArenaProposalPanel
        state={stateFor(member)}
        controller={controller}
        workspace={workspace}
      />,
    ));

    await act(async () => button('同步房间配置').click());

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(workspace.syncFromRoom).toHaveBeenCalledOnce();
    expect(controller.submitProposal).not.toHaveBeenCalled();
    expect(container.querySelector('#arena-proposal-user-guidance')).toBeNull();
    fetchSpy.mockRestore();
  });

  it('member 重新同步 dirty 草稿前需二次确认，且不提供会被自动重建的退出入口', async () => {
    const controller = createController();
    const memberState = stateFor(member);
    const editor = createRoomProposalArenaEditorSession(memberState.session!.snapshot);
    editor.update((draft) => ({ ...draft, userGuidance: '未提交草稿' }));
    const workspace: ArenaRoomProposalWorkspace = {
      editor,
      syncFromRoom: vi.fn(),
    };
    await act(async () => root.render(
      <ArenaProposalPanel
        state={memberState}
        controller={controller}
        workspace={workspace}
      />,
    ));

    expect(container.textContent).not.toContain('退出提案模式');
    await act(async () => button('丢弃草稿并重新同步').click());
    expect(workspace.syncFromRoom).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(container.textContent).toContain('未提交修改将被丢弃');

    await act(async () => button('确认丢弃并同步').click());
    expect(workspace.syncFromRoom).toHaveBeenCalledOnce();
    editor.dispose();
  });

  it('member 只能撤回 projected 自己的 pending Proposal', async () => {
    const controller = createController();
    await act(async () => root.render(
      <ArenaProposalPanel state={stateFor(member, [proposal])} controller={controller} workspace={createWorkspace()} />,
    ));
    await act(async () => button('撤回提案').click());
    expect(controller.withdrawProposal).toHaveBeenCalledWith('proposal-atomic');
    expect(container.textContent).not.toContain('接受所选');
  });

  it('host per-change 选择缺失 atomic closure 时禁用接受，完整选择后提交 revision fence', async () => {
    const controller = createController();
    await act(async () => root.render(
      <ArenaProposalPanel state={stateFor(host, [proposal])} controller={controller} workspace={createWorkspace()} />,
    ));
    expect(container.textContent).toContain('待处理提案 (1)');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    const checkboxes = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(checkboxes).toHaveLength(2);
    await act(async () => checkboxes[1]!.click());
    expect(container.textContent).toContain('所选变更缺少依赖或拆分了联动变更组');
    expect(button('接受所选').disabled).toBe(true);
    expect(controller.resolveProposal).not.toHaveBeenCalled();

    await act(async () => checkboxes[1]!.click());
    await act(async () => {
      button('接受所选').click();
      button('接受所选').click();
      await Promise.resolve();
    });
    expect(controller.resolveProposal).toHaveBeenCalledOnce();
    expect(controller.resolveProposal).toHaveBeenCalledWith('proposal-atomic', {
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 0,
      resolution: 'accept-selected',
      selectedChangeIds: ['mode', 'guidance'],
    });
    vi.mocked(controller.resolveProposal).mockClear();
    await act(async () => button('拒绝全部').click());
    expect(controller.resolveProposal).toHaveBeenCalledWith('proposal-atomic', {
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 0,
      resolution: 'reject',
    });
  });

  it('host 审阅显示 language 与 team structure typed changes', async () => {
    const controller = createController();
    const expanded: ArenaProposal = {
      ...proposal,
      proposalId: 'proposal-expanded',
      changes: [{
        changeId: 'team-add',
        type: 'addTeam',
        teamKey: 'team:b',
        displayName: 'B 队',
        expectedBase: { kind: 'absent' },
      }, {
        changeId: 'team-remove',
        type: 'removeTeam',
        teamKey: 'team:a',
        expectedBase: {
          kind: 'present',
          ref: { key: 'team:a', displayName: 'A 队', combatantKeys: [] },
        },
      }, {
        changeId: 'team-rename',
        type: 'renameTeam',
        teamKey: 'team:c',
        value: 'C 队新名',
        expectedBase: { kind: 'value', value: 'C 队' },
      }, {
        changeId: 'language',
        type: 'setSelectedLanguage',
        value: 'en-US',
        expectedBase: { kind: 'value', value: 'ja-JP' },
      }, {
        changeId: 'combatant-order',
        type: 'reorderCombatants',
        value: ['data-card:character-2', 'data-card:character-1'],
        expectedBase: { kind: 'value', value: ['data-card:character-1', 'data-card:character-2'] },
      }, {
        changeId: 'team-order',
        type: 'reorderTeams',
        value: ['team:b', 'team:a'],
        expectedBase: { kind: 'value', value: ['team:a', 'team:b'] },
      }, {
        changeId: 'team-combatant-order',
        type: 'reorderTeamCombatants',
        teamKey: 'team:a',
        value: ['data-card:character-2', 'data-card:character-1'],
        expectedBase: { kind: 'value', value: ['data-card:character-1', 'data-card:character-2'] },
      }, {
        changeId: 'aux-order',
        type: 'reorderAuxScenarios',
        value: ['data-card:aux-2', 'data-card:aux-1'],
        expectedBase: { kind: 'value', value: ['data-card:aux-1', 'data-card:aux-2'] },
      }, {
        changeId: 'material-order',
        type: 'reorderMaterials',
        value: ['data-card:material-2', 'data-card:material-1'],
        expectedBase: { kind: 'value', value: ['data-card:material-1', 'data-card:material-2'] },
      }, {
        changeId: 'character-guidance',
        type: 'setCharacterGuidance',
        combatantKey: 'data-card:character-1',
        value: '保护后排并等待支援',
        expectedBase: { kind: 'value', value: null },
      }, {
        changeId: 'team-assignment',
        type: 'assignTeam',
        combatantKey: 'data-card:character-1',
        teamKey: 'team:b',
        expectedBase: { kind: 'value', value: null },
      }, {
        changeId: 'history-settings',
        type: 'setHistorySettings',
        value: {
          ...sharedConfig.historySettings,
          readNarrativeHistory: true,
          readNarrativeHistoryLimit: 7,
        },
        expectedBase: { kind: 'value', value: sharedConfig.historySettings },
      }],
    };
    await act(async () => root.render(
      <ArenaProposalPanel state={stateFor(host, [expanded])} controller={controller} workspace={createWorkspace()} />,
    ));
    expect(container.textContent).toContain('待处理提案 (1)');
    expect(container.textContent).toContain('成员');
    expect(container.textContent).toContain('提案基准：');
    expect(container.textContent).toContain('当前房间值：');
    expect(container.textContent).toContain('建议值：');
    // 真冲突（当前值既不等于基准也不等于提案值）仍会红字提示并给出操作指引。
    expect(container.textContent).toContain('该目标的当前值已与提案基准不一致');
    expect(container.textContent).toContain('可取消勾选该项，其余变更仍可接受');
    // 当前房间没有 team:a：移除目标已被满足，显示为安全跳过而非冲突。
    expect(container.textContent).toContain('已由其他修改满足');
    expect(container.querySelector('[data-change-outcome="satisfied"]')).not.toBeNull();
    expect(container.querySelector('[data-conflict-code]')).not.toBeNull();
    expect(container.textContent).toContain('新增队伍 B 队');
    expect(container.textContent).toContain('移除队伍 team:a');
    expect(container.textContent).toContain('队伍 team:c 改名为 C 队新名');
    expect(container.textContent).toContain('语言改为 en-US');
    expect(container.textContent).toContain('调整角色顺序');
    expect(container.textContent).toContain('调整队伍顺序');
    expect(container.textContent).toContain('调整队伍 team:a 内角色顺序');
    expect(container.textContent).toContain('调整辅助情景顺序');
    expect(container.textContent).toContain('调整素材顺序');
    expect(container.textContent).toContain(
      '建议值：角色 data-card:character-1 引导改为“保护后排并等待支援”',
    );
    expect(container.textContent).toContain(
      '建议值：角色 data-card:character-1 分配至队伍 team:b',
    );
    expect(container.textContent).toContain('叙事历史 读取=开(7)、写入=关');
    for (const exposedTerm of [
      'Proposal',
      'typed diff',
      'BASE',
      'CURRENT',
      'PROPOSED',
      'same-target conflict',
      'revision',
      'incarnation',
    ]) {
      expect(container.textContent).not.toContain(exposedTerm);
    }
  });
});
