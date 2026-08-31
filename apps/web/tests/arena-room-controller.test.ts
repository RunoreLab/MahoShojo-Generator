import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ArenaRoomClientError,
  type ArenaRoomClient,
} from '@/lib/arena-room/client';
import {
  createArenaRoomController,
  type ArenaRoomSocket,
} from '@/lib/arena-room/controller';

const sharedConfig = {
  battleMode: 'classic' as const,
  combatants: [{
    key: 'host-local:character:1',
    displayName: '角色',
    type: 'magical-girl' as const,
    source: 'host-local' as const,
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

const snapshot = {
  protocolVersion: 1 as const,
  schemaVersion: 1 as const,
  roomId: 'room-1',
  roomEpoch: 'epoch-1',
  revision: 0,
  controlSeq: 0,
  sharedConfig,
  members: [{
    userId: 'user-host',
    role: 'host' as const,
    displayName: '房主',
    membershipState: 'active' as const,
  }],
  proposals: [],
  activeGeneration: null,
};

const session = {
  protocolVersion: 1 as const,
  roomId: snapshot.roomId,
  roomEpoch: snapshot.roomEpoch,
  self: snapshot.members[0]!,
  snapshot,
};

const generationMirror = {
  generationRequestId: 'request-12345678',
  generationId: 'generation-1',
  attempt: 1,
  state: 'running' as const,
  configRevision: 0,
  snapshotDigest: 'sha256:generation-snapshot',
  collaborativeInfluence: true,
  participantUserIds: [1],
  startedAt: '2026-08-28T00:01:00.000Z',
};

const generationView = {
  protocolVersion: 1 as const,
  roomId: 'room-1',
  roomEpoch: 'epoch-1',
  generation: generationMirror,
  status: 'running' as const,
  markdown: '权威基线',
  nextChunkSeq: 0,
  finalAuthoritative: false,
};

const generationResult = {
  version: 1 as const,
  format: 'stream-markdown' as const,
  mode: 'classic' as const,
  reporterInfo: { name: '安全记者', publication: '房间日报' },
  sharedGuidance: '保护车站',
  ai: {
    model: 'safe-model-name',
    usage: { promptTokens: 12, completionTokens: 34, totalTokens: 46 },
  },
  combatantUpdates: [{
    combatantKey: 'host-local:character:1',
    displayName: '角色',
    impact: '守住车站',
    currentStateSummary: '轻伤',
  }],
};

const generationStartRequest = {
  expectedRoomEpoch: 'epoch-1',
  expectedRevision: 0,
  generationRequestId: 'request-12345678',
  sharedConfig,
  generation: {
    prompt: '完整生成请求',
    providerCredential: 'test-secret-canary',
  },
};

class FakeSocket implements ArenaRoomSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly send = vi.fn();
  readonly close = vi.fn();

  open() {
    this.onopen?.();
  }

  message(data: unknown) {
    this.onmessage?.({ data });
  }

  closed(code: number, reason = '') {
    this.onclose?.({ code, reason });
  }
}

const ticket = (value: string) => ({
  protocolVersion: 1 as const,
  ticket: value,
  expiresInSeconds: 45,
  websocket: {
    path: '/api/arena/rooms/v1/ws' as const,
    protocol: 'mahoshojo.arena-room.v1' as const,
  },
});

const createHarness = () => {
  let ticketIndex = 0;
  let createRequestIndex = 0;
  const client: ArenaRoomClient = {
    discover: vi.fn(async () => ({ items: [], nextCursor: null })),
    create: vi.fn(async () => session),
    join: vi.fn(async () => session),
    getSession: vi.fn(async () => session),
    issueTicket: vi.fn(async () => ticket(`ticket-${++ticketIndex}`)),
    leave: vi.fn(async () => ({ protocolVersion: 1, roomId: 'room-1', outcome: 'left' })),
    close: vi.fn(async () => ({ protocolVersion: 1, roomId: 'room-1', outcome: 'closed' })),
    kick: vi.fn(async () => session),
    submitProposal: vi.fn(async (roomId, request) => ({
      protocolVersion: 1,
      roomId,
      roomEpoch: 'epoch-1',
      controlSeq: 1,
      revision: 0,
      proposalId: request.proposalId,
      status: 'submitted' as const,
      result: 'applied' as const,
    })),
    resolveProposal: vi.fn(async (roomId, proposalId) => ({
      protocolVersion: 1,
      roomId,
      roomEpoch: 'epoch-1',
      controlSeq: 2,
      revision: 1,
      proposalId,
      status: 'accepted' as const,
      result: 'applied' as const,
    })),
    withdrawProposal: vi.fn(async (roomId, proposalId) => ({
      protocolVersion: 1,
      roomId,
      roomEpoch: 'epoch-1',
      controlSeq: 2,
      revision: 0,
      proposalId,
      status: 'withdrawn' as const,
      result: 'applied' as const,
    })),
    publishConfig: vi.fn(async () => session),
    startGeneration: vi.fn(async () => generationView),
    getGenerationView: vi.fn(async () => generationView),
    cancelGeneration: vi.fn(async () => generationView),
    buildWebSocketUrl: vi.fn((issued) => `wss://room.test/ws?ticket=${issued.ticket}`),
  };
  const sockets: FakeSocket[] = [];
  const queued: Array<() => void> = [];
  const controller = createArenaRoomController({
    client,
    createSocket: vi.fn((url, protocol) => {
      expect(url).toMatch(/^wss:\/\/room\.test\/ws\?ticket=ticket-/u);
      expect(protocol).toBe('mahoshojo.arena-room.v1');
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    }),
    initialAccess: { enabled: true, authenticated: true },
    maxReconnectAttempts: 2,
    reconnectDelayMs: () => 0,
    setTimer: (callback) => {
      queued.push(callback);
      return callback;
    },
    clearTimer: (handle) => {
      const index = queued.indexOf(handle as () => void);
      if (index >= 0) queued.splice(index, 1);
    },
    createRequestId: () => `create-request-${String(++createRequestIndex).padStart(4, '0')}`,
  });
  const runNextTimer = async () => {
    queued.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { client, controller, queued, runNextTimer, sockets };
};

describe('Arena Room browser controller', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('disabled/unauthenticated 状态不发任何 Room 请求', async () => {
    const { client, controller } = createHarness();
    controller.setAccess({ enabled: false, authenticated: true });
    await controller.discover();
    controller.setAccess({ enabled: true, authenticated: false });
    await controller.discover();

    expect(client.discover).not.toHaveBeenCalled();
    expect(client.issueTicket).not.toHaveBeenCalled();
    expect(controller.getSnapshot().phase).toBe('unauthenticated');
  });

  it('公开房间发现保留 cursor，加载第二页时有界追加并去重', async () => {
    const { client, controller } = createHarness();
    const room = (roomId: string) => ({
      roomId,
      title: `房间 ${roomId}`,
      visibility: 'public' as const,
      status: 'open' as const,
      createdAt: '2026-08-28T00:00:00.000Z',
      lastActivityAt: '2026-08-28T00:01:00.000Z',
    });
    vi.mocked(client.discover)
      .mockResolvedValueOnce({ items: [room('room-1'), room('room-2')], nextCursor: 'cursor-page-2' })
      .mockResolvedValueOnce({ items: [room('room-2'), room('room-3')], nextCursor: null });

    await controller.discover();
    expect(client.discover).toHaveBeenNthCalledWith(1, { limit: 20 });
    expect(controller.getSnapshot()).toMatchObject({
      rooms: [room('room-1'), room('room-2')],
      directoryNextCursor: 'cursor-page-2',
      directoryLoadingMore: false,
    });

    await controller.discoverMore();
    expect(client.discover).toHaveBeenNthCalledWith(2, { limit: 20, cursor: 'cursor-page-2' });
    expect(controller.getSnapshot()).toMatchObject({
      rooms: [room('room-1'), room('room-2'), room('room-3')],
      directoryNextCursor: null,
      directoryLoadingMore: false,
    });

    await controller.discoverMore();
    expect(client.discover).toHaveBeenCalledTimes(2);
  });

  it('忽略 access/reset 后才返回的旧 HTTP 结果', async () => {
    const first = createHarness();
    let resolveCreate!: (value: typeof session) => void;
    vi.mocked(first.client.create).mockImplementation(() => new Promise((resolve) => {
      resolveCreate = resolve;
    }));
    const creating = first.controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });
    first.controller.setAccess({ enabled: true, authenticated: false });
    resolveCreate(session);
    await creating;

    expect(first.client.issueTicket).not.toHaveBeenCalled();
    expect(first.controller.getSnapshot()).toMatchObject({
      phase: 'unauthenticated',
      session: null,
    });

    const second = createHarness();
    const discoveredRoom = {
      roomId: 'room-stale',
      title: '过期结果',
      visibility: 'public' as const,
      status: 'open' as const,
      createdAt: '2026-08-28T00:00:00.000Z',
      lastActivityAt: '2026-08-28T00:01:00.000Z',
    };
    let resolveDiscovery!: (value: { items: [typeof discoveredRoom]; nextCursor: null }) => void;
    vi.mocked(second.client.discover).mockImplementation(() => new Promise((resolve) => {
      resolveDiscovery = resolve;
    }));
    const discovering = second.controller.discover();
    second.controller.reset();
    resolveDiscovery({ items: [discoveredRoom], nextCursor: null });
    await discovering;
    expect(second.controller.getSnapshot().phase).toBe('ready');
    expect(second.controller.getSnapshot().rooms).toEqual([]);
  });

  it('create 仅提交一次，按 session -> fresh ticket -> WSS 顺序连接', async () => {
    const { client, controller, sockets } = createHarness();
    await controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });

    expect(client.create).toHaveBeenCalledTimes(1);
    expect(client.issueTicket).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().phase).toBe('connecting');
    sockets[0]!.open();
    expect(controller.getSnapshot().phase).toBe('connected');
  });

  it('1013 重连只重取 ticket/cursor，绝不重放 create/join', async () => {
    const { client, controller, runNextTimer, sockets } = createHarness();
    await controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });
    sockets[0]!.open();
    sockets[0]!.message(JSON.stringify({
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq: 4,
      timestamp: '2026-08-28T00:04:00.000Z',
      type: 'room.snapshot',
      payload: { ...snapshot, controlSeq: 4 },
    }));
    sockets[0]!.closed(1013, 'try-again-later');
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'reconnecting',
      notice: '正在重新连接…',
    });
    await runNextTimer();

    expect(client.issueTicket).toHaveBeenCalledTimes(2);
    expect(client.issueTicket).toHaveBeenLastCalledWith('room-1', {
      reconnect: { control: { roomEpoch: 'epoch-1', controlSeq: 4 } },
    });
    expect(client.create).toHaveBeenCalledTimes(1);
    expect(client.join).not.toHaveBeenCalled();
    sockets[1]!.open();
    expect(controller.getSnapshot().phase).toBe('connected');
  });

  it('authoritative snapshot/member events 更新视图但不触发任何 generation/write', async () => {
    const { controller, sockets } = createHarness();
    await controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });
    sockets[0]!.open();
    sockets[0]!.message(JSON.stringify({
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq: 1,
      timestamp: '2026-08-28T00:01:00.000Z',
      type: 'room.member.joined',
      payload: {
        member: {
          userId: 'user-member',
          role: 'member',
          displayName: '成员',
          membershipState: 'active',
          joinedAt: '2026-08-28T00:01:00.000Z',
        },
      },
    }));

    expect(controller.getSnapshot().session?.snapshot.members).toHaveLength(2);
    expect(sockets[0]!.send).not.toHaveBeenCalled();
  });

  it('Proposal mutation 不打断 WSS lifecycle，并只由权威事件更新 snapshot', async () => {
    const { client, controller, sockets } = createHarness();
    await controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });
    sockets[0]!.open();
    const proposal = {
      proposalVersion: 1 as const,
      proposalId: 'proposal-1',
      roomId: 'room-1',
      authorUserId: 'user-member',
      baseRevision: 0,
      status: 'submitted' as const,
      changes: [{
        changeId: 'guidance-1',
        type: 'setUserGuidance' as const,
        value: '成员建议',
        expectedBase: { kind: 'value' as const, value: '' },
      }],
      createdAt: '2026-08-28T00:01:00.000Z',
    };
    sockets[0]!.message(JSON.stringify({
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq: 1,
      timestamp: '2026-08-28T00:01:00.000Z',
      type: 'proposal.submitted',
      payload: { proposal },
    }));
    expect(controller.getSnapshot().session?.snapshot.proposals).toEqual([proposal]);

    await controller.resolveProposal('proposal-1', {
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 0,
      resolution: 'reject',
    });
    expect(client.resolveProposal).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'connected',
      proposalOperation: null,
      proposalResultUnknown: false,
    });
    expect(sockets[0]!.close).not.toHaveBeenCalled();
    expect(controller.getSnapshot().session?.snapshot.proposals).toHaveLength(1);

    sockets[0]!.message(JSON.stringify({
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq: 2,
      timestamp: '2026-08-28T00:02:00.000Z',
      type: 'proposal.resolved',
      payload: { proposalId: 'proposal-1', status: 'rejected' },
    }));
    expect(controller.getSnapshot().session?.snapshot.proposals).toEqual([]);
  });

  it('Proposal 结果未知时冻结重复 mutation，等待 WSS/snapshot 对账', async () => {
    const { client, controller, sockets } = createHarness();
    const memberSession = {
      ...session,
      self: {
        userId: 'user-member',
        role: 'member' as const,
        displayName: '成员',
        membershipState: 'active' as const,
      },
      snapshot: {
        ...snapshot,
        members: [
          snapshot.members[0]!,
          {
            userId: 'user-member',
            role: 'member' as const,
            displayName: '成员',
            membershipState: 'active' as const,
          },
        ],
      },
    };
    vi.mocked(client.join).mockResolvedValueOnce(memberSession);
    let rejectMutation!: (error: unknown) => void;
    vi.mocked(client.submitProposal).mockImplementationOnce(() => new Promise((_, reject) => {
      rejectMutation = reject;
    }));
    await controller.join('room-1', '成员');
    sockets[0]!.open();
    const intent = {
      proposalId: 'proposal-stable',
      expectedRoomEpoch: 'epoch-1',
      baseRevision: 0,
      changes: [{
        changeId: 'guidance-1',
        type: 'setUserGuidance' as const,
        value: '成员建议',
        expectedBase: { kind: 'value' as const, value: '' },
      }],
    };
    const mutation = controller.submitProposal(intent);
    const proposal = {
      proposalVersion: 1 as const,
      proposalId: intent.proposalId,
      roomId: 'room-1',
      authorUserId: 'user-member',
      baseRevision: 0,
      status: 'submitted' as const,
      changes: intent.changes,
      createdAt: '2026-08-28T00:01:00.000Z',
    };
    sockets[0]!.message(JSON.stringify({
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq: 1,
      timestamp: '2026-08-28T00:01:00.000Z',
      type: 'proposal.submitted',
      payload: { proposal },
    }));
    rejectMutation(new ArenaRoomClientError(
      'ROOM_RESULT_UNKNOWN',
      503,
      '请求可能已提交，请先确认房间状态，不要重复提交',
    ));
    await mutation;
    await controller.submitProposal(intent);

    expect(client.submitProposal).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'connected',
      proposalOperation: null,
      proposalResultUnknown: true,
      notice: '请求可能已提交，请先确认房间状态，不要重复提交',
    });
    expect(sockets[0]!.close).not.toHaveBeenCalled();

    vi.mocked(client.getSession).mockResolvedValueOnce({
      ...memberSession,
      snapshot: {
        ...memberSession.snapshot,
        controlSeq: 1,
        proposals: [proposal],
      },
    });
    controller.reconnect();
    await vi.waitFor(() => expect(client.getSession).toHaveBeenCalledWith('room-1'));
    await vi.waitFor(() => expect(controller.getSnapshot()).toMatchObject({
      proposalResultUnknown: false,
      session: { snapshot: { controlSeq: 1, proposals: [{ proposalId: 'proposal-stable' }] } },
    }));
    expect(client.issueTicket).toHaveBeenCalledTimes(2);
  });

  it('config publish 重做 host/epoch/revision fence，并拒绝 stale intent', async () => {
    const { client, controller } = createHarness();
    await controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });

    await controller.publishConfig({
      expectedRoomEpoch: 'epoch-stale',
      expectedRevision: 0,
      sharedConfig: { ...sharedConfig, userGuidance: '不能发布' },
    });
    await controller.publishConfig({
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 7,
      sharedConfig: { ...sharedConfig, userGuidance: '仍不能发布' },
    });

    expect(client.publishConfig).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      configPublishPending: false,
      configPublishResultUnknown: false,
      notice: null,
      error: '房间配置已发生变化，请重新确认后再发布',
      session: { snapshot: { revision: 0, sharedConfig } },
    });
  });

  it('config publish single-flight 且不乐观递增 revision，只安装权威 response', async () => {
    const { client, controller } = createHarness();
    const desired = { ...sharedConfig, userGuidance: '显式发布' };
    const published = {
      ...session,
      snapshot: {
        ...snapshot,
        revision: 1,
        controlSeq: 1,
        sharedConfig: desired,
      },
    };
    let resolvePublish!: (value: typeof published) => void;
    vi.mocked(client.publishConfig).mockImplementationOnce(() => new Promise((resolve) => {
      resolvePublish = resolve;
    }));
    await controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });
    const request = {
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 0,
      sharedConfig: desired,
    };

    const first = controller.publishConfig(request);
    const concurrent = controller.publishConfig(request);
    expect(client.publishConfig).toHaveBeenCalledOnce();
    expect(client.publishConfig).toHaveBeenCalledWith('room-1', request);
    expect(controller.getSnapshot()).toMatchObject({
      configPublishPending: true,
      configPublishResultUnknown: false,
      session: { snapshot: { revision: 0, sharedConfig } },
    });

    resolvePublish(published);
    await Promise.all([first, concurrent]);
    expect(controller.getSnapshot()).toMatchObject({
      configPublishPending: false,
      configPublishResultUnknown: false,
      notice: '房间配置已更新',
      error: null,
      session: { snapshot: { revision: 1, controlSeq: 1, sharedConfig: desired } },
    });
  });

  it('config publish unknown 不伪造 revision，并由匹配的权威事件对账', async () => {
    const { client, controller, sockets } = createHarness();
    const desired = { ...sharedConfig, userGuidance: '结果未知' };
    vi.mocked(client.publishConfig).mockRejectedValueOnce(new ArenaRoomClientError(
      'ROOM_RESULT_UNKNOWN',
      503,
      '请求可能已提交，请先确认房间状态，不要重复提交',
    ));
    await controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });

    await controller.publishConfig({
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 0,
      sharedConfig: desired,
    });
    await controller.publishConfig({
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 0,
      sharedConfig: desired,
    });

    expect(client.publishConfig).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toMatchObject({
      configPublishPending: false,
      configPublishResultUnknown: true,
      notice: '请求可能已提交，请先确认房间状态，不要重复提交',
      error: null,
      session: { snapshot: { revision: 0, sharedConfig } },
    });

    sockets[0]!.message(JSON.stringify({
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq: 1,
      timestamp: '2026-08-31T00:02:00.000Z',
      type: 'room.config.updated',
      payload: { revision: 1, sharedConfig: desired },
    }));
    expect(controller.getSnapshot()).toMatchObject({
      configPublishResultUnknown: false,
      notice: '房间配置已更新',
      session: { snapshot: { revision: 1, sharedConfig: desired } },
    });
  });

  it('幂等 config publish 响应丢失且无事件时主动拉取权威 session 解锁', async () => {
    const { client, controller, sockets } = createHarness();
    vi.mocked(client.publishConfig).mockRejectedValueOnce(new ArenaRoomClientError(
      'ROOM_RESULT_UNKNOWN',
      503,
      '请求可能已提交，请先确认房间状态，不要重复提交',
    ));
    await controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });
    sockets[0]!.open();
    await controller.publishConfig({
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 0,
      sharedConfig,
    });
    expect(controller.getSnapshot().configPublishResultUnknown).toBe(true);

    vi.mocked(client.getSession).mockResolvedValueOnce(session);
    controller.reconnect();
    await vi.waitFor(() => expect(client.getSession).toHaveBeenCalledWith('room-1'));
    await vi.waitFor(() => expect(controller.getSnapshot()).toMatchObject({
      configPublishPending: false,
      configPublishResultUnknown: false,
      session: { roomEpoch: 'epoch-1', snapshot: { revision: 0, sharedConfig } },
    }));
    expect(client.issueTicket).toHaveBeenCalledTimes(2);
  });

  it('reset/dispose 使在途 config publish response 失效', async () => {
    for (const cleanup of ['reset', 'dispose'] as const) {
      const { client, controller } = createHarness();
      const desired = { ...sharedConfig, userGuidance: cleanup };
      const published = {
        ...session,
        snapshot: { ...snapshot, revision: 1, controlSeq: 1, sharedConfig: desired },
      };
      let resolvePublish!: (value: typeof published) => void;
      vi.mocked(client.publishConfig).mockImplementationOnce(() => new Promise((resolve) => {
        resolvePublish = resolve;
      }));
      await controller.create({
        displayName: '房主',
        directory: { title: '测试房', visibility: 'public' },
        sharedConfig,
      });
      const publishing = controller.publishConfig({
        expectedRoomEpoch: 'epoch-1',
        expectedRevision: 0,
        sharedConfig: desired,
      });

      controller[cleanup]();
      resolvePublish(published);
      await publishing;

      expect(controller.getSnapshot().session?.snapshot.revision ?? 0).toBe(0);
    }
  });

  it('Proposal unknown 只由同一 proposal 的权威事件解锁', async () => {
    const memberSession = {
      ...session,
      self: {
        userId: 'user-member',
        role: 'member' as const,
        displayName: '成员',
        membershipState: 'active' as const,
      },
      snapshot: {
        ...snapshot,
        members: [
          snapshot.members[0]!,
          {
            userId: 'user-member',
            role: 'member' as const,
            displayName: '成员',
            membershipState: 'active' as const,
          },
        ],
      },
    };
    const proposal = (proposalId: string) => ({
      proposalVersion: 1 as const,
      proposalId,
      roomId: 'room-1',
      authorUserId: 'user-member',
      baseRevision: 0,
      status: 'submitted' as const,
      changes: [{
        changeId: `${proposalId}-guidance`,
        type: 'setUserGuidance' as const,
        value: '成员建议',
        expectedBase: { kind: 'value' as const, value: '' },
      }],
      createdAt: '2026-08-28T00:01:00.000Z',
    });
    const unknown = () => new ArenaRoomClientError(
      'ROOM_RESULT_UNKNOWN',
      503,
      '请求可能已提交，请先确认房间状态，不要重复提交',
    );
    const submittedEvent = (proposalId: string, controlSeq: number) => JSON.stringify({
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq,
      timestamp: '2026-08-28T00:02:00.000Z',
      type: 'proposal.submitted',
      payload: { proposal: proposal(proposalId) },
    });
    const resolvedEvent = (
      proposalId: string,
      controlSeq: number,
      status: 'accepted' | 'withdrawn',
    ) => JSON.stringify({
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq,
      timestamp: '2026-08-28T00:03:00.000Z',
      type: 'proposal.resolved',
      payload: { proposalId, status },
    });

    const submit = createHarness();
    vi.mocked(submit.client.join).mockResolvedValueOnce(memberSession);
    vi.mocked(submit.client.submitProposal).mockRejectedValueOnce(unknown());
    await submit.controller.join('room-1', '成员');
    submit.sockets[0]!.open();
    await submit.controller.submitProposal({
      proposalId: 'proposal-submit-target',
      expectedRoomEpoch: 'epoch-1',
      baseRevision: 0,
      changes: proposal('proposal-submit-target').changes,
    });
    submit.sockets[0]!.message(submittedEvent('proposal-unrelated', 1));
    expect(submit.controller.getSnapshot().proposalResultUnknown).toBe(true);
    submit.sockets[0]!.message(submittedEvent('proposal-submit-target', 2));
    expect(submit.controller.getSnapshot().proposalResultUnknown).toBe(false);

    const resolve = createHarness();
    vi.mocked(resolve.client.resolveProposal).mockRejectedValueOnce(unknown());
    await resolve.controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });
    resolve.sockets[0]!.open();
    await resolve.controller.resolveProposal('proposal-resolve-target', {
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 0,
      resolution: 'reject',
    });
    resolve.sockets[0]!.message(submittedEvent('proposal-unrelated', 1));
    expect(resolve.controller.getSnapshot().proposalResultUnknown).toBe(true);
    resolve.sockets[0]!.message(resolvedEvent('proposal-resolve-target', 2, 'accepted'));
    expect(resolve.controller.getSnapshot().proposalResultUnknown).toBe(false);

    const withdraw = createHarness();
    vi.mocked(withdraw.client.join).mockResolvedValueOnce(memberSession);
    vi.mocked(withdraw.client.withdrawProposal).mockRejectedValueOnce(unknown());
    await withdraw.controller.join('room-1', '成员');
    withdraw.sockets[0]!.open();
    await withdraw.controller.withdrawProposal('proposal-withdraw-target');
    withdraw.sockets[0]!.message(resolvedEvent('proposal-unrelated', 1, 'withdrawn'));
    expect(withdraw.controller.getSnapshot().proposalResultUnknown).toBe(true);
    withdraw.sockets[0]!.message(resolvedEvent('proposal-withdraw-target', 2, 'withdrawn'));
    expect(withdraw.controller.getSnapshot().proposalResultUnknown).toBe(false);
  });

  it('忽略重复 control event，跳号时请求 reconnect/resync', async () => {
    const { client, controller, queued, sockets } = createHarness();
    await controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });
    sockets[0]!.open();
    const member = {
      userId: 'user-member',
      role: 'member' as const,
      displayName: '成员',
      membershipState: 'active' as const,
      joinedAt: '2026-08-28T00:01:00.000Z',
    };
    sockets[0]!.message(JSON.stringify({
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq: 1,
      timestamp: '2026-08-28T00:01:00.000Z',
      type: 'room.member.joined',
      payload: { member },
    }));
    sockets[0]!.message(JSON.stringify({
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq: 1,
      timestamp: '2026-08-28T00:02:00.000Z',
      type: 'room.member.joined',
      payload: { member: { ...member, displayName: '过期名称' } },
    }));
    expect(controller.getSnapshot().session?.snapshot.members[1]?.displayName).toBe('成员');

    sockets[0]!.message(JSON.stringify({
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq: 3,
      timestamp: '2026-08-28T00:03:00.000Z',
      type: 'room.member.joined',
      payload: { member: { ...member, displayName: '跳号名称' } },
    }));
    expect(controller.getSnapshot().phase).toBe('reconnecting');
    expect(controller.getSnapshot().session?.snapshot.controlSeq).toBe(1);
    expect(client.issueTicket).toHaveBeenCalledTimes(1);
    expect(queued).toHaveLength(1);
  });

  it('epoch replacement 使用 full snapshot 并明确提示重新同步', async () => {
    const { controller, sockets } = createHarness();
    await controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });
    sockets[0]!.open();
    const recovered = {
      ...snapshot,
      roomEpoch: 'epoch-2',
      controlSeq: 1,
    };
    sockets[0]!.message(JSON.stringify({
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-2',
      controlSeq: 1,
      timestamp: '2026-08-28T00:05:00.000Z',
      type: 'room.snapshot',
      payload: recovered,
    }));

    expect(controller.getSnapshot()).toMatchObject({
      notice: '房间已由服务器恢复，需要重新同步',
      session: { roomEpoch: 'epoch-2' },
    });
  });

  it('1008/reconnect 耗尽进入 replacement，且 dispose 清 timer/socket', async () => {
    const first = createHarness();
    await first.controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });
    first.sockets[0]!.open();
    first.sockets[0]!.closed(1008, 'membership-revoked');
    expect(first.controller.getSnapshot()).toMatchObject({
      phase: 'replacement',
      notice: '原房间无法恢复，请房主创建新房间',
    });

    const second = createHarness();
    vi.mocked(second.client.issueTicket).mockRejectedValue(
      new Error('runtime unavailable') as ArenaRoomClientError,
    );
    await second.controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });
    expect(second.controller.getSnapshot().phase).toBe('degraded');
    await second.runNextTimer();
    await second.runNextTimer();
    expect(second.controller.getSnapshot()).toMatchObject({
      phase: 'replacement',
      notice: '原房间无法恢复，请房主创建新房间',
    });
    second.controller.dispose();
    expect(second.queued).toHaveLength(0);
  });

  it('post-open 1013 不清零跨连接预算，重连最终有界熔断', async () => {
    const { client, controller, runNextTimer, sockets } = createHarness();
    await controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });
    sockets[0]!.open();
    sockets[0]!.closed(1013, 'authority-unavailable');
    await runNextTimer();
    sockets[1]!.open();
    sockets[1]!.closed(1013, 'authority-unavailable');
    await runNextTimer();
    sockets[2]!.open();
    sockets[2]!.closed(1013, 'authority-unavailable');

    expect(client.issueTicket).toHaveBeenCalledTimes(3);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'replacement',
      notice: '原房间无法恢复，请房主创建新房间',
    });
  });

  it('只有 host 显式 start；unknown 不自动 POST，显式 retry 复用内存中的同一完整请求', async () => {
    const host = createHarness();
    await host.controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });
    host.sockets[0]!.open();
    await host.controller.startGeneration(generationStartRequest);

    expect(host.client.startGeneration).toHaveBeenCalledOnce();
    expect(host.client.startGeneration).toHaveBeenCalledWith('room-1', generationStartRequest);
    expect(host.controller.getSnapshot().generation).toMatchObject({
      phase: 'running',
      mirror: generationMirror,
      status: 'running',
      markdown: '权威基线',
      finalAuthoritative: false,
      startResultUnknown: false,
    });
    expect(JSON.stringify(host.controller.getSnapshot())).not.toContain('test-secret-canary');

    const unknown = createHarness();
    vi.mocked(unknown.client.startGeneration).mockRejectedValueOnce(new ArenaRoomClientError(
      'ROOM_RESULT_UNKNOWN',
      503,
      '请求可能已提交，请先确认房间状态，不要重复提交',
    ));
    await unknown.controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });
    unknown.sockets[0]!.open();
    await unknown.controller.startGeneration(generationStartRequest);
    unknown.sockets[0]!.message(JSON.stringify({
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq: 1,
      timestamp: '2026-08-28T00:02:00.000Z',
      type: 'room.snapshot',
      payload: { ...snapshot, controlSeq: 1 },
    }));
    await unknown.controller.startGeneration(generationStartRequest);

    expect(unknown.client.startGeneration).toHaveBeenCalledOnce();
    expect(unknown.controller.getSnapshot().generation).toMatchObject({
      phase: 'unknown',
      pendingRequestId: 'request-12345678',
      startResultUnknown: true,
    });
    vi.mocked(unknown.client.startGeneration).mockResolvedValueOnce(generationView);
    await unknown.controller.retryGenerationStart();
    expect(unknown.client.startGeneration).toHaveBeenCalledTimes(2);
    expect(unknown.client.startGeneration).toHaveBeenLastCalledWith(
      'room-1',
      generationStartRequest,
    );
    expect(unknown.controller.getSnapshot().generation).toMatchObject({
      phase: 'running',
      startResultUnknown: false,
    });

    const member = createHarness();
    vi.mocked(member.client.join).mockResolvedValueOnce({
      ...session,
      self: {
        userId: 'user-member',
        role: 'member',
        displayName: '成员',
        membershipState: 'active',
      },
      snapshot: {
        ...snapshot,
        members: [
          snapshot.members[0]!,
          {
            userId: 'user-member',
            role: 'member',
            displayName: '成员',
            membershipState: 'active',
          },
        ],
      },
    });
    await member.controller.join('room-1', '成员');
    await member.controller.startGeneration(generationStartRequest);
    await member.controller.retryGenerationStart();
    expect(member.client.startGeneration).not.toHaveBeenCalled();
  });

  it('start response 不再把 request config/revision 伪装成已显式发布的权威状态', async () => {
    const host = createHarness();
    const pendingConfig = { ...sharedConfig, userGuidance: '最终房主配置' };
    vi.mocked(host.client.startGeneration).mockResolvedValueOnce({
      ...generationView,
      generation: { ...generationMirror, configRevision: 1 },
    });
    await host.controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });
    await host.controller.startGeneration({
      ...generationStartRequest,
      sharedConfig: pendingConfig,
    });
    expect(host.controller.getSnapshot().session?.snapshot).toMatchObject({
      revision: 0,
      sharedConfig,
      activeGeneration: { generationId: 'generation-1', configRevision: 1 },
    });
  });

  it('unknown 后 Room epoch 恢复时显式 retry 只重绑 epoch 并复用同一 intent/payload', async () => {
    const recovered = createHarness();
    vi.mocked(recovered.client.startGeneration).mockRejectedValueOnce(new ArenaRoomClientError(
      'ROOM_RESULT_UNKNOWN',
      503,
      '请求可能已提交，请先确认房间状态，不要重复提交',
    ));
    await recovered.controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });
    recovered.sockets[0]!.open();
    await recovered.controller.startGeneration(generationStartRequest);
    vi.mocked(recovered.client.getGenerationView).mockRejectedValueOnce(
      new Error('generation projection unavailable'),
    );
    recovered.sockets[0]!.message(JSON.stringify({
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-2',
      controlSeq: 2,
      timestamp: '2026-08-28T00:03:00.000Z',
      type: 'room.snapshot',
      payload: {
        ...snapshot,
        roomEpoch: 'epoch-2',
        controlSeq: 2,
        activeGeneration: { ...generationMirror, state: 'starting' },
      },
    }));
    await vi.waitFor(() => {
      expect(recovered.controller.getSnapshot().generation.phase).toBe('unavailable');
    });
    vi.mocked(recovered.client.startGeneration).mockResolvedValueOnce({
      ...generationView,
      roomEpoch: 'epoch-2',
      generation: { ...generationMirror, state: 'running' },
    });

    await recovered.controller.retryGenerationStart();

    expect(recovered.client.startGeneration).toHaveBeenCalledTimes(2);
    expect(recovered.client.startGeneration).toHaveBeenLastCalledWith('room-1', {
      ...generationStartRequest,
      expectedRoomEpoch: 'epoch-2',
    });
    expect(recovered.controller.getSnapshot().generation.phase).toBe('running');
  });

  it('story 仅接受 0-based contiguous chunk，忽略重复并在 gap 冻结后 single-flight GET', async () => {
    const { client, controller, sockets } = createHarness();
    let resolveRecovery!: (value: typeof generationView) => void;
    vi.mocked(client.getGenerationView).mockImplementation(() => new Promise((resolve) => {
      resolveRecovery = resolve;
    }));
    await controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });
    sockets[0]!.open();
    sockets[0]!.message(JSON.stringify({
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq: 1,
      timestamp: '2026-08-28T00:01:00.000Z',
      type: 'generation.started',
      payload: {
        generationRequestId: generationMirror.generationRequestId,
        generationId: generationMirror.generationId,
        attempt: generationMirror.attempt,
        configRevision: generationMirror.configRevision,
        snapshotDigest: generationMirror.snapshotDigest,
        collaborativeInfluence: generationMirror.collaborativeInfluence,
        participantUserIds: generationMirror.participantUserIds,
      },
    }));
    expect(client.getGenerationView).toHaveBeenCalledOnce();
    resolveRecovery({ ...generationView, markdown: '' });
    await vi.waitFor(() => expect(controller.getSnapshot().generation.phase).toBe('running'));
    const story = (chunkSeq: number, delta: string) => JSON.stringify({
      protocolVersion: 1,
      type: 'story.delta',
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      generationId: 'generation-1',
      chunkSeq,
      timestamp: '2026-08-28T00:02:00.000Z',
      payload: { delta },
    });
    sockets[0]!.message(story(0, 'A'));
    sockets[0]!.message(story(0, '重复'));
    sockets[0]!.message(story(1, 'B'));
    expect(controller.getSnapshot().generation).toMatchObject({
      markdown: 'AB',
      storyCursor: { generationId: 'generation-1', chunkSeq: 1 },
      gap: null,
    });

    sockets[0]!.message(story(3, '跳号'));
    sockets[0]!.message(story(4, '继续跳号'));
    sockets[0]!.message(JSON.stringify({
      protocolVersion: 1,
      type: 'room.resync.required',
      reason: 'replay-unavailable',
    }));
    expect(controller.getSnapshot().generation).toMatchObject({
      phase: 'resyncing',
      markdown: 'AB',
      gap: {
        generationId: 'generation-1',
        expectedChunkSeq: 2,
        receivedChunkSeq: 3,
      },
    });
    expect(client.getGenerationView).toHaveBeenCalledTimes(2);

    resolveRecovery({
      ...generationView,
      markdown: '权威全文',
      nextChunkSeq: 4,
    });
    await vi.waitFor(() => expect(controller.getSnapshot().generation).toMatchObject({
      phase: 'running',
      markdown: '权威全文',
      authoritativeMarkdown: '权威全文',
      storyCursor: { generationId: 'generation-1', chunkSeq: 3 },
      gap: null,
    }));
  });

  it('generation.started 立即读取权威基线，避免晚加入客户端从错误 chunk 起点拼接', async () => {
    const { client, controller, sockets } = createHarness();
    let resolveBaseline!: (value: typeof generationView) => void;
    vi.mocked(client.getGenerationView).mockImplementation(() => new Promise((resolve) => {
      resolveBaseline = resolve;
    }));
    await controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });
    sockets[0]!.open();
    sockets[0]!.message(JSON.stringify({
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq: 1,
      timestamp: '2026-08-28T00:01:00.000Z',
      type: 'generation.started',
      payload: {
        generationRequestId: generationMirror.generationRequestId,
        generationId: generationMirror.generationId,
        attempt: generationMirror.attempt,
        configRevision: generationMirror.configRevision,
        snapshotDigest: generationMirror.snapshotDigest,
        collaborativeInfluence: generationMirror.collaborativeInfluence,
        participantUserIds: generationMirror.participantUserIds,
      },
    }));

    expect(client.getGenerationView).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().generation.phase).toBe('resyncing');

    resolveBaseline({ ...generationView, markdown: '已生成基线', nextChunkSeq: 2 });
    await vi.waitFor(() => expect(controller.getSnapshot().generation).toMatchObject({
      phase: 'running',
      markdown: '已生成基线',
      storyCursor: { generationId: 'generation-1', chunkSeq: 1 },
    }));
  });

  it('terminal control 先更新 mirror，再由权威 GET 恢复最终 markdown', async () => {
    const { client, controller, sockets } = createHarness();
    let resolveRecovery!: (value: typeof generationView) => void;
    vi.mocked(client.getGenerationView).mockImplementation(() => new Promise((resolve) => {
      resolveRecovery = resolve;
    }));
    await controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });
    sockets[0]!.open();
    sockets[0]!.message(JSON.stringify({
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq: 1,
      timestamp: '2026-08-28T00:01:00.000Z',
      type: 'generation.started',
      payload: {
        generationRequestId: generationMirror.generationRequestId,
        generationId: generationMirror.generationId,
        attempt: generationMirror.attempt,
        configRevision: generationMirror.configRevision,
        snapshotDigest: generationMirror.snapshotDigest,
        collaborativeInfluence: generationMirror.collaborativeInfluence,
        participantUserIds: generationMirror.participantUserIds,
      },
    }));
    expect(client.getGenerationView).toHaveBeenCalledOnce();
    resolveRecovery(generationView);
    await vi.waitFor(() => expect(controller.getSnapshot().generation.phase).toBe('running'));
    sockets[0]!.message(JSON.stringify({
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq: 2,
      timestamp: '2026-08-28T00:03:00.000Z',
      type: 'generation.completed',
      payload: {
        generationRequestId: generationMirror.generationRequestId,
        generationId: generationMirror.generationId,
        attempt: generationMirror.attempt,
        configRevision: generationMirror.configRevision,
        snapshotDigest: generationMirror.snapshotDigest,
        collaborativeInfluence: generationMirror.collaborativeInfluence,
        participantUserIds: generationMirror.participantUserIds,
        generationRecordId: 'record-1',
      },
    }));

    expect(controller.getSnapshot().session?.snapshot.activeGeneration).toMatchObject({
      generationId: 'generation-1',
      state: 'completed',
    });
    expect(controller.getSnapshot().generation).toMatchObject({
      phase: 'resyncing',
      finalAuthoritative: false,
    });
    expect(client.getGenerationView).toHaveBeenCalledTimes(2);

    resolveRecovery({
      ...generationView,
      generation: {
        ...generationMirror,
        state: 'completed',
        finishedAt: '2026-08-28T00:03:00.000Z',
      },
      status: 'completed',
      markdown: '# 最终权威报告',
      nextChunkSeq: 2,
      finalAuthoritative: true,
      generationRecordId: 'record-1',
      result: generationResult,
    });
    await vi.waitFor(() => expect(controller.getSnapshot().generation).toMatchObject({
      phase: 'completed',
      status: 'completed',
      markdown: '# 最终权威报告',
      finalAuthoritative: true,
      generationRecordId: 'record-1',
      result: generationResult,
    }));
  });

  it('terminal 使同 attempt 的旧 GET 失效，并在 single-flight 后补一次权威终态 GET', async () => {
    const { client, controller, sockets } = createHarness();
    const recoveryResolvers: Array<(value: typeof generationView) => void> = [];
    vi.mocked(client.getGenerationView).mockImplementation(() => new Promise((resolve) => {
      recoveryResolvers.push(resolve);
    }));
    await controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });
    sockets[0]!.open();
    const payload = {
      generationRequestId: generationMirror.generationRequestId,
      generationId: generationMirror.generationId,
      attempt: generationMirror.attempt,
      configRevision: generationMirror.configRevision,
      snapshotDigest: generationMirror.snapshotDigest,
      collaborativeInfluence: generationMirror.collaborativeInfluence,
      participantUserIds: generationMirror.participantUserIds,
    };
    sockets[0]!.message(JSON.stringify({
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq: 1,
      timestamp: '2026-08-28T00:01:00.000Z',
      type: 'generation.started',
      payload,
    }));
    sockets[0]!.message(JSON.stringify({
      protocolVersion: 1,
      type: 'story.delta',
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      generationId: 'generation-1',
      chunkSeq: 2,
      timestamp: '2026-08-28T00:02:00.000Z',
      payload: { delta: '跳号' },
    }));
    expect(client.getGenerationView).toHaveBeenCalledOnce();

    sockets[0]!.message(JSON.stringify({
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq: 2,
      timestamp: '2026-08-28T00:03:00.000Z',
      type: 'generation.completed',
      payload: { ...payload, generationRecordId: 'record-1' },
    }));
    expect(client.getGenerationView).toHaveBeenCalledOnce();

    recoveryResolvers[0]!({
      ...generationView,
      markdown: '过期运行中基线',
      nextChunkSeq: 3,
    });
    await vi.waitFor(() => expect(client.getGenerationView).toHaveBeenCalledTimes(2));
    expect(controller.getSnapshot().generation.markdown).not.toBe('过期运行中基线');

    recoveryResolvers[1]!({
      ...generationView,
      generation: {
        ...generationMirror,
        state: 'completed',
        finishedAt: '2026-08-28T00:03:00.000Z',
      },
      status: 'completed',
      markdown: '# 最终权威报告',
      nextChunkSeq: 3,
      finalAuthoritative: true,
      generationRecordId: 'record-1',
    });
    await vi.waitFor(() => expect(controller.getSnapshot().generation).toMatchObject({
      phase: 'completed',
      markdown: '# 最终权威报告',
      finalAuthoritative: true,
    }));
  });

  it('generation GET 响应受 roomEpoch/generationId/dispose fence 约束', async () => {
    const { client, controller, sockets } = createHarness();
    const recoveryResolvers = new Map<string, (value: typeof generationView) => void>();
    vi.mocked(client.getGenerationView).mockImplementation((_roomId, generationId) => (
      new Promise((resolve) => recoveryResolvers.set(generationId, resolve))
    ));
    await controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });
    sockets[0]!.open();
    const payload = {
      generationRequestId: generationMirror.generationRequestId,
      generationId: generationMirror.generationId,
      attempt: generationMirror.attempt,
      configRevision: generationMirror.configRevision,
      snapshotDigest: generationMirror.snapshotDigest,
      collaborativeInfluence: generationMirror.collaborativeInfluence,
      participantUserIds: generationMirror.participantUserIds,
    };
    sockets[0]!.message(JSON.stringify({
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq: 1,
      timestamp: '2026-08-28T00:01:00.000Z',
      type: 'generation.started',
      payload,
    }));
    sockets[0]!.message(JSON.stringify({
      protocolVersion: 1,
      type: 'story.delta',
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      generationId: 'generation-1',
      chunkSeq: 2,
      timestamp: '2026-08-28T00:02:00.000Z',
      payload: { delta: '跳号' },
    }));

    const generation2 = {
      ...generationMirror,
      generationRequestId: 'request-87654321',
      generationId: 'generation-2',
      startedAt: '2026-08-28T00:04:00.000Z',
    };
    sockets[0]!.message(JSON.stringify({
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-2',
      controlSeq: 1,
      timestamp: '2026-08-28T00:04:00.000Z',
      type: 'room.snapshot',
      payload: {
        ...snapshot,
        roomEpoch: 'epoch-2',
        controlSeq: 1,
        activeGeneration: generation2,
      },
    }));
    expect(client.getGenerationView).toHaveBeenCalledTimes(2);

    recoveryResolvers.get('generation-1')!({
      ...generationView,
      markdown: '旧 epoch 不得覆盖',
    });
    await Promise.resolve();
    expect(controller.getSnapshot().generation).toMatchObject({
      mirror: { generationId: 'generation-2' },
      markdown: '',
    });

    controller.dispose();
    recoveryResolvers.get('generation-2')!({
      ...generationView,
      roomEpoch: 'epoch-2',
      generation: generation2,
      markdown: 'dispose 后不得写入',
    });
    await Promise.resolve();
    expect(controller.getSnapshot().generation).toMatchObject({
      mirror: { generationId: 'generation-2' },
      markdown: '',
    });
  });

  it('成员管理使用单飞锁并安装 kick 后的服务器权威 session', async () => {
    const { client, controller } = createHarness();
    const member = {
      userId: 'member-1',
      role: 'member' as const,
      displayName: '成员',
      membershipState: 'active' as const,
    };
    const withMember = {
      ...session,
      snapshot: { ...snapshot, members: [snapshot.members[0]!, member] },
    };
    vi.mocked(client.create).mockResolvedValueOnce(withMember);
    vi.mocked(client.kick).mockResolvedValueOnce({
      ...withMember,
      snapshot: {
        ...withMember.snapshot,
        members: [snapshot.members[0]!, { ...member, membershipState: 'revoked' as const }],
      },
    });
    await controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });

    await Promise.all([controller.kickMember('member-1'), controller.kickMember('member-1')]);

    expect(client.kick).toHaveBeenCalledOnce();
    expect(client.kick).toHaveBeenCalledWith('room-1', 'member-1', 'epoch-1');
    expect(controller.getSnapshot().managementOperation).toBeNull();
    expect(controller.getSnapshot().managementResultUnknown).toBe(false);
    expect(controller.getSnapshot().session?.snapshot.members.find(
      (candidate) => candidate.userId === 'member-1',
    )?.membershipState).toBe('revoked');
  });

  it('cancel accepted 但仍 running 时不声称已取消，并等待权威终态解除管理锁', async () => {
    const { client, controller, sockets } = createHarness();
    const generatingSession = {
      ...session,
      snapshot: { ...snapshot, activeGeneration: generationMirror },
    };
    vi.mocked(client.create).mockResolvedValueOnce(generatingSession);
    await controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });

    await Promise.all([controller.cancelGeneration(), controller.cancelGeneration()]);

    expect(client.cancelGeneration).toHaveBeenCalledOnce();
    expect(client.cancelGeneration).toHaveBeenCalledWith('room-1', 'generation-1', 'epoch-1');
    expect(controller.getSnapshot().managementOperation).toBe('cancel-generation');
    expect(controller.getSnapshot().notice).toContain('等待服务器权威终态');
    expect(controller.getSnapshot().notice).not.toContain('已取消');

    vi.mocked(client.getGenerationView).mockResolvedValueOnce({
      ...generationView,
      generation: {
        ...generationMirror,
        state: 'cancelled',
        finishedAt: '2026-08-28T00:03:00.000Z',
      },
      status: 'cancelled',
      finalAuthoritative: true,
    });
    sockets[0]!.message(JSON.stringify({
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq: 1,
      timestamp: '2026-08-28T00:03:00.000Z',
      type: 'generation.completed',
      payload: {
        generationRequestId: generationMirror.generationRequestId,
        generationId: generationMirror.generationId,
        attempt: generationMirror.attempt,
        configRevision: generationMirror.configRevision,
        snapshotDigest: generationMirror.snapshotDigest,
        collaborativeInfluence: generationMirror.collaborativeInfluence,
        participantUserIds: generationMirror.participantUserIds,
        generationRecordId: 'record-cancelled',
      },
    }));

    await vi.waitFor(() => expect(controller.getSnapshot()).toMatchObject({
      managementOperation: null,
      managementResultUnknown: false,
      generation: { status: 'cancelled', finalAuthoritative: true },
    }));
    expect(controller.getSnapshot().notice).toContain('服务器确认取消');
  });

  it('kick 结果未知只通过 GET 对账，不盲目重放 mutation', async () => {
    const { client, controller } = createHarness();
    const member = {
      userId: 'member-1',
      role: 'member' as const,
      displayName: '成员',
      membershipState: 'active' as const,
    };
    const withMember = {
      ...session,
      snapshot: { ...snapshot, members: [snapshot.members[0]!, member] },
    };
    vi.mocked(client.create).mockResolvedValueOnce(withMember);
    vi.mocked(client.kick).mockRejectedValueOnce(new ArenaRoomClientError(
      'ROOM_RESULT_UNKNOWN',
      null,
      '请求结果未知',
    ));
    vi.mocked(client.getSession).mockResolvedValueOnce(session);
    await controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });

    await controller.kickMember('member-1');
    expect(controller.getSnapshot().managementResultUnknown).toBe(true);
    controller.reconnect();
    await vi.waitFor(() => expect(controller.getSnapshot().managementResultUnknown).toBe(false));
    expect(client.kick).toHaveBeenCalledOnce();
    expect(client.getSession).toHaveBeenCalled();
  });

  it('close 使用同一管理锁，reset 后迟到结果不能污染新状态', async () => {
    const { client, controller } = createHarness();
    let resolveClose!: (value: { protocolVersion: 1; roomId: string; outcome: 'closed' }) => void;
    vi.mocked(client.close).mockImplementationOnce(() => new Promise((resolve) => {
      resolveClose = resolve;
    }));
    await controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });

    const first = controller.close();
    const second = controller.close();
    expect(client.close).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().managementOperation).toBe('close');

    controller.reset();
    resolveClose({ protocolVersion: 1, roomId: 'room-1', outcome: 'closed' });
    await Promise.all([first, second]);

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'ready',
      session: null,
      managementOperation: null,
      managementResultUnknown: false,
    });
  });

  it('reconnect ticket 同时携带 control/story cursor，且 refresh/reconnect 只 GET 不 POST', async () => {
    const { client, controller, runNextTimer, sockets } = createHarness();
    vi.mocked(client.getGenerationView).mockResolvedValue({
      ...generationView,
      nextChunkSeq: 1,
    });
    await controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });
    sockets[0]!.open();
    sockets[0]!.message(JSON.stringify({
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq: 1,
      timestamp: '2026-08-28T00:01:00.000Z',
      type: 'room.snapshot',
      payload: {
        ...snapshot,
        controlSeq: 1,
        activeGeneration: generationMirror,
      },
    }));
    await vi.waitFor(() => expect(controller.getSnapshot().generation).toMatchObject({
      phase: 'running',
      storyCursor: { generationId: 'generation-1', chunkSeq: 0 },
    }));
    await Promise.resolve();
    sockets[0]!.closed(1013, 'try-again-later');
    await runNextTimer();

    expect(client.issueTicket).toHaveBeenLastCalledWith('room-1', {
      reconnect: {
        control: { roomEpoch: 'epoch-1', controlSeq: 1 },
        story: { generationId: 'generation-1', chunkSeq: 0 },
      },
    });
    expect(client.getGenerationView).toHaveBeenCalledTimes(2);
    expect(client.startGeneration).not.toHaveBeenCalled();
  });

  it('create 结果未知时冻结新意图，并以同一请求 ID 安全确认结果', async () => {
    const { client, controller } = createHarness();
    vi.mocked(client.create).mockRejectedValueOnce(new ArenaRoomClientError(
      'ROOM_RESULT_UNKNOWN',
      503,
      '请求可能已提交，请先确认房间状态，不要重复提交',
    ));
    const request = {
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' as const },
      sharedConfig,
    };

    await controller.create(request);
    await controller.create(request);

    expect(client.create).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'unknown',
      notice: '请求可能已提交，请先确认房间状态，不要重复提交',
      unknownOperation: 'create',
    });

    await controller.retryUnknownOperation();
    expect(client.create).toHaveBeenCalledTimes(2);
    const firstRequest = vi.mocked(client.create).mock.calls[0]![0];
    const retryRequest = vi.mocked(client.create).mock.calls[1]![0];
    expect(firstRequest.creationRequestId).toBe('create-request-0001');
    expect(retryRequest).toEqual(firstRequest);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'connecting',
      unknownOperation: null,
      session: { roomId: 'room-1' },
    });
  });

  it('join 结果未知先 GET session 有界确认，失败后也不重放 join POST', async () => {
    const { client, controller } = createHarness();
    vi.mocked(client.join).mockRejectedValueOnce(new ArenaRoomClientError(
      'ROOM_RESULT_UNKNOWN',
      503,
      '加入请求结果未知，请先确认房间状态',
    ));
    vi.mocked(client.getSession).mockRejectedValueOnce(new ArenaRoomClientError(
      'ROOM_NOT_FOUND',
      404,
      '房间不存在',
    ));
    await controller.join('room-1', '成员');

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'unknown',
      unknownOperation: 'join',
      notice: '加入请求结果未知，请先确认房间状态',
    });
    expect(client.join).toHaveBeenCalledTimes(1);
    expect(client.getSession).toHaveBeenCalledTimes(1);

    await controller.retryUnknownOperation();
    expect(client.join).toHaveBeenCalledTimes(1);
    expect(client.getSession).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'connecting',
      unknownOperation: null,
      session: { roomId: 'room-1' },
    });
  });

  it('join POST 响应丢失但 session 已提交时由一次 GET 直接恢复', async () => {
    const { client, controller } = createHarness();
    vi.mocked(client.join).mockRejectedValueOnce(new ArenaRoomClientError(
      'ROOM_RESULT_UNKNOWN',
      null,
      '加入请求结果未知',
    ));

    await controller.join('room-1', '成员');

    expect(client.join).toHaveBeenCalledTimes(1);
    expect(client.getSession).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'connecting',
      unknownOperation: null,
      session: { roomId: 'room-1' },
    });
  });

  it('按 close reason 区分 membership replacement、epoch recovery 与协议降级', async () => {
    const membership = createHarness();
    await membership.controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });
    membership.sockets[0]!.open();
    membership.sockets[0]!.closed(1008, 'membership-revoked');
    expect(membership.controller.getSnapshot().phase).toBe('replacement');
    expect(membership.queued).toHaveLength(0);

    const epoch = createHarness();
    await epoch.controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });
    epoch.sockets[0]!.open();
    epoch.sockets[0]!.closed(1008, 'room-epoch-stale');
    expect(epoch.controller.getSnapshot().phase).toBe('reconnecting');
    expect(epoch.queued).toHaveLength(1);

    const invalid = createHarness();
    await invalid.controller.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig,
    });
    invalid.sockets[0]!.open();
    invalid.sockets[0]!.closed(1008, 'invalid-message');
    expect(invalid.controller.getSnapshot()).toMatchObject({
      phase: 'degraded',
      notice: '房间运行时暂不可用，正在重试',
    });
    expect(invalid.queued).toHaveLength(1);
  });
});
