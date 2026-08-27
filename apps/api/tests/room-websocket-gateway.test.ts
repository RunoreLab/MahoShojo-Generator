import { EventEmitter } from 'node:events';

import {
  ARENA_ROOM_WEBSOCKET_PROTOCOL,
  MAX_CONTROL_FRAME_BYTES,
} from '@mahoshojo/contracts/arena-room';
import type { WebSocketLike } from '@hono/node-server';
import type { WSContext, WSEvents } from 'hono/ws';

import {
  ARENA_ROOM_WEBSOCKET_PATH,
  RoomWebSocketGateway,
  denyRoomWebSocketAuthorization,
  type RoomWebSocketAuthorization,
  type RoomWebSocketConnectionAuthority,
  type RoomWebSocketReservation,
} from '#/arena-room/room-websocket-gateway';

class FakeWebSocket extends EventEmitter {
  readonly protocol = ARENA_ROOM_WEBSOCKET_PROTOCOL;
  readyState = 1;
  bufferedAmount = 0;
  readonly sent: string[] = [];
  readonly closes: Array<{ code?: number; reason?: string }> = [];
  pingCount = 0;
  terminateCount = 0;
  deferSendCallback = false;
  private readonly sendCallbacks: Array<(error?: Error) => void> = [];

  send(
    data: string | ArrayBuffer | ArrayBufferView,
    _options?: { compress?: boolean },
    callback?: (error?: Error) => void,
  ): void {
    this.sent.push(typeof data === 'string' ? data : Buffer.from(data as ArrayBuffer).toString());
    if (!callback) return;
    if (this.deferSendCallback) {
      this.sendCallbacks.push(callback);
      return;
    }
    callback();
  }

  flushSend(): void {
    this.sendCallbacks.shift()?.();
  }

  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
    this.readyState = 2;
  }

  ping(): void {
    this.pingCount += 1;
  }

  terminate(): void {
    this.terminateCount += 1;
    this.readyState = 3;
    this.emit('close', 1006, Buffer.alloc(0));
  }
}

const acceptedAuthorization = (
  userId = 'user-1',
): RoomWebSocketAuthorization => ({
  accepted: true,
  roomId: 'room-1',
  userId,
});

const upgradeRequest = (headers: HeadersInit = {}): Request => new Request(
  `http://localhost${ARENA_ROOM_WEBSOCKET_PATH}`,
  {
    headers: {
      connection: 'Upgrade',
      origin: 'https://app.example.com',
      'sec-websocket-key': Buffer.alloc(16, 1).toString('base64'),
      'sec-websocket-protocol': ARENA_ROOM_WEBSOCKET_PROTOCOL,
      'sec-websocket-version': '13',
      upgrade: 'websocket',
      ...headers,
    },
  },
);

const wsContext = (socket: FakeWebSocket): WSContext<WebSocketLike> => {
  return { raw: socket } as unknown as WSContext<WebSocketLike>;
};

const openReservation = (
  gateway: RoomWebSocketGateway,
  reservation: RoomWebSocketReservation,
  socket = new FakeWebSocket(),
): { events: WSEvents<WebSocketLike>; socket: FakeWebSocket } => {
  const events = gateway.createEvents(reservation);
  events.onOpen?.(new Event('open'), wsContext(socket));
  return { events, socket };
};

describe('RoomWebSocketGateway', () => {
  const gateways: RoomWebSocketGateway[] = [];

  const createGateway = (
    overrides: Partial<ConstructorParameters<typeof RoomWebSocketGateway>[0]> = {},
  ): RoomWebSocketGateway => {
    const gateway = new RoomWebSocketGateway({
      allowedBrowserOrigins: ['https://app.example.com'],
      authorize: async () => acceptedAuthorization(),
      heartbeatIntervalMs: 1_000,
      heartbeatTimeoutMs: 1_000,
      ...overrides,
    });
    gateways.push(gateway);
    return gateway;
  };

  afterEach(() => {
    for (const gateway of gateways.splice(0)) gateway.forceClose();
    vi.useRealTimers();
  });

  it('只接受精确 Origin、固定路径和 canonical 子协议', async () => {
    const authorize = vi.fn(async () => acceptedAuthorization());
    const gateway = createGateway({ authorize });

    const accepted = await gateway.prepareUpgrade(upgradeRequest());
    expect(accepted.accepted).toBe(true);

    const suffixAttack = await gateway.prepareUpgrade(upgradeRequest({
      origin: 'https://app.example.com.attacker.invalid',
    }));
    expect(suffixAttack).toMatchObject({ accepted: false, response: { status: 403 } });
    expect(authorize).toHaveBeenCalledTimes(1);

    const wrongProtocol = await gateway.prepareUpgrade(upgradeRequest({
      'sec-websocket-protocol': 'mahoshojo.arena-room.v0',
    }));
    expect(wrongProtocol).toMatchObject({ accepted: false, response: { status: 426 } });

    const wrongPath = await gateway.prepareUpgrade(new Request(
      'http://localhost/api/arena/rooms/v1/ws-shadow',
      { headers: upgradeRequest().headers },
    ));
    expect(wrongPath).toMatchObject({ accepted: false, response: { status: 404 } });
  });

  it('允许无 Origin 的非浏览器客户端继续进入服务器鉴权，但不把 Origin 当鉴权', async () => {
    const authorize = vi.fn(async () => acceptedAuthorization());
    const gateway = createGateway({ authorize });
    const headers = new Headers(upgradeRequest().headers);
    headers.delete('origin');

    const decision = await gateway.prepareUpgrade(upgradeRequest(headers));

    expect(decision.accepted).toBe(true);
    expect(authorize).toHaveBeenCalledOnce();
  });

  it('默认 authorizer fail-closed 且不会产生 reservation', async () => {
    const gateway = createGateway({ authorize: denyRoomWebSocketAuthorization });

    const decision = await gateway.prepareUpgrade(upgradeRequest());

    expect(decision).toMatchObject({ accepted: false, response: { status: 503 } });
  });

  it('pre-upgrade grant 不占 cap，onOpen 原子限制 active connection', async () => {
    const gateway = createGateway({ maxConnectionsPerUser: 1 });
    const first = await gateway.prepareUpgrade(upgradeRequest());
    const concurrent = await gateway.prepareUpgrade(upgradeRequest());
    if (!first.accepted || !concurrent.accepted) {
      throw new Error('expected accepted reservations');
    }
    const { events, socket } = openReservation(gateway, first.reservation);
    const rejectedConcurrent = openReservation(gateway, concurrent.reservation);
    expect(rejectedConcurrent.socket.closes.at(-1)).toEqual({
      code: 1013,
      reason: 'connection-limit',
    });

    const whileActive = await gateway.prepareUpgrade(upgradeRequest());
    expect(whileActive).toMatchObject({ accepted: false, response: { status: 429 } });

    socket.readyState = 3;
    events.onClose?.(new CloseEvent('close', { code: 1000 }), wsContext(socket));
    const afterClose = await gateway.prepareUpgrade(upgradeRequest());
    expect(afterClose.accepted).toBe(true);
  });

  it('未完成 handshake 不留 pending state，过期 grant 在 onOpen 拒绝', async () => {
    vi.useFakeTimers();
    const gateway = createGateway({
      heartbeatIntervalMs: 100,
      heartbeatTimeoutMs: 100,
      maxConnectionsPerUser: 1,
      reservationTtlMs: 100,
    });
    const expired = await gateway.prepareUpgrade(upgradeRequest());
    expect(expired.accepted).toBe(true);
    expect((await gateway.prepareUpgrade(upgradeRequest())).accepted).toBe(true);

    await vi.advanceTimersByTimeAsync(100);

    if (!expired.accepted) throw new Error('expected accepted reservation');
    const rejected = openReservation(gateway, expired.reservation);
    expect(rejected.socket.closes.at(-1)).toEqual({
      code: 1008,
      reason: 'authorization-expired',
    });
    expect((await gateway.prepareUpgrade(upgradeRequest())).accepted).toBe(true);
  });

  it('同一 authorization grant 只能激活一次', async () => {
    const gateway = createGateway({ maxConnectionsPerUser: 4 });
    const decision = await gateway.prepareUpgrade(upgradeRequest());
    if (!decision.accepted) throw new Error('expected accepted reservation');

    openReservation(gateway, decision.reservation);
    const replayed = openReservation(gateway, decision.reservation);

    expect(replayed.socket.closes.at(-1)).toEqual({
      code: 1008,
      reason: 'invalid-reservation',
    });
  });

  it('对合法 resync 请求只返回 state-not-attached 骨架', async () => {
    const gateway = createGateway();
    const decision = await gateway.prepareUpgrade(upgradeRequest());
    if (!decision.accepted) throw new Error('expected accepted reservation');
    const { events, socket } = openReservation(gateway, decision.reservation);

    events.onMessage?.(new MessageEvent('message', {
      data: JSON.stringify({ protocolVersion: 1, type: 'room.resync.request' }),
    }), wsContext(socket));

    expect(socket.sent).toEqual([
      JSON.stringify({
        protocolVersion: 1,
        reason: 'state-not-attached',
        type: 'room.resync.required',
      }),
    ]);
  });

  it('scoped connection authority 可在 onOpen 后异步 attach、处理消息并在 close 时只 dispose 一次', async () => {
    const dispose = vi.fn(async () => undefined);
    const onMessage = vi.fn();
    const connectionAuthority: RoomWebSocketConnectionAuthority = {
      activate: async (peer) => {
        peer.send({
          protocolVersion: 1,
          type: 'room.resync.required',
          reason: 'replay-unavailable',
        });
        return {
          dispose,
          onMessage: (message) => {
            onMessage(message);
            peer.send({
              protocolVersion: 1,
              type: 'room.resync.required',
              reason: 'state-not-attached',
            });
          },
        };
      },
    };
    const gateway = createGateway({
      authorize: async () => ({
        ...acceptedAuthorization(),
        connectionAuthority,
      }),
    });
    const decision = await gateway.prepareUpgrade(upgradeRequest());
    if (!decision.accepted) throw new Error('expected accepted reservation');
    const { events, socket } = openReservation(gateway, decision.reservation);

    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    events.onMessage?.(new MessageEvent('message', {
      data: JSON.stringify({ protocolVersion: 1, type: 'room.resync.request' }),
    }), wsContext(socket));
    await vi.waitFor(() => expect(onMessage).toHaveBeenCalledOnce());
    expect(socket.sent).toHaveLength(2);

    socket.readyState = 3;
    events.onClose?.(new CloseEvent('close', { code: 1000 }), wsContext(socket));
    events.onClose?.(new CloseEvent('close', { code: 1000 }), wsContext(socket));
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
  });

  it('拒绝 binary、超大和 malformed client frame', async () => {
    const gateway = createGateway();
    const decisions = await Promise.all([
      gateway.prepareUpgrade(upgradeRequest()),
      gateway.prepareUpgrade(upgradeRequest()),
      gateway.prepareUpgrade(upgradeRequest()),
    ]);
    const opened = decisions.map((decision) => {
      if (!decision.accepted) throw new Error('expected accepted reservation');
      return openReservation(gateway, decision.reservation);
    });

    opened[0]?.events.onMessage?.(new MessageEvent('message', {
      data: new ArrayBuffer(1),
    }), wsContext(opened[0]!.socket));
    opened[1]?.events.onMessage?.(new MessageEvent('message', {
      data: 'x'.repeat(MAX_CONTROL_FRAME_BYTES + 1),
    }), wsContext(opened[1]!.socket));
    opened[2]?.events.onMessage?.(new MessageEvent('message', {
      data: '{"type":"unknown"}',
    }), wsContext(opened[2]!.socket));

    expect(opened[0]?.socket.closes.at(-1)).toEqual({ code: 1003, reason: 'binary-not-supported' });
    expect(opened[1]?.socket.closes.at(-1)).toEqual({ code: 1009, reason: 'message-too-large' });
    expect(opened[2]?.socket.closes.at(-1)).toEqual({ code: 1008, reason: 'invalid-message' });
  });

  it('在 connection rate 超限时 fail-closed', async () => {
    const gateway = createGateway({
      connectionMessageLimit: 2,
      userMessageLimit: 10,
      rateWindowMs: 60_000,
    });
    const decision = await gateway.prepareUpgrade(upgradeRequest());
    if (!decision.accepted) throw new Error('expected accepted reservation');
    const { events, socket } = openReservation(gateway, decision.reservation);
    const message = new MessageEvent('message', {
      data: JSON.stringify({ protocolVersion: 1, type: 'room.resync.request' }),
    });

    events.onMessage?.(message, wsContext(socket));
    events.onMessage?.(message, wsContext(socket));
    events.onMessage?.(message, wsContext(socket));

    expect(socket.closes.at(-1)).toEqual({ code: 1008, reason: 'rate-limit' });
  });

  it('对同一用户的多个连接共享 user rate limit', async () => {
    const gateway = createGateway({
      connectionMessageLimit: 10,
      maxConnectionsPerUser: 2,
      rateWindowMs: 60_000,
      userMessageLimit: 2,
    });
    const first = await gateway.prepareUpgrade(upgradeRequest());
    const second = await gateway.prepareUpgrade(upgradeRequest());
    if (!first.accepted || !second.accepted) throw new Error('expected accepted reservations');
    const openedFirst = openReservation(gateway, first.reservation);
    const openedSecond = openReservation(gateway, second.reservation);
    const message = new MessageEvent('message', {
      data: JSON.stringify({ protocolVersion: 1, type: 'room.resync.request' }),
    });

    openedFirst.events.onMessage?.(message, wsContext(openedFirst.socket));
    openedSecond.events.onMessage?.(message, wsContext(openedSecond.socket));
    openedFirst.events.onMessage?.(message, wsContext(openedFirst.socket));

    expect(openedFirst.socket.closes.at(-1)).toEqual({ code: 1008, reason: 'rate-limit' });
    expect(openedSecond.socket.closes).toEqual([]);
  });

  it('服务器 connectionKey 跨房间统一约束同一账户的 occupancy', async () => {
    let authorizationIndex = 0;
    const gateway = createGateway({
      authorize: async () => ({
        accepted: true,
        connectionKey: 'account:101',
        roomId: `room-${++authorizationIndex}`,
        userId: `room-user-${authorizationIndex}`,
      }),
      maxConnectionsPerUser: 1,
    });
    const first = await gateway.prepareUpgrade(upgradeRequest());
    const second = await gateway.prepareUpgrade(upgradeRequest());
    if (!first.accepted || !second.accepted) throw new Error('expected accepted reservations');

    openReservation(gateway, first.reservation);
    const rejected = openReservation(gateway, second.reservation);

    expect(rejected.socket.closes.at(-1)).toEqual({
      code: 1013,
      reason: 'connection-limit',
    });
  });

  it('用单一 heartbeat sweep 终止不回应 pong 的 dead connection', async () => {
    vi.useFakeTimers();
    const gateway = createGateway({
      heartbeatIntervalMs: 100,
      heartbeatTimeoutMs: 100,
    });
    const decision = await gateway.prepareUpgrade(upgradeRequest());
    if (!decision.accepted) throw new Error('expected accepted reservation');
    const { socket } = openReservation(gateway, decision.reservation);

    await vi.advanceTimersByTimeAsync(100);
    expect(socket.pingCount).toBe(1);
    expect(socket.terminateCount).toBe(0);
    await vi.advanceTimersByTimeAsync(100);

    expect(socket.terminateCount).toBe(1);
  });

  it('bounded send queue 饱和时以 resync-required 关闭 slow consumer', async () => {
    const gateway = createGateway({ outboundQueueMaxBytes: 150 });
    const decision = await gateway.prepareUpgrade(upgradeRequest());
    if (!decision.accepted) throw new Error('expected accepted reservation');
    const socket = new FakeWebSocket();
    socket.deferSendCallback = true;
    const { events } = openReservation(gateway, decision.reservation, socket);
    const message = new MessageEvent('message', {
      data: JSON.stringify({ protocolVersion: 1, type: 'room.resync.request' }),
    });

    events.onMessage?.(message, wsContext(socket));
    events.onMessage?.(message, wsContext(socket));

    expect(socket.closes.at(-1)).toEqual({ code: 1013, reason: 'resync-required' });
  });

  it('graceful shutdown 停止新连接、发出 1012 并在期限后 terminate', async () => {
    vi.useFakeTimers();
    const gateway = createGateway({ shutdownGraceMs: 100 });
    const decision = await gateway.prepareUpgrade(upgradeRequest());
    if (!decision.accepted) throw new Error('expected accepted reservation');
    const { socket } = openReservation(gateway, decision.reservation);

    gateway.stopAccepting();
    const denied = await gateway.prepareUpgrade(upgradeRequest());
    expect(denied).toMatchObject({ accepted: false, response: { status: 503 } });
    const shutdown = gateway.shutdown();
    expect(socket.closes.at(-1)).toEqual({ code: 1012, reason: 'service-restart' });

    await vi.advanceTimersByTimeAsync(100);
    await shutdown;
    expect(socket.terminateCount).toBe(1);
  });

  it('authority activation 永不返回时 shutdown 仍在有界期限内完成', async () => {
    vi.useFakeTimers();
    const gateway = createGateway({
      authorize: async () => ({
        ...acceptedAuthorization(),
        connectionAuthority: { activate: () => new Promise(() => undefined) },
      }),
      shutdownGraceMs: 100,
    });
    const decision = await gateway.prepareUpgrade(upgradeRequest());
    if (!decision.accepted) throw new Error('expected accepted reservation');
    const { socket } = openReservation(gateway, decision.reservation);

    const shutdown = gateway.shutdown();
    await vi.advanceTimersByTimeAsync(200);
    await expect(shutdown).resolves.toBeUndefined();
    expect(socket.terminateCount).toBe(1);
  });
});
