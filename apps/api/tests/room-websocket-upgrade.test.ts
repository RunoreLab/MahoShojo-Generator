import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createAdaptorServer } from '@hono/node-server';
import {
  ARENA_ROOM_WEBSOCKET_PROTOCOL,
  MAX_CONTROL_FRAME_BYTES,
} from '@mahoshojo/contracts/arena-room';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import WebSocket from 'ws';

import {
  ARENA_ROOM_WEBSOCKET_PATH,
  RoomWebSocketGateway,
  type RoomWebSocketAuthorization,
  type RoomWebSocketGatewayOptions,
} from '#/arena-room/room-websocket-gateway';
import {
  createRoomRequestDispatcher,
  createRoomWebSocketApp,
  createRoomWebSocketServer,
} from '#/arena-room/room-websocket-transport';

interface TestRuntime {
  gateway: RoomWebSocketGateway;
  origin: string;
  server: Server;
  sockets: Set<WebSocket>;
}

const acceptedAuthorization: RoomWebSocketAuthorization = {
  accepted: true,
  roomId: 'room-1',
  userId: 'user-1',
};

const startRuntime = async (
  overrides: Partial<RoomWebSocketGatewayOptions> = {},
): Promise<TestRuntime> => {
  const httpApp = new Hono();
  httpApp.use('*', secureHeaders());
  httpApp.get('/health', (context) => context.text('ok'));
  const gateway = new RoomWebSocketGateway({
    allowedBrowserOrigins: ['https://app.example.com'],
    authorize: async () => acceptedAuthorization,
    heartbeatIntervalMs: 1_000,
    heartbeatTimeoutMs: 1_000,
    ...overrides,
  });
  const websocketServer = createRoomWebSocketServer();
  const websocketApp = createRoomWebSocketApp(gateway);
  const server = createAdaptorServer({
    fetch: createRoomRequestDispatcher(httpApp, websocketApp),
    websocket: { server: websocketServer },
  }) as Server;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    gateway,
    origin: `http://127.0.0.1:${address.port}`,
    server,
    sockets: new Set(),
  };
};

const openSocket = (
  runtime: TestRuntime,
  options: WebSocket.ClientOptions = {},
  protocol = ARENA_ROOM_WEBSOCKET_PROTOCOL,
): Promise<WebSocket> => {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `${runtime.origin}${ARENA_ROOM_WEBSOCKET_PATH}`,
      protocol,
      { origin: 'https://app.example.com', ...options },
    );
    runtime.sockets.add(socket);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
};

const expectRejectedUpgrade = (
  runtime: TestRuntime,
  expectedStatus: number,
  options: WebSocket.ClientOptions = {},
  protocol = ARENA_ROOM_WEBSOCKET_PROTOCOL,
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `${runtime.origin}${ARENA_ROOM_WEBSOCKET_PATH}`,
      protocol,
      { origin: 'https://app.example.com', ...options },
    );
    runtime.sockets.add(socket);
    socket.once('open', () => reject(new Error('upgrade unexpectedly succeeded')));
    socket.once('unexpected-response', (_request, response) => {
      response.resume();
      if (response.statusCode !== expectedStatus) {
        reject(new Error(`expected ${expectedStatus}, received ${response.statusCode}`));
        return;
      }
      resolve();
    });
    socket.once('error', () => {
      // `unexpected-response` is the authoritative assertion for handshake refusal.
    });
  });
};

const nextMessage = (socket: WebSocket): Promise<string> => {
  return new Promise((resolve, reject) => {
    socket.once('message', (data, isBinary) => {
      if (isBinary) {
        reject(new Error('unexpected binary message'));
        return;
      }
      resolve(data.toString());
    });
    socket.once('error', reject);
  });
};

const nextClose = (socket: WebSocket): Promise<{ code: number; reason: string }> => {
  return new Promise((resolve) => {
    socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });
};

describe('Room WebSocket real Node upgrade', () => {
  const runtimes: TestRuntime[] = [];

  const createRuntime = async (
    overrides: Partial<RoomWebSocketGatewayOptions> = {},
  ): Promise<TestRuntime> => {
    const runtime = await startRuntime(overrides);
    runtimes.push(runtime);
    return runtime;
  };

  afterEach(async () => {
    for (const runtime of runtimes.splice(0)) {
      runtime.gateway.forceClose();
      for (const socket of runtime.sockets) {
        if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
      }
      await new Promise<void>((resolve) => runtime.server.close(() => resolve()));
    }
  });

  it('在隔离 middleware chain 上完成 canonical upgrade，且普通 HTTP 不回归', async () => {
    const runtime = await createRuntime();

    const httpResponse = await fetch(`${runtime.origin}/health`);
    expect(await httpResponse.text()).toBe('ok');
    expect(httpResponse.headers.get('x-content-type-options')).toBe('nosniff');

    const socket = await openSocket(runtime);
    expect(socket.protocol).toBe(ARENA_ROOM_WEBSOCKET_PROTOCOL);
    const message = nextMessage(socket);
    socket.send(JSON.stringify({ protocolVersion: 1, type: 'room.resync.request' }));
    expect(JSON.parse(await message)).toEqual({
      protocolVersion: 1,
      reason: 'state-not-attached',
      type: 'room.resync.required',
    });
  });

  it('在 authorizer 之前拒绝非精确 Origin 与错误子协议', async () => {
    const authorize = vi.fn(async () => acceptedAuthorization);
    const runtime = await createRuntime({ authorize });

    await expectRejectedUpgrade(runtime, 403, {
      origin: 'https://app.example.com.attacker.invalid',
    });
    await expectRejectedUpgrade(runtime, 426, {}, 'mahoshojo.arena-room.v0');

    expect(authorize).not.toHaveBeenCalled();
  });

  it('未接入 GMR-05 ticket authority 前对所有客户端 fail-closed', async () => {
    const runtime = await createRuntime({
      allowedBrowserOrigins: [],
      authorize: undefined,
    });

    await expectRejectedUpgrade(runtime, 403);
    await expectRejectedUpgrade(runtime, 503, { origin: undefined });
  });

  it('由 ws maxPayload 对 oversized message 保留 1009 close code', async () => {
    const runtime = await createRuntime();
    const socket = await openSocket(runtime);
    const closed = nextClose(socket);

    socket.send('x'.repeat(MAX_CONTROL_FRAME_BYTES + 1));

    await expect(closed).resolves.toEqual({ code: 1009, reason: '' });
  });

  it('在 flood 与 per-user connection cap 上 fail-closed', async () => {
    const floodRuntime = await createRuntime({
      connectionMessageLimit: 2,
      rateWindowMs: 60_000,
      userMessageLimit: 10,
    });
    const floodSocket = await openSocket(floodRuntime);
    const floodClosed = nextClose(floodSocket);
    const frame = JSON.stringify({ protocolVersion: 1, type: 'room.resync.request' });
    floodSocket.send(frame);
    floodSocket.send(frame);
    floodSocket.send(frame);
    await expect(floodClosed).resolves.toEqual({ code: 1008, reason: 'rate-limit' });

    const capRuntime = await createRuntime({ maxConnectionsPerUser: 1 });
    await openSocket(capRuntime);
    await expectRejectedUpgrade(capRuntime, 429);
  });

  it('heartbeat 会终止不回应 pong 的连接', async () => {
    const runtime = await createRuntime({
      heartbeatIntervalMs: 25,
      heartbeatTimeoutMs: 25,
    });
    const socket = await openSocket(runtime, { autoPong: false });
    const closed = nextClose(socket);

    await expect(closed).resolves.toEqual({ code: 1006, reason: '' });
  });

  it('graceful shutdown 对活动连接发送 1012', async () => {
    const runtime = await createRuntime({ shutdownGraceMs: 500 });
    const socket = await openSocket(runtime);
    const closed = nextClose(socket);

    await runtime.gateway.shutdown();

    await expect(closed).resolves.toEqual({ code: 1012, reason: 'service-restart' });
  });

  it('先启动 WebSocket drain 后，HTTP server close 不被 upgrade connection 卡住', async () => {
    const runtime = await createRuntime({ shutdownGraceMs: 500 });
    const socket = await openSocket(runtime);
    const closed = nextClose(socket);

    const gatewayShutdown = runtime.gateway.shutdown();
    await new Promise<void>((resolve) => runtime.server.close(() => resolve()));
    await gatewayShutdown;

    await expect(closed).resolves.toEqual({ code: 1012, reason: 'service-restart' });
  });
});
