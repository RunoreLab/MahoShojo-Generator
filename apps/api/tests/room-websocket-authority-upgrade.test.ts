import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createAdaptorServer } from '@hono/node-server';
import {
  ARENA_ROOM_WEBSOCKET_PROTOCOL,
  type RoomServerTransportMessage,
} from '@mahoshojo/contracts/arena-room';
import {
  checkpointPredecessorOf,
  consumeArenaRoomCheckpointCommit,
  type ArenaRoomAuthorityState,
} from '@mahoshojo/multiplayer-core';
import { Hono } from 'hono';
import WebSocket from 'ws';

import {
  createRoomActorRegistry,
  type RoomActorCheckpointStore,
} from '#/arena-room/room-actor-registry';
import { createArenaRoomMembershipService } from '#/arena-room/room-membership-service';
import type { RedisRoomTicketReplayStore } from '#/arena-room/redis-room-ticket-replay-store';
import {
  createArenaRoomTicketCodec,
  createArenaRoomTicketSignatureService,
} from '#/arena-room/room-ticket';
import {
  ARENA_ROOM_WEBSOCKET_PATH,
  RoomWebSocketGateway,
} from '#/arena-room/room-websocket-gateway';
import { createArenaRoomWebSocketAuthority } from '#/arena-room/room-websocket-authority';
import {
  createRoomRequestDispatcher,
  createRoomWebSocketApp,
  createRoomWebSocketServer,
} from '#/arena-room/room-websocket-transport';
import { createArenaRoomState } from './arena-room-fixtures';

class MemoryRoomStore implements RoomActorCheckpointStore {
  state: ArenaRoomAuthorityState | null = null;
  saveFailure = false;

  async load(roomId: string) {
    return this.state?.snapshot.roomId === roomId ? structuredClone(this.state) : null;
  }

  async save(input: Parameters<RoomActorCheckpointStore['save']>[0]) {
    if (this.saveFailure) throw new Error('REDIS_ROOM_CHECKPOINT_UNAVAILABLE');
    const data = consumeArenaRoomCheckpointCommit(input.commit);
    if (data.predecessor === null) {
      if (this.state !== null) return { kind: 'conflict' as const };
    } else if (
      this.state === null
      || JSON.stringify(this.state) !== JSON.stringify(data.predecessorState)
      || JSON.stringify(checkpointPredecessorOf(this.state)) !== JSON.stringify(data.predecessor)
    ) return { kind: 'conflict' as const };
    this.state = structuredClone(data.nextState);
    return { kind: 'saved' as const };
  }

  async refresh() {
    return { kind: 'refreshed' as const };
  }
}

class MemoryReplay implements RedisRoomTicketReplayStore {
  private readonly used = new Set<string>();
  async consume(input: { jti: string }) {
    if (this.used.has(input.jti)) return { kind: 'replayed' as const };
    this.used.add(input.jti);
    return { kind: 'consumed' as const };
  }
}

const nextMessage = (socket: WebSocket): Promise<RoomServerTransportMessage> => new Promise(
  (resolve, reject) => {
    socket.once('message', (data, binary) => {
      if (binary) reject(new Error('unexpected binary frame'));
      else resolve(JSON.parse(data.toString()) as RoomServerTransportMessage);
    });
    socket.once('error', reject);
  },
);

const nextClose = (socket: WebSocket) => new Promise<{ code: number; reason: string }>((resolve) => {
  socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
});

const within = <T>(operation: Promise<T>, label: string, timeoutMs = 2_000): Promise<T> => (
  Promise.race([
    operation,
    new Promise<never>((_resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`timeout:${label}`)), timeoutMs);
      timeout.unref();
    }),
  ])
);

describe('Room signed-ticket real Node upgrade', () => {
  it('完成 ticket -> current membership -> snapshot，ticket replay 在 upgrade 阶段拒绝', async () => {
    const store = new MemoryRoomStore();
    let userIndex = 0;
    let jtiIndex = 0;
    const actors = createRoomActorRegistry({
      store,
      createRoomIdentity: () => ({ roomId: 'room-1', roomEpoch: 'epoch-1' }),
      createTimestamp: () => '2026-08-28T00:00:00.000Z',
      now: () => Date.parse('2026-08-28T00:01:00.000Z'),
    });
    const memberships = createArenaRoomMembershipService({
      actors,
      createUserId: () => `server-user-${++userIndex}`,
      now: () => '2026-08-28T00:01:00.000Z',
    });
    await memberships.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    });
    const member = await memberships.join({
      roomId: 'room-1',
      accountUserId: 202,
      displayName: 'Member',
    });
    const tickets = createArenaRoomTicketCodec({
      signatures: createArenaRoomTicketSignatureService({
        env: { SIGNATURE_SECRET_KEY: 'real-upgrade-secret-at-least-32-characters' },
        logger: { warn: () => undefined, error: () => undefined },
      }),
      createJti: () => `jti-${++jtiIndex}`,
      now: () => Date.parse('2026-08-28T00:01:00.000Z'),
    });
    const authority = createArenaRoomWebSocketAuthority({
      actors,
      memberships,
      replay: new MemoryReplay(),
      tickets,
      now: () => Date.parse('2026-08-28T00:01:00.000Z'),
    });
    const gateway = new RoomWebSocketGateway({
      allowedBrowserOrigins: ['https://app.example.com'],
      authorize: authority.authorize,
      closeGraceMs: 100,
      heartbeatIntervalMs: 1_000,
      heartbeatTimeoutMs: 1_000,
      maxConnectionsPerUser: 1,
      shutdownGraceMs: 100,
    });
    const http = new Hono();
    http.get('/health', (context) => context.text('ok'));
    const server = createAdaptorServer({
      fetch: createRoomRequestDispatcher(http, createRoomWebSocketApp(gateway)),
      websocket: { server: createRoomWebSocketServer() },
    }) as Server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address() as AddressInfo;
    const origin = `ws://127.0.0.1:${address.port}`;
    const sockets = new Set<WebSocket>();
    const open = (ticket: string): Promise<{
      close: Promise<{ code: number; reason: string }>;
      firstMessage: Promise<RoomServerTransportMessage>;
      socket: WebSocket;
    }> => new Promise((resolve, reject) => {
      const socket = new WebSocket(
        `${origin}${ARENA_ROOM_WEBSOCKET_PATH}?ticket=${encodeURIComponent(ticket)}`,
        ARENA_ROOM_WEBSOCKET_PROTOCOL,
        { origin: 'https://app.example.com' },
      );
      const close = nextClose(socket);
      const firstMessage = nextMessage(socket);
      sockets.add(socket);
      socket.once('open', () => resolve({ close, firstMessage, socket }));
      socket.once('error', reject);
    });
    try {
      store.saveFailure = true;
      const unavailableTicket = await authority.issue({ roomId: 'room-1', accountUserId: 202 });
      const unavailable = await open(unavailableTicket);
      await expect(unavailable.close).resolves.toEqual({
        code: 1013,
        reason: 'authority-unavailable',
      });
      expect(store.state?.deadlines).toEqual({
        hostOfflineDeadline: '2026-08-28T00:45:00.000Z',
        roomIdleDeadline: '2026-08-28T12:00:00.000Z',
      });
      expect(store.state?.memberAuthority.find((entry) => entry.accountUserId === 202)?.member)
        .toMatchObject({ membershipState: 'active' });
      store.saveFailure = false;

      const ticket = await authority.issue({ roomId: 'room-1', accountUserId: 202 });
      const opened = await open(ticket);
      const socket = opened.socket;
      await expect(opened.firstMessage).resolves.toMatchObject({
        type: 'room.snapshot',
        roomId: 'room-1',
        payload: { members: expect.arrayContaining([member.member]) },
      });

      await expect(new Promise<number>((resolve, reject) => {
        const replay = new WebSocket(
          `${origin}${ARENA_ROOM_WEBSOCKET_PATH}?ticket=${encodeURIComponent(ticket)}`,
          ARENA_ROOM_WEBSOCKET_PROTOCOL,
          { origin: 'https://app.example.com' },
        );
        sockets.add(replay);
        replay.once('open', () => reject(new Error('ticket replay unexpectedly connected')));
        replay.once('unexpected-response', (_request, response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        });
        replay.once('error', () => undefined);
      })).resolves.toBe(401);

      const close = nextClose(socket);
      await memberships.kick({
        roomId: 'room-1',
        accountUserId: 101,
        targetUserId: member.member.userId,
      });
      await expect(close).resolves.toEqual({ code: 1008, reason: 'membership-revoked' });
      expect(store.state?.memberAuthority.find((entry) => entry.accountUserId === 202)?.member)
        .toMatchObject({ membershipState: 'revoked' });
    } finally {
      await gateway.shutdown();
      for (const socket of sockets) if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await actors.shutdown();
    }
  });

  it('dead host socket 经 heartbeat terminate 后只清 connection presence，deadline 前可重连', async () => {
    const store = new MemoryRoomStore();
    const now = Date.parse('2026-08-28T00:10:00.000Z');
    const actors = createRoomActorRegistry({
      store,
      createRoomIdentity: () => ({ roomId: 'room-dead-host', roomEpoch: 'epoch-dead-host' }),
      createTimestamp: () => '2026-08-28T00:00:00.000Z',
      now: () => now,
    });
    const memberships = createArenaRoomMembershipService({
      actors,
      createUserId: () => 'host-dead-socket',
      now: () => '2026-08-28T00:10:00.000Z',
    });
    await memberships.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    });
    let jti = 0;
    const tickets = createArenaRoomTicketCodec({
      signatures: createArenaRoomTicketSignatureService({
        env: { SIGNATURE_SECRET_KEY: 'heartbeat-authority-secret-at-least-32-characters' },
        logger: { warn: () => undefined, error: () => undefined },
      }),
      createJti: () => `heartbeat-jti-${++jti}`,
      now: () => now,
    });
    const authority = createArenaRoomWebSocketAuthority({
      actors,
      memberships,
      replay: new MemoryReplay(),
      tickets,
      now: () => now,
    });
    const gateway = new RoomWebSocketGateway({
      allowedBrowserOrigins: ['https://app.example.com'],
      authorize: authority.authorize,
      closeGraceMs: 20,
      heartbeatIntervalMs: 20,
      heartbeatTimeoutMs: 20,
      shutdownGraceMs: 50,
    });
    const server = createAdaptorServer({
      fetch: createRoomRequestDispatcher(new Hono(), createRoomWebSocketApp(gateway)),
      websocket: { server: createRoomWebSocketServer() },
    }) as Server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address() as AddressInfo;
    const endpoint = `ws://127.0.0.1:${address.port}${ARENA_ROOM_WEBSOCKET_PATH}`;
    const sockets = new Set<WebSocket>();
    const open = (ticket: string, autoPong: boolean): Promise<{
      firstMessage: Promise<RoomServerTransportMessage>;
      socket: WebSocket;
    }> => new Promise(
      (resolve, reject) => {
        const socket = new WebSocket(
          `${endpoint}?ticket=${encodeURIComponent(ticket)}`,
          ARENA_ROOM_WEBSOCKET_PROTOCOL,
          { autoPong, origin: 'https://app.example.com' },
        );
        const firstMessage = nextMessage(socket);
        sockets.add(socket);
        socket.once('open', () => resolve({ firstMessage, socket }));
        socket.once('error', reject);
      },
    );
    try {
      const firstTicket = await authority.issue({
        roomId: 'room-dead-host',
        accountUserId: 101,
      });
      const deadConnection = await open(firstTicket, false);
      const deadSocket = deadConnection.socket;
      await expect(within(deadConnection.firstMessage, 'initial-snapshot'))
        .resolves.toMatchObject({ type: 'room.snapshot' });
      await expect(within(nextClose(deadSocket), 'dead-close'))
        .resolves.toMatchObject({ code: 1006 });
      await vi.waitFor(() => expect(store.state?.deadlines).toEqual({
        hostOfflineDeadline: '2026-08-28T00:55:00.000Z',
        roomIdleDeadline: '2026-08-28T12:10:00.000Z',
      }));
      expect(store.state?.snapshot.controlSeq).toBe(2);
      expect(store.state?.memberAuthority[0]?.member.membershipState).toBe('active');

      const reconnectTicket = await authority.issue({
        roomId: 'room-dead-host',
        accountUserId: 101,
      });
      const reconnect = await open(reconnectTicket, true);
      await expect(within(reconnect.firstMessage, 'reconnect-snapshot'))
        .resolves.toMatchObject({ type: 'room.snapshot' });
      await vi.waitFor(() => expect(store.state?.deadlines).toEqual({
        hostOfflineDeadline: null,
        roomIdleDeadline: null,
      }));
      expect(store.state?.snapshot.controlSeq).toBe(3);
    } finally {
      await gateway.shutdown();
      for (const socket of sockets) if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await actors.shutdown();
    }
  });
});
