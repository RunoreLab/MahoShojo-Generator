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
import type { ArenaRoomHostWorkspace } from '@/lib/arena-room/host-workspace';

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

const bundle = (sharedConfig: ArenaRoomSharedConfig) => ({
  sharedConfig,
  hostLocalPayloads: [],
  hostLocalContentDigests: [],
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
  it('accepted authority 到达且 working clean 时自动同步并 capture 新 baseline', async () => {
    const capturePublished = vi.fn();
    const workspace = {
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

    await act(async () => root.render(<Harness state={currentState} workspace={workspace} />));
    currentState = stateAt(2, config('daily'));
    await act(async () => root.render(<Harness state={currentState} workspace={workspace} />));
    await flush();

    expect(workspace.compare).toHaveBeenCalledOnce();
    expect(mocks.applyAuthority).toHaveBeenCalledWith(config('daily'), expect.objectContaining({
      hostLocalPayloads: [],
    }));
    expect(capturePublished).toHaveBeenCalledOnce();
    expect(latest?.state).toMatchObject({
      kind: 'synced',
      revision: 2,
    });
  });

  it('accepted authority 到达且 working dirty 时进入 conflict，不覆盖任一方向', async () => {
    const workspace = {
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

    await act(async () => root.render(<Harness state={currentState} workspace={workspace} />));
    currentState = stateAt(2, config('daily'));
    await act(async () => root.render(<Harness state={currentState} workspace={workspace} />));
    await flush();

    expect(mocks.applyAuthority).not.toHaveBeenCalled();
    expect(workspace.capturePublished).not.toHaveBeenCalled();
    expect(latest?.state).toMatchObject({
      kind: 'conflicted',
      revision: 2,
      reasons: ['shared-config'],
    });
  });

  it('自动同步失败时返回稳定的 reconciliation code，不依赖文案判断', async () => {
    const workspace = {
      compare: vi.fn(),
      startFromRoom: vi.fn(),
      capturePublished: vi.fn(),
      retainFor: vi.fn(),
      clear: vi.fn(),
    } satisfies ArenaRoomHostWorkspace;
    mocks.buildBundle.mockRejectedValueOnce(new Error('本地草稿无法读取'));

    await act(async () => root.render(<Harness state={currentState} workspace={workspace} />));
    currentState = stateAt(2, config('daily'));
    await act(async () => root.render(<Harness state={currentState} workspace={workspace} />));
    await flush();

    expect(latest?.state).toMatchObject({
      kind: 'error',
      code: 'ROOM_GENERATION_RECONCILIATION_REQUIRED',
      message: '本地草稿无法读取',
    });
  });

  it('同步等待期间 authority 再次更新时废弃旧任务且不 capture 过期 baseline', async () => {
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
      compare: vi.fn()
        .mockReturnValueOnce({
          kind: 'clean',
          start: { sharedConfig: config('classic'), hostLocalPayloads: [] },
        })
        .mockReturnValueOnce({
          kind: 'dirty',
          reasons: ['shared-config'] as const,
          current: { sharedConfig: config('classic'), hostLocalPayloads: [] },
          room: { sharedConfig: config('classic'), hostLocalPayloads: [] },
        }),
      startFromRoom: vi.fn(() => ({ sharedConfig: config('daily'), hostLocalPayloads: [] })),
      capturePublished,
      retainFor: vi.fn(),
      clear: vi.fn(),
    } satisfies ArenaRoomHostWorkspace;
    mocks.buildBundle.mockResolvedValue(bundle(config('classic')));

    await act(async () => root.render(<Harness state={currentState} workspace={workspace} />));
    currentState = stateAt(2, config('daily'));
    await act(async () => root.render(<Harness state={currentState} workspace={workspace} />));
    await flush();
    expect(capturedCommitIf).toBeTypeOf('function');

    currentState = stateAt(3, config('scenario'));
    await act(async () => root.render(<Harness state={currentState} workspace={workspace} />));
    await flush();
    expect(capturedCommitIf?.()).toBe(false);

    releaseApply();
    await flush();

    expect(capturePublished).not.toHaveBeenCalled();
    expect(latest?.state).toMatchObject({
      kind: 'conflicted',
      revision: 3,
    });
  });
});
