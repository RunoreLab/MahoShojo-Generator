// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ArenaRoomSharedConfig } from '@mahoshojo/contracts/arena-room';

import {
  useArenaRoomHostReconciliation,
  type ArenaRoomHostReconciliation,
} from '@/components/arena/multiplayer/useArenaRoomHostReconciliation';
import type {
  ArenaRoomController,
  ArenaRoomControllerState,
} from '@/lib/arena-room/controller';
import type {
  ArenaRoomHostWorkspace,
  ArenaRoomHostWorkspaceAuthority,
} from '@/lib/arena-room/host-workspace';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  applyAuthority: vi.fn(async (
    _config: unknown,
    options: { readonly commitIf?: () => boolean },
  ) => {
    if (options.commitIf && !options.commitIf()) {
      throw new Error('房间配置同步期间状态已变化，未覆盖新的本地修改');
    }
  }),
  buildBundle: vi.fn(),
}));

vi.mock('@/lib/arena-room/host-reconciliation', () => ({
  applyArenaRoomAuthorityToBattleStore: mocks.applyAuthority,
}));

vi.mock('@/lib/arena-room/shared-config', () => ({
  buildArenaRoomHostWorkspaceBundleFromBattleState: mocks.buildBundle,
}));

const config = (battleMode: ArenaRoomSharedConfig['battleMode']): ArenaRoomSharedConfig => ({
  battleMode,
  combatants: [{
    key: 'data-card:character-1',
    ref: { id: 'character-1', kind: 'character', versionToken: 'v1' },
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
});

const host = {
  userId: 'host-1',
  role: 'host' as const,
  displayName: '房主',
  membershipState: 'active' as const,
};

const stateAt = (revision: number, sharedConfig: ArenaRoomSharedConfig): ArenaRoomControllerState => ({
  phase: 'connected',
  rooms: [],
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
      revision,
      controlSeq: revision,
      sharedConfig,
      members: [host],
      proposals: [],
      activeGeneration: null,
    },
  },
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
});

/** 模拟 proposal.resolved：同 revision、新 session 对象，仅 controlSeq/proposals 变化。 */
const withControlEventAtSameRevision = (
  state: ArenaRoomControllerState,
  controlSeq: number,
): ArenaRoomControllerState => ({
  ...state,
  session: state.session ? {
    ...state.session,
    snapshot: {
      ...state.session.snapshot,
      controlSeq,
      proposals: [{
        proposalVersion: 1,
        proposalId: `proposal-${controlSeq}`,
        roomId: state.session.roomId,
        authorUserId: 'member-1',
        baseRevision: state.session.snapshot.revision,
        status: 'submitted',
        changes: [],
        createdAt: '2026-09-04T00:00:00.000Z',
      }],
    },
  } : null,
});

const bundle = (sharedConfig: ArenaRoomSharedConfig) => ({
  sharedConfig,
  hostLocalPayloads: [],
  hostLocalContentDigests: [],
});

const authorityOf = (state: ArenaRoomControllerState): ArenaRoomHostWorkspaceAuthority => ({
  roomId: 'room-1',
  roomEpoch: 'epoch-1',
  revision: state.session!.snapshot.revision,
  ownerUserId: 'host-1',
  sharedConfig: state.session!.snapshot.sharedConfig,
});

let container: HTMLDivElement;
let root: Root;
let currentState: ArenaRoomControllerState;
let latest: ArenaRoomHostReconciliation | null;

const publishConfig = vi.fn(async () => undefined);
const controller = {
  getSnapshot: () => currentState,
  publishConfig,
} as unknown as ArenaRoomController;

const Harness = ({
  state,
  workspace,
}: {
  readonly state: ArenaRoomControllerState;
  readonly workspace: ArenaRoomHostWorkspace;
}) => {
  latest = useArenaRoomHostReconciliation({
    controller,
    controllerState: state,
    hostWorkspace: workspace,
  });
  return <span>{latest.state.kind}</span>;
};

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const renderState = async (state: ArenaRoomControllerState, workspace: ArenaRoomHostWorkspace) => {
  currentState = state;
  await act(async () => root.render(<Harness state={state} workspace={workspace} />));
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  currentState = stateAt(1, config('classic'));
  latest = null;
  vi.clearAllMocks();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('useArenaRoomHostReconciliation', () => {
  it('首次观察 authority 只记录，不自动覆盖本地', async () => {
    const workspace = {
      settledAuthority: vi.fn(() => null),
      compare: vi.fn(),
      startFromRoom: vi.fn(),
      capturePublished: vi.fn(),
      retainFor: vi.fn(),
      clear: vi.fn(),
    } satisfies ArenaRoomHostWorkspace;

    await renderState(currentState, workspace);
    await flush();

    expect(workspace.compare).not.toHaveBeenCalled();
    expect(mocks.applyAuthority).not.toHaveBeenCalled();
    expect(latest?.state).toMatchObject({ kind: 'idle' });
  });

  it('accepted authority 到达且相对 settled baseline clean 时自动同步并 capture 新 baseline', async () => {
    const settled = authorityOf(stateAt(1, config('classic')));
    const capturePublished = vi.fn();
    const workspace = {
      settledAuthority: vi.fn(() => settled),
      compare: vi.fn(() => ({ kind: 'clean', start: { sharedConfig: config('classic'), hostLocalPayloads: [] } })),
      startFromRoom: vi.fn(() => ({ sharedConfig: config('daily'), hostLocalPayloads: [] })),
      capturePublished,
      retainFor: vi.fn(),
      clear: vi.fn(),
    } satisfies ArenaRoomHostWorkspace;
    mocks.buildBundle
      .mockResolvedValueOnce(bundle(config('classic')))
      .mockResolvedValueOnce(bundle(config('classic')))
      .mockResolvedValueOnce(bundle(config('daily')));

    await renderState(currentState, workspace);
    await renderState(stateAt(2, config('daily')), workspace);
    await flush();

    expect(workspace.compare).toHaveBeenCalledOnce();
    expect(workspace.compare).toHaveBeenCalledWith(settled, expect.anything());
    expect(mocks.applyAuthority).toHaveBeenCalledWith(config('daily'), expect.objectContaining({
      hostLocalPayloads: [],
    }));
    expect(capturePublished).toHaveBeenCalledOnce();
    expect(latest?.state).toMatchObject({
      kind: 'synced',
      revision: 2,
    });
  });

  it('本地相对 settled baseline 有真实修改时进入 conflict，不覆盖任一方向', async () => {
    const settled = authorityOf(stateAt(1, config('classic')));
    const workspace = {
      settledAuthority: vi.fn(() => settled),
      compare: vi.fn(() => ({
        kind: 'dirty',
        reasons: ['shared-config'] as const,
        current: { sharedConfig: config('classic'), hostLocalPayloads: [] },
        room: { sharedConfig: config('classic'), hostLocalPayloads: [] },
      })),
      startFromRoom: vi.fn(),
      capturePublished: vi.fn(),
      retainFor: vi.fn(),
      clear: vi.fn(),
    } satisfies ArenaRoomHostWorkspace;
    mocks.buildBundle.mockResolvedValue(bundle(config('classic')));

    await renderState(currentState, workspace);
    await renderState(stateAt(2, config('daily')), workspace);
    await flush();

    expect(workspace.compare).toHaveBeenCalledWith(settled, expect.anything());
    expect(mocks.applyAuthority).not.toHaveBeenCalled();
    expect(workspace.capturePublished).not.toHaveBeenCalled();
    expect(latest?.state).toMatchObject({
      kind: 'conflicted',
      revision: 2,
      reasons: ['shared-config'],
    });
  });

  it('proposal.resolved 同 revision session 更新不取消进行中的物化（回归：永久 synchronizing）', async () => {
    const settled = authorityOf(stateAt(1, config('classic')));
    let releaseApply!: () => void;
    const applyPending = new Promise<void>((resolve) => {
      releaseApply = resolve;
    });
    let capturedCommitIf: (() => boolean) | undefined;
    mocks.applyAuthority.mockImplementationOnce(async (_config, options) => {
      capturedCommitIf = options.commitIf;
      await applyPending;
      if (options.commitIf && !options.commitIf()) {
        throw new Error('房间配置同步期间状态已变化，未覆盖新的本地修改');
      }
    });
    const capturePublished = vi.fn();
    const workspace = {
      settledAuthority: vi.fn(() => settled),
      compare: vi.fn(() => ({ kind: 'clean', start: { sharedConfig: config('classic'), hostLocalPayloads: [] } })),
      startFromRoom: vi.fn(() => ({ sharedConfig: config('daily'), hostLocalPayloads: [] })),
      capturePublished,
      retainFor: vi.fn(),
      clear: vi.fn(),
    } satisfies ArenaRoomHostWorkspace;
    mocks.buildBundle
      .mockResolvedValueOnce(bundle(config('classic')))
      .mockResolvedValueOnce(bundle(config('classic')))
      .mockResolvedValueOnce(bundle(config('daily')));

    const revision2 = stateAt(2, config('daily'));
    await renderState(currentState, workspace);
    await renderState(revision2, workspace);
    await flush();
    expect(capturedCommitIf).toBeTypeOf('function');

    // 服务端接受提案后会紧随 room.config.updated 发出 proposal.resolved：
    // session 对象替换，但 revision 不变，物化不得被取消。
    await renderState(withControlEventAtSameRevision(revision2, 3), workspace);
    await flush();
    expect(mocks.applyAuthority).toHaveBeenCalledOnce();

    releaseApply();
    await flush();

    expect(capturePublished).toHaveBeenCalledOnce();
    expect(latest?.state).toMatchObject({
      kind: 'synced',
      revision: 2,
    });
  });

  it('连续 authority revision 且房主无本地编辑时直接收敛到最新 revision，不产生伪冲突', async () => {
    const settled = authorityOf(stateAt(1, config('classic')));
    let releaseApply!: () => void;
    const applyPending = new Promise<void>((resolve) => {
      releaseApply = resolve;
    });
    let capturedCommitIf: (() => boolean) | undefined;
    mocks.applyAuthority.mockImplementationOnce(async (_config, options) => {
      capturedCommitIf = options.commitIf;
      await applyPending;
      if (options.commitIf && !options.commitIf()) {
        throw new Error('房间配置同步期间状态已变化，未覆盖新的本地修改');
      }
    });
    const capturePublished = vi.fn();
    const workspace = {
      settledAuthority: vi.fn(() => settled),
      compare: vi.fn(() => ({ kind: 'clean', start: { sharedConfig: config('classic'), hostLocalPayloads: [] } })),
      startFromRoom: vi.fn(() => ({ sharedConfig: config('scenario'), hostLocalPayloads: [] })),
      capturePublished,
      retainFor: vi.fn(),
      clear: vi.fn(),
    } satisfies ArenaRoomHostWorkspace;
    mocks.buildBundle
      .mockResolvedValueOnce(bundle(config('classic')))
      .mockResolvedValueOnce(bundle(config('classic')))
      .mockResolvedValueOnce(bundle(config('classic')))
      .mockResolvedValueOnce(bundle(config('classic')))
      .mockResolvedValueOnce(bundle(config('scenario')));

    await renderState(currentState, workspace);
    await renderState(stateAt(2, config('daily')), workspace);
    await flush();
    expect(capturedCommitIf).toBeTypeOf('function');

    await renderState(stateAt(3, config('scenario')), workspace);
    await flush();
    // rev2 的物化被废弃：commitIf 判定过期，不 capture 过期 baseline
    expect(capturedCommitIf?.()).toBe(false);

    releaseApply();
    await flush();

    expect(workspace.compare).toHaveBeenCalledTimes(2);
    expect(workspace.compare).toHaveBeenNthCalledWith(2, settled, expect.anything());
    expect(capturePublished).toHaveBeenCalledOnce();
    expect(capturePublished).toHaveBeenCalledWith(
      authorityOf(stateAt(3, config('scenario'))),
      expect.anything(),
    );
    expect(latest?.state).toMatchObject({
      kind: 'synced',
      revision: 3,
    });
  });

  it('无 settled 基线时退回与上一个观察 authority 比较的保守行为', async () => {
    const observedFirst = authorityOf(stateAt(1, config('classic')));
    const capturePublished = vi.fn();
    const workspace = {
      settledAuthority: vi.fn(() => null),
      compare: vi.fn(() => ({ kind: 'clean', start: { sharedConfig: config('classic'), hostLocalPayloads: [] } })),
      startFromRoom: vi.fn(() => ({ sharedConfig: config('daily'), hostLocalPayloads: [] })),
      capturePublished,
      retainFor: vi.fn(),
      clear: vi.fn(),
    } satisfies ArenaRoomHostWorkspace;
    mocks.buildBundle
      .mockResolvedValueOnce(bundle(config('classic')))
      .mockResolvedValueOnce(bundle(config('classic')))
      .mockResolvedValueOnce(bundle(config('daily')));

    await renderState(currentState, workspace);
    await renderState(stateAt(2, config('daily')), workspace);
    await flush();

    expect(workspace.compare).toHaveBeenCalledOnce();
    expect(workspace.compare).toHaveBeenCalledWith(observedFirst, expect.anything());
    expect(capturePublished).toHaveBeenCalledOnce();
    expect(latest?.state).toMatchObject({ kind: 'synced', revision: 2 });
  });

  it('自动同步失败时返回稳定的 reconciliation code，不依赖文案判断', async () => {
    const workspace = {
      settledAuthority: vi.fn(() => null),
      compare: vi.fn(),
      startFromRoom: vi.fn(),
      capturePublished: vi.fn(),
      retainFor: vi.fn(),
      clear: vi.fn(),
    } satisfies ArenaRoomHostWorkspace;
    mocks.buildBundle.mockRejectedValueOnce(new Error('本地草稿无法读取'));

    await renderState(currentState, workspace);
    await renderState(stateAt(2, config('daily')), workspace);
    await flush();

    expect(latest?.state).toMatchObject({
      kind: 'error',
      code: 'ROOM_GENERATION_RECONCILIATION_REQUIRED',
      message: '本地草稿无法读取',
    });
  });
});
