import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import {
  monitorEventLoopDelay,
  performance,
} from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { createAdaptorServer } from '@hono/node-server';
import {
  ARENA_ROOM_WEBSOCKET_PROTOCOL,
  type ArenaRoomSharedConfig,
  type RoomServerTransportMessage,
} from '@mahoshojo/contracts/arena-room';
import { Hono } from 'hono';
import { createClient } from 'redis';
import WebSocket from 'ws';

import { createArenaRoomRedisKeyspace } from '../src/arena-room/redis-room-keyspace';
import { createRoomActorRegistry } from '../src/arena-room/room-actor-registry';
import type {
  ArenaRoomRuntimeObservation,
  ArenaRoomRuntimeObserver,
} from '../src/arena-room/runtime-observer';
import {
  createArenaRoomTicketCodec,
  createArenaRoomTicketSignatureService,
} from '../src/arena-room/room-ticket';
import { createArenaRoomWebSocketAuthority } from '../src/arena-room/room-websocket-authority';
import {
  ARENA_ROOM_WEBSOCKET_PATH,
  RoomWebSocketGateway,
} from '../src/arena-room/room-websocket-gateway';
import {
  createRoomRequestDispatcher,
  createRoomWebSocketApp,
  createRoomWebSocketServer,
} from '../src/arena-room/room-websocket-transport';
import {
  RedisRuntime,
  type RedisRuntimeOperationObservation,
  type RedisRuntimeObserver,
  type RedisServerStatsObservation,
} from '../src/redis/runtime';
import { requireSafeRoomVerifierPrefix } from './room-verifier-safety';
import { createRoomVerifierMembershipService } from './room-verifier-membership';

const OUTBOUND_QUEUE_MAX_BYTES = 256 * 1_024;
const ACTOR_QUEUE_MAX_COMMANDS = 64;
const VERIFIER_TIMEOUT_MS = 30_000;
const BROWSER_ORIGIN = 'https://hardening-load.loopback.invalid';

export const HARDENING_LOAD_WORKLOAD = Object.freeze({
  rooms: 32,
  socketsPerRoom: 4,
  membershipTransitionsPerRoom: 4,
  configTransitionsPerRoom: 16,
  authorityTransitionsPerRoom: 20,
  totalSockets: 128,
  totalAuthorityTransitions: 640,
});

type HardeningLoadEnvironment = Readonly<{
  redisUrl: string;
  keyPrefix: string;
}>;

const safeKeyPrefix = (value: string | undefined): string => {
  return requireSafeRoomVerifierPrefix({
    environmentName: 'ROOM_HARDENING_LOAD_KEY_PREFIX',
    maxLength: 32,
    value,
  });
};

export const parseRoomHardeningLoadEnvironment = (
  environment: Readonly<Record<string, string | undefined>>,
): HardeningLoadEnvironment => {
  if (environment.ROOM_HARDENING_LOAD_VERIFY?.trim().toLowerCase() !== 'true') {
    throw new Error('Room hardening load verifier 只允许 ROOM_HARDENING_LOAD_VERIFY=true');
  }
  const hostedApiEnvironment = environment.HOSTED_API_ENVIRONMENT?.trim().toLowerCase();
  if (hostedApiEnvironment !== 'local' && hostedApiEnvironment !== 'test') {
    throw new Error('HOSTED_API_ENVIRONMENT 必须显式设为 local 或 test');
  }
  if (environment.NODE_ENV?.trim().toLowerCase() === 'production') {
    throw new Error('Room hardening load verifier 只允许非生产环境');
  }
  const redisUrl = environment.REDIS_URL?.trim();
  if (!redisUrl) throw new Error('Room hardening load verifier 需要 REDIS_URL');
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(redisUrl);
  } catch {
    throw new Error('Room hardening load verifier REDIS_URL 无效');
  }
  if (
    !['redis:', 'rediss:'].includes(parsedUrl.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname)
  ) {
    throw new Error('Room hardening load verifier 只允许连接 loopback Redis');
  }
  return Object.freeze({
    redisUrl,
    keyPrefix: safeKeyPrefix(environment.ROOM_HARDENING_LOAD_KEY_PREFIX),
  });
};

export const isolatedRoomKeyPatterns = (keyPrefixInput: string): readonly string[] => {
  const keyPrefix = safeKeyPrefix(keyPrefixInput);
  return Object.freeze([
    `mahoshojo:room:v1:${keyPrefix}:*`,
    `mahoshojo:room-directory:v1:${keyPrefix}:*`,
    `mahoshojo:room-ticket:v1:${keyPrefix}:*`,
  ]);
};

type OutcomeCounts = Record<string, number>;

const increment = (counts: OutcomeCounts, key: string): void => {
  counts[key] = (counts[key] ?? 0) + 1;
};

class HardeningLoadObserver implements ArenaRoomRuntimeObserver, RedisRuntimeObserver {
  readonly actorOperationDurationsMs: number[] = [];
  readonly checkpointDurationsMs: number[] = [];
  readonly checkpointBytes: number[] = [];
  readonly actorOperationOutcomes: OutcomeCounts = {};
  readonly checkpointOutcomes: OutcomeCounts = {};
  readonly redisOperationOutcomes: OutcomeCounts = {};
  readonly syncActions: OutcomeCounts = {};
  readonly incidents: OutcomeCounts = {};
  activeRoomsCurrent = 0;
  activeRoomsPeak = 0;
  residentActorsCurrent = 0;
  residentActorsPeak = 0;
  actorQueuedCurrent = 0;
  actorQueuedPeak = 0;
  roomQueuedPeak = 0;
  actorOverloads = 0;
  activeSocketsCurrent = 0;
  activeSocketsPeak = 0;
  socketOpened = 0;
  socketClosed = 0;
  outboundQueuedFramesCurrent = 0;
  outboundQueuedFramesPeak = 0;
  outboundQueuedBytesCurrent = 0;
  outboundQueuedBytesPeak = 0;
  slowConsumerCloses = 0;
  lastCheckpointSerializedBytes: number | null = null;
  redisServerStats: RedisServerStatsObservation | null = null;

  observeArenaRoomRuntime(observation: ArenaRoomRuntimeObservation): void {
    switch (observation.event) {
      case 'registry':
        this.activeRoomsCurrent = observation.activeRooms;
        this.activeRoomsPeak = Math.max(this.activeRoomsPeak, observation.activeRooms);
        this.residentActorsCurrent = observation.residentActors;
        this.residentActorsPeak = Math.max(this.residentActorsPeak, observation.residentActors);
        break;
      case 'actor_queue':
        this.actorQueuedCurrent = observation.queuedCurrent;
        this.actorQueuedPeak = Math.max(this.actorQueuedPeak, observation.queuedCurrent);
        this.roomQueuedPeak = Math.max(this.roomQueuedPeak, observation.roomQueuedCurrent);
        if (observation.overloaded) this.actorOverloads += 1;
        break;
      case 'actor_operation':
        this.actorOperationDurationsMs.push(observation.durationMs);
        increment(this.actorOperationOutcomes, `${observation.operation}:${observation.outcome}`);
        break;
      case 'checkpoint':
        this.checkpointDurationsMs.push(observation.durationMs);
        if (observation.serializedBytes !== undefined) {
          this.checkpointBytes.push(observation.serializedBytes);
          this.lastCheckpointSerializedBytes = observation.serializedBytes;
        }
        increment(this.checkpointOutcomes, `${observation.operation}:${observation.outcome}`);
        break;
      case 'socket':
        if (observation.action === 'opened') {
          this.socketOpened += 1;
          this.activeSocketsCurrent += 1;
          this.activeSocketsPeak = Math.max(this.activeSocketsPeak, this.activeSocketsCurrent);
        } else {
          this.socketClosed += 1;
          this.activeSocketsCurrent = Math.max(0, this.activeSocketsCurrent - 1);
        }
        break;
      case 'socket_backlog':
        this.outboundQueuedFramesCurrent = observation.queuedFrames;
        this.outboundQueuedFramesPeak = Math.max(
          this.outboundQueuedFramesPeak,
          observation.queuedFrames,
        );
        this.outboundQueuedBytesCurrent = observation.queuedBytes;
        this.outboundQueuedBytesPeak = Math.max(
          this.outboundQueuedBytesPeak,
          observation.queuedBytes,
        );
        break;
      case 'slow_consumer_resync_close':
        this.slowConsumerCloses += 1;
        break;
      case 'sync':
        increment(
          this.syncActions,
          observation.action === 'delivery'
            ? `${observation.action}:${observation.mode}`
            : observation.action,
        );
        break;
      case 'incident':
        increment(this.incidents, observation.outcome);
        break;
      case 'publisher':
      case 'publisher_backlog':
      case 'publisher_outcome':
        break;
    }
  }

  observeRedisOperation(observation: RedisRuntimeOperationObservation): void {
    increment(this.redisOperationOutcomes, `${observation.operation}:${observation.outcome}`);
  }

  observeRedisServerStats(observation: RedisServerStatsObservation): void {
    this.redisServerStats = observation;
  }

  errorCount(): number {
    const actorErrors = Object.entries(this.actorOperationOutcomes)
      .filter(([key]) => key.endsWith(':error') || key.endsWith(':rejected'))
      .reduce((total, [, count]) => total + count, 0);
    const checkpointErrors = Object.entries(this.checkpointOutcomes)
      .filter(([key]) => (
        key.endsWith(':error')
        || key.endsWith(':unavailable')
        || key.endsWith(':conflict')
      ))
      .reduce((total, [, count]) => total + count, 0);
    const redisErrors = Object.entries(this.redisOperationOutcomes)
      .filter(([key]) => key.endsWith(':error') || key.endsWith(':unavailable'))
      .reduce((total, [, count]) => total + count, 0);
    return actorErrors + checkpointErrors + redisErrors + this.actorOverloads;
  }
}

const sharedConfig = (): ArenaRoomSharedConfig => ({
  battleMode: 'classic',
  combatants: [{
    key: 'data-card:hardening-load-character',
    ref: {
      id: 'hardening-load-character',
      kind: 'character',
      versionToken: 'v1',
    },
  }],
  teams: [],
  scenario: null,
  auxScenarios: [],
  materials: [],
  userGuidance: '',
  storyLength: 'standard',
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

const percentile = (values: readonly number[], target: number): number | null => {
  if (values.length === 0) return null;
  const ordered = values
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  if (ordered.length === 0) return null;
  const index = Math.max(0, Math.ceil(ordered.length * target) - 1);
  return Number(ordered[index]!.toFixed(3));
};

const durationSummary = (values: readonly number[]) => Object.freeze({
  samples: values.length,
  p50Ms: percentile(values, 0.5),
  p95Ms: percentile(values, 0.95),
  p99Ms: percentile(values, 0.99),
});

const within = <T>(operation: Promise<T>, label: string): Promise<T> => new Promise(
  (resolveWithin, rejectWithin) => {
    const timeout = setTimeout(
      () => rejectWithin(new Error(`ROOM_HARDENING_LOAD_TIMEOUT:${label}`)),
      VERIFIER_TIMEOUT_MS,
    );
    timeout.unref();
    void operation.then(
      (value) => {
        clearTimeout(timeout);
        resolveWithin(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        rejectWithin(error);
      },
    );
  },
);

const waitFor = async (
  accept: () => boolean,
  code: string,
  timeoutMs = VERIFIER_TIMEOUT_MS,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (accept()) return;
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 5));
  }
  throw new Error(code);
};

const createCleanupClient = (redisUrl: string) => createClient({
  url: redisUrl,
  socket: {
    connectTimeout: 5_000,
    reconnectStrategy: false,
  },
});

type CleanupClient = ReturnType<typeof createCleanupClient>;

const isolatedKeys = async (
  client: CleanupClient,
  keyPrefix: string,
): Promise<string[]> => {
  const keys: string[] = [];
  for (const pattern of isolatedRoomKeyPatterns(keyPrefix)) {
    for await (const batch of client.scanIterator({ MATCH: pattern, COUNT: 200 })) {
      keys.push(...batch);
    }
  }
  return [...new Set(keys)].sort();
};

const deleteIsolatedKeys = async (
  client: CleanupClient,
  keyPrefix: string,
): Promise<number> => {
  const keys = await isolatedKeys(client, keyPrefix);
  if (keys.length > 0) await client.del(keys);
  return keys.length;
};

const inspectSecretPersistence = async (
  client: CleanupClient,
  keyPrefix: string,
  secretCanary: string,
): Promise<Readonly<{ scannedKeys: number; secretPersisted: boolean }>> => {
  let scannedKeys = 0;
  for (const key of await isolatedKeys(client, keyPrefix)) {
    scannedKeys += 1;
    const type = await client.type(key);
    let value: unknown = null;
    if (type === 'string') value = await client.get(key);
    else if (type === 'stream') value = await client.xRange(key, '-', '+');
    else if (type === 'set') value = await client.sMembers(key);
    else if (type === 'zset') value = await client.zRangeWithScores(key, 0, -1);
    else if (type === 'hash') value = await client.hGetAll(key);
    else if (type === 'list') value = await client.lRange(key, 0, -1);
    if (JSON.stringify(value).includes(secretCanary)) {
      return { scannedKeys, secretPersisted: true };
    }
  }
  return { scannedKeys, secretPersisted: false };
};

type ClientCounters = {
  messages: number;
  invalidMessages: number;
  errors: number;
};

const openRoomSocket = async (input: Readonly<{
  origin: string;
  ticket: string;
  expectedRoomId: string;
  counters: ClientCounters;
  sockets: Set<WebSocket>;
}>): Promise<WebSocket> => {
  const socket = new WebSocket(
    `${input.origin}${ARENA_ROOM_WEBSOCKET_PATH}?ticket=${encodeURIComponent(input.ticket)}`,
    ARENA_ROOM_WEBSOCKET_PROTOCOL,
    { origin: BROWSER_ORIGIN },
  );
  input.sockets.add(socket);
  socket.on('message', (raw, binary) => {
    if (binary) {
      input.counters.invalidMessages += 1;
      return;
    }
    try {
      JSON.parse(raw.toString()) as RoomServerTransportMessage;
      input.counters.messages += 1;
    } catch {
      input.counters.invalidMessages += 1;
    }
  });
  const firstMessage = new Promise<RoomServerTransportMessage>((resolveFirst, rejectFirst) => {
    const onMessage = (raw: WebSocket.RawData, binary: boolean): void => {
      cleanup();
      if (binary) {
        rejectFirst(new Error('ROOM_HARDENING_LOAD_BINARY_MESSAGE'));
        return;
      }
      try {
        resolveFirst(JSON.parse(raw.toString()) as RoomServerTransportMessage);
      } catch {
        rejectFirst(new Error('ROOM_HARDENING_LOAD_MESSAGE_INVALID'));
      }
    };
    const onError = (): void => {
      cleanup();
      rejectFirst(new Error('ROOM_HARDENING_LOAD_SOCKET_OPEN_FAILED'));
    };
    const onUnexpected = (): void => {
      cleanup();
      rejectFirst(new Error('ROOM_HARDENING_LOAD_SOCKET_UPGRADE_REJECTED'));
    };
    const cleanup = (): void => {
      socket.off('message', onMessage);
      socket.off('error', onError);
      socket.off('unexpected-response', onUnexpected);
    };
    socket.on('message', onMessage);
    socket.once('error', onError);
    socket.once('unexpected-response', onUnexpected);
  });
  await within(new Promise<void>((resolveOpen, rejectOpen) => {
    const onOpen = (): void => {
      socket.off('error', onError);
      resolveOpen();
    };
    const onError = (error: Error): void => {
      socket.off('open', onOpen);
      rejectOpen(error);
    };
    socket.once('open', onOpen);
    socket.once('error', onError);
  }), 'socket-open');
  const initial = await within(firstMessage, 'initial-snapshot');
  if (initial.type !== 'room.snapshot' || initial.roomId !== input.expectedRoomId) {
    throw new Error('ROOM_HARDENING_LOAD_INITIAL_SNAPSHOT_INVALID');
  }
  socket.on('error', () => { input.counters.errors += 1; });
  return socket;
};

const closeClientSockets = async (sockets: ReadonlySet<WebSocket>): Promise<void> => {
  await Promise.all([...sockets].map(async (socket) => {
    if (socket.readyState === WebSocket.CLOSED) return;
    const closed = new Promise<void>((resolveClosed) => socket.once('close', () => resolveClosed()));
    if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
    else socket.close(1000, 'hardening-load-finished');
    await within(closed, 'client-close').catch(() => socket.terminate());
  }));
};

const delta = (after: number | null, before: number | null): number | null => (
  after === null || before === null ? null : after - before
);

const runRoomHardeningLoadVerifier = async (
  environment: HardeningLoadEnvironment,
): Promise<void> => {
  const observer = new HardeningLoadObserver();
  const cleanupClient = createCleanupClient(environment.redisUrl);
  cleanupClient.on('error', () => undefined);
  const token = randomUUID().replaceAll('-', '').slice(0, 18);
  const secretCanary = `hardening-load-secret-${token}`;
  const foreignSentinelKey = (
    `mahoshojo:rate-limit:${environment.keyPrefix}:hardening-load-sentinel:${token}`
  );
  const foreignSentinelValue = `preserve-${token}`;
  const keyspace = createArenaRoomRedisKeyspace(environment.keyPrefix);
  const sockets = new Set<WebSocket>();
  const clientCounters: ClientCounters = { messages: 0, invalidMessages: 0, errors: 0 };
  let runtime: RedisRuntime | null = null;
  let actors: ReturnType<typeof createRoomActorRegistry> | null = null;
  let gateway: RoomWebSocketGateway | null = null;
  let server: Server | null = null;
  let initialCleanupKeys = 0;
  let finalCleanupKeys = 0;
  let finalIsolatedKeys = -1;
  let foreignSentinelPreserved = false;

  await cleanupClient.connect();
  try {
    await cleanupClient.set(foreignSentinelKey, foreignSentinelValue);
    initialCleanupKeys = await deleteIsolatedKeys(cleanupClient, environment.keyPrefix);
    if (await cleanupClient.get(foreignSentinelKey) !== foreignSentinelValue) {
      throw new Error('ROOM_HARDENING_LOAD_FOREIGN_SENTINEL_REMOVED');
    }

    runtime = new RedisRuntime(
      environment.redisUrl,
      true,
      observer,
      undefined,
      environment.keyPrefix,
    );
    await runtime.connect();
    const redisBefore = await runtime.sampleServerStats();
    const eventLoop = monitorEventLoopDelay({ resolution: 10 });
    eventLoop.enable();
    const startedAt = performance.now();
    const cpuBefore = process.cpuUsage();
    const memoryBefore = process.memoryUsage();

    let roomIdentityIndex = 0;
    let userIdentityIndex = 0;
    actors = createRoomActorRegistry({
      store: runtime.getRoomStore(),
      observer,
      maxActors: HARDENING_LOAD_WORKLOAD.rooms,
      maxQueuedCommands: ACTOR_QUEUE_MAX_COMMANDS,
      createRoomIdentity: () => {
        const index = roomIdentityIndex;
        roomIdentityIndex += 1;
        return {
          roomId: `gmr10-load-room-${token}-${index}`,
          roomEpoch: `gmr10-load-epoch-${token}-${index}`,
        };
      },
    });
    const memberships = createRoomVerifierMembershipService({
      actors,
      createUserId: () => {
        const index = userIdentityIndex;
        userIdentityIndex += 1;
        return `gmr10-load-user-${token}-${index}`;
      },
    });
    const tickets = createArenaRoomTicketCodec({
      signatures: createArenaRoomTicketSignatureService({
        env: { SIGNATURE_SECRET_KEY: secretCanary },
        logger: { warn: () => undefined, error: () => undefined },
      }),
      createJti: () => `gmr10-load-ticket-${token}-${randomUUID()}`,
    });
    const authority = createArenaRoomWebSocketAuthority({
      actors,
      memberships,
      replay: runtime.getRoomTicketReplayStore(),
      tickets,
      observer,
    });
    gateway = new RoomWebSocketGateway({
      allowedBrowserOrigins: [BROWSER_ORIGIN],
      authorize: authority.authorize,
      observer,
      maxConnectionsPerUser: 1,
      outboundQueueMaxBytes: OUTBOUND_QUEUE_MAX_BYTES,
      shutdownGraceMs: 5_000,
    });
    const http = new Hono();
    http.get('/health', (context) => context.text('ok'));
    server = createAdaptorServer({
      fetch: createRoomRequestDispatcher(http, createRoomWebSocketApp(gateway)),
      websocket: { server: createRoomWebSocketServer() },
    }) as Server;
    await new Promise<void>((resolveListen, rejectListen) => {
      server!.once('error', rejectListen);
      server!.listen(0, '127.0.0.1', resolveListen);
    });
    const address = server.address() as AddressInfo;
    const webSocketOrigin = `ws://127.0.0.1:${address.port}`;

    const rooms = await Promise.all(Array.from(
      { length: HARDENING_LOAD_WORKLOAD.rooms },
      async (_unused, roomIndex) => {
        const accounts = Array.from(
          { length: HARDENING_LOAD_WORKLOAD.socketsPerRoom },
          (_entry, memberIndex) => 10_000 + roomIndex * 100 + memberIndex,
        );
        const host = await memberships.create({
          accountUserId: accounts[0]!,
          displayName: `Load Host ${roomIndex}`,
          sharedConfig: sharedConfig(),
        });
        for (let memberIndex = 1; memberIndex < accounts.length; memberIndex += 1) {
          await memberships.join({
            roomId: host.roomId,
            accountUserId: accounts[memberIndex]!,
            displayName: `Load Member ${memberIndex}`,
          });
        }
        for (const accountUserId of accounts) {
          const ticket = await authority.issue({ roomId: host.roomId, accountUserId });
          await openRoomSocket({
            origin: webSocketOrigin,
            ticket,
            expectedRoomId: host.roomId,
            counters: clientCounters,
            sockets,
          });
        }
        return {
          accountUserId: accounts[0]!,
          hostUserId: host.member.userId,
          roomId: host.roomId,
        };
      },
    ));

    if (
      observer.activeRoomsCurrent !== HARDENING_LOAD_WORKLOAD.rooms
      || observer.residentActorsCurrent !== HARDENING_LOAD_WORKLOAD.rooms
      || observer.activeSocketsCurrent !== HARDENING_LOAD_WORKLOAD.totalSockets
      || sockets.size !== HARDENING_LOAD_WORKLOAD.totalSockets
      || [...sockets].some((socket) => socket.readyState !== WebSocket.OPEN)
    ) {
      throw new Error('ROOM_HARDENING_LOAD_ACTIVE_GAUGE_INVALID');
    }

    const expectedRooms = await Promise.all(rooms.map(async (room, roomIndex) => {
      const actor = actors!.get(room.roomId);
      if (!actor) throw new Error('ROOM_HARDENING_LOAD_ACTOR_MISSING');
      const initial = actor.getSnapshot();
      if (!initial) throw new Error('ROOM_HARDENING_LOAD_STATE_MISSING');
      const initialRevision = initial.snapshot.revision;
      for (
        let transitionIndex = 0;
        transitionIndex < HARDENING_LOAD_WORKLOAD.configTransitionsPerRoom;
        transitionIndex += 1
      ) {
        const state = actor.getSnapshot();
        if (!state) throw new Error('ROOM_HARDENING_LOAD_STATE_MISSING');
        const timestamp = new Date(Math.max(
          Date.now(),
          Date.parse(state.lifecycle.updatedAt) + 1,
        )).toISOString();
        const result = await actor.execute({
          authority: {
            kind: 'authenticated-user',
            actorUserId: room.hostUserId,
            accountUserId: room.accountUserId,
          },
          command: {
            type: 'publish-config',
            expectedRoomEpoch: state.snapshot.roomEpoch,
            expectedRevision: state.snapshot.revision,
            sharedConfig: {
              ...state.snapshot.sharedConfig,
              userGuidance: `hardening-load-${roomIndex}-${transitionIndex}`,
            },
            timestamp,
          },
        });
        if (!result.ok || result.kind !== 'applied') {
          throw new Error('ROOM_HARDENING_LOAD_AUTHORITY_TRANSITION_REJECTED');
        }
      }
      return {
        expectedGuidance: `hardening-load-${roomIndex}-${HARDENING_LOAD_WORKLOAD.configTransitionsPerRoom - 1}`,
        expectedRevision: initialRevision + HARDENING_LOAD_WORKLOAD.configTransitionsPerRoom,
        roomId: room.roomId,
      };
    }));

    const minimumMessages = HARDENING_LOAD_WORKLOAD.totalSockets
      + HARDENING_LOAD_WORKLOAD.rooms
        * HARDENING_LOAD_WORKLOAD.configTransitionsPerRoom
        * HARDENING_LOAD_WORKLOAD.socketsPerRoom;
    await waitFor(
      () => clientCounters.messages >= minimumMessages
        && observer.outboundQueuedFramesCurrent === 0
        && observer.outboundQueuedBytesCurrent === 0,
      'ROOM_HARDENING_LOAD_DELIVERY_TIMEOUT',
    );

    let checkpointRawBytesPeak = 0;
    for (const expected of expectedRooms) {
      observer.lastCheckpointSerializedBytes = null;
      const checkpoint = await runtime.getRoomStore().load(expected.roomId);
      const raw = await cleanupClient.get(keyspace.roomCheckpointKey(expected.roomId));
      const rawBytes = raw === null ? null : Buffer.byteLength(raw, 'utf8');
      if (
        !checkpoint
        || checkpoint.lifecycle.status !== 'open'
        || checkpoint.snapshot.members.filter((member) => member.membershipState === 'active').length
          !== HARDENING_LOAD_WORKLOAD.socketsPerRoom
        || checkpoint.snapshot.revision !== expected.expectedRevision
        || checkpoint.snapshot.sharedConfig.userGuidance !== expected.expectedGuidance
        || raw === null
        || rawBytes === null
      ) {
        throw new Error('ROOM_HARDENING_LOAD_DURABLE_AUTHORITY_INVALID');
      }
      if (observer.lastCheckpointSerializedBytes !== rawBytes) {
        throw new Error('ROOM_HARDENING_LOAD_CHECKPOINT_BYTES_INEXACT');
      }
      checkpointRawBytesPeak = Math.max(checkpointRawBytesPeak, rawBytes);
    }

    const secretInspection = await inspectSecretPersistence(
      cleanupClient,
      environment.keyPrefix,
      secretCanary,
    );
    if (secretInspection.secretPersisted) {
      throw new Error('ROOM_HARDENING_LOAD_SECRET_PERSISTED');
    }
    const isolatedKeyCount = (await isolatedKeys(cleanupClient, environment.keyPrefix)).length;
    const redisAfter = await runtime.sampleServerStats();
    const durationMs = Math.max(0, performance.now() - startedAt);
    const cpu = process.cpuUsage(cpuBefore);
    const memoryAfter = process.memoryUsage();
    eventLoop.disable();

    const appliedActorOperations = Object.entries(observer.actorOperationOutcomes)
      .filter(([key]) => key.endsWith(':applied'))
      .reduce((total, [, count]) => total + count, 0);
    const errorCount = observer.errorCount() + clientCounters.errors + clientCounters.invalidMessages;
    const workloadActorOperationOutcomes = Object.freeze({
      ...observer.actorOperationOutcomes,
    });
    const workloadCheckpointOutcomes = Object.freeze({
      ...observer.checkpointOutcomes,
    });
    const workloadActorLatency = durationSummary(observer.actorOperationDurationsMs);
    const workloadCheckpointLatency = durationSummary(observer.checkpointDurationsMs);
    const workloadCheckpointBytesPeak = Math.max(0, ...observer.checkpointBytes);
    const expectedActorOperations = HARDENING_LOAD_WORKLOAD.totalAuthorityTransitions
      + HARDENING_LOAD_WORKLOAD.rooms;
    const expectedClientMessages = HARDENING_LOAD_WORKLOAD.totalSockets
      + HARDENING_LOAD_WORKLOAD.rooms
        * HARDENING_LOAD_WORKLOAD.configTransitionsPerRoom
        * HARDENING_LOAD_WORKLOAD.socketsPerRoom;
    if (
      appliedActorOperations !== expectedActorOperations
      || clientCounters.messages !== expectedClientMessages
    ) {
      throw new Error('ROOM_HARDENING_LOAD_APPLIED_TRANSITIONS_INVALID');
    }
    if (errorCount !== 0) throw new Error('ROOM_HARDENING_LOAD_ERRORS_OBSERVED');
    if (observer.slowConsumerCloses !== 0) {
      throw new Error('ROOM_HARDENING_LOAD_SLOW_CONSUMER_CLOSE_OBSERVED');
    }
    if (
      observer.activeRoomsCurrent !== HARDENING_LOAD_WORKLOAD.rooms
      || observer.residentActorsCurrent !== HARDENING_LOAD_WORKLOAD.rooms
      || observer.activeSocketsCurrent !== HARDENING_LOAD_WORKLOAD.totalSockets
    ) {
      throw new Error('ROOM_HARDENING_LOAD_ACTIVE_GAUGE_INVALID');
    }
    if (
      observer.actorQueuedPeak > HARDENING_LOAD_WORKLOAD.rooms * ACTOR_QUEUE_MAX_COMMANDS
      || observer.roomQueuedPeak > ACTOR_QUEUE_MAX_COMMANDS
    ) {
      throw new Error('ROOM_HARDENING_LOAD_ACTOR_QUEUE_UNBOUNDED');
    }
    if (
      observer.outboundQueuedBytesPeak
      > HARDENING_LOAD_WORKLOAD.totalSockets * OUTBOUND_QUEUE_MAX_BYTES
    ) {
      throw new Error('ROOM_HARDENING_LOAD_SOCKET_QUEUE_UNBOUNDED');
    }
    if (await cleanupClient.get(foreignSentinelKey) !== foreignSentinelValue) {
      throw new Error('ROOM_HARDENING_LOAD_FOREIGN_SENTINEL_REMOVED');
    }

    await closeClientSockets(sockets);
    await within(gateway.shutdown(), 'gateway-shutdown');
    await within(new Promise<void>((resolveClose, rejectClose) => {
      server!.close((error) => error ? rejectClose(error) : resolveClose());
    }), 'server-close');
    server = null;
    await within(actors.shutdown(), 'actors-shutdown');
    actors = null;
    await runtime.close();
    runtime = null;
    finalCleanupKeys = await deleteIsolatedKeys(cleanupClient, environment.keyPrefix);
    finalIsolatedKeys = (await isolatedKeys(cleanupClient, environment.keyPrefix)).length;
    foreignSentinelPreserved = await cleanupClient.get(foreignSentinelKey) === foreignSentinelValue;
    if (
      finalIsolatedKeys !== 0
      || !foreignSentinelPreserved
      || Number(observer.activeSocketsCurrent) !== 0
      || Number(observer.activeRoomsCurrent) !== 0
      || Number(observer.residentActorsCurrent) !== 0
    ) {
      throw new Error('ROOM_HARDENING_LOAD_CLEANUP_INVALID');
    }

    console.log(JSON.stringify({
      verifier: 'GMR10_ROOM_HARDENING_LOAD',
      environment: 'non-production-loopback',
      workload: HARDENING_LOAD_WORKLOAD,
      authority: {
        correct: true,
        appliedActorOperations,
        actorOperationOutcomes: workloadActorOperationOutcomes,
        checkpointOutcomes: workloadCheckpointOutcomes,
      },
      durationMs: Number(durationMs.toFixed(3)),
      latency: {
        actor: workloadActorLatency,
        checkpoint: workloadCheckpointLatency,
      },
      queue: {
        actorQueuedPeak: observer.actorQueuedPeak,
        roomQueuedPeak: observer.roomQueuedPeak,
        configuredPerRoomLimit: ACTOR_QUEUE_MAX_COMMANDS,
        outboundQueuedFramesPeak: observer.outboundQueuedFramesPeak,
        outboundQueuedBytesPeak: observer.outboundQueuedBytesPeak,
        configuredPerSocketBytesLimit: OUTBOUND_QUEUE_MAX_BYTES,
      },
      sockets: {
        activePeak: observer.activeSocketsPeak,
        opened: observer.socketOpened,
        closed: observer.socketClosed,
        messagesReceived: clientCounters.messages,
        slowConsumerCloses: observer.slowConsumerCloses,
      },
      actors: {
        activeRoomsPeak: observer.activeRoomsPeak,
        residentActorsPeak: observer.residentActorsPeak,
      },
      checkpoint: {
        serializedBytesPeak: workloadCheckpointBytesPeak,
        verifiedFinalSerializedBytesPeak: checkpointRawBytesPeak,
        keysBeforeCleanup: isolatedKeyCount,
      },
      redisProcess: {
        usedMemoryBytesBefore: redisBefore?.usedMemoryBytes ?? null,
        usedMemoryBytesAfter: redisAfter?.usedMemoryBytes ?? null,
        usedMemoryBytesDelta: delta(
          redisAfter?.usedMemoryBytes ?? null,
          redisBefore?.usedMemoryBytes ?? null,
        ),
        evictedKeysBefore: redisBefore?.evictedKeys ?? null,
        evictedKeysAfter: redisAfter?.evictedKeys ?? null,
        evictedKeysDelta: delta(
          redisAfter?.evictedKeys ?? null,
          redisBefore?.evictedKeys ?? null,
        ),
      },
      process: {
        cpuUserMs: Number((cpu.user / 1_000).toFixed(3)),
        cpuSystemMs: Number((cpu.system / 1_000).toFixed(3)),
        rssBytesBefore: memoryBefore.rss,
        rssBytesAfter: memoryAfter.rss,
        rssBytesDelta: memoryAfter.rss - memoryBefore.rss,
        heapUsedBytesBefore: memoryBefore.heapUsed,
        heapUsedBytesAfter: memoryAfter.heapUsed,
        heapUsedBytesDelta: memoryAfter.heapUsed - memoryBefore.heapUsed,
        eventLoopP50Ms: Number((eventLoop.percentile(50) / 1e6).toFixed(3)),
        eventLoopP95Ms: Number((eventLoop.percentile(95) / 1e6).toFixed(3)),
        eventLoopP99Ms: Number((eventLoop.percentile(99) / 1e6).toFixed(3)),
      },
      errors: errorCount,
      secretScan: {
        scannedKeys: secretInspection.scannedKeys,
        secretPersisted: secretInspection.secretPersisted,
      },
      cleanup: {
        initialCleanupKeys,
        finalCleanupKeys,
        remainingIsolatedKeys: finalIsolatedKeys,
        foreignSentinelPreserved,
      },
      serviceLevelObjective: null,
    }));
  } finally {
    await closeClientSockets(sockets).catch(() => undefined);
    await gateway?.shutdown().catch(() => undefined);
    if (server?.listening) {
      await new Promise<void>((resolveClose) => server!.close(() => resolveClose()));
    }
    await actors?.shutdown().catch(() => undefined);
    await runtime?.close().catch(() => undefined);
    if (!cleanupClient.isOpen) await cleanupClient.connect().catch(() => undefined);
    if (cleanupClient.isOpen) {
      await deleteIsolatedKeys(cleanupClient, environment.keyPrefix).catch(() => undefined);
      await cleanupClient.del(foreignSentinelKey).catch(() => undefined);
      await cleanupClient.quit().catch(() => cleanupClient.destroy());
    }
  }
};

const isMain = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const environment = parseRoomHardeningLoadEnvironment(process.env);
  await runRoomHardeningLoadVerifier(environment);
}
