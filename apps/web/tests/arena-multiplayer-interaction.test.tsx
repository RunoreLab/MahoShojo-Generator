// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ArenaRoomSharedConfig } from '@mahoshojo/contracts/arena-room';
import type { ArenaRoomControllerState } from '@/lib/arena-room/controller';
import type { ArenaRoomHostReconciliationState } from '@/components/arena/multiplayer/useArenaRoomHostReconciliation';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  buildWorkspaceBundle: vi.fn(),
  capturePublished: vi.fn(),
  close: vi.fn(async () => undefined),
  create: vi.fn(async () => undefined),
  discover: vi.fn(async () => undefined),
  discoverMore: vi.fn(async () => undefined),
  join: vi.fn(async () => undefined),
  leave: vi.fn(async () => undefined),
  submitProposal: vi.fn(async () => undefined),
  resolveProposal: vi.fn(async () => undefined),
  withdrawProposal: vi.fn(async () => undefined),
  publishConfig: vi.fn(async () => undefined),
  publishLocal: vi.fn(async () => undefined),
  syncRoom: vi.fn(async () => undefined),
  reconnect: vi.fn(),
  reset: vi.fn(),
  syncProposalWorkspace: vi.fn(),
  discardProposalWorkspace: vi.fn(),
  state: null as ArenaRoomControllerState | null,
  reconciliationState: { kind: 'idle' } as ArenaRoomHostReconciliationState,
}));

vi.mock('@/components/arena/multiplayer/useArenaRoom', () => ({
  useArenaRoom: () => ({
    controller: {
      close: mocks.close,
      create: mocks.create,
      discover: mocks.discover,
      discoverMore: mocks.discoverMore,
      join: mocks.join,
      leave: mocks.leave,
      submitProposal: mocks.submitProposal,
      resolveProposal: mocks.resolveProposal,
      withdrawProposal: mocks.withdrawProposal,
      publishConfig: mocks.publishConfig,
      getSnapshot: () => mocks.state,
      reconnect: mocks.reconnect,
      reset: mocks.reset,
    },
    state: mocks.state,
    hostWorkspace: {
      capturePublished: mocks.capturePublished,
      compare: vi.fn(),
      startFromRoom: vi.fn(),
      retainFor: vi.fn(),
      clear: vi.fn(),
    },
    hostReconciliation: {
      state: mocks.reconciliationState,
      publishLocal: mocks.publishLocal,
      syncRoom: mocks.syncRoom,
      dismiss: vi.fn(),
    },
    proposalWorkspace: {
      editor: null,
      syncFromRoom: mocks.syncProposalWorkspace,
      discard: mocks.discardProposalWorkspace,
    },
  }),
}));

vi.mock('@/lib/arena-room/shared-config', () => ({
  buildArenaRoomHostWorkspaceBundleFromBattleState: mocks.buildWorkspaceBundle,
}));

vi.mock('@/components/arena/stores/useBattleStore', () => ({
  useBattleStore: { getState: vi.fn(() => ({ safe: 'battle-state' })) },
}));

import { ArenaMultiplayerPanel } from '@/components/arena/multiplayer/ArenaMultiplayerPanel';

const readyState: ArenaRoomControllerState = {
  phase: 'ready',
  rooms: [],
  session: null,
  notice: null,
  error: null,
  unknownOperation: null,
  proposalOperation: null,
  proposalResultUnknown: false,
  configPublishPending: false,
  configPublishResultUnknown: false,
  generation: {
    mirror: null,
    phase: 'idle',
    status: null,
    authoritativeMarkdown: '',
    markdown: '',
    storyCursor: null,
    gap: null,
    finalAuthoritative: false,
    generationRecordId: null,
    errorCode: null,
    pendingRequestId: null,
    startResultUnknown: false,
  },
};

const sharedConfig: ArenaRoomSharedConfig = {
  battleMode: 'classic',
  combatants: [{
    key: 'host-local:character:1',
    displayName: '角色',
    type: 'magical-girl',
    source: 'host-local',
  }],
  teams: [],
  scenario: null,
  auxScenarios: [],
  materials: [],
  userGuidance: '',
  storyLength: 'default',
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

const props = {
  enabled: true,
  origin: 'http://127.0.0.1:8787',
  authLoading: false,
  isAuthenticated: true,
  displayName: '测试玩家',
};

let container: HTMLDivElement;
let root: Root;

const button = (label: string): HTMLButtonElement => {
  const match = [...container.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
};

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(async () => {
  mocks.state = readyState;
  mocks.reconciliationState = { kind: 'idle' };
  mocks.buildWorkspaceBundle.mockResolvedValue({
    sharedConfig,
    hostLocalPayloads: [],
    hostLocalContentDigests: [],
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<ArenaMultiplayerPanel {...props} />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('Arena multiplayer panel real React interactions', () => {
  it('create 的安全映射窗口使用同步锁，双击只提交一个房间', async () => {
    await act(async () => button('打开多人房间').click());
    await act(async () => {
      button('创建多人房间').click();
      button('创建多人房间').click();
    });
    await flush();

    expect(mocks.buildWorkspaceBundle).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it('真实输入与点击连接 discover/join controller action', async () => {
    await act(async () => button('打开多人房间').click());
    const input = container.querySelector<HTMLInputElement>('#arena-room-join-code');
    if (!input) throw new Error('join input missing');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, 'room-visible-1');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('加入房间').click());

    expect(mocks.discover).toHaveBeenCalledTimes(1);
    expect(mocks.join).toHaveBeenCalledWith('room-visible-1', '测试玩家');
  });

  it('公开房间 Modal 有界展示 cursor 第二页入口', async () => {
    mocks.state = {
      ...readyState,
      rooms: [{
        roomId: 'room-page-1',
        title: '第一页房间',
        visibility: 'public',
        status: 'open',
        createdAt: '2026-08-28T00:00:00.000Z',
        lastActivityAt: '2026-08-28T00:01:00.000Z',
      }],
      directoryNextCursor: 'cursor-page-2',
      directoryLoadingMore: false,
    };
    await act(async () => root.render(<ArenaMultiplayerPanel {...props} />));
    await act(async () => button('打开多人房间').click());

    expect(container.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="公开房间列表"]')?.className).toContain('max-h-64');
    await act(async () => button('加载更多').click());
    expect(mocks.discoverMore).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain('Development Gate');
  });

  it('unauthenticated/disabled 真实挂载不暴露 Room action', async () => {
    mocks.state = { ...readyState, phase: 'unauthenticated' };
    await act(async () => root.render(<ArenaMultiplayerPanel {...props} isAuthenticated={false} />));
    expect(container.textContent).toContain('多人房间需要登录后使用');
    expect(container.querySelectorAll('button')).toHaveLength(0);

    mocks.state = { ...readyState, phase: 'disabled' };
    await act(async () => root.render(<ArenaMultiplayerPanel {...props} enabled={false} />));
    expect(container.innerHTML).toBe('');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.discover).not.toHaveBeenCalled();
    expect(mocks.join).not.toHaveBeenCalled();
  });

  it('connected member 通过生产面板 wiring 获得 detached Proposal editor', async () => {
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
    mocks.state = {
      ...readyState,
      phase: 'connected',
      session: {
        protocolVersion: 1,
        roomId: 'room-1',
        roomEpoch: 'epoch-1',
        self: member,
        snapshot: {
          protocolVersion: 1,
          schemaVersion: 1,
          roomId: 'room-1',
          roomEpoch: 'epoch-1',
          revision: 0,
          controlSeq: 0,
          sharedConfig,
          members: [host, member],
          proposals: [],
          activeGeneration: null,
        },
      },
    };
    await act(async () => root.render(<ArenaMultiplayerPanel {...props} />));
    expect(container.textContent).toContain('配置提案');
    expect(container.textContent).toContain('同步房间配置');
    expect(container.textContent).not.toContain('Proposal 审阅箱');
  });

  it('config publish unknown 在 connected 状态提供主动权威对账入口', async () => {
    const host = {
      userId: 'host-1',
      role: 'host' as const,
      displayName: '房主',
      membershipState: 'active' as const,
    };
    mocks.state = {
      ...readyState,
      phase: 'connected',
      configPublishResultUnknown: true,
      session: {
        protocolVersion: 1,
        roomId: 'room-1',
        roomEpoch: 'epoch-1',
        self: host,
        snapshot: {
          protocolVersion: 1,
          schemaVersion: 1,
          roomId: 'room-1',
          roomEpoch: 'epoch-1',
          revision: 0,
          controlSeq: 0,
          sharedConfig,
          members: [host],
          proposals: [],
          activeGeneration: null,
        },
      },
    };
    await act(async () => root.render(<ArenaMultiplayerPanel {...props} />));
    await act(async () => button('重新确认配置发布').click());
    expect(mocks.reconnect).toHaveBeenCalledOnce();
  });

  it('host 通过显式动作发布本地 working copy，冲突时提供三种 reconciliation 入口', async () => {
    const host = {
      userId: 'host-1',
      role: 'host' as const,
      displayName: '房主',
      membershipState: 'active' as const,
    };
    mocks.state = {
      ...readyState,
      phase: 'connected',
      session: {
        protocolVersion: 1,
        roomId: 'room-1',
        roomEpoch: 'epoch-1',
        self: host,
        snapshot: {
          protocolVersion: 1,
          schemaVersion: 1,
          roomId: 'room-1',
          roomEpoch: 'epoch-1',
          revision: 2,
          controlSeq: 0,
          sharedConfig,
          members: [host],
          proposals: [],
          activeGeneration: null,
        },
      },
    };
    await act(async () => root.render(<ArenaMultiplayerPanel {...props} />));
    await act(async () => button('更新房间配置').click());
    expect(mocks.publishLocal).toHaveBeenCalledOnce();

    mocks.reconciliationState = {
      kind: 'conflicted',
      revision: 3,
      reasons: ['shared-config'],
      roomConfig: { ...sharedConfig, battleMode: 'daily' },
      localConfig: sharedConfig,
    };
    await act(async () => root.render(<ArenaMultiplayerPanel {...props} />));
    expect(container.textContent).toContain('房间配置已更新，但本地 Arena 同时有未发布修改');
    await act(async () => button('查看差异').click());
    expect(container.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();
    await act(async () => button('关闭').click());
    await act(async () => button('同步房间配置').click());
    await act(async () => button('保留本地修改并重新发布').click());
    expect(mocks.syncRoom).toHaveBeenCalledOnce();
    expect(mocks.publishLocal).toHaveBeenCalledTimes(2);
  });
});
