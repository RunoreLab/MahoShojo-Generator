// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ArenaRoomSharedConfig } from '@mahoshojo/contracts/arena-room';
import type { ArenaRoomControllerState } from '@/lib/arena-room/controller';
import type { ArenaRoomHostReconciliationState } from '@/components/arena/multiplayer/useArenaRoomHostReconciliation';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  tryBuildWorkspaceBundle: vi.fn(),
  createCanonicalDraftBundle: vi.fn(),
  capturePublished: vi.fn(),
  close: vi.fn(async () => undefined),
  kickMember: vi.fn(async () => undefined),
  cancelGeneration: vi.fn(async () => undefined),
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
  listGenerationHistory: vi.fn(),
  readGenerationHistory: vi.fn(),
  state: null as ArenaRoomControllerState | null,
  reconciliationState: { kind: 'idle' } as ArenaRoomHostReconciliationState,
}));

vi.mock('@/components/arena/multiplayer/useArenaRoom', () => ({
  useArenaRoomContext: () => ({
    controller: {
      close: mocks.close,
      kickMember: mocks.kickMember,
      cancelGeneration: mocks.cancelGeneration,
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
      canAutoPublish: vi.fn(() => false),
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
    generationHistory: {
      list: mocks.listGenerationHistory,
      read: mocks.readGenerationHistory,
    },
  }),
}));

vi.mock('@/lib/arena-room/shared-config', () => ({
  tryBuildArenaRoomHostWorkspaceBundleFromBattleState: mocks.tryBuildWorkspaceBundle,
  createArenaRoomCanonicalEmptyDraftBundle: mocks.createCanonicalDraftBundle,
}));

vi.mock('@/components/arena/stores/useBattleStore', () => ({
  useBattleStore: { getState: vi.fn(() => ({ safe: 'battle-state' })) },
}));

import { ArenaMultiplayerContextPanel } from '@/components/arena/multiplayer/ArenaMultiplayerPanel';

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

const emptySharedConfig: ArenaRoomSharedConfig = {
  ...sharedConfig,
  combatants: [],
};

const connectedHostState = (config: ArenaRoomSharedConfig): ArenaRoomControllerState => {
  const host = {
    userId: 'host-1',
    role: 'host' as const,
    displayName: '测试玩家',
    membershipState: 'active' as const,
  };
  return {
    ...readyState,
    phase: 'connected',
    session: {
      protocolVersion: 1,
      roomId: 'room-created',
      roomEpoch: 'epoch-created',
      self: host,
      snapshot: {
        protocolVersion: 1,
        schemaVersion: 1,
        roomId: 'room-created',
        roomEpoch: 'epoch-created',
        revision: 0,
        controlSeq: 0,
        sharedConfig: config,
        members: [host],
        proposals: [],
        activeGeneration: null,
      },
    },
  };
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
  const match = [...document.body.querySelectorAll('button')]
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
  const bundle = {
    sharedConfig,
    hostLocalPayloads: [],
    hostLocalContentDigests: [],
  };
  mocks.tryBuildWorkspaceBundle.mockResolvedValue({ ok: true, bundle });
  mocks.createCanonicalDraftBundle.mockReturnValue({
    ...bundle,
    sharedConfig: emptySharedConfig,
  });
  mocks.listGenerationHistory.mockResolvedValue({
    protocolVersion: 1,
    roomId: 'room-created',
    roomEpoch: 'epoch-created',
    items: [{
      generationId: 'generation-history-1',
      state: 'completed',
      configRevision: 0,
      collaborativeInfluence: false,
      startedAt: '2026-09-02T00:00:00.000Z',
      finishedAt: '2026-09-02T00:03:00.000Z',
    }],
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<ArenaMultiplayerContextPanel {...props} />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('Arena multiplayer panel real React interactions', () => {
  it('未加入房间时只显示紧凑多人入口，不占用常驻说明区', async () => {
    const panel = container.querySelector<HTMLElement>('[data-arena-multiplayer="v1"]');
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute('data-arena-multiplayer-entry')).toBe('compact');
    expect(panel?.textContent).toContain('打开多人房间');
    expect(panel?.textContent).not.toContain('Arena 多人房间');
    expect(panel?.textContent).not.toContain('房间状态由服务器维护');
  });

  it('create 的安全映射窗口使用同步锁，双击只提交一个房间', async () => {
    await act(async () => button('打开多人房间').click());
    await act(async () => {
      button('创建多人房间').click();
      button('创建多人房间').click();
    });
    await flush();

    expect(mocks.tryBuildWorkspaceBundle).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it('空角色草稿直接创建房间，不进入降级或错误路径', async () => {
    mocks.tryBuildWorkspaceBundle.mockResolvedValueOnce({
      ok: true,
      bundle: {
        sharedConfig: emptySharedConfig,
        hostLocalPayloads: [],
        hostLocalContentDigests: [],
      },
    });
    mocks.create.mockImplementationOnce(async () => {
      mocks.state = connectedHostState(emptySharedConfig);
    });

    await act(async () => button('打开多人房间').click());
    await act(async () => button('创建多人房间').click());
    await flush();

    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      sharedConfig: expect.objectContaining({ combatants: [] }),
    }));
    expect(mocks.createCanonicalDraftBundle).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('当前本地配置尚未同步');
  });

  it('本地配置不可共享时仍以 canonical 空草稿创建，成功后列出所有问题', async () => {
    mocks.tryBuildWorkspaceBundle.mockResolvedValueOnce({
      ok: false,
      issues: [{
        code: 'ROOM_PAYLOAD_JSON_INVALID',
        target: 'combatants[0].data',
        message: '本地角色内容无法转换为 JSON。',
        action: '请重新导入该角色。',
      }, {
        code: 'ROOM_REFERENCE_VERSION_REQUIRED',
        target: 'materials[2]',
        message: '在线素材引用缺少版本信息。',
        action: '请刷新该在线素材。',
      }],
    });
    mocks.create.mockImplementationOnce(async () => {
      mocks.state = connectedHostState(emptySharedConfig);
    });

    await act(async () => button('打开多人房间').click());
    await act(async () => button('创建多人房间').click());
    await flush();
    await act(async () => root.render(<ArenaMultiplayerContextPanel {...props} />));

    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      sharedConfig: emptySharedConfig,
    }));
    expect(mocks.capturePublished).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: 'room-created' }),
      expect.objectContaining({ sharedConfig: emptySharedConfig }),
    );
    expect(container.textContent).toContain('房间已创建，但当前本地配置尚未同步');
    expect(container.textContent).toContain('本地角色内容无法转换为 JSON');
    expect(container.textContent).toContain('请重新导入该角色');
    expect(container.textContent).toContain('在线素材引用缺少版本信息');
    expect(container.textContent).toContain('请刷新该在线素材');
    expect(container.textContent).not.toContain('当前竞技场配置无法安全共享');
  });

  it('空草稿降级创建未取得房间权威时不误报创建成功', async () => {
    mocks.tryBuildWorkspaceBundle.mockResolvedValueOnce({
      ok: false,
      issues: [{
        code: 'ROOM_PAYLOAD_JSON_INVALID',
        target: 'combatants[0].data',
        message: '本地角色内容无法转换为 JSON。',
        action: '请重新导入该角色。',
      }],
    });
    mocks.create.mockImplementationOnce(async () => {
      mocks.state = { ...readyState, error: '房间服务暂不可用' };
    });

    await act(async () => button('打开多人房间').click());
    await act(async () => button('创建多人房间').click());
    await flush();
    await act(async () => root.render(<ArenaMultiplayerContextPanel {...props} />));

    expect(mocks.createCanonicalDraftBundle).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain('房间服务暂不可用');
    expect(container.textContent).not.toContain('房间已创建，但当前本地配置尚未同步');
  });

  it('创建或加入 pending notice 位于大厅 dialog 的可访问范围内', async () => {
    await act(async () => button('打开多人房间').click());
    mocks.state = {
      ...readyState,
      phase: 'connecting',
      notice: '正在创建房间…',
    };
    await act(async () => root.render(<ArenaMultiplayerContextPanel {...props} />));

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
    expect(dialog?.textContent).toContain('正在创建房间…');
    expect(dialog?.querySelector('[role="status"]')).not.toBeNull();
    expect([...document.body.querySelectorAll('[role="status"]')]
      .filter((status) => status.textContent?.includes('正在创建房间…'))).toHaveLength(1);
  });

  it('真实输入与点击连接 discover/join controller action', async () => {
    await act(async () => button('打开多人房间').click());
    const input = document.body.querySelector<HTMLInputElement>('#arena-room-join-code');
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
    await act(async () => root.render(<ArenaMultiplayerContextPanel {...props} />));
    await act(async () => button('打开多人房间').click());

    expect(container.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();
    expect(document.body.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();
    expect(document.body.querySelector('[aria-label="公开房间列表"]')?.className).toContain('max-h-64');
    await act(async () => button('加载更多').click());
    expect(mocks.discoverMore).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain('Development Gate');
  });

  it('房间 Modal 锁定键盘焦点，Escape 后恢复到触发按钮', async () => {
    const trigger = button('打开多人房间');
    trigger.focus();
    await act(async () => trigger.click());

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
    expect(dialog).not.toBeNull();
    expect(container.contains(dialog)).toBe(false);
    expect(dialog?.parentElement?.parentElement).toBe(document.body);
    expect(document.activeElement?.textContent).toBe('关闭');
    expect(document.body.style.overflow).toBe('hidden');

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
      }));
    });
    expect(dialog?.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.textContent).not.toBe('关闭');

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe('');
  });

  it('unauthenticated/disabled 真实挂载不暴露 Room action', async () => {
    mocks.state = { ...readyState, phase: 'unauthenticated' };
    await act(async () => root.render(<ArenaMultiplayerContextPanel {...props} isAuthenticated={false} />));
    expect(container.textContent).toContain('多人房间需要登录后使用');
    expect(container.querySelectorAll('button')).toHaveLength(0);

    mocks.state = { ...readyState, phase: 'disabled' };
    await act(async () => root.render(<ArenaMultiplayerContextPanel {...props} enabled={false} />));
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
    await act(async () => root.render(<ArenaMultiplayerContextPanel {...props} />));
    expect(document.body.querySelector('#arena-room-proposals-dialog-heading')).toBeNull();
    await act(async () => button('提案').click());
    expect(document.body.querySelector('#arena-room-proposals-dialog-heading')).not.toBeNull();
    expect(document.body.textContent).toContain('配置提案');
    expect(document.body.textContent).toContain('同步房间配置');
    expect(document.body.textContent).not.toContain('Proposal 审阅箱');
  });

  it('connected 房间成员可从全屏 dialog 打开历史战报列表', async () => {
    mocks.state = connectedHostState(sharedConfig);
    await act(async () => root.render(<ArenaMultiplayerContextPanel {...props} />));

    await act(async () => button('历史战报').click());
    await flush();

    expect(document.body.querySelector('#arena-room-generation-history-dialog-heading')).not.toBeNull();
    expect(mocks.listGenerationHistory).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain('已完成 · 配置版本 0');
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
    await act(async () => root.render(<ArenaMultiplayerContextPanel {...props} />));
    await act(async () => button('重新确认配置发布').click());
    expect(mocks.reconnect).toHaveBeenCalledOnce();
  });

  it('host 通过成员/管理 Modal 执行 kick、cancel 与 close 的确认动作', async () => {
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
        self: host,
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
          activeGeneration: {
            generationRequestId: 'request-12345678',
            generationId: 'generation-1',
            attempt: 1,
            state: 'running',
            configRevision: 0,
            snapshotDigest: 'sha256:generation',
            collaborativeInfluence: true,
            participantUserIds: [1, 2],
            startedAt: '2026-08-31T00:00:00.000Z',
          },
        },
      },
    };
    await act(async () => root.render(<ArenaMultiplayerContextPanel {...props} />));

    await act(async () => button('成员').click());
    await act(async () => button('移除').click());
    expect(document.body.textContent).toContain('确定将“成员”移出当前房间吗');
    await act(async () => button('确认移除成员').click());
    expect(mocks.kickMember).toHaveBeenCalledWith('member-1');
    await act(async () => button('关闭').click());

    await act(async () => button('房间管理').click());
    await act(async () => button('停止当前生成').click());
    await act(async () => button('确认停止生成').click());
    expect(mocks.cancelGeneration).toHaveBeenCalledOnce();

    await act(async () => button('关闭房间').click());
    await act(async () => button('确认关闭房间').click());
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it('member 离开房间需要显式确认', async () => {
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
    await act(async () => root.render(<ArenaMultiplayerContextPanel {...props} />));

    await act(async () => button('房间管理 / 退出').click());
    await act(async () => button('离开房间').click());
    expect(mocks.leave).not.toHaveBeenCalled();
    await act(async () => button('确认离开房间').click());
    expect(mocks.leave).toHaveBeenCalledOnce();
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
    await act(async () => root.render(<ArenaMultiplayerContextPanel {...props} />));
    await act(async () => button('更新配置').click());
    await act(async () => button('更新房间配置').click());
    expect(mocks.publishLocal).toHaveBeenCalledOnce();

    mocks.reconciliationState = {
      kind: 'conflicted',
      revision: 3,
      reasons: ['shared-config'],
      roomConfig: { ...sharedConfig, battleMode: 'daily' },
      localConfig: sharedConfig,
    };
    await act(async () => root.render(<ArenaMultiplayerContextPanel {...props} />));
    expect(document.body.textContent).toContain('房间配置已更新，但本地 Arena 同时有未发布修改');
    await act(async () => button('查看差异').click());
    expect(document.body.querySelectorAll('[role="dialog"][aria-modal="true"]')).toHaveLength(1);
    const diffClose = document.body.querySelector<HTMLButtonElement>(
      '[aria-labelledby="arena-host-config-diff-heading"] button',
    );
    if (!diffClose) throw new Error('diff close button missing');
    await act(async () => diffClose.click());
    await act(async () => button('同步房间配置').click());
    await act(async () => button('保留本地修改并重新发布').click());
    expect(mocks.syncRoom).toHaveBeenCalledOnce();
    expect(mocks.publishLocal).toHaveBeenCalledTimes(2);
    for (const exposedTerm of [
      'Room authority',
      'working copy',
      'revision',
      'host-local',
      'safe Shared Config',
    ]) {
      expect(document.body.textContent).not.toContain(exposedTerm);
    }
  });
});
