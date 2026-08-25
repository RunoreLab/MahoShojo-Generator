import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';

import { RedisRuntime } from '../src/redis/runtime';

const redisUrl = process.env.REDIS_URL?.trim();
if (!redisUrl) throw new Error('ARENA Redis verifier 需要 REDIS_URL');

const token = randomUUID();
const generationId = `generation-${token}`;
const generationRequestId = `request-${token}`;
const actorKey = `anonymous:${token}`;
const now = '2026-08-25T04:00:00.000Z';
const leaseExpiresAt = '2026-08-25T04:01:00.000Z';
const redis = new RedisRuntime(redisUrl, true);
const cleanup = createClient({ url: redisUrl });

try {
  await redis.connect();
  const store = redis.getGenerationReplayStore();
  const created = await store.reserve({
    actorKey,
    generationRequestId,
    generationId,
    payloadHash: 'payload-a',
    now,
    leaseExpiresAt,
  });
  const reused = await store.reserve({
    actorKey,
    generationRequestId,
    generationId: `unused-${token}`,
    payloadHash: 'payload-a',
    now,
    leaseExpiresAt,
  });
  const conflict = await store.reserve({
    actorKey,
    generationRequestId,
    generationId: `conflict-${token}`,
    payloadHash: 'payload-b',
    now,
    leaseExpiresAt,
  });
  if (created.kind !== 'created' || reused.kind !== 'reused' || conflict.kind !== 'conflict') {
    throw new Error('ARENA_REDIS_RESERVATION_CONTRACT_FAILED');
  }

  await store.markRunning({ generationId, now, leaseExpiresAt });
  const appended = await store.appendEvents({
    generationId,
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
  const hidden = await store.readState({ generationId, actorKey: 'anonymous:other' });
  if (hidden !== null) throw new Error('ARENA_REDIS_OWNER_SCOPE_FAILED');
  const cancel = await store.requestCancel({
    generationId,
    actorKey,
    reason: 'user',
    now,
  });
  const heartbeat = await store.heartbeat({ generationId, now, leaseExpiresAt });
  if (cancel.kind !== 'accepted' || !heartbeat.cancelRequested) {
    throw new Error('ARENA_REDIS_CANCEL_CONTRACT_FAILED');
  }
  const terminal = await store.markTerminal({
    generationId,
    terminal: { status: 'cancelled', code: 'USER_CANCELLED' },
    now,
  });
  const duplicateTerminal = await store.markTerminal({
    generationId,
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

  console.info(JSON.stringify({
    arenaRedis: true,
    reservation: true,
    replay: true,
    ownerScope: true,
    cancel: true,
    terminalCas: true,
  }));
} finally {
  await redis.close();
  await cleanup.connect();
  for await (const key of cleanup.scanIterator({
    MATCH: `mahoshojo:gen:v1:*${token}*`,
    COUNT: 100,
  })) {
    await cleanup.unlink(key);
  }
  await cleanup.quit();
}
