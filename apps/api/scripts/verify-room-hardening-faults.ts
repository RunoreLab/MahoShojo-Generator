import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createAdaptorServer } from '@hono/node-server';
import {
  ARENA_ROOM_WEBSOCKET_PROTOCOL,
  type RoomServerTransportMessage,
} from '@mahoshojo/contracts/arena-room';
import { Hono } from 'hono';
import { createClient } from 'redis';
import WebSocket from 'ws';

import { createArenaRoomDirectoryService } from '../src/arena-room/room-directory-service';
import { createArenaRoomRedisKeyspace } from '../src/arena-room/redis-room-keyspace';
import { createRoomActorRegistry } from '../src/arena-room/room-actor-registry';
import { createArenaRoomMembershipService } from '../src/arena-room/room-membership-service';
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
import type { ArenaRoomRuntimeObservation } from '../src/arena-room/runtime-observer';
import { RedisRuntime } from '../src/redis/runtime';
import { requireSafeRoomVerifierPrefix } from './room-verifier-safety';

const redisUrl = process.env.REDIS_URL?.trim();
if (!redisUrl) throw new Error('Room hardening faults verifier 需要 REDIS_URL');
if (process.env.ROOM_HARDENING_VERIFY?.trim().toLowerCase() !== 'true') {
  throw new Error('Room hardening faults verifier 只允许 ROOM_HARDENING_VERIFY=true');
}
const hostedApiEnvironment = process.env.HOSTED_API_ENVIRONMENT?.trim().toLowerCase();
if (hostedApiEnvironment !== 'local' && hostedApiEnvironment !== 'test') {
  throw new Error('HOSTED_API_ENVIRONMENT 必须显式设为 local 或 test');
}
if (process.env.NODE_ENV?.trim().toLowerCase() === 'production') {
  throw new Error('Room hardening faults verifier 只允许非生产环境');
}
const parsedUrl = new URL(redisUrl);
if (
  !['redis:', 'rediss:'].includes(parsedUrl.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname)
) throw new Error('Room hardening faults verifier 只允许连接 loopback Redis');

const basePrefix = requireSafeRoomVerifierPrefix({
  environmentName: 'ROOM_HARDENING_VERIFY_KEY_PREFIX',
  maxLength: 20,
  value: process.env.ROOM_HARDENING_VERIFY_KEY_PREFIX,
});

const scenarioPrefixes = Object.freeze({
  restart: `${basePrefix}_restart`,
  loss: `${basePrefix}_loss`,
  vps: `${basePrefix}_vps`,
});
const cleanupClient = createClient({
  url: redisUrl,
  socket: { connectTimeout: 5_000, reconnectStrategy: false },
});
cleanupClient.on('error', () => undefined);
const foreignSentinelKey = `mahoshojo:rate-limit:${basePrefix}:foreign-sentinel`;
const foreignSentinelValue = 'preserve-hardening-fault-verifier';
const secretCanary = 'hardening-local-signature-secret-at-least-32-characters';

const sharedConfig = () => ({
  battleMode: 'classic' as const,
  combatants: [{
    key: 'data-card:hardening-character',
    ref: { id: 'hardening-character', kind: 'character' as const, versionToken: 'v1' },
  }],
  teams: [],
  scenario: null,
  auxScenarios: [],
  materials: [],
  userGuidance: '',
  storyLength: 'standard' as const,
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

const patternsFor = (prefix: string): readonly string[] => [
  `mahoshojo:room:v1:${prefix}:*`,
  `mahoshojo:room-directory:v1:${prefix}:*`,
  `mahoshojo:room-ticket:v1:${prefix}:*`,
];

const keysForPatterns = async (patterns: readonly string[]): Promise<string[]> => {
  const keys = new Set<string>();
  for (const pattern of patterns) {
    for await (const batch of cleanupClient.scanIterator({ MATCH: pattern, COUNT: 200 })) {
      for (const key of batch) keys.add(key);
    }
  }
  return [...keys];
};

const deletePatterns = async (patterns: readonly string[]): Promise<number> => {
  const keys = await keysForPatterns(patterns);
  return keys.length === 0 ? 0 : cleanupClient.del(keys);
};

const inspectSecretPersistence = async (): Promise<{ scannedKeys: number; persisted: boolean }> => {
  const keys = await keysForPatterns(Object.values(scenarioPrefixes).flatMap(patternsFor));
  for (const key of keys) {
    const type = await cleanupClient.type(key);
    let value: unknown = null;
    if (type === 'string') value = await cleanupClient.get(key);
    else if (type === 'set') value = await cleanupClient.sMembers(key);
    else if (type === 'zset') value = await cleanupClient.zRange(key, 0, -1);
    else if (type === 'hash') value = await cleanupClient.hGetAll(key);
    if (JSON.stringify(value).includes(secretCanary)) {
      return { scannedKeys: keys.length, persisted: true };
    }
  }
  return { scannedKeys: keys.length, persisted: false };
};

const within = <T>(operation: Promise<T>, label: string, timeoutMs = 3_000): Promise<T> => (
  Promise.race([
    operation,
    new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`ROOM_HARDENING_TIMEOUT:${label}`)), timeoutMs);
      timer.unref();
    }),
  ])
);

const expectErrorCode = async (operation: Promise<unknown>, code: string): Promise<void> => {
  try {
    await operation;
  } catch (error) {
    if (error instanceof Error && error.message === code) return;
    throw error;
  }
  throw new Error(`ROOM_HARDENING_EXPECTED_ERROR_MISSING:${code}`);
};

const listenHonoApp = async (app: Hono): Promise<Readonly<{
  baseUrl: string;
  server: Server;
}>> => {
  const server = createAdaptorServer({ fetch: app.fetch }) as Server;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return Object.freeze({ baseUrl: `http://127.0.0.1:${address.port}`, server });
};

const closeHonoServer = async (server: Server | null): Promise<void> => {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
};

const readRedisRunId = async (): Promise<string> => {
  const info = await cleanupClient.info('server');
  const runId = /^run_id:([^\r\n]+)$/mu.exec(info)?.[1];
  if (!runId) throw new Error('ROOM_HARDENING_REDIS_RUN_ID_MISSING');
  return runId;
};

type RestartSession = Readonly<{
  member: Readonly<{ userId: string }>;
  roomEpoch: string;
  roomId: string;
}>;

const readRestartSession = async (
  url: string,
  init?: RequestInit,
): Promise<RestartSession> => {
  const response = await within(fetch(url, init), 'hono-restart-http');
  if (!response.ok) throw new Error(`ROOM_HARDENING_HONO_HTTP_${response.status}`);
  return response.json() as Promise<RestartSession>;
};

const honoRestartRedisSurvivor = async () => {
  const prefix = scenarioPrefixes.restart;
  const roomId = 'room-hardening-restart';
  let firstRuntime: RedisRuntime | null = new RedisRuntime(redisUrl, true, undefined, undefined, prefix);
  let firstActors: ReturnType<typeof createRoomActorRegistry> | null = null;
  let firstServer: Server | null = null;
  let secondRuntime: RedisRuntime | null = null;
  let secondActors: ReturnType<typeof createRoomActorRegistry> | null = null;
  let secondServer: Server | null = null;
  try {
    const redisRunIdBefore = await readRedisRunId();
    await firstRuntime.connect();
    firstActors = createRoomActorRegistry({
      store: firstRuntime.getRoomStore(),
      createRoomIdentity: () => ({ roomId, roomEpoch: 'restart-epoch-1' }),
    });
    const memberships = createArenaRoomMembershipService({
      actors: firstActors,
      createUserId: () => 'restart-host',
    });
    const firstApp = new Hono();
    firstApp.post('/hardening/restart-room', async (context) => context.json(
      await memberships.create({
        accountUserId: 101,
        displayName: 'Restart Host',
        sharedConfig: sharedConfig(),
        directory: { title: 'Restart survivor', visibility: 'public' },
      }),
    ));
    const firstHono = await listenHonoApp(firstApp);
    firstServer = firstHono.server;
    const created = await readRestartSession(`${firstHono.baseUrl}/hardening/restart-room`, {
      method: 'POST',
    });
    const keyspace = createArenaRoomRedisKeyspace(prefix);
    const checkpointBeforeHonoStop = await cleanupClient.get(keyspace.roomCheckpointKey(roomId));
    if (!checkpointBeforeHonoStop) throw new Error('ROOM_HARDENING_RESTART_CHECKPOINT_MISSING');
    await closeHonoServer(firstServer);
    firstServer = null;
    await firstActors.shutdown();
    firstActors = null;
    await firstRuntime.close();
    firstRuntime = null;
    const checkpointAfterHonoStop = await cleanupClient.get(keyspace.roomCheckpointKey(roomId));
    const checkpointUnchangedDuringRestart = checkpointAfterHonoStop === checkpointBeforeHonoStop;
    if (!checkpointUnchangedDuringRestart) throw new Error('ROOM_HARDENING_RESTART_CHECKPOINT_CHANGED');
    const redisRunIdAfterFirstStop = await readRedisRunId();

    secondRuntime = new RedisRuntime(redisUrl, true, undefined, undefined, prefix);
    await secondRuntime.connect();
    secondActors = createRoomActorRegistry({
      store: secondRuntime.getRoomStore(),
      createRoomEpoch: () => 'restart-epoch-2',
    });
    const recoveredMemberships = createArenaRoomMembershipService({ actors: secondActors });
    const secondApp = new Hono();
    secondApp.get('/hardening/restart-room/:roomId', async (context) => context.json(
      await recoveredMemberships.getSession({
        roomId: context.req.param('roomId'),
        accountUserId: 101,
      }),
    ));
    const secondHono = await listenHonoApp(secondApp);
    secondServer = secondHono.server;
    const recovered = await readRestartSession(
      `${secondHono.baseUrl}/hardening/restart-room/${encodeURIComponent(roomId)}`,
    );
    if (
      created.roomEpoch !== 'restart-epoch-1'
      || recovered.roomEpoch !== 'restart-epoch-2'
      || recovered.member.userId !== 'restart-host'
    ) throw new Error('ROOM_HARDENING_RESTART_RECOVERY_INVALID');
    const redisRunIdAfterRecovery = await readRedisRunId();
    const redisRunIdStable = redisRunIdBefore === redisRunIdAfterFirstStop
      && redisRunIdAfterFirstStop === redisRunIdAfterRecovery;
    if (!redisRunIdStable) throw new Error('ROOM_HARDENING_REDIS_RESTARTED');
    const oldEpochFenced = await cleanupClient.sIsMember(
      keyspace.roomIncarnationFenceKey(roomId),
      'restart-epoch-1',
    ) === 1;
    if (!oldEpochFenced) throw new Error('ROOM_HARDENING_RESTART_OLD_EPOCH_NOT_FENCED');
    return Object.freeze({
      checkpointSurvived: true,
      checkpointUnchangedDuringRestart,
      honoServersStarted: 2,
      honoServerRestarted: true,
      redisProcessRestarted: !redisRunIdStable,
      redisRunIdStable,
      recoveredRoomEpoch: recovered.roomEpoch,
      authorityRecovered: true,
      oldEpochFenced,
    });
  } finally {
    await closeHonoServer(firstServer).catch(() => undefined);
    await closeHonoServer(secondServer).catch(() => undefined);
    await firstActors?.shutdown().catch(() => undefined);
    await secondActors?.shutdown().catch(() => undefined);
    await firstRuntime?.close().catch(() => undefined);
    await secondRuntime?.close().catch(() => undefined);
  }
};

const exactCheckpointLoss = async () => {
  const prefix = scenarioPrefixes.loss;
  const roomId = 'room-hardening-loss';
  const replacementRoomId = 'room-hardening-replacement';
  const runtime = new RedisRuntime(redisUrl, true, undefined, undefined, prefix);
  let initialActors: ReturnType<typeof createRoomActorRegistry> | null = null;
  let recoveredActors: ReturnType<typeof createRoomActorRegistry> | null = null;
  try {
    await runtime.connect();
    initialActors = createRoomActorRegistry({
      store: runtime.getRoomStore(),
      createRoomIdentity: () => ({ roomId, roomEpoch: 'loss-epoch-1' }),
    });
    const initialMemberships = createArenaRoomMembershipService({
      actors: initialActors,
      createUserId: () => 'loss-host',
    });
    await initialMemberships.create({
      accountUserId: 201,
      displayName: 'Loss Host',
      sharedConfig: sharedConfig(),
      directory: { title: 'Checkpoint loss', visibility: 'public' },
    });
    initialActors.forceClose();
    initialActors = null;

    const keyspace = createArenaRoomRedisKeyspace(prefix);
    if (await cleanupClient.del(keyspace.roomCheckpointKey(roomId)) !== 1) {
      throw new Error('ROOM_HARDENING_CHECKPOINT_DELETE_MISSING');
    }
    const observations: ArenaRoomRuntimeObservation[] = [];
    const observer = {
      observeArenaRoomRuntime(observation: ArenaRoomRuntimeObservation) {
        observations.push(observation);
      },
    };
    recoveredActors = createRoomActorRegistry({
      store: runtime.getRoomStore(),
      observer,
      createRoomIdentity: () => ({ roomId: replacementRoomId, roomEpoch: 'loss-epoch-2' }),
    });
    const recoveredMemberships = createArenaRoomMembershipService({
      actors: recoveredActors,
      createUserId: () => 'replacement-host',
    });
    if (await recoveredActors.recover(roomId) !== null) {
      throw new Error('ROOM_HARDENING_CHECKPOINT_RESURRECTED');
    }
    await expectErrorCode(
      recoveredMemberships.getSession({ roomId, accountUserId: 201 }),
      'ROOM_NOT_FOUND',
    );
    await expectErrorCode(
      recoveredMemberships.join({
        roomId,
        accountUserId: 202,
        displayName: 'Must Not Resurrect',
      }),
      'ROOM_NOT_FOUND',
    );
    const directory = createArenaRoomDirectoryService({
      authority: runtime.getRoomStore(),
      store: runtime.getRoomDirectoryStore(),
      observer,
    });
    if (await directory.lookup(roomId) !== null) {
      throw new Error('ROOM_HARDENING_STALE_DIRECTORY_VISIBLE');
    }
    if (
      await runtime.getRoomDirectoryStore().getCandidate(roomId) !== null
      || await cleanupClient.zCard(keyspace.directoryPublicIndexKey) !== 0
      || !observations.some((observation) => (
        observation.event === 'incident'
        && observation.outcome === 'replacement_required'
      ))
    ) throw new Error('ROOM_HARDENING_REPLACEMENT_SIGNAL_INVALID');
    const replacement = await recoveredMemberships.create({
      accountUserId: 301,
      displayName: 'Replacement Host',
      sharedConfig: sharedConfig(),
    });
    if (replacement.roomId === roomId || replacement.roomId !== replacementRoomId) {
      throw new Error('ROOM_HARDENING_REPLACEMENT_ROOM_INVALID');
    }
    return Object.freeze({
      exactCheckpointDeleted: true,
      oldRoomRecovered: false,
      staleDirectoryCleaned: true,
      replacementRequiredObserved: true,
      replacementRoomIdChanged: true,
    });
  } finally {
    await initialActors?.shutdown().catch(() => undefined);
    await recoveredActors?.shutdown().catch(() => undefined);
    await runtime.close().catch(() => undefined);
  }
};

const nextMessage = (socket: WebSocket): Promise<RoomServerTransportMessage> => new Promise(
  (resolve, reject) => {
    socket.once('message', (data, binary) => {
      if (binary) reject(new Error('ROOM_HARDENING_BINARY_FRAME_UNEXPECTED'));
      else resolve(JSON.parse(data.toString()) as RoomServerTransportMessage);
    });
    socket.once('error', reject);
  },
);

const nextClose = (socket: WebSocket): Promise<{ code: number; reason: string }> => new Promise(
  (resolve) => socket.once('close', (code, reason) => resolve({
    code,
    reason: reason.toString(),
  })),
);

const vpsUnreachable = async () => {
  const prefix = scenarioPrefixes.vps;
  const roomId = 'room-hardening-vps';
  const runtime = new RedisRuntime(redisUrl, true, undefined, undefined, prefix);
  let actors: ReturnType<typeof createRoomActorRegistry> | null = null;
  let gateway: RoomWebSocketGateway | null = null;
  let server: Server | null = null;
  let socket: WebSocket | null = null;
  try {
    await runtime.connect();
    actors = createRoomActorRegistry({
      store: runtime.getRoomStore(),
      createRoomIdentity: () => ({ roomId, roomEpoch: 'vps-epoch-1' }),
    });
    const memberships = createArenaRoomMembershipService({
      actors,
      createUserId: () => 'vps-host',
    });
    await memberships.create({
      accountUserId: 401,
      displayName: 'VPS Host',
      sharedConfig: sharedConfig(),
    });
    const tickets = createArenaRoomTicketCodec({
      signatures: createArenaRoomTicketSignatureService({
        env: { SIGNATURE_SECRET_KEY: secretCanary },
        logger: { warn: () => undefined, error: () => undefined },
      }),
      createJti: () => 'vps-unreachable-jti',
    });
    const authority = createArenaRoomWebSocketAuthority({
      actors,
      memberships,
      replay: runtime.getRoomTicketReplayStore(),
      tickets,
    });
    gateway = new RoomWebSocketGateway({
      allowedBrowserOrigins: ['https://hardening.example.test'],
      authorize: authority.authorize,
      closeGraceMs: 50,
      heartbeatIntervalMs: 60_000,
      heartbeatTimeoutMs: 60_000,
      shutdownGraceMs: 100,
    });
    const app = new Hono();
    app.get('/health', (context) => context.text('ok'));
    server = createAdaptorServer({
      fetch: createRoomRequestDispatcher(app, createRoomWebSocketApp(gateway)),
      websocket: { server: createRoomWebSocketServer() },
    }) as Server;
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;
    const ticket = await authority.issue({ roomId, accountUserId: 401 });
    socket = new WebSocket(
      `ws://127.0.0.1:${address.port}${ARENA_ROOM_WEBSOCKET_PATH}?ticket=${encodeURIComponent(ticket)}`,
      ARENA_ROOM_WEBSOCKET_PROTOCOL,
      { origin: 'https://hardening.example.test' },
    );
    const firstMessage = nextMessage(socket);
    await within(new Promise<void>((resolve, reject) => {
      socket!.once('open', resolve);
      socket!.once('error', reject);
    }), 'vps-socket-open');
    const snapshot = await within(firstMessage, 'vps-snapshot');
    if (snapshot.type !== 'room.snapshot') throw new Error('ROOM_HARDENING_VPS_SNAPSHOT_MISSING');
    const closed = nextClose(socket);
    await within(gateway.shutdown(), 'vps-gateway-shutdown');
    const rejectedUpgrade = await gateway.prepareUpgrade(new Request(
      `http://127.0.0.1${ARENA_ROOM_WEBSOCKET_PATH}?ticket=${encodeURIComponent(ticket)}`,
      {
        headers: {
          connection: 'Upgrade',
          origin: 'https://hardening.example.test',
          'sec-websocket-key': Buffer.alloc(16, 3).toString('base64'),
          'sec-websocket-protocol': ARENA_ROOM_WEBSOCKET_PROTOCOL,
          'sec-websocket-version': '13',
          upgrade: 'websocket',
        },
      },
    ));
    if (rejectedUpgrade.accepted || rejectedUpgrade.response.status !== 503) {
      throw new Error('ROOM_HARDENING_VPS_NEW_UPGRADE_ACCEPTED');
    }
    gateway = null;
    const close = await within(closed, 'vps-socket-close');
    const roomStore = runtime.getRoomStore();
    actors.forceClose();
    await runtime.close();
    await expectErrorCode(
      memberships.getSession({ roomId, accountUserId: 401 }),
      'ROOM_ACTOR_REGISTRY_SHUTTING_DOWN',
    );
    await expectErrorCode(roomStore.load(roomId), 'REDIS_ROOM_CHECKPOINT_UNAVAILABLE');
    if (close.code !== 1012 || close.reason !== 'service-restart') {
      throw new Error('ROOM_HARDENING_VPS_SOCKET_CLOSE_INVALID');
    }
    return Object.freeze({
      socketCloseCode: close.code,
      gatewayShutdown: true,
      newUpgradeRejected: true,
      actorAuthorityClosed: true,
      redisRuntimeClosed: true,
      oldRoomUnavailable: true,
      transparentFailover: false,
    });
  } finally {
    if (gateway) await gateway.shutdown().catch(() => undefined);
    if (socket && socket.readyState !== WebSocket.CLOSED) socket.terminate();
    actors?.forceClose();
    await runtime.close().catch(() => undefined);
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
};

try {
  await cleanupClient.connect();
  await cleanupClient.set(foreignSentinelKey, foreignSentinelValue);
  for (const prefix of Object.values(scenarioPrefixes)) await deletePatterns(patternsFor(prefix));
  if (await cleanupClient.get(foreignSentinelKey) !== foreignSentinelValue) {
    throw new Error('ROOM_HARDENING_INITIAL_CLEANUP_ESCAPED');
  }
  const restart = await honoRestartRedisSurvivor();
  const loss = await exactCheckpointLoss();
  const vps = await vpsUnreachable();
  const secret = await inspectSecretPersistence();
  if (secret.persisted) throw new Error('ROOM_HARDENING_SECRET_PERSISTED');
  for (const prefix of Object.values(scenarioPrefixes)) await deletePatterns(patternsFor(prefix));
  const foreignNamespacePreserved = await cleanupClient.get(foreignSentinelKey)
    === foreignSentinelValue;
  if (!foreignNamespacePreserved) throw new Error('ROOM_HARDENING_CLEANUP_ESCAPED');
  await cleanupClient.del(foreignSentinelKey);
  console.info(JSON.stringify({
    verifier: 'GMR10_ROOM_HARDENING_FAULTS',
    redis: 'real-loopback',
    honoRestartRedisSurvivor: restart,
    exactCheckpointLoss: loss,
    vpsUnreachable: vps,
    secretKeysScanned: secret.scannedKeys,
    secretPersisted: secret.persisted,
    foreignNamespacePreserved,
  }));
} finally {
  if (!cleanupClient.isOpen) await cleanupClient.connect().catch(() => undefined);
  if (cleanupClient.isOpen) {
    for (const prefix of Object.values(scenarioPrefixes)) {
      await deletePatterns(patternsFor(prefix)).catch(() => 0);
    }
    await cleanupClient.del(foreignSentinelKey).catch(() => 0);
    await cleanupClient.quit();
  }
}
