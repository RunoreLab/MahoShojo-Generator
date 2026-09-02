import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  createArenaGenerationService,
  type ArenaGenerationExecutor,
  type ArenaGenerationTerminalStore,
} from '@mahoshojo/hosted-api/arena-generation/service';
import {
  canonicalizeNodeArenaGenerationSemanticPayload,
  deriveArenaGenerationId,
  hashArenaGenerationPayload,
} from '@mahoshojo/hosted-runtime/arena-generation';
import { createClient } from 'redis';

import { createArenaRoomGenerationPort } from '../src/arena-generation/room-generation-port';
import { createArenaRoomGenerationService } from '../src/arena-room/room-generation-service';
import { createRoomActorRegistry } from '../src/arena-room/room-actor-registry';
import { RedisRuntime } from '../src/redis/runtime';
import { requireSafeRoomVerifierPrefix } from './room-verifier-safety';
import { createRoomGenerationVerifierMaterializer } from './room-generation-verifier-materializer';
import { createRoomVerifierMembershipService } from './room-verifier-membership';

const redisUrl = process.env.REDIS_URL?.trim();
if (!redisUrl) throw new Error('Room generation process verifier 需要 REDIS_URL');
if (process.env.ROOM_GENERATION_PROCESS_VERIFY?.trim().toLowerCase() !== 'true') {
  throw new Error('Room generation process verifier 只允许 ROOM_GENERATION_PROCESS_VERIFY=true');
}
const hostedApiEnvironment = process.env.HOSTED_API_ENVIRONMENT?.trim().toLowerCase();
if (hostedApiEnvironment !== 'local' && hostedApiEnvironment !== 'test') {
  throw new Error('Room generation process verifier 只允许 HOSTED_API_ENVIRONMENT=local/test');
}
if (process.env.NODE_ENV?.trim().toLowerCase() === 'production') {
  throw new Error('Room generation process verifier 只允许非生产环境');
}
const parsedUrl = new URL(redisUrl);
if (
  !['redis:', 'rediss:'].includes(parsedUrl.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname)
) {
  throw new Error('Room generation process verifier 只允许连接 loopback Redis');
}

const keyPrefix = requireSafeRoomVerifierPrefix({
  environmentName: 'ROOM_REDIS_VERIFY_KEY_PREFIX',
  maxLength: 32,
  value: process.env.ROOM_REDIS_VERIFY_KEY_PREFIX,
});

const token = process.env.ROOM_GENERATION_PROCESS_VERIFY_TOKEN?.trim() || randomUUID();
if (!/^[a-zA-Z0-9_-]{8,64}$/u.test(token)) {
  throw new Error('ROOM_GENERATION_PROCESS_VERIFY_TOKEN 必须是安全 opaque token');
}
const safeToken = createHash('sha256').update(token).digest('hex').slice(0, 24);
const roomId = `room-process-${safeToken}`;
const generationRequestId = `request-process-${safeToken}`;
const secretCanary = `process-secret-${token}`;
const actorKey = `pvp-room:${roomId}`;
const producerLeaseMs = 800;

const signatures = Object.freeze({
  generateSignature: async () => null,
  verifySignature: async () => false,
});

const sharedConfig = () => ({
  battleMode: 'classic' as const,
  combatants: [{
    key: 'data-card:process-character',
    ref: { id: 'process-character', kind: 'character' as const, versionToken: 'v1' },
  }, {
    key: 'data-card:process-character-2',
    ref: { id: 'process-character-2', kind: 'character' as const, versionToken: 'v1' },
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

const terminalStore = (): ArenaGenerationTerminalStore => ({
  readOwnedTerminal: async () => null,
  reconcileExpiredLease: async (input) => ({
    generationId: input.generationId,
    generationRequestId: input.generationRequestId,
    status: 'producer_lost',
    updatedAt: input.updatedAt,
    resultRef: null,
    markdown: '',
    reasoning: '',
    payloadHash: input.payloadHash,
  }),
});

const createPort = (
  runtime: RedisRuntime,
  executor: ArenaGenerationExecutor,
) => {
  const generationService = createArenaGenerationService({
    store: runtime.getGenerationReplayStore(),
    terminalStore: terminalStore(),
    executor,
    resolveActor: async () => ({ actorKey }),
    deriveGenerationId: deriveArenaGenerationId,
    hashPayload: hashArenaGenerationPayload,
    now: () => new Date(),
    heartbeatIntervalMs: 10_000,
    leaseDurationMs: producerLeaseMs,
    replayPollMs: 5,
    deltaFlushIntervalMs: 5,
    deltaFlushBytes: 1,
  });
  return createArenaRoomGenerationPort({
    generationService,
    pvpAuthority: { sign: async () => 'process-pvp-signature' },
    internalGuidanceAuthority: { sign: async () => 'process-guidance-signature' },
    deriveGenerationId: deriveArenaGenerationId,
    canonicalizeSemanticPayload: (input) => canonicalizeNodeArenaGenerationSemanticPayload({
      payload: input.payload,
      signatures,
      trustedInternalGuidance: input.trustedInternalGuidance,
      trustedPvpContext: input.trustedPvpContext,
    }),
  });
};

const waitFor = async <T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  code: string,
): Promise<T> => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(code);
};

const runProducerProcess = async (): Promise<never> => {
  const runtime = new RedisRuntime(redisUrl, true, undefined, undefined, keyPrefix);
  await runtime.connect();
  const actors = createRoomActorRegistry({
    store: runtime.getRoomStore(),
    createRoomIdentity: () => ({ roomId, roomEpoch: 'epoch-process-1' }),
  });
  let nextUser = 0;
  const memberships = createRoomVerifierMembershipService({
    actors,
    createUserId: () => `process-user-${++nextUser}`,
  });
  const host = await memberships.create({
    accountUserId: 101,
    displayName: 'Process Host',
    sharedConfig: sharedConfig(),
  });
  await memberships.join({ roomId, accountUserId: 202, displayName: 'Process Member' });
  let providerStarts = 0;
  let firstChunk!: () => void;
  const firstChunkWritten = new Promise<void>((resolve) => { firstChunk = resolve; });
  const executor: ArenaGenerationExecutor = {
    async execute(input) {
      providerStarts += 1;
      await input.emit({ type: 'markdown', data: { chunk: '# process chunk\n' } });
      firstChunk();
      return new Promise<never>(() => undefined);
    },
  };
  const port = createPort(runtime, executor);
  const coordinator = createArenaRoomGenerationService({
    memberships,
    materializer: createRoomGenerationVerifierMaterializer(),
    generation: port,
  });
  await coordinator.start({
    roomId,
    accountUserId: 101,
    request: {
      expectedRoomEpoch: host.roomEpoch,
      expectedRevision: host.snapshot.revision,
      expectedControlSeq: host.snapshot.controlSeq,
      generationRequestId,
      sharedConfig: sharedConfig(),
      hostLocalPayloads: [],
      generation: {
        customProvider: { apiKey: secretCanary },
      },
    },
    sourceRequest: new Request('https://loopback.invalid/api/arena/rooms/generation', {
      method: 'POST',
      headers: { authorization: 'Bearer process-verifier' },
    }),
  });
  await firstChunkWritten;
  const generationId = await port.deriveGenerationId({ roomId, generationRequestId });
  await waitFor(
    () => port.readOwnedProjection({ roomId, generationId }),
    (value) => value.kind === 'found'
      && value.projection.status === 'running'
      && value.projection.markdown === '# process chunk\n',
    'ROOM_GENERATION_PROCESS_FIRST_CHUNK_TIMEOUT',
  );
  console.log(JSON.stringify({ event: 'producer-ready', generationId, providerStarts }));
  return new Promise<never>(() => undefined);
};

const cleanupClient = createClient({ url: redisUrl });
cleanupClient.on('error', () => undefined);

const isolatedKeyPatterns = Object.freeze([
  `mahoshojo:room:v1:${keyPrefix}:*`,
  `mahoshojo:room-directory:v1:${keyPrefix}:*`,
  `mahoshojo:gen:v1:${keyPrefix}:*`,
]);

const isolatedKeys = async (): Promise<string[]> => {
  const keys: string[] = [];
  for (const pattern of isolatedKeyPatterns) {
    for await (const batch of cleanupClient.scanIterator({
      MATCH: pattern,
      COUNT: 200,
    })) keys.push(...batch);
  }
  return keys;
};

const deleteIsolatedKeys = async (): Promise<void> => {
  const keys = await isolatedKeys();
  if (keys.length > 0) await cleanupClient.del(keys);
};

const inspectSecretPersistence = async (): Promise<Readonly<{
  scannedKeys: number;
  secretPersisted: boolean;
}>> => {
  let scannedKeys = 0;
  for (const key of await isolatedKeys()) {
    scannedKeys += 1;
    const type = await cleanupClient.type(key);
    let value: unknown = null;
    if (type === 'string') value = await cleanupClient.get(key);
    else if (type === 'stream') value = await cleanupClient.xRange(key, '-', '+');
    else if (type === 'set') value = await cleanupClient.sMembers(key);
    else if (type === 'zset') value = await cleanupClient.zRangeWithScores(key, 0, -1);
    else if (type === 'hash') value = await cleanupClient.hGetAll(key);
    else if (type === 'list') value = await cleanupClient.lRange(key, 0, -1);
    if (JSON.stringify(value).includes(secretCanary)) {
      return { scannedKeys, secretPersisted: true };
    }
  }
  return { scannedKeys, secretPersisted: false };
};

const waitForProducerReady = (
  child: ReturnType<typeof spawn>,
): Promise<{ generationId: string; providerStarts: number }> => new Promise((resolve, reject) => {
  let stdout = '';
  let stderr = '';
  const timeout = setTimeout(() => {
    reject(new Error(`ROOM_GENERATION_PROCESS_CHILD_TIMEOUT:${stderr.slice(-500)}`));
  }, 15_000);
  timeout.unref();
  child.stderr?.on('data', (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-2_000); });
  child.stdout?.on('data', (chunk) => {
    stdout += String(chunk);
    const lines = stdout.split('\n');
    stdout = lines.pop() ?? '';
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (
          parsed.event === 'producer-ready'
          && typeof parsed.generationId === 'string'
          && parsed.providerStarts === 1
        ) {
          clearTimeout(timeout);
          resolve({ generationId: parsed.generationId, providerStarts: 1 });
        }
      } catch {
        // Redis connection diagnostics are intentionally ignored.
      }
    }
  });
  child.once('exit', (code, signal) => {
    clearTimeout(timeout);
    reject(new Error(`ROOM_GENERATION_PROCESS_CHILD_EARLY_EXIT:${code ?? signal}:${stderr}`));
  });
});

const runParent = async (): Promise<void> => {
  await cleanupClient.connect();
  await deleteIsolatedKeys();
  let runtime: RedisRuntime | null = null;
  let child: ReturnType<typeof spawn> | null = null;
  try {
    child = spawn(process.execPath, [
      '--import',
      'tsx',
      fileURLToPath(import.meta.url),
    ], {
      env: {
        ...process.env,
        REDIS_URL: redisUrl,
        ROOM_GENERATION_PROCESS_VERIFY: 'true',
        ROOM_GENERATION_PROCESS_VERIFY_MODE: 'producer',
        ROOM_GENERATION_PROCESS_VERIFY_TOKEN: token,
        ROOM_REDIS_VERIFY_KEY_PREFIX: keyPrefix,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const ready = await waitForProducerReady(child);
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child!.once('exit', (code, signal) => resolve({ code, signal }));
    });
    child.kill('SIGKILL');
    const exit = await exited;
    child = null;
    if (exit.signal !== 'SIGKILL') throw new Error('ROOM_GENERATION_PROCESS_KILL_NOT_OBSERVED');

    await new Promise((resolve) => setTimeout(resolve, producerLeaseMs + 250));
    runtime = new RedisRuntime(redisUrl, true, undefined, undefined, keyPrefix);
    await runtime.connect();
    const actors = createRoomActorRegistry({
      store: runtime.getRoomStore(),
      createRoomEpoch: () => 'epoch-process-2',
    });
    const memberships = createRoomVerifierMembershipService({ actors });
    let recoveryProviderStarts = 0;
    const port = createPort(runtime, {
      async execute() {
        recoveryProviderStarts += 1;
        throw new Error('ROOM_GENERATION_PROCESS_SECOND_PROVIDER_STARTED');
      },
    });
    const coordinator = createArenaRoomGenerationService({
      memberships,
      materializer: createRoomGenerationVerifierMaterializer(),
      generation: port,
    });
    const recovered = await waitFor(
      () => coordinator.read({
        roomId,
        generationId: ready.generationId,
        accountUserId: 202,
      }).catch(() => null),
      (value) => value?.roomEpoch === 'epoch-process-2'
        && value.status === 'producer_lost'
        && value.generation.state === 'failed',
      'ROOM_GENERATION_PROCESS_RECOVERY_TIMEOUT',
    );
    if (!recovered || recoveryProviderStarts !== 0) {
      throw new Error('ROOM_GENERATION_PROCESS_DUPLICATE_PROVIDER');
    }
    const checkpoint = await runtime.getRoomStore().load(roomId);
    if (checkpoint?.snapshot.activeGeneration?.state !== 'failed') {
      throw new Error('ROOM_GENERATION_PROCESS_ROOM_TERMINAL_INVALID');
    }
    const replay = runtime.getGenerationReplayStore();
    const durableState = await replay.readState({ generationId: ready.generationId, actorKey });
    const durableEvents = await replay.readAfter({
      generationId: ready.generationId,
      after: null,
      blockMs: 1,
    });
    const terminalEvent = durableEvents.events.find((event) => (
      event.type === 'error'
      && event.data
      && typeof event.data === 'object'
      && (event.data as { status?: unknown }).status === 'producer_lost'
    ));
    if (
      durableState?.status !== 'producer_lost'
      || durableState.terminal?.status !== 'producer_lost'
      || durableState.leaseExpiresAt !== null
      || durableState.snapshot?.status !== 'producer_lost'
      || !terminalEvent
      || durableState.lastEventId !== terminalEvent.id
      || durableState.snapshot.lastEventId !== terminalEvent.id
    ) throw new Error('ROOM_GENERATION_PROCESS_DURABLE_TERMINAL_INVALID');
    const repeatedRead = await coordinator.read({
      roomId,
      generationId: ready.generationId,
      accountUserId: 202,
    });
    if (repeatedRead.status !== 'producer_lost') {
      throw new Error('ROOM_GENERATION_PROCESS_REPEATED_READ_INVALID');
    }
    const retry = await coordinator.start({
      roomId,
      accountUserId: 101,
      request: {
        expectedRoomEpoch: checkpoint.snapshot.roomEpoch,
        expectedRevision: checkpoint.snapshot.revision,
        expectedControlSeq: checkpoint.snapshot.controlSeq,
        generationRequestId,
        sharedConfig: sharedConfig(),
        hostLocalPayloads: [],
        generation: {
          customProvider: { apiKey: secretCanary },
        },
      },
      sourceRequest: new Request('https://loopback.invalid/api/arena/rooms/generation', {
        method: 'POST',
        headers: { authorization: 'Bearer process-verifier' },
      }),
    });
    if (retry.status !== 'producer_lost' || recoveryProviderStarts !== 0) {
      throw new Error('ROOM_GENERATION_PROCESS_TERMINAL_RETRY_INVALID');
    }
    const secretInspection = await inspectSecretPersistence();
    if (secretInspection.secretPersisted) {
      throw new Error('ROOM_GENERATION_PROCESS_SECRET_PERSISTED');
    }
    await actors.shutdown();
    console.log(JSON.stringify({
      verifier: 'GMR09_ROOM_GENERATION_PROCESS_RECOVERY',
      redis: 'real-loopback',
      killedSignal: exit.signal,
      providerStartsBeforeKill: ready.providerStarts,
      producerLostAfterKill: true,
      recoveryProviderStarts,
      recoveredRoomEpoch: recovered.roomEpoch,
      recoveredGenerationStatus: recovered.status,
      roomTerminal: checkpoint.snapshot.activeGeneration.state,
      durableFact: durableState.status,
      durableTerminalEvent: terminalEvent.type,
      durableTerminalSnapshot: durableState.snapshot.status,
      terminalRetryProviderStarts: recoveryProviderStarts,
      secretKeysScanned: secretInspection.scannedKeys,
      secretPersisted: secretInspection.secretPersisted,
    }));
  } finally {
    if (child) child.kill('SIGKILL');
    await runtime?.close().catch(() => undefined);
    if (!cleanupClient.isOpen) await cleanupClient.connect().catch(() => undefined);
    if (cleanupClient.isOpen) {
      await deleteIsolatedKeys().catch(() => undefined);
      await cleanupClient.quit();
    }
  }
};

if (process.env.ROOM_GENERATION_PROCESS_VERIFY_MODE === 'producer') {
  await runProducerProcess();
} else {
  await runParent();
}
