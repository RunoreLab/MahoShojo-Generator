// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArenaProposal } from '@mahoshojo/contracts/arena-room';

import { ArenaProposalPanel } from '@/components/arena/multiplayer/ArenaProposalPanel';
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
  discard: vi.fn(),
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

  it('member 只能撤回 projected 自己的 pending Proposal', async () => {
    const controller = createController();
    await act(async () => root.render(
      <ArenaProposalPanel state={stateFor(member, [proposal])} controller={controller} workspace={createWorkspace()} />,
    ));
    await act(async () => button('撤回 Proposal').click());
    expect(controller.withdrawProposal).toHaveBeenCalledWith('proposal-atomic');
    expect(container.textContent).not.toContain('接受所选');
  });

  it('host per-change 选择缺失 atomic closure 时禁用接受，完整选择后提交 revision fence', async () => {
    const controller = createController();
    await act(async () => root.render(
      <ArenaProposalPanel state={stateFor(host, [proposal])} controller={controller} workspace={createWorkspace()} />,
    ));
    const checkboxes = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(checkboxes).toHaveLength(2);
    await act(async () => checkboxes[1]!.click());
    expect(container.textContent).toContain('所选变更缺少依赖或拆分了原子组');
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
        expectedBase: { kind: 'value', value: 'zh-CN' },
      }],
    };
    await act(async () => root.render(
      <ArenaProposalPanel state={stateFor(host, [expanded])} controller={controller} workspace={createWorkspace()} />,
    ));
    expect(container.textContent).toContain('新增队伍 B 队');
    expect(container.textContent).toContain('移除队伍 team:a');
    expect(container.textContent).toContain('队伍 team:c 改名为 C 队新名');
    expect(container.textContent).toContain('语言改为 en-US');
  });
});
