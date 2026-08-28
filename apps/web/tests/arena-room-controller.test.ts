import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ArenaRoomClient,
  ArenaRoomClientError,
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
  const client: ArenaRoomClient = {
    discover: vi.fn(async () => ({ items: [], nextCursor: null })),
    create: vi.fn(async () => session),
    join: vi.fn(async () => session),
    getSession: vi.fn(async () => session),
    issueTicket: vi.fn(async () => ticket(`ticket-${++ticketIndex}`)),
    leave: vi.fn(async () => ({ protocolVersion: 1, roomId: 'room-1', outcome: 'left' })),
    close: vi.fn(async () => ({ protocolVersion: 1, roomId: 'room-1', outcome: 'closed' })),
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
});
