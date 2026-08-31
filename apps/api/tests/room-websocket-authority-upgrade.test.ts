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
  issueArenaRoomGenerationPublisherAuthority,
  issueArenaRoomGenerationReservationAuthority,
  issueArenaRoomTrustedTime,
  type ArenaRoomAuthorityState,
} from '@mahoshojo/multiplayer-core';
import { createMemoryGenerationReplayStore } from '@mahoshojo/hosted-api/arena-generation/memory-replay-store';
import { createArenaGenerationService } from '@mahoshojo/hosted-api/arena-generation/service';
import { Hono } from 'hono';
import WebSocket from 'ws';

import { createArenaRoomGenerationPort } from '#/arena-generation/room-generation-port';
import {
  createRoomActorRegistry,
  type RoomActorCheckpointStore,
} from '#/arena-room/room-actor-registry';
import { createRoomGenerationPublisher } from '#/arena-room/room-generation-publisher';
import { createArenaRoomGenerationSnapshot } from '#/arena-room/room-generation-snapshot';
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
import {
  createArenaRoomState,
  createTestArenaDataCardRefVerifier,
} from './arena-room-fixtures';

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

const nextMatchingMessage = (
  socket: WebSocket,
  predicate: (message: RoomServerTransportMessage) => boolean,
): Promise<RoomServerTransportMessage> => new Promise((resolve, reject) => {
  const onMessage = (data: WebSocket.RawData, binary: boolean) => {
    if (binary) {
      cleanup();
      reject(new Error('unexpected binary frame'));
      return;
    }
    const message = JSON.parse(data.toString()) as RoomServerTransportMessage;
    if (!predicate(message)) return;
    cleanup();
    resolve(message);
  };
  const onError = (error: Error) => {
    cleanup();
    reject(error);
  };
  const cleanup = () => {
    socket.off('message', onMessage);
    socket.off('error', onError);
  };
  socket.on('message', onMessage);
  socket.on('error', onError);
});

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
      createRoomEpoch: () => 'epoch-2',
      recoveryTimestamp: () => '2026-08-28T00:01:00.000Z',
      now: () => Date.parse('2026-08-28T00:01:00.000Z'),
    });
    const memberships = createArenaRoomMembershipService({
      actors,
      references: createTestArenaDataCardRefVerifier(),
      createUserId: () => `server-user-${++userIndex}`,
      now: () => '2026-08-28T00:01:00.000Z',
    });
    const host = await memberships.create({
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
      // This case verifies authority recovery and ticket replay, not the
      // connection quota. Leave room for the closing socket's async cleanup.
      maxConnectionsPerUser: 2,
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
      await expect(within(unavailable.close, 'unavailable-close')).resolves.toEqual({
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
      await expect(within(opened.firstMessage, 'recovered-snapshot')).resolves.toMatchObject({
        type: 'room.snapshot',
        roomId: 'room-1',
        payload: { members: expect.arrayContaining([member.member]) },
      });
      const hostTicket = await authority.issue({ roomId: 'room-1', accountUserId: 101 });
      const openedHost = await open(hostTicket);
      await expect(within(openedHost.firstMessage, 'host-snapshot')).resolves.toMatchObject({
        type: 'room.snapshot',
        roomId: 'room-1',
      });

      const actor = actors.get('room-1');
      if (!actor) throw new Error('actor missing');
      const authorityState = actor.getSnapshot();
      if (!authorityState) throw new Error('authority state missing');
      const roomEpoch = authorityState.snapshot.roomEpoch;
      const configRevision = authorityState.snapshot.revision;
      const timestamp = '2026-08-28T00:01:00.000Z';
      const expiresAt = '2026-08-28T01:00:00.000Z';
      const memberStoryMessage = nextMatchingMessage(socket, (message) => (
        message.type === 'story.delta'
        && message.generationId === 'generation-real-ws-story'
      ));
      const hostStoryMessage = nextMatchingMessage(openedHost.socket, (message) => (
        message.type === 'story.delta'
        && message.generationId === 'generation-real-ws-story'
      ));
      const reservationAuthority = issueArenaRoomGenerationReservationAuthority({
        actorUserId: host.member.userId,
        accountUserId: 101,
        roomId: 'room-1',
        roomEpoch,
        configRevision,
        generationRequestId: 'request-real-ws-story',
        generationId: 'generation-real-ws-story',
        attempt: 1,
        snapshotDigest: `sha256:${'a'.repeat(64)}`,
        generationPayloadDigest: `sha256:${'b'.repeat(64)}`,
        expiresAt,
      });
      await actor.execute({
        authority: reservationAuthority,
        command: {
          type: 'reserve-generation',
          expectedRoomEpoch: roomEpoch,
          expectedRevision: configRevision,
          generationRequestId: 'request-real-ws-story',
          generationId: 'generation-real-ws-story',
          attempt: 1,
          generationPayloadDigest: `sha256:${'b'.repeat(64)}`,
          timestamp,
        },
        trustedTime: issueArenaRoomTrustedTime({ now: timestamp }),
      });
      const publisherAuthority = issueArenaRoomGenerationPublisherAuthority({
        roomId: 'room-1',
        roomEpoch,
        generationRequestId: 'request-real-ws-story',
        generationId: 'generation-real-ws-story',
        attempt: 1,
        expiresAt,
      });
      await actor.execute({
        authority: publisherAuthority,
        command: {
          type: 'mirror-generation',
          expectedRoomEpoch: roomEpoch,
          generationRequestId: 'request-real-ws-story',
          generationId: 'generation-real-ws-story',
          attempt: 1,
          state: 'running',
          timestamp,
        },
        trustedTime: issueArenaRoomTrustedTime({ now: timestamp }),
      });
      const story = {
        protocolVersion: 1 as const,
        type: 'story.delta' as const,
        roomId: 'room-1',
        roomEpoch,
        generationId: 'generation-real-ws-story',
        chunkSeq: 0,
        timestamp,
        payload: { delta: '真实 WebSocket 正文' },
      };
      await expect(actor.publishStory({
        authority: publisherAuthority,
        event: story,
        trustedTime: issueArenaRoomTrustedTime({ now: timestamp }),
      })).resolves.toEqual({ ok: true, kind: 'published' });
      await expect(Promise.all([
        within(memberStoryMessage, 'real-websocket-member-story'),
        within(hostStoryMessage, 'real-websocket-host-story'),
      ])).resolves.toEqual([story, story]);

      const firstMemberPublisherStory = nextMatchingMessage(socket, (message) => (
        message.type === 'story.delta'
        && message.generationId === 'generation-real-ws-story'
        && message.payload.delta === '房主在线时由 Hosted batch 合并发布'
      ));
      const firstHostPublisherStory = nextMatchingMessage(openedHost.socket, (message) => (
        message.type === 'story.delta'
        && message.generationId === 'generation-real-ws-story'
        && message.payload.delta === '房主在线时由 Hosted batch 合并发布'
      ));
      const memberPublisherStoryAfterDisconnect = nextMatchingMessage(socket, (message) => (
        message.type === 'story.delta'
        && message.generationId === 'generation-real-ws-story'
        && message.payload.delta === '房主断线后仍由服务器继续发布'
      ));
      const memberPublisherTerminal = nextMatchingMessage(socket, (message) => (
        message.type === 'generation.completed'
        && message.payload.generationId === 'generation-real-ws-story'
      ));
      let producerStarts = 0;
      let releaseFirstBatch!: () => void;
      let releaseSecondBatch!: () => void;
      const firstBatchGate = new Promise<void>((resolve) => { releaseFirstBatch = resolve; });
      const secondBatchGate = new Promise<void>((resolve) => { releaseSecondBatch = resolve; });
      const generationService = createArenaGenerationService({
        store: createMemoryGenerationReplayStore(),
        executor: {
          async execute({ emit }) {
            producerStarts += 1;
            await firstBatchGate;
            await emit({ type: 'markdown', data: { chunk: '房主在线时由 ' } });
            await emit({ type: 'markdown', data: { chunk: 'Hosted batch 合并发布' } });
            await secondBatchGate;
            await emit({ type: 'markdown', data: { chunk: '房主断线后仍由' } });
            await emit({ type: 'markdown', data: { chunk: '服务器继续发布' } });
            return {
              status: 'completed' as const,
              resultRef: 'r2:real-ws-batched-report',
            };
          },
        },
        resolveActor: async () => ({ actorKey: 'pvp-room:room-1' }),
        deriveGenerationId: async () => 'generation-real-ws-story',
        hashPayload: async (payload) => `test:${JSON.stringify(payload)}`,
        now: () => new Date(timestamp),
        replayPollMs: 1,
        deltaFlushIntervalMs: 75,
        deltaFlushBytes: 1_024,
      });
      const generationPort = createArenaRoomGenerationPort({
        generationService,
        pvpAuthority: { sign: async () => 'real-ws-pvp-signature' },
        internalGuidanceAuthority: { sign: async () => 'real-ws-guidance-signature' },
        deriveGenerationId: async () => 'generation-real-ws-story',
        canonicalizeSemanticPayload: async ({ payload }) => structuredClone(payload),
      });
      const started = await generationPort.startFromHostRequest({
        request: new Request('https://api.example.test/api/arena/generate-stream', {
          method: 'POST',
          headers: { authorization: 'Bearer real-ws-host' },
        }),
        roomId: 'room-1',
        generationRequestId: 'request-real-ws-story',
        payload: { mode: 'classic' },
        internalGuidance: 'server-owned real WebSocket batch test',
        pvpContext: {
          matchId: 'generation-real-ws-story',
          roundId: 'attempt-1',
        },
        multiplayerSnapshot: createArenaRoomGenerationSnapshot(
          authorityState,
          'request-real-ws-story',
        ),
      });
      if (started.kind !== 'subscribed') {
        throw new Error(`real Hosted generation rejected:${started.code}`);
      }
      const publisher = createRoomGenerationPublisher({
        actor,
        authority: publisherAuthority,
        now: () => Date.parse(timestamp),
      });
      const publishing = publisher.attach(started.subscription);

      releaseFirstBatch();
      await expect(Promise.all([
        within(firstMemberPublisherStory, 'member-real-hosted-batch'),
        within(firstHostPublisherStory, 'host-real-hosted-batch'),
      ])).resolves.toEqual([
        expect.objectContaining({
          type: 'story.delta',
          chunkSeq: 1,
          payload: { delta: '房主在线时由 Hosted batch 合并发布' },
        }),
        expect.objectContaining({
          type: 'story.delta',
          chunkSeq: 1,
          payload: { delta: '房主在线时由 Hosted batch 合并发布' },
        }),
      ]);

      const hostDisconnected = nextClose(openedHost.socket);
      openedHost.socket.close(1000, 'host-client-disconnected');
      await expect(within(hostDisconnected, 'host-client-disconnected')).resolves.toMatchObject({
        code: 1000,
      });
      releaseSecondBatch();

      await expect(within(publishing, 'server-owned-publisher')).resolves.toEqual({
        kind: 'completed',
        generationRecordId: 'generation-real-ws-story',
      });
      await expect(Promise.all([
        within(memberPublisherStoryAfterDisconnect, 'member-publisher-story-after-host-disconnect'),
        within(memberPublisherTerminal, 'member-publisher-terminal-after-host-disconnect'),
      ])).resolves.toEqual([
        expect.objectContaining({
          type: 'story.delta',
          chunkSeq: 2,
          payload: { delta: '房主断线后仍由服务器继续发布' },
        }),
        expect.objectContaining({
          type: 'generation.completed',
          payload: expect.objectContaining({
            generationId: 'generation-real-ws-story',
            generationRecordId: 'generation-real-ws-story',
          }),
        }),
      ]);
      expect(producerStarts).toBe(1);

      await expect(within(new Promise<number>((resolve, reject) => {
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
      }), 'ticket-replay-response')).resolves.toBe(401);

      const close = nextClose(socket);
      await memberships.kick({
        roomId: 'room-1',
        accountUserId: 101,
        targetUserId: member.member.userId,
        expectedRoomEpoch: roomEpoch,
      });
      await expect(within(close, 'kick-close')).resolves.toEqual({
        code: 1008,
        reason: 'membership-revoked',
      });
      expect(store.state?.memberAuthority.find((entry) => entry.accountUserId === 202)?.member)
        .toMatchObject({ membershipState: 'revoked' });
    } finally {
      await within(gateway.shutdown(), 'gateway-shutdown');
      for (const socket of sockets) if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
      await within(new Promise<void>((resolve) => server.close(() => resolve())), 'server-close');
      await within(actors.shutdown(), 'actors-shutdown');
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
      references: createTestArenaDataCardRefVerifier(),
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
