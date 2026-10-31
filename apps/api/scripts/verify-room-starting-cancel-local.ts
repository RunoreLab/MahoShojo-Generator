import assert from 'node:assert/strict';
import { DesktopRoomGenerationIdentitySchema } from '@mahoshojo/contracts/desktop-room-session';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from 'redis';
import { createArenaGenerationService } from '@mahoshojo/hosted-api/arena-generation/service';
import {
  canonicalizeNodeArenaGenerationSemanticPayload,
  deriveArenaGenerationId,
  hashArenaGenerationPayload,
  createNodeArenaNoProviderCancellationRecorder,
  createNodeArenaGenerationTerminalStore,
  createNodeArenaRejectedTerminalRecorder,
} from '@mahoshojo/hosted-runtime/arena-generation';
import type { NodeDataD1Client } from '@mahoshojo/hosted-runtime/node-runtime/data-ports';
import { createRedisGenerationReplayStore, type RedisGenerationClient } from '../src/redis/generation-replay-store';
import { createArenaRoomRedisKeyspace } from '../src/arena-room/redis-room-keyspace';
import { createRedisRoomStore } from '../src/arena-room/redis-room-store';
import { createRoomActorRegistry } from '../src/arena-room/room-actor-registry';
import { createArenaRoomGenerationService } from '../src/arena-room/room-generation-service';
import { createArenaRoomGenerationPort } from '../src/arena-generation/room-generation-port';
import { createRoomVerifierMembershipService } from './room-verifier-membership';
import { createRoomGenerationVerifierMaterializer } from './room-generation-verifier-materializer';

// Intentionally accepts only an explicitly selected local redis-server binary.
// Never reads REDIS_URL or connects to an existing Redis. A random password and
// PID verification make a loopback port race fail closed before any fixture write.
const binary = process.argv[2];
if (!binary || !path.isAbsolute(binary) || process.argv.length !== 3) {
  throw new Error('用法：node --import tsx scripts/verify-room-starting-cancel-local.ts /absolute/path/to/redis-server');
}
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const address = reservation.address();
assert.ok(address && typeof address === 'object');
const port = address.port;
await new Promise<void>((resolve, reject) => {
  reservation.close((error) => error ? reject(error) : resolve());
});
const password = randomBytes(32).toString('hex');
const directory = await mkdtemp(path.join(tmpdir(), 'maho-room-starting-cancel-'));
const server = spawn(binary, [
  '--bind', '127.0.0.1', '--port', String(port), '--protected-mode', 'yes', '--requirepass', password,
  '--save', '', '--appendonly', 'no', '--dir', directory,
], { stdio: ['ignore', 'pipe', 'pipe'] });
let serverError: Error | null = null;
let serverLog = '';
for (const stream of [server.stdout, server.stderr]) {
  stream?.on('data', (chunk: Buffer) => { serverLog = (serverLog + chunk.toString()).slice(-4_096); });
}
server.on('error', (error) => { serverError = error; });
const serverExit = once(server, 'exit').catch(() => undefined);
const client = createClient({
  password,
  socket: { host: '127.0.0.1', port, reconnectStrategy: false, connectTimeout: 1_000, socketTimeout: 5_000 },
});
client.on('error', () => undefined);

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};
const deadline = async <T>(promise: Promise<T>, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Barrier timeout: ${label}`)), 5_000);
    })]);
  } finally { clearTimeout(timer); }
};
const config = () => ({
  battleMode: 'classic' as const, reportFormat: 'markdown' as const,
  combatants: ['character-1', 'character-2'].map((id) => ({
    key: `data-card:${id}`, ref: { id, kind: 'character' as const, versionToken: 'v1' },
  })),
  teams: [], scenario: null, auxScenarios: [], materials: [], userGuidance: '',
  storyLength: 'standard' as const, customStoryLength: null, selectedLanguage: 'zh-CN',
  historySettings: {
    readArenaHistory: true, readArenaHistoryLimit: 3, isArenaHistoryUnlimited: false,
    writeArenaHistory: true, readCurrentState: true, writeCurrentState: true,
    readNarrativeHistory: false, readNarrativeHistoryLimit: 10,
    isNarrativeHistoryUnlimited: false, writeNarrativeHistory: false,
  },
});

type LocalDatabase = {
  exec(sql: string): void;
  prepare(sql: string): { all(...params: unknown[]): Record<string, unknown>[]; run(...params: unknown[]): { changes: number | bigint } };
  close(): void;
};
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => LocalDatabase };
const schema = await readFile(new URL('../../web/lib/database/schema.sql', import.meta.url), 'utf8');
const createD1 = () => {
  const database = new DatabaseSync(':memory:');
  for (const table of ['battle_report_generations', 'large_objects']) {
    const definition = new RegExp(String.raw`CREATE TABLE IF NOT EXISTS ${table} \([\s\S]*?\n\);`).exec(schema)?.[0];
    if (!definition) throw new Error(`Missing real schema: ${table}`);
    database.exec(definition);
  }
  const d1: NodeDataD1Client = {
    prepare(sql) {
      const statement = database.prepare(sql);
      let parameters: unknown[] = [];
      const bound = {
        bind(...next: unknown[]) { parameters = next; return bound; },
        async all() { return { success: true, results: statement.all(...parameters), meta: {} }; },
        async run() { return { success: true, results: [], meta: { changes: Number(statement.run(...parameters).changes) } }; },
      };
      return bound;
    },
  };
  return { database, d1 };
};

// This barrier wraps actual Redis EVAL, not a mocked Room/core implementation.
// It deliberately stops after the Room checkpoint has committed and before the
// core reservation exists. Releasing it resumes the original captured start.
type Barrier = 'room-reserved-core-absent' | 'original-token-bound' | 'running-won';
type Variant = 'default' | 'legacy-off' | 'flag-off-reconcile' | 'd1-unavailable'
  | 'read-reserved-legacy' | 'read-reserved-gated'
  | 'preflight-rejection' | 'rejection-won' | 'reserved-cancel-retry' | 'seeded-expired'
  | 'room-missing' | 'room-ttl' | 'epoch' | 'host' | 'closed' | 'deadline' | 'malformed-deadline' | 'token' | 'intent' | 'old-lease' | 'next-lease';
const cancelAtBarrier = async (barrier: Barrier, variant: Variant = 'default') => {
  const roomId = `starting-cancel-${barrier}-${variant}`;
  const generationRequestId = `request-${barrier}-${variant}`;
  const denyAdmission = !['default', 'legacy-off', 'read-reserved-legacy', 'read-reserved-gated', 'flag-off-reconcile', 'd1-unavailable', 'preflight-rejection', 'rejection-won', 'reserved-cancel-retry', 'seeded-expired'].includes(variant);
  let markKeys: string[] = [];
  const actorKey = `pvp-room:${roomId}`;
  const keyPrefix = 'localstartingcancel';
  const entered = deferred();
  const release = deferred();
  let blocked = false;
  let executions = 0;
  const wrapped: RedisGenerationClient = {
    eval: async (script, options) => {
      const shouldBlock = variant !== 'rejection-won' && !blocked && (barrier === 'room-reserved-core-absent'
        ? script.includes('-- GEN_RESERVE_') : script.includes('-- GEN_MARK_RUNNING_'));
      if (shouldBlock && barrier === 'running-won') {
        const result = await client.eval(script, options);
        assert.equal(result, 1, 'The actual Redis running transition must win first');
        blocked = true; entered.resolve(); await release.promise; return result;
      }
      if (shouldBlock) {
        if (script.includes('-- GEN_MARK_RUNNING_')) markKeys = options.keys;
        blocked = true;
        entered.resolve();
        await release.promise;
      }
      if (script.includes('-- GEN_MARK_RUNNING_') && variant === 'next-lease') {
        options.arguments[2] = new Date(Date.now() - 1_000).toISOString();
      }
      return client.eval(script, options);
    },
    get: (key) => client.get(key),
    xRead: (streams, options) => client.xRead(streams, options),
  };
  const roomStore = createRedisRoomStore({ getClient: () => client, keyPrefix });
  const actors = createRoomActorRegistry({
    store: roomStore,
    createRoomIdentity: () => ({ roomId, roomEpoch: 'epoch-1' }),
    createTimestamp: () => new Date().toISOString(), now: Date.now,
  });
  const memberships = createRoomVerifierMembershipService({
    actors, createUserId: () => 'host-1', now: () => new Date().toISOString(),
  });
  const host = await memberships.create({ accountUserId: 101, displayName: 'Synthetic Host', sharedConfig: config() });
  const store = createRedisGenerationReplayStore({ getClient: () => wrapped, keyPrefix });
  const { d1, database } = createD1();
  let d1Available = true;
  const hosted = createArenaGenerationService({
    store,
    terminalStore: createNodeArenaGenerationTerminalStore({ getD1Client: () => d1Available ? d1 : null }),
    noProviderCancellationRecorder: createNodeArenaNoProviderCancellationRecorder({ getD1Client: () => d1Available ? d1 : null }),
    rejectedTerminalRecorder: createNodeArenaRejectedTerminalRecorder({ getD1Client: () => d1Available ? d1 : null }),
    executor: {
      ...(variant === 'seeded-expired' ? {
        materializationVersion: 'arena-runtime-v1',
        preflight: async (input: { payload: Record<string, unknown> }) => ({
          materializationPayload: input.payload,
          semanticPayload: await canonicalizeNodeArenaGenerationSemanticPayload({
            payload: input.payload, signatures: { generateSignature: async () => null, verifySignature: async () => false },
            trustedInternalGuidance: String(input.payload.internalGuidance),
            trustedPvpContext: input.payload.pvpContext as { roomId: string; matchId: string; roundId: string },
          }),
        }),
        materialize: async (input: { payload: Record<string, unknown> }) => ({ executionPayload: input.payload }),
      } : {}),
      async prepare(input) {
        const semanticPayload = await canonicalizeNodeArenaGenerationSemanticPayload({
          payload: input.payload,
          signatures: { generateSignature: async () => null, verifySignature: async () => false },
          trustedInternalGuidance: String(input.payload.internalGuidance),
          trustedPvpContext: input.payload.pvpContext as { roomId: string; matchId: string; roundId: string },
        });
        if (variant === 'preflight-rejection' || variant === 'rejection-won') {
          if (variant === 'preflight-rejection') { blocked = true; entered.resolve(); await release.promise; }
          return { kind: 'auditable-rejection' as const, actorKey, generationRequestId,
            code: 'CONTENT_POLICY_VIOLATION', stage: 'safety', fingerprintPayload: semanticPayload,
            response: Response.json({ code: 'CONTENT_POLICY_VIOLATION' }, { status: 400 }),
            audit: { startedAt: new Date().toISOString(), mode: 'classic', generationMode: 'stream' as const,
              endpoint: 'api/arena/generate-stream', pvpContext: { roomId, matchId: input.generationRequestId, roundId: 'attempt-1' } },
          };
        }
        return { executionPayload: input.payload, semanticPayload };
      },
      async execute({ claimFinalization }) {
        executions += 1;
        await claimFinalization({ status: 'cancelled', code: 'USER_CANCELLED' });
        return { status: 'cancelled' as const, code: 'USER_CANCELLED' };
      },
    },
    resolveActor: async () => ({ actorKey }), deriveGenerationId: deriveArenaGenerationId,
    hashPayload: hashArenaGenerationPayload, now: () => new Date(),
    replayPollMs: 5, deltaFlushIntervalMs: 5,
  });
  const port = createArenaRoomGenerationPort({
    generationService: hosted,
    pvpAuthority: { sign: async () => 'synthetic-pvp' },
    internalGuidanceAuthority: { sign: async () => 'synthetic-guidance' },
    deriveGenerationId: deriveArenaGenerationId,
    canonicalizeSemanticPayload: (input) => canonicalizeNodeArenaGenerationSemanticPayload({
      payload: input.payload,
      signatures: { generateSignature: async () => null, verifySignature: async () => false },
      trustedInternalGuidance: input.trustedInternalGuidance,
      trustedPvpContext: input.trustedPvpContext,
    }),
  });
  let coordinator = createArenaRoomGenerationService({
    memberships, materializer: createRoomGenerationVerifierMaterializer(),
    generation: { ...port, async startFromHostRequest(input) {
      try {
        const result = await port.startFromHostRequest(input);
        if (result.kind === 'rejected') console.log(JSON.stringify({ kind: 'fixture-start-rejected', status: result.status, code: result.code }));
        if (variant === 'rejection-won') { entered.resolve(); await release.promise; }
        return result;
      } catch (error) { console.log(JSON.stringify({ kind: 'fixture-start-error', error: String(error) })); throw error; }
    } }, startingCancelEnabled: variant !== 'legacy-off' && variant !== 'read-reserved-legacy',
  });
  const generationId = await port.deriveGenerationId({ roomId, generationRequestId });
  const start = coordinator.start({
    roomId, accountUserId: 101,
    request: {
      expectedRoomEpoch: host.roomEpoch, expectedRevision: host.snapshot.revision,
      expectedControlSeq: host.snapshot.controlSeq, generationRequestId,
      sharedConfig: config(), hostLocalPayloads: [], generation: {},
    },
    sourceRequest: new Request('https://loopback.invalid/room-generation', { method: 'POST' }),
  }).then((value) => ({ value }), (error: unknown) => ({ error }));
  let cancelError: string | null = null;
  try {
    await deadline(Promise.race([entered.promise, start.then((result) => {
      throw new Error(`Start finished before ${barrier}: ${'error' in result ? String(result.error) : JSON.stringify(result.value)}`);
    })]), barrier);
    const persisted = await roomStore.load(roomId);
    assert.equal(persisted?.snapshot.activeGeneration?.state, 'starting');
    const expectedGeneration = DesktopRoomGenerationIdentitySchema.parse(Object.fromEntries(Object.entries(persisted!.snapshot.activeGeneration!).filter(([key]) => !['state', 'startedAt', 'finishedAt'].includes(key))));
    const exactCancel = () => coordinator.cancel({ roomId, generationId, accountUserId: 101, request: { expectedRoomEpoch: host.roomEpoch }, ...(variant === 'legacy-off' ? {} : { expectedGeneration }) });
    const before = await store.readState({ generationId, actorKey });
    if (variant === 'read-reserved-legacy' || variant === 'read-reserved-gated') {
      // Members can read after Room reservation while the producer prepares.
      for (let read = 0; read < 2; read += 1) {
        await coordinator.read({ roomId, generationId, accountUserId: 101 });
        assert.equal((await roomStore.load(roomId))?.snapshot.activeGeneration?.state, 'starting');
        assert.equal(executions, 0);
      }
      release.resolve();
      const result = await deadline(start, 'original producer after concurrent reserved reads');
      assert.ok('value' in result);
      assert.equal(executions, 1);
      return;
    }
    if (variant === 'rejection-won') {
      assert.equal(before?.terminal?.status, 'failed');
      assert.equal(before?.roomAdmission?.generationRequestId, generationRequestId);
      await exactCancel();
      release.resolve();
      await deadline(start, 'preflight rejection mirror after concurrent cancel');
      await coordinator.read({ roomId, generationId, accountUserId: 101 });
      assert.equal(executions, 0);
      const rows = database.prepare('SELECT * FROM battle_report_generations').all();
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.status, 'failed');
      assert.equal(JSON.parse(String(rows[0]?.extra_json)).rejectedBeforeProvider, true);
      assert.equal((await roomStore.load(roomId))?.generationLedger[0]?.mirror.state, 'failed');
      return;
    }
    if (barrier === 'room-reserved-core-absent') assert.equal(before, null);
    else {
      assert.equal(before?.status, barrier === 'running-won' ? 'running' : 'reserved');
      if (variant !== 'legacy-off') assert.equal(persisted?.generationLedger[0]?.startGate?.producerTokenDigest, before?.producerTokenDigest);
      assert.match(before?.producerTokenDigest ?? '', /^sha256:[a-f0-9]{64}$/u);
    }
    if (variant === 'legacy-off') {
      assert.equal(persisted?.authorityStateVersion, 2);
      assert.equal(persisted?.generationLedger[0]?.startGate, undefined);
      await assert.rejects(coordinator.cancel({ roomId, generationId, accountUserId: 101, request: { expectedRoomEpoch: host.roomEpoch }, expectedGeneration }), { code: 'ROOM_GENERATION_UNAVAILABLE' });
    }
    if (denyAdmission) {
      const checkpointKey = createArenaRoomRedisKeyspace(keyPrefix).roomCheckpointKey(roomId);
      const checkpoint = JSON.parse((await client.get(checkpointKey))!) as { roomEpoch: string; state: {
        snapshot: { roomEpoch: string }; lifecycle: { status: string }; deadlines: { roomIdleDeadline: string };
        memberAuthority: Array<{ accountUserId: number }>; generationLedger: Array<{
          mirror: { generationRequestId: string }; startGate: { producerTokenDigest: string };
        }>;
      } };
      if (variant === 'room-missing') await client.del(checkpointKey);
      else if (variant === 'room-ttl') { await client.pExpire(checkpointKey, 1); await delay(10); assert.equal(await client.get(checkpointKey), null); }
      else if (variant === 'old-lease') {
        const coreKey = markKeys[0]!;
        const core = JSON.parse((await client.get(coreKey))!) as { leaseExpiresAt: string };
        core.leaseExpiresAt = new Date(Date.now() - 1_000).toISOString();
        await client.set(coreKey, JSON.stringify(core));
      } else if (variant !== 'next-lease') {
        if (variant === 'epoch') { checkpoint.roomEpoch = 'epoch-2'; checkpoint.state.snapshot.roomEpoch = 'epoch-2'; }
        if (variant === 'host') checkpoint.state.memberAuthority[0]!.accountUserId = 102;
        if (variant === 'closed') checkpoint.state.lifecycle.status = 'closed';
        if (variant === 'deadline') checkpoint.state.deadlines.roomIdleDeadline = new Date(Date.now() - 1_000).toISOString();
        if (variant === 'malformed-deadline') checkpoint.state.deadlines.roomIdleDeadline = 'not-an-iso-deadline';
        if (variant === 'token') checkpoint.state.generationLedger[0]!.startGate.producerTokenDigest = `sha256:${'f'.repeat(64)}`;
        if (variant === 'intent') checkpoint.state.generationLedger[0]!.mirror.generationRequestId = 'changed-request';
        await client.set(checkpointKey, JSON.stringify(checkpoint));
      }
      release.resolve();
      await deadline(start, `live admission rejects ${variant}`);
      assert.equal(executions, 0);
      assert.equal(database.prepare('SELECT * FROM battle_report_generations').all().length, 0);
      assert.equal((await store.readState({ generationId, actorKey }))?.terminal, null);
      return;
    }
    if (variant === 'seeded-expired') {
      assert.notEqual(before?.payloadHash, persisted!.generationLedger[0]!.generationPayloadDigest!.slice(7));
      assert.equal(before?.preparationVersion, 'arena-runtime-v1');
      const coreKey = markKeys[0]!;
      const core = JSON.parse((await client.get(coreKey))!) as { leaseExpiresAt: string };
      core.leaseExpiresAt = new Date(Date.now() - 1_000).toISOString();
      await client.set(coreKey, JSON.stringify(core));
    }
    if (variant === 'reserved-cancel-retry') {
      d1Available = false;
      await store.requestCancel({ generationId, actorKey, reason: 'user', now: new Date().toISOString() });
      release.resolve();
      await deadline(start, 'reserved cancellation durable write unavailable');
      const pending = await store.readState({ generationId, actorKey });
      assert.equal(executions, 0);
      assert.equal(pending?.status, 'reserved');
      assert.equal(pending?.terminal, null);
      assert.equal(database.prepare('SELECT * FROM battle_report_generations').all().length, 0);
      d1Available = true;
      await exactCancel();
      assert.equal(database.prepare('SELECT * FROM battle_report_generations').all()[0]?.status, 'aborted');
      assert.equal((await roomStore.load(roomId))?.generationLedger[0]?.mirror.state, 'cancelled');
      return;
    }
    if (variant === 'flag-off-reconcile') coordinator = createArenaRoomGenerationService({
      memberships, materializer: createRoomGenerationVerifierMaterializer(), generation: port, startingCancelEnabled: false,
    });
    if (variant === 'd1-unavailable') d1Available = false;
    try {
      await exactCancel();
    } catch (error) { cancelError = error instanceof Error ? error.message : String(error); }
    const rowsAtCancel = database.prepare('SELECT * FROM battle_report_generations').all();
    assert.equal(rowsAtCancel.length, barrier === 'running-won' || variant === 'd1-unavailable' ? 0 : 1);
    release.resolve();
    await deadline(start, 'captured start after cancel');
    // execute is called synchronously inside launchProducer; an awaited start
    // completes only after admission, so no arbitrary sleep establishes this.
    console.log(JSON.stringify({ kind: 'observation', barrier, variant, cancelError, executions }));
    if (variant === 'd1-unavailable') {
      assert.equal(cancelError, 'ROOM_OPERATION_UNKNOWN');
      assert.equal((await store.readState({ generationId, actorKey }))?.terminal, null);
      d1Available = true;
      await coordinator.read({ roomId, generationId, accountUserId: 101 });
      cancelError = null;
    }
    assert.equal(executions, barrier === 'running-won' ? 1 : 0, 'Only the real running winner may reach execute');
    assert.equal(cancelError, null, 'Cancellation must finish without invented terminal evidence');
    if (barrier !== 'running-won') {
      const row = database.prepare('SELECT * FROM battle_report_generations').all()[0]!;
      assert.equal(row.status, 'aborted');
      assert.equal(row.output_chars, 0);
      assert.equal(row.output_bytes, 0);
      assert.equal(row.mode, 'classic');
      assert.equal(row.pvp_room_id, roomId);
      const extra = JSON.parse(String(row.extra_json)) as Record<string, unknown>;
      assert.equal(extra.generationTerminalStatus, 'cancelled');
      assert.equal(extra.cancelledBeforeProvider, 'room-generation-no-provider-cancel-v1');
      assert.equal(extra.resultRef, null);
      assert.equal(extra.generationPayloadHash, persisted!.generationLedger[0]!.generationPayloadDigest!.slice(7));
      const finalRoom = await roomStore.load(roomId);
      assert.equal(finalRoom?.generationLedger[0]?.mirror.state, 'cancelled');
      assert.equal(finalRoom?.generationLedger[0]?.startGate?.cancellationRequested, true);
      await exactCancel();
      assert.equal(database.prepare('SELECT * FROM battle_report_generations').all().length, 1);
      await coordinator.read({ roomId, generationId, accountUserId: 101 });
      const projection = await hosted.readOwnedProjection({ generationId, actorKey });
      assert.equal(projection.kind, 'found');
      if (projection.kind === 'found') assert.equal(projection.projection.status, 'cancelled');
    }
  } finally {
    release.resolve();
    await start;
    await actors.shutdown();
    database.close();
  }
};

try {
  for (let attempt = 0; ; attempt += 1) {
    if (serverError) throw serverError;
    if (server.exitCode !== null) throw new Error(`Local Redis exited: ${server.exitCode}\n${serverLog}`);
    try { await client.connect(); break; } catch (error) {
      if (attempt >= 100) throw error;
      await delay(50);
    }
  }
  const info = await client.info('server');
  assert.equal(Number(/^process_id:(\d+)\r?$/mu.exec(info)?.[1]), server.pid, 'Refusing a Redis process not spawned by this verifier');
  assert.equal((await client.configGet('save')).save, '');
  assert.equal((await client.configGet('appendonly')).appendonly, 'no');
  console.log(JSON.stringify({ kind: 'environment', redisVersion: /^redis_version:(.+)$/mu.exec(info)?.[1]?.trim(), transport: 'private-loopback-tcp', persistence: 'disabled', productionData: false }));
  for (const variant of ['read-reserved-legacy', 'read-reserved-gated'] as const) {
    await cancelAtBarrier('original-token-bound', variant);
    console.log(JSON.stringify({ kind: 'pass', variant }));
  }
  for (const barrier of ['room-reserved-core-absent', 'original-token-bound', 'running-won'] as const) {
    await cancelAtBarrier(barrier);
    console.log(JSON.stringify({ kind: 'pass', barrier }));
  }
  for (const variant of ['legacy-off', 'flag-off-reconcile', 'd1-unavailable', 'preflight-rejection', 'rejection-won', 'reserved-cancel-retry', 'seeded-expired', 'room-missing', 'room-ttl', 'epoch', 'host', 'closed', 'deadline', 'malformed-deadline', 'token', 'intent', 'old-lease', 'next-lease'] as const) {
    await cancelAtBarrier(variant === 'legacy-off' ? 'running-won' : ['d1-unavailable', 'preflight-rejection'].includes(variant) ? 'room-reserved-core-absent' : 'original-token-bound', variant);
    console.log(JSON.stringify({ kind: 'pass', variant }));
  }
} finally {
  if (client.isOpen) client.destroy();
  server.kill('SIGTERM');
  const killTimeout = setTimeout(() => server.kill('SIGKILL'), 2_000);
  killTimeout.unref();
  await serverExit;
  clearTimeout(killTimeout);
  await rm(directory, { recursive: true, force: true });
}
