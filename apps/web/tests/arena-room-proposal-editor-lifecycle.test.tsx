// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ArenaRoomGenerationHistoryResponse,
  ArenaRoomSessionResponse,
  ArenaRoomSharedConfig,
} from '@mahoshojo/contracts/arena-room';

import {
  useArenaRoom,
  type ArenaRoomRuntime,
} from '@/components/arena/multiplayer/useArenaRoom';
import type { ArenaRoomControllerState } from '@/lib/arena-room/controller';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const runtime = {
    state: null as ArenaRoomControllerState | null,
  };
  const controller = {
    getSnapshot: vi.fn(() => {
      if (!runtime.state) throw new Error('controller state missing');
      return runtime.state;
    }),
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    setAccess: vi.fn(),
    dispose: vi.fn(),
  };
  return {
    controller,
    getGenerationHistoryView: vi.fn(),
    hostWorkspace: { retainFor: vi.fn() },
    listGenerationHistory: vi.fn(),
    listeners,
    runtime,
  };
});

vi.mock('@/lib/arena-room/client', () => ({
  createArenaRoomClient: vi.fn(() => ({
    getGenerationHistoryView: mocks.getGenerationHistoryView,
    listGenerationHistory: mocks.listGenerationHistory,
  })),
}));

vi.mock('@/lib/arena-room/controller', () => ({
  createArenaRoomController: vi.fn(() => mocks.controller),
}));

vi.mock('@/lib/arena-room/host-workspace', () => ({
  arenaRoomHostWorkspaceAuthorityFromSession: vi.fn(() => null),
  createArenaRoomHostWorkspace: vi.fn(() => mocks.hostWorkspace),
}));

vi.mock('@/components/arena/multiplayer/useArenaRoomHostReconciliation', () => ({
  useArenaRoomHostReconciliation: vi.fn(() => null),
}));

vi.mock('@/components/arena/multiplayer/useArenaRoomNarrativeHistoryResultWriter', () => ({
  useArenaRoomNarrativeHistoryResultWriter: vi.fn(),
}));

const historySettings = () => ({
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
});

const config = (
  overrides: Partial<ArenaRoomSharedConfig> = {},
): ArenaRoomSharedConfig => ({
  battleMode: 'classic',
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
  historySettings: historySettings(),
  ...overrides,
});

const member = {
  userId: 'member-1',
  role: 'member' as const,
  displayName: '成员',
  membershipState: 'active' as const,
};

const host = {
  userId: 'host-1',
  role: 'host' as const,
  displayName: '房主',
  membershipState: 'active' as const,
};

const session = (
  overrides: Partial<{
    roomEpoch: string;
    revision: number;
    sharedConfig: ArenaRoomSharedConfig;
    self: typeof member | typeof host;
  }> = {},
): ArenaRoomSessionResponse => {
  const self = overrides.self ?? member;
  const roomEpoch = overrides.roomEpoch ?? 'epoch-1';
  return {
    protocolVersion: 1,
    roomId: 'room-1',
    roomEpoch,
    self,
    snapshot: {
      protocolVersion: 1,
      schemaVersion: 1,
      roomId: 'room-1',
      roomEpoch,
      revision: overrides.revision ?? 1,
      controlSeq: overrides.revision ?? 1,
      sharedConfig: overrides.sharedConfig ?? config(),
      members: self.role === 'host' ? [host] : [host, member],
      proposals: [],
      activeGeneration: null,
    },
  };
};

const stateWith = (roomSession: ArenaRoomSessionResponse | null): ArenaRoomControllerState => ({
  phase: roomSession ? 'connected' : 'ready',
  rooms: [],
  directoryNextCursor: null,
  directoryLoadingMore: false,
  session: roomSession,
  notice: null,
  error: null,
  unknownOperation: null,
  proposalOperation: null,
  proposalResultUnknown: false,
  configPublishPending: false,
  configPublishResultUnknown: false,
  managementOperation: null,
  managementResultUnknown: false,
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
    result: null,
  },
});

let container: HTMLDivElement;
let root: Root;
let latest: ArenaRoomRuntime | null;

const Harness = () => {
  latest = useArenaRoom({
    enabled: true,
    authenticated: true,
    origin: 'http://room.test',
  });
  return null;
};

const installState = async (next: ArenaRoomControllerState): Promise<void> => {
  mocks.runtime.state = next;
  await act(async () => {
    mocks.listeners.forEach((listener) => listener());
  });
};

beforeEach(() => {
  mocks.getGenerationHistoryView.mockReset();
  mocks.listGenerationHistory.mockReset();
  mocks.runtime.state = stateWith(null);
  mocks.listeners.clear();
  latest = null;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('useArenaRoom proposal editor lifecycle', () => {
  it('member 首次出现时自动创建 detached editor，后续仍使用 sync 语义', async () => {
    await act(async () => root.render(<Harness />));
    expect(latest?.proposalWorkspace.editor).toBeNull();

    await installState(stateWith(session({
      revision: 1,
      sharedConfig: config({ battleMode: 'daily' }),
    })));
    const editor = latest?.proposalWorkspace.editor;
    expect(editor).not.toBeNull();
    expect(editor?.store.getState()).toMatchObject({
      baselineEpoch: 'epoch-1',
      baselineRevision: 1,
      battleMode: 'daily',
      dirty: false,
      stale: false,
      replacementRequired: false,
    });

    await installState(stateWith(session({
      revision: 2,
      sharedConfig: config({ battleMode: 'kizuna' }),
    })));
    expect(latest?.proposalWorkspace.editor).toBe(editor);
    expect(editor?.store.getState()).toMatchObject({
      baselineRevision: 2,
      battleMode: 'kizuna',
      dirty: false,
      stale: false,
    });

    await act(async () => {
      editor?.store.getState().actions.setUserGuidance('成员草稿');
    });
    await installState(stateWith(session({
      revision: 3,
      sharedConfig: config({ battleMode: 'scenario', userGuidance: '房间新值' }),
    })));
    expect(latest?.proposalWorkspace.editor).toBe(editor);
    expect(editor?.store.getState()).toMatchObject({
      baselineRevision: 2,
      battleMode: 'kizuna',
      userGuidance: '成员草稿',
      dirty: true,
      stale: true,
      replacementRequired: false,
    });

    await installState(stateWith(session({
      roomEpoch: 'epoch-2',
      revision: 0,
      sharedConfig: config({ battleMode: 'classic' }),
    })));
    expect(latest?.proposalWorkspace.editor).toBe(editor);
    expect(editor?.store.getState()).toMatchObject({
      baselineEpoch: 'epoch-1',
      stale: true,
      replacementRequired: true,
    });
  });

  it('房间会话变化后拒绝迟到的历史战报列表', async () => {
    let resolveHistory!: (value: ArenaRoomGenerationHistoryResponse) => void;
    mocks.listGenerationHistory.mockReturnValue(new Promise((resolve) => {
      resolveHistory = resolve;
    }));
    await act(async () => root.render(<Harness />));
    await installState(stateWith(session()));

    const request = latest?.generationHistory.list();
    await installState(stateWith(null));
    resolveHistory({
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      items: [],
    });

    await expect(request).rejects.toThrow('房间会话已变化');
  });

  it('显式同步强制重建，且离开 member 生命周期或卸载时释放 editor', async () => {
    await act(async () => root.render(<Harness />));
    await installState(stateWith(session()));
    const automaticallyCreated = latest?.proposalWorkspace.editor;
    expect(automaticallyCreated).not.toBeNull();

    await act(async () => latest?.proposalWorkspace.syncFromRoom());
    const explicitlySynced = latest?.proposalWorkspace.editor;
    expect(explicitlySynced).not.toBe(automaticallyCreated);
    expect(automaticallyCreated?.store.getState().disposed).toBe(true);

    await installState(stateWith(null));
    expect(latest?.proposalWorkspace.editor).toBeNull();
    expect(explicitlySynced?.store.getState().disposed).toBe(true);

    await installState(stateWith(session()));
    const beforeRoleChange = latest?.proposalWorkspace.editor;
    expect(beforeRoleChange).not.toBeNull();
    await installState(stateWith(session({ self: host })));
    expect(latest?.proposalWorkspace.editor).toBeNull();
    expect(beforeRoleChange?.store.getState().disposed).toBe(true);

    await installState(stateWith(session()));
    const beforeUnmount = latest?.proposalWorkspace.editor;
    expect(beforeUnmount).not.toBeNull();
    await act(async () => root.unmount());
    expect(beforeUnmount?.store.getState().disposed).toBe(true);
  });
});
