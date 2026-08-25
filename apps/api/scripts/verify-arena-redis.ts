import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';

import { RedisRuntime } from '../src/redis/runtime';

const redisUrl = process.env.REDIS_URL?.trim();
if (!redisUrl) throw new Error('ARENA Redis verifier 需要 REDIS_URL');

const token = randomUUID();
const generationId = `generation-${token}`;
const generationRequestId = `request-${token}`;
const actorKey = `anonymous:${token}`;
const producerToken = `producer-${token}`;
const now = '2026-08-25T04:00:00.000Z';
const leaseExpiresAt = '2026-08-25T04:01:00.000Z';
const redis = new RedisRuntime(redisUrl, true);
const redisWriter = new RedisRuntime(redisUrl, true);
const cleanup = createClient({ url: redisUrl });

try {
  await redis.connect();
  await redisWriter.connect();
  await cleanup.connect();
  const store = redis.getGenerationReplayStore();
  const writerStore = redisWriter.getGenerationReplayStore();
  const created = await store.reserve({
    actorKey,
    generationRequestId,
    generationId,
    payloadHash: 'payload-a',
    producerToken,
    now,
    leaseExpiresAt,
  });
  const reused = await store.reserve({
    actorKey,
    generationRequestId,
    generationId: `unused-${token}`,
    payloadHash: 'payload-a',
    producerToken: `unused-producer-${token}`,
    now,
    leaseExpiresAt,
  });
  const conflict = await store.reserve({
    actorKey,
    generationRequestId,
    generationId: `conflict-${token}`,
    payloadHash: 'payload-b',
    producerToken: `conflict-producer-${token}`,
    now,
    leaseExpiresAt,
  });
  if (created.kind !== 'created' || reused.kind !== 'reused' || conflict.kind !== 'conflict') {
    throw new Error('ARENA_REDIS_RESERVATION_CONTRACT_FAILED');
  }

  await store.markRunning({ generationId, producerToken, now, leaseExpiresAt });
  const staleAppend = await store.appendEvents({
    generationId,
    producerToken: `stale-${token}`,
    events: [{ type: 'markdown', data: { chunk: 'must-not-write' } }],
    now,
  });
  if (staleAppend.owned || staleAppend.events.length !== 0) {
    throw new Error('ARENA_REDIS_FENCING_CONTRACT_FAILED');
  }
  const appended = await store.appendEvents({
    generationId,
    producerToken,
    events: [
      { type: 'markdown', data: { chunk: 'A' } },
      { type: 'reasoning', data: { chunk: 'R' } },
    ],
    now,
  });
  if (appended.events.length !== 2 || !appended.events.every((event) => event.id)) {
    throw new Error('ARENA_REDIS_APPEND_CONTRACT_FAILED');
  }
  await store.writeSnapshot({
    generationId,
    producerToken,
    now,
    snapshot: {
      status: 'running',
      markdown: 'A',
      reasoning: 'R',
      lastEventId: appended.events.at(-1)?.id ?? null,
      updatedAt: now,
    },
  });
  const replay = await store.readAfter({
    generationId,
    after: appended.events[0]?.id ?? null,
    blockMs: 10,
  });
  if (replay.kind !== 'events' || replay.events.length !== 1) {
    throw new Error('ARENA_REDIS_REPLAY_CONTRACT_FAILED');
  }
  const trimEvents = Array.from({ length: 2_050 }, (_, index) => ({
    type: 'markdown',
    data: { chunk: String(index % 10) },
  }));
  const trimRace = store.readAfter({
    generationId,
    after: appended.events.at(-1)?.id ?? null,
    blockMs: 1_000,
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 25));
  await writerStore.appendEvents({ generationId, producerToken, events: trimEvents, now });
  if ((await trimRace).kind !== 'window-lost') {
    throw new Error('ARENA_REDIS_BLOCKING_TRIM_RACE_CONTRACT_FAILED');
  }
  const eventsKey = `mahoshojo:gen:v1:${generationId}:events`;
  if (await cleanup.xLen(eventsKey) !== 2_048) {
    throw new Error('ARENA_REDIS_EXACT_TRIM_CONTRACT_FAILED');
  }
  const trimmed = await store.readAfter({
    generationId,
    after: appended.events[0]?.id ?? null,
    blockMs: 10,
  });
  if (trimmed.kind !== 'window-lost') {
    throw new Error('ARENA_REDIS_TRIM_WINDOW_CONTRACT_FAILED');
  }
  await cleanup.unlink(eventsKey);
  const missing = await store.readAfter({
    generationId,
    after: appended.events.at(-1)?.id ?? null,
    blockMs: 10,
  });
  if (missing.kind !== 'stream-missing') {
    throw new Error('ARENA_REDIS_STREAM_MISSING_CONTRACT_FAILED');
  }
  const hidden = await store.readState({ generationId, actorKey: 'anonymous:other' });
  if (hidden !== null) throw new Error('ARENA_REDIS_OWNER_SCOPE_FAILED');
  const cancel = await store.requestCancel({
    generationId,
    actorKey,
    reason: 'user',
    now,
  });
  const heartbeat = await store.heartbeat({ generationId, producerToken, now, leaseExpiresAt });
  if (cancel.kind !== 'accepted' || !heartbeat.owned || !heartbeat.cancelRequested) {
    throw new Error('ARENA_REDIS_CANCEL_CONTRACT_FAILED');
  }
  const finalizationClaim = await store.claimFinalization({
    generationId,
    producerToken,
    now,
    leaseExpiresAt,
  });
  if (finalizationClaim.kind !== 'cancelled') {
    throw new Error('ARENA_REDIS_CANCEL_FINALIZATION_ORDER_FAILED');
  }
  const terminal = await store.markTerminal({
    generationId,
    producerToken,
    terminal: { status: 'cancelled', code: 'USER_CANCELLED' },
    now,
  });
  const duplicateTerminal = await store.markTerminal({
    generationId,
    producerToken,
    terminal: { status: 'completed' },
    now,
  });
  if (!terminal.applied || duplicateTerminal.applied) {
    throw new Error('ARENA_REDIS_TERMINAL_CAS_FAILED');
  }
  const state = await store.readState({ generationId, actorKey });
  if (state?.status !== 'cancelled' || state.snapshot?.markdown !== 'A') {
    throw new Error('ARENA_REDIS_STATE_CONTRACT_FAILED');
  }
  const terminalStateTtl = await cleanup.pTTL(`mahoshojo:gen:v1:${generationId}:state`);
  if (terminalStateTtl <= 0 || terminalStateTtl > 2_700_000) {
    throw new Error('ARENA_REDIS_TERMINAL_TTL_CONTRACT_FAILED');
  }

  const orphanGenerationId = `generation-orphan-${token}`;
  const orphanProducerToken = `producer-orphan-${token}`;
  await store.reserve({
    actorKey,
    generationRequestId: `request-orphan-${token}`,
    generationId: orphanGenerationId,
    payloadHash: 'payload-orphan',
    producerToken: orphanProducerToken,
    mode: 'scenario',
    now,
    leaseExpiresAt,
  });
  await store.markRunning({
    generationId: orphanGenerationId,
    producerToken: orphanProducerToken,
    now,
    leaseExpiresAt,
  });
  const expiredHeartbeat = await store.heartbeat({
    generationId: orphanGenerationId,
    producerToken: orphanProducerToken,
    now: '2026-08-25T04:02:00.000Z',
    leaseExpiresAt: '2026-08-25T04:03:00.000Z',
  });
  const expiredAppend = await store.appendEvents({
    generationId: orphanGenerationId,
    producerToken: orphanProducerToken,
    events: [{ type: 'markdown', data: { chunk: 'stale' } }],
    now: '2026-08-25T04:02:00.000Z',
  });
  if (expiredHeartbeat.owned || expiredAppend.owned) {
    throw new Error('ARENA_REDIS_EXPIRED_PRODUCER_FENCING_FAILED');
  }
  const reaper = await store.claimLeaseExpiry({
    generationId: orphanGenerationId,
    actorKey,
    reaperToken: `reaper-${token}`,
    now: '2026-08-25T04:02:00.000Z',
    leaseExpiresAt: '2026-08-25T04:03:00.000Z',
  });
  if (reaper.kind !== 'claimed' || reaper.payloadHash !== 'payload-orphan'
    || reaper.mode !== 'scenario') {
    throw new Error('ARENA_REDIS_REAPER_FENCING_FAILED');
  }
  console.info(JSON.stringify({
    arenaRedis: true,
    reservation: true,
    replay: true,
    ownerScope: true,
    cancel: true,
    terminalCas: true,
    finalizationCas: true,
    reaperFencing: true,
    fencing: true,
    exactTrim: true,
    blockingTrimRace: true,
    expiredProducerFencing: true,
    streamMissing: true,
    terminalTtl: true,
  }));
} finally {
  await redis.close();
  await redisWriter.close();
  if (!cleanup.isOpen) await cleanup.connect();
  for await (const key of cleanup.scanIterator({
    MATCH: `mahoshojo:gen:v1:*${token}*`,
    COUNT: 100,
  })) {
    await cleanup.unlink(key);
  }
  await cleanup.quit();
}
