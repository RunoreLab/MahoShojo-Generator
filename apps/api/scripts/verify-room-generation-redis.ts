import { randomUUID } from 'node:crypto';

import {
  createArenaGenerationService,
  type ArenaGenerationExecutor,
  type GenerationReplayStore,
} from '@mahoshojo/hosted-api/arena-generation/service';
import { ArenaRoomGenerationResultSchema } from '@mahoshojo/contracts/arena-room';
import {
  canonicalizeNodeArenaGenerationSemanticPayload,
  createArenaGenerationFinalizer,
  createNodeArenaGenerationTerminalStore,
  createNodeArenaGenerationFinalizationPorts,
  deriveArenaGenerationId,
  hashArenaGenerationPayload,
} from '@mahoshojo/hosted-runtime/arena-generation';
import type {
  NodeDataD1Client,
  NodeDataD1Statement,
} from '@mahoshojo/hosted-runtime/node-runtime/data-ports';
import { createClient } from 'redis';

import {
  createArenaRoomGenerationPort,
  type ArenaRoomGenerationPort,
} from '../src/arena-generation/room-generation-port';
import { createRoomActorRegistry } from '../src/arena-room/room-actor-registry';
import { createArenaRoomGenerationSnapshotFromFrozen } from '../src/arena-room/room-generation-snapshot';
import {
  ARENA_ROOM_INTERNAL_GUIDANCE,
  createArenaRoomGenerationService,
} from '../src/arena-room/room-generation-service';
import { RedisRuntime } from '../src/redis/runtime';
import { createRoomGenerationVerifierMaterializer } from './room-generation-verifier-materializer';
import { createRoomVerifierMembershipService } from './room-verifier-membership';
import { requireSafeRoomVerifierPrefix } from './room-verifier-safety';

const redisUrl = process.env.REDIS_URL?.trim();
if (!redisUrl) throw new Error('Room generation Redis verifier 需要 REDIS_URL');
if (process.env.ROOM_GENERATION_REDIS_VERIFY?.trim().toLowerCase() !== 'true') {
  throw new Error('Room generation Redis verifier 只允许 ROOM_GENERATION_REDIS_VERIFY=true');
}
const hostedApiEnvironment = process.env.HOSTED_API_ENVIRONMENT?.trim().toLowerCase();
if (hostedApiEnvironment !== 'local' && hostedApiEnvironment !== 'test') {
  throw new Error('Room generation Redis verifier 只允许 HOSTED_API_ENVIRONMENT=local/test');
}
if (process.env.NODE_ENV?.trim().toLowerCase() === 'production') {
  throw new Error('Room generation Redis verifier 只允许非生产环境');
}
const parsedUrl = new URL(redisUrl);
if (
  !['redis:', 'rediss:'].includes(parsedUrl.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname)
) throw new Error('Room generation Redis verifier 只允许连接 loopback Redis');

const keyPrefix = requireSafeRoomVerifierPrefix({
  environmentName: 'ROOM_GENERATION_REDIS_VERIFY_KEY_PREFIX',
  maxLength: 32,
  value: process.env.ROOM_GENERATION_REDIS_VERIFY_KEY_PREFIX,
});

const token = randomUUID();
const roomId = `room-generation-durable-${token}`;
const generationRequestId = `request-generation-durable-${token}`;
const actorKey = `pvp-room:${roomId}`;
const objects = new Map<string, string>();
const generationRows = new Map<string, Record<string, unknown>>();
const objectRows = new Map<string, Record<string, unknown>>();
const cleanupClient = createClient({ url: redisUrl });
cleanupClient.on('error', () => undefined);
const isolatedKeyPatterns = [
  `mahoshojo:room:v1:${keyPrefix}:*`,
  `mahoshojo:room-directory:v1:${keyPrefix}:*`,
  `mahoshojo:gen:v1:${keyPrefix}:*`,
] as const;
const foreignNamespaceSentinelKey = `mahoshojo:rate-limit:${keyPrefix}:${token}`;
const foreignNamespaceSentinelValue = `preserve-${token}`;
let runtime: RedisRuntime | null = null;
let recoveredRuntime: RedisRuntime | null = null;
let activeRecoveredActors: ReturnType<typeof createRoomActorRegistry> | null = null;

const createVerifierD1Adapter = (): NodeDataD1Client => ({
  prepare(sql) {
    let parameters: unknown[] = [];
    const d1Statement: NodeDataD1Statement = {
      bind(...nextParameters) {
        parameters = nextParameters;
        return d1Statement;
      },
      async all() {
        const generationId = String(parameters[0] ?? '');
        const generation = generationRows.get(generationId);
        if (sql.includes('FROM battle_report_generations\nWHERE id = ?')) {
          return {
            success: true,
            results: generation ? [{ ...generation }] : [],
            meta: {},
          };
        }
        if (!sql.includes('FROM battle_report_generations AS brg')) {
          throw new Error('ROOM_GENERATION_DURABLE_D1_QUERY_UNEXPECTED');
        }
        const object = objectRows.get(generationId);
        return {
          success: true,
          results: generation ? [{ ...generation, r2_key: object?.r2_key ?? null }] : [],
          meta: {},
        };
      },
      async run() {
        if (sql.includes('INSERT INTO large_objects')) {
          const generationId = String(parameters[2] ?? '');
          objectRows.set(generationId, {
            id: parameters[0],
            kind: parameters[1],
            owner_ref_id: generationId,
            r2_key: parameters[4],
          });
          return { success: true, results: [], meta: { changes: 1 } };
        }
        if (sql.includes('INSERT OR IGNORE INTO battle_report_generations')) {
          const generationId = String(parameters[0] ?? '');
          if (generationRows.has(generationId)) {
            return { success: true, results: [], meta: { changes: 0 } };
          }
          const extraIndex = parameters.findIndex((value) => (
            typeof value === 'string' && value.includes('"generationRequestId"')
          ));
          if (extraIndex < 1) throw new Error('ROOM_GENERATION_DURABLE_D1_EXTRA_MISSING');
          generationRows.set(generationId, {
            id: generationId,
            status: parameters[4],
            mode: parameters[8],
            scenario_title: parameters[10],
            language: parameters[13],
            story_length: parameters[14],
            ai_model: parameters[32],
            headline: parameters[33],
            winner: parameters[34],
            prompt_tokens: parameters[37],
            completion_tokens: parameters[38],
            total_tokens: parameters[39],
            cached_tokens: parameters[40],
            reasoning_tokens: parameters[41],
            updated_at: parameters.at(-1),
            output_preview: parameters[extraIndex - 1],
            extra_json: parameters[extraIndex],
          });
          return { success: true, results: [], meta: { changes: 1 } };
        }
        if (
          sql.includes('UPDATE battle_report_generations')
          && sql.includes("'$.finalizationCompleted'")
        ) {
          const generationId = String(parameters[4] ?? '');
          const generation = generationRows.get(generationId);
          if (!generation) return { success: true, results: [], meta: { changes: 0 } };
          const extra = JSON.parse(String(generation.extra_json ?? '{}')) as Record<string, unknown>;
          if (extra.finalizationCompleted === true) {
            return { success: true, results: [], meta: { changes: 0 } };
          }
          generationRows.set(generationId, {
            ...generation,
            status: parameters[0],
            updated_at: parameters[3],
            extra_json: JSON.stringify({
              ...extra,
              generationTerminalStatus: parameters[2],
              finalizationCompleted: true,
            }),
          });
          return { success: true, results: [], meta: { changes: 1 } };
        }
        if (sql.includes('INSERT INTO battle_report_generation_combatants')) {
          return { success: true, results: [], meta: { changes: 1 } };
        }
        throw new Error('ROOM_GENERATION_DURABLE_D1_WRITE_UNEXPECTED');
      },
    };
    return d1Statement;
  },
});

const sharedConfig = () => ({
  battleMode: 'classic' as const,
  combatants: [{
    key: 'data-card:character-1',
    ref: { id: 'character-1', kind: 'character' as const, versionToken: 'v1' },
  }, {
    key: 'data-card:character-2',
    ref: { id: 'character-2', kind: 'character' as const, versionToken: 'v1' },
  }],
  teams: [],
  scenario: null,
  auxScenarios: [],
  materials: [],
  userGuidance: '真实 Redis durable seam',
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

const readAll = async <T>(stream: ReadableStream<T>): Promise<T[]> => {
  const values: T[] = [];
  const reader = stream.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) return values;
      values.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
};

const hasVerifierRoomSafeResult = (value: unknown): boolean => {
  const parsed = ArenaRoomGenerationResultSchema.safeParse(value);
  return parsed.success
    && parsed.data.mode === 'classic'
    && Boolean(parsed.data.combatantUpdates?.some((update) => (
      update.combatantKey === 'data-card:character-1'
    )));
};

const waitFor = async <T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  code: string,
): Promise<T> => {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(code);
};

const deleteIsolatedKeys = async (pattern: string): Promise<number> => {
  const keys: string[] = [];
  for await (const batch of cleanupClient.scanIterator({ MATCH: pattern, COUNT: 200 })) {
    keys.push(...batch);
  }
  return keys.length === 0 ? 0 : cleanupClient.del(keys);
};

const deleteVerifierKeys = async (): Promise<number> => {
  let deleted = 0;
  for (const pattern of isolatedKeyPatterns) deleted += await deleteIsolatedKeys(pattern);
  return deleted;
};

try {
  await cleanupClient.connect();
  await cleanupClient.set(foreignNamespaceSentinelKey, foreignNamespaceSentinelValue);
  await deleteVerifierKeys();
  const initialCleanupForeignNamespacePreserved = await cleanupClient.get(
    foreignNamespaceSentinelKey,
  ) === foreignNamespaceSentinelValue;
  if (!initialCleanupForeignNamespacePreserved) {
    throw new Error('ROOM_GENERATION_DURABLE_INITIAL_CLEANUP_NAMESPACE_ESCAPED');
  }

  const d1 = createVerifierD1Adapter();
  const objectStore = {
    async put(input: {
      key: string;
      body: string | Uint8Array;
      contentType: string;
      signal: AbortSignal;
    }) {
      const markdown = typeof input.body === 'string'
        ? input.body
        : new TextDecoder().decode(input.body);
      objects.set(input.key, markdown);
      return {
        bytes: new TextEncoder().encode(markdown).byteLength,
        storedBytes: new TextEncoder().encode(markdown).byteLength,
        contentEncoding: null,
      };
    },
    async getText(key: string) {
      const value = objects.get(key);
      return value === undefined
        ? { kind: 'not-found' as const }
        : { kind: 'found' as const, text: value };
    },
  };
  let ratingSettlementInvocations = 0;
  let storyImpactGateInvocations = 0;
  const persistence = createNodeArenaGenerationFinalizationPorts({
    getD1Client: () => d1,
    objectStore,
    settleRatings: async () => {
      ratingSettlementInvocations += 1;
    },
  });
  const applyStoryImpacts = persistence.applyStoryImpacts.bind(persistence);
  const finalizer = createArenaGenerationFinalizer({
    ...persistence,
    async applyStoryImpacts(input) {
      storyImpactGateInvocations += 1;
      await applyStoryImpacts(input);
    },
  });
  const terminalStore = createNodeArenaGenerationTerminalStore({
    getD1Client: () => d1,
    objectStore,
  });

  let releaseProvider!: () => void;
  let providerFirstChunk!: () => void;
  const providerGate = new Promise<void>((resolve) => { releaseProvider = resolve; });
  const firstChunk = new Promise<void>((resolve) => { providerFirstChunk = resolve; });
  let providerStarts = 0;
  let finalizerRuns = 0;
  const longStreamChunks = Array.from(
    { length: 300 },
    (_, index) => `长流事件-${String(index + 1).padStart(3, '0')}\n`,
  );
  const expectedMarkdown = `# 第一批\n\n${longStreamChunks.join('')}第二批\n`;
  const executor: ArenaGenerationExecutor = {
    async prepare(input) {
      const pvpContext = input.payload.pvpContext;
      const trustedPvpContext = pvpContext
        && typeof pvpContext === 'object'
        && !Array.isArray(pvpContext)
        ? pvpContext as { roomId: string; matchId: string; roundId: string }
        : null;
      const trustedInternalGuidance = typeof input.payload.internalGuidance === 'string'
        ? input.payload.internalGuidance
        : null;
      return {
        executionPayload: input.payload,
        semanticPayload: await canonicalizeNodeArenaGenerationSemanticPayload({
          payload: input.payload,
          signatures: {
            generateSignature: async () => null,
            verifySignature: async () => false,
          },
          trustedInternalGuidance,
          trustedPvpContext,
        }),
      };
    },
    async execute(input) {
      providerStarts += 1;
      await input.emit({ type: 'markdown', data: { chunk: '# 第一批\n\n' } });
      providerFirstChunk();
      await providerGate;
      for (const chunk of longStreamChunks) {
        await input.emit({ type: 'markdown', data: { chunk } });
      }
      await input.emit({ type: 'markdown', data: { chunk: '第二批\n' } });
      const claim = await input.claimFinalization({ status: 'completed' });
      if (claim.kind !== 'claimed') throw new Error('ROOM_GENERATION_DURABLE_FINALIZER_FENCED');
      const finalizationInput = {
        generationId: input.generationId,
        generationRequestId: input.generationRequestId,
        actorKey: input.actorKey,
        payloadHash: input.payloadHash,
        payload: input.payload,
        metadata: {},
        markdown: expectedMarkdown,
        telemetry: {},
        status: 'completed' as const,
        errorCode: null,
        signal: input.signal,
      };
      const firstFinalization = await finalizer(finalizationInput);
      finalizerRuns += 1;
      const duplicateFinalization = await finalizer(finalizationInput);
      finalizerRuns += 1;
      if (
        !firstFinalization.resultRef
        || duplicateFinalization.resultRef !== firstFinalization.resultRef
      ) throw new Error('ROOM_GENERATION_DURABLE_FINALIZER_NOT_IDEMPOTENT');
      return { status: 'completed', resultRef: firstFinalization.resultRef };
    },
  };

  const createHostedPort = (store: GenerationReplayStore): ArenaRoomGenerationPort => {
    const hosted = createArenaGenerationService({
      store,
      terminalStore,
      executor,
      resolveActor: async () => ({ actorKey }),
      deriveGenerationId: deriveArenaGenerationId,
      hashPayload: hashArenaGenerationPayload,
      now: () => new Date(),
      heartbeatIntervalMs: 10_000,
      leaseDurationMs: 60_000,
      replayPollMs: 5,
      deltaFlushIntervalMs: 5,
      deltaFlushBytes: 1,
    });
    return createArenaRoomGenerationPort({
      generationService: hosted,
      pvpAuthority: { sign: async () => 'verifier-pvp-signature' },
      internalGuidanceAuthority: { sign: async () => 'verifier-guidance-signature' },
      deriveGenerationId: deriveArenaGenerationId,
      canonicalizeSemanticPayload: (input) => canonicalizeNodeArenaGenerationSemanticPayload({
        payload: input.payload,
        signatures: {
          generateSignature: async () => null,
          verifySignature: async () => false,
        },
        trustedInternalGuidance: input.trustedInternalGuidance,
        trustedPvpContext: input.trustedPvpContext,
      }),
    });
  };

  runtime = new RedisRuntime(redisUrl, true, undefined, undefined, keyPrefix);
  await runtime.connect();
  const roomActors = createRoomActorRegistry({
    store: runtime.getRoomStore(),
    createRoomIdentity: () => ({ roomId, roomEpoch: 'epoch-1' }),
    createTimestamp: () => new Date().toISOString(),
    now: Date.now,
  });
  let nextUser = 0;
  const memberships = createRoomVerifierMembershipService({
    actors: roomActors,
    createUserId: () => `durable-user-${++nextUser}`,
    now: () => new Date().toISOString(),
  });
  const host = await memberships.create({
    accountUserId: 101,
    displayName: 'Durable Host',
    sharedConfig: sharedConfig(),
  });
  await memberships.join({ roomId, accountUserId: 202, displayName: 'Durable Member' });
  const port = createHostedPort(runtime.getGenerationReplayStore());
  const generationMaterializer = createRoomGenerationVerifierMaterializer();
  const coordinator = createArenaRoomGenerationService({
    memberships,
    materializer: generationMaterializer,
    generation: port,
    now: () => new Date().toISOString(),
  });
  const generationRequest = {
    expectedRoomEpoch: host.roomEpoch,
    expectedRevision: host.snapshot.revision,
    generationRequestId,
    sharedConfig: sharedConfig(),
    hostLocalPayloads: [],
    generation: {
      customProvider: { apiKey: `secret-${token}` },
    },
  };
  const sourceRequest = new Request('https://loopback.invalid/api/arena/rooms/generation', {
    method: 'POST',
    headers: { authorization: 'Bearer verifier' },
  });

  let responseLossInjected = false;
  try {
    await coordinator.start({
      roomId,
      accountUserId: 101,
      request: generationRequest,
      sourceRequest,
    });
    throw new Error('ROOM_GENERATION_DURABLE_INJECTED_RESPONSE_LOSS');
  } catch (error) {
    if (
      error instanceof Error
      && error.message === 'ROOM_GENERATION_DURABLE_INJECTED_RESPONSE_LOSS'
    ) responseLossInjected = true;
    else throw error;
  }
  await firstChunk;
  const generationId = await port.deriveGenerationId({ roomId, generationRequestId });
  const firstProjection = await waitFor(
    () => port.readOwnedProjection({ roomId, generationId }),
    (value) => value.kind === 'found' && value.projection.markdown === '# 第一批\n\n',
    'ROOM_GENERATION_DURABLE_FIRST_CHUNK_TIMEOUT',
  );
  if (firstProjection.kind !== 'found') throw new Error('ROOM_GENERATION_DURABLE_PROJECTION_MISSING');

  const verificationActor = await roomActors.recover(roomId);
  const verificationState = verificationActor?.getSnapshot();
  const historical = verificationState?.generationLedger.find((record) => (
    record.mirror.generationRequestId === generationRequestId
  ));
  if (!historical) throw new Error('ROOM_GENERATION_DURABLE_LEDGER_MISSING');
  const retrySnapshot = createArenaRoomGenerationSnapshotFromFrozen({
    roomId,
    generationRequestId,
    configRevision: historical.mirror.configRevision,
    collaborativeInfluence: historical.mirror.collaborativeInfluence,
    participantUserIds: historical.mirror.participantUserIds,
    sharedConfig: generationRequest.sharedConfig,
  });
  const retryPayload = await generationMaterializer.materialize({
    sharedConfig: generationRequest.sharedConfig,
    hostAccountUserId: 101,
    hostLocalPayloads: generationRequest.hostLocalPayloads,
    hostRuntime: generationRequest.generation,
  });
  const retryPayloadDigest = await port.hashSemanticPayload({
    roomId,
    generationRequestId,
    payload: retryPayload,
    internalGuidance: ARENA_ROOM_INTERNAL_GUIDANCE,
    pvpContext: { matchId: generationId, roundId: 'attempt-1' },
    multiplayerSnapshot: retrySnapshot,
  });
  if (historical.generationPayloadDigest !== retryPayloadDigest) {
    throw new Error([
      'ROOM_GENERATION_DURABLE_PAYLOAD_DIGEST_UNSTABLE',
      historical.generationPayloadDigest ?? 'legacy-missing',
      retryPayloadDigest,
    ].join(':'));
  }
  const hostedSemanticState = await runtime.getGenerationReplayStore().readState({
    generationId,
    actorKey,
  });
  const hostedSemanticDigestMatched = Boolean(
    hostedSemanticState
    && historical.generationPayloadDigest === `sha256:${hostedSemanticState.payloadHash}`,
  );
  if (!hostedSemanticDigestMatched) {
    throw new Error('ROOM_GENERATION_DURABLE_HOSTED_SEMANTIC_DIGEST_MISMATCH');
  }

  await coordinator.start({
    roomId,
    accountUserId: 101,
    request: generationRequest,
    sourceRequest,
  });
  if (providerStarts !== 1) throw new Error('ROOM_GENERATION_DURABLE_DUPLICATE_PROVIDER');
  const resumed = await port.resumeOwnedSubscription({
    roomId,
    generationId,
    after: firstProjection.projection.resumeCursor,
  });
  if (resumed.kind !== 'subscribed') throw new Error('ROOM_GENERATION_DURABLE_RESUME_MISSING');
  const resumedEventsPromise = readAll(resumed.subscription.events);
  roomActors.forceClose();
  activeRecoveredActors = createRoomActorRegistry({
    store: runtime.getRoomStore(),
    createRoomEpoch: () => 'epoch-2',
    recoveryTimestamp: () => new Date().toISOString(),
    now: Date.now,
  });
  const activeRecoveredMemberships = createRoomVerifierMembershipService({
    actors: activeRecoveredActors,
    now: () => new Date().toISOString(),
  });
  const activeRecoveredPort = createHostedPort(runtime.getGenerationReplayStore());
  const activeRecoveredCoordinator = createArenaRoomGenerationService({
    memberships: activeRecoveredMemberships,
    materializer: createRoomGenerationVerifierMaterializer(),
    generation: activeRecoveredPort,
    now: () => new Date().toISOString(),
  });
  const activeRecoveredView = await activeRecoveredCoordinator.read({
    roomId,
    generationId,
    accountUserId: 202,
  });
  if (
    activeRecoveredView.roomEpoch !== 'epoch-2'
    || activeRecoveredView.status !== 'running'
    || providerStarts !== 1
  ) throw new Error('ROOM_GENERATION_DURABLE_ACTIVE_PROCESS_RECOVERY_INVALID');
  releaseProvider();
  const resumedEvents = await resumedEventsPromise;
  if (
    !resumedEvents.some((event) => event.type === 'markdown' && event.chunk === '第二批\n')
    || !resumedEvents.some((event) => event.type === 'done' && event.status === 'completed')
  ) throw new Error('ROOM_GENERATION_DURABLE_RESUME_INCOMPLETE');

  const roomTerminal = await waitFor(
    () => runtime!.getRoomStore().load(roomId),
    (value) => value?.snapshot.activeGeneration?.state === 'completed',
    'ROOM_GENERATION_DURABLE_ROOM_TERMINAL_TIMEOUT',
  );
  const replay = runtime.getGenerationReplayStore();
  const replayState = await replay.readState({ generationId, actorKey });
  const replayEvents = await replay.readAfter({ generationId, after: null, blockMs: 1 });
  const terminalEvent = replayState?.lastEventId
    ? await replay.readEvent({ generationId, eventId: replayState.lastEventId })
    : null;
  const terminalBeyondBoundedBatch = Boolean(
    terminalEvent
    && replayEvents.events.length === 256
    && !replayEvents.events.some((event) => event.id === terminalEvent.id),
  );
  if (
    replayState?.status !== 'completed'
    || replayState.terminal?.status !== 'completed'
    || replayState.snapshot?.status !== 'completed'
    || replayState.snapshot.markdown !== expectedMarkdown
    || !terminalEvent
    || terminalEvent.type !== 'done'
    || !terminalBeyondBoundedBatch
    || replayState.lastEventId !== terminalEvent.id
    || replayState.snapshot.lastEventId !== terminalEvent.id
    || JSON.stringify(roomTerminal).includes(`secret-${token}`)
  ) throw new Error('ROOM_GENERATION_DURABLE_ATOMIC_TERMINAL_INVALID');

  const terminal = await terminalStore.readOwnedTerminal({ generationId, actorKey });
  if (
    terminal?.markdown !== expectedMarkdown
    || terminal.resultRef === null
    || terminal.contentAvailable !== true
    || !hasVerifierRoomSafeResult(terminal.roomSafeResult)
    || await terminalStore.readOwnedTerminal({ generationId, actorKey: `${actorKey}:other` }) !== null
  ) throw new Error('ROOM_GENERATION_DURABLE_D1_R2_AUTHORITY_INVALID');

  activeRecoveredActors.forceClose();
  activeRecoveredActors = null;
  await runtime.close();
  runtime = null;
  const deletedGenerationKeys = await deleteIsolatedKeys(`mahoshojo:gen:v1:${keyPrefix}:*`);
  if (deletedGenerationKeys < 2) throw new Error('ROOM_GENERATION_DURABLE_FAULT_INJECTION_MISSING');

  recoveredRuntime = new RedisRuntime(redisUrl, true, undefined, undefined, keyPrefix);
  await recoveredRuntime.connect();
  const recoveredActors = createRoomActorRegistry({
    store: recoveredRuntime.getRoomStore(),
    createRoomEpoch: () => 'epoch-3',
    recoveryTimestamp: () => new Date().toISOString(),
    now: Date.now,
  });
  const recoveredMemberships = createRoomVerifierMembershipService({
    actors: recoveredActors,
    now: () => new Date().toISOString(),
  });
  const recoveredPort = createHostedPort(recoveredRuntime.getGenerationReplayStore());
  const recoveredCoordinator = createArenaRoomGenerationService({
    memberships: recoveredMemberships,
    materializer: createRoomGenerationVerifierMaterializer(),
    generation: recoveredPort,
    now: () => new Date().toISOString(),
  });
  const recoveredView = await recoveredCoordinator.read({
    roomId,
    generationId,
    accountUserId: 202,
  });
  if (
    recoveredView.roomEpoch !== 'epoch-3'
    || recoveredView.status !== 'completed'
    || recoveredView.markdown !== expectedMarkdown
    || recoveredView.generationRecordId !== generationId
    || recoveredView.result?.mode !== 'classic'
    || !recoveredView.result.combatantUpdates?.some((update) => (
      update.combatantKey === 'data-card:character-1'
    ))
    || providerStarts !== 1
  ) throw new Error('ROOM_GENERATION_DURABLE_PROCESS_RECOVERY_INVALID');

  await recoveredCoordinator.start({
    roomId,
    accountUserId: 101,
    request: { ...generationRequest, expectedRoomEpoch: 'epoch-3' },
    sourceRequest,
  });
  if (providerStarts !== 1) throw new Error('ROOM_GENERATION_DURABLE_TERMINAL_REEXECUTED');
  await recoveredActors.shutdown();

  if (ratingSettlementInvocations !== 1 || storyImpactGateInvocations !== 1) {
    throw new Error('ROOM_GENERATION_DURABLE_TERMINAL_EFFECT_NOT_EXACTLY_ONCE');
  }

  const secretPersisted = JSON.stringify({
    generationRows: [...generationRows.values()],
    objectRows: [...objectRows.values()],
    objects: [...objects.entries()],
  }).includes(`secret-${token}`);
  if (secretPersisted) throw new Error('ROOM_GENERATION_DURABLE_SECRET_PERSISTED');

  await deleteVerifierKeys();
  const foreignNamespacePreserved = await cleanupClient.get(foreignNamespaceSentinelKey)
    === foreignNamespaceSentinelValue;
  if (!foreignNamespacePreserved) {
    throw new Error('ROOM_GENERATION_DURABLE_CLEANUP_NAMESPACE_ESCAPED');
  }
  await cleanupClient.del(foreignNamespaceSentinelKey);

  console.log(JSON.stringify({
    verifier: 'GMR09_ROOM_HOSTED_DURABLE_SEAM',
    redis: 'real-loopback',
    providerStarts,
    responseLossInjected,
    hostedSemanticDigestMatched,
    duplicateSingleFlight: true,
    resume: true,
    activeProcessRecoveryEpoch: activeRecoveredView.roomEpoch,
    atomicTerminalMarkerEventSnapshot: true,
    terminalExactReadBeyondBatch: terminalBeyondBoundedBatch,
    roomTerminal: roomTerminal?.snapshot.activeGeneration?.state,
    d1R2TerminalFallback: true,
    ownerMismatchHidden: true,
    terminalRecoveryEpoch: recoveredView.roomEpoch,
    realFinalizerRuns: finalizerRuns,
    duplicateFinalizationIdempotent: finalizerRuns === 2,
    terminalEffectScope: 'invocation-gates',
    ratingSettlementInvocations,
    storyImpactGateInvocations,
    terminalReexecution: false,
    deletedFaultInjectionKeys: deletedGenerationKeys,
    initialCleanupForeignNamespacePreserved,
    foreignNamespacePreserved,
    secretPersisted,
  }));
} finally {
  activeRecoveredActors?.forceClose();
  await runtime?.close().catch(() => undefined);
  await recoveredRuntime?.close().catch(() => undefined);
  if (!cleanupClient.isOpen) await cleanupClient.connect().catch(() => undefined);
  if (cleanupClient.isOpen) {
    await deleteVerifierKeys().catch(() => 0);
    await cleanupClient.del(foreignNamespaceSentinelKey).catch(() => 0);
    await cleanupClient.quit();
  }
}
