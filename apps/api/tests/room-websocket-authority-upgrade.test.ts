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

  async load(roomId: string) {
    return this.state?.snapshot.roomId === roomId ? structuredClone(this.state) : null;
  }

  async save(input: Parameters<RoomActorCheckpointStore['save']>[0]) {
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

describe('Room signed-ticket real Node upgrade', () => {
  it('完成 ticket -> current membership -> snapshot，ticket replay 在 upgrade 阶段拒绝', async () => {
    const store = new MemoryRoomStore();
    let userIndex = 0;
    let jtiIndex = 0;
    const actors = createRoomActorRegistry({
      store,
      createRoomIdentity: () => ({ roomId: 'room-1', roomEpoch: 'epoch-1' }),
      createTimestamp: () => '2026-08-28T00:00:00.000Z',
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
      heartbeatIntervalMs: 1_000,
      heartbeatTimeoutMs: 1_000,
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
    const open = (ticket: string): Promise<WebSocket> => new Promise((resolve, reject) => {
      const socket = new WebSocket(
        `${origin}${ARENA_ROOM_WEBSOCKET_PATH}?ticket=${encodeURIComponent(ticket)}`,
        ARENA_ROOM_WEBSOCKET_PROTOCOL,
        { origin: 'https://app.example.com' },
      );
      sockets.add(socket);
      socket.once('open', () => resolve(socket));
      socket.once('error', reject);
    });
    try {
      const ticket = await authority.issue({ roomId: 'room-1', accountUserId: 202 });
      const socket = await open(ticket);
      await expect(nextMessage(socket)).resolves.toMatchObject({
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
});
