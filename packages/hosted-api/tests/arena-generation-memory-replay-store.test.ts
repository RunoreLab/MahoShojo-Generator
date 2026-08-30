import { describe, expect, it } from 'vitest';

import { createMemoryGenerationReplayStore } from '../src/arena-generation/memory-replay-store';

const producerToken = 'producer-token-1';
const preparationSeed = '11'.repeat(32);

const reserve = (store: ReturnType<typeof createMemoryGenerationReplayStore>) => store.reserve({
  actorKey: 'user:1',
  generationRequestId: 'request-1',
  generationId: 'generation-1',
  payloadHash: 'hash-1',
  preparationSeed,
  preparationVersion: 'arena-runtime-v1',
  producerToken,
  now: '2026-08-25T00:00:00.000Z',
  leaseExpiresAt: '2026-08-25T00:01:00.000Z',
});

describe('memory generation replay store', () => {
  it('keeps reservation idempotent and owner-scoped', async () => {
    const store = createMemoryGenerationReplayStore();
    await expect(reserve(store)).resolves.toMatchObject({ kind: 'created' });
    await expect(reserve(store)).resolves.toEqual({
      kind: 'reused',
      generationId: 'generation-1',
      preparationSeed,
      preparationVersion: 'arena-runtime-v1',
    });
    await expect(store.readState({ generationId: 'generation-1' })).resolves.toMatchObject({
      preparationSeed,
      preparationVersion: 'arena-runtime-v1',
    });
    await expect(store.readState({
      generationId: 'generation-1',
      actorKey: 'user:2',
    })).resolves.toBeNull();
  });

  it('rejects incomplete preparation metadata before writing a reservation', async () => {
    const store = createMemoryGenerationReplayStore();

    await expect(store.reserve({
      actorKey: 'user:1',
      generationRequestId: 'request-invalid',
      generationId: 'generation-invalid',
      payloadHash: 'hash-invalid',
      preparationSeed,
      producerToken,
      now: '2026-08-25T00:00:00.000Z',
      leaseExpiresAt: '2026-08-25T00:01:00.000Z',
    })).rejects.toThrow('MEMORY_GENERATION_PREPARATION_INVALID');
    await expect(store.readState({ generationId: 'generation-invalid' })).resolves.toBeNull();
  });

  it('propagates a fixed content-policy cancel reason through heartbeat and finalization claim', async () => {
    const store = createMemoryGenerationReplayStore();
    await reserve(store);
    await store.markRunning({
      generationId: 'generation-1',
      producerToken,
      now: '2026-08-25T00:00:00.000Z',
      leaseExpiresAt: '2026-08-25T00:01:00.000Z',
    });
    await store.requestCancel({
      generationId: 'generation-1',
      actorKey: 'user:1',
      reason: 'content_policy',
      now: '2026-08-25T00:00:01.000Z',
    });
    await expect(store.requestCancel({
      generationId: 'generation-1',
      actorKey: 'user:1',
      reason: 'user',
      now: '2026-08-25T00:00:01.500Z',
    })).resolves.toEqual({ kind: 'accepted', cancelReason: 'content_policy' });

    await expect(store.heartbeat({
      generationId: 'generation-1',
      producerToken,
      now: '2026-08-25T00:00:02.000Z',
      leaseExpiresAt: '2026-08-25T00:01:02.000Z',
    })).resolves.toEqual({
      owned: true,
      cancelRequested: true,
      cancelReason: 'content_policy',
    });
    await expect(store.claimFinalization({
      generationId: 'generation-1',
      producerToken,
      now: '2026-08-25T00:00:03.000Z',
      leaseExpiresAt: '2026-08-25T00:01:03.000Z',
    })).resolves.toEqual({ kind: 'cancelled', cancelReason: 'content_policy' });
    await expect(store.readState({ generationId: 'generation-1' })).resolves.toMatchObject({
      cancelRequested: true,
      cancelReason: 'content_policy',
    });
  });

  it('reports trimmed cursors without silently appending from the wrong point', async () => {
    const store = createMemoryGenerationReplayStore({ maxEvents: 2 });
    await reserve(store);
    await store.markRunning({
      generationId: 'generation-1',
      producerToken,
      now: '2026-08-25T00:00:00.000Z',
      leaseExpiresAt: '2026-08-25T00:01:00.000Z',
    });
    await store.appendEvents({
      generationId: 'generation-1',
      producerToken,
      events: [
        { type: 'markdown', data: { chunk: 'a' } },
        { type: 'markdown', data: { chunk: 'b' } },
        { type: 'markdown', data: { chunk: 'c' } },
      ],
      now: '2026-08-25T00:00:01.000Z',
    });
    await expect(store.readAfter({
      generationId: 'generation-1',
      after: '1-0',
      blockMs: 0,
    })).resolves.toMatchObject({
      kind: 'window-lost',
      events: [{ id: '2-0' }, { id: '3-0' }],
    });
    await expect(store.readAfter({
      generationId: 'generation-1',
      after: '2-0',
      blockMs: 0,
    })).resolves.toMatchObject({ kind: 'events', events: [{ id: '3-0' }] });
  });

  it('fences stale producer mutations with a different token', async () => {
    const store = createMemoryGenerationReplayStore();
    await reserve(store);
    await expect(store.markRunning({
      generationId: 'generation-1',
      producerToken: 'stale-token',
      now: '2026-08-25T00:00:00.000Z',
      leaseExpiresAt: '2026-08-25T00:01:00.000Z',
    })).resolves.toEqual({ owned: false, cancelRequested: false });
    await expect(store.appendEvents({
      generationId: 'generation-1',
      producerToken: 'stale-token',
      events: [{ type: 'markdown', data: { chunk: 'must-not-write' } }],
      now: '2026-08-25T00:00:01.000Z',
    })).resolves.toEqual({ owned: false, events: [] });
    await expect(store.readAfter({
      generationId: 'generation-1',
      after: null,
      blockMs: 0,
    })).resolves.toEqual({ kind: 'events', events: [] });
  });

  it('does not let an expired producer renew or mutate the active lifecycle', async () => {
    const store = createMemoryGenerationReplayStore();
    await reserve(store);
    await store.markRunning({
      generationId: 'generation-1',
      producerToken,
      now: '2026-08-25T00:00:00.000Z',
      leaseExpiresAt: '2026-08-25T00:01:00.000Z',
    });

    await expect(store.heartbeat({
      generationId: 'generation-1',
      producerToken,
      now: '2026-08-25T00:02:00.000Z',
      leaseExpiresAt: '2026-08-25T00:03:00.000Z',
    })).resolves.toMatchObject({ owned: false });
    await expect(store.appendEvents({
      generationId: 'generation-1',
      producerToken,
      events: [{ type: 'markdown', data: { chunk: 'stale' } }],
      now: '2026-08-25T00:02:00.000Z',
    })).resolves.toEqual({ owned: false, events: [] });
    await expect(store.claimFinalization({
      generationId: 'generation-1',
      producerToken,
      now: '2026-08-25T00:02:00.000Z',
      leaseExpiresAt: '2026-08-25T00:03:00.000Z',
    })).resolves.toEqual({ kind: 'fenced' });
  });

  it('fences stale running snapshots after the lifecycle becomes terminal', async () => {
    const store = createMemoryGenerationReplayStore();
    await reserve(store);
    await store.markRunning({
      generationId: 'generation-1',
      producerToken,
      now: '2026-08-25T00:00:00.000Z',
      leaseExpiresAt: '2026-08-25T00:01:00.000Z',
    });
    await store.markTerminal({
      generationId: 'generation-1',
      producerToken,
      terminal: { status: 'completed' },
      terminalEvent: { type: 'done', data: { ok: true, status: 'completed' } },
      clearTerminalSnapshot: true,
      now: '2026-08-25T00:00:02.000Z',
    });

    await expect(store.writeSnapshot({
      generationId: 'generation-1',
      producerToken,
      snapshot: {
        status: 'running',
        markdown: 'stale',
        reasoning: '',
        lastEventId: null,
        updatedAt: '2026-08-25T00:00:03.000Z',
      },
      now: '2026-08-25T00:00:03.000Z',
    })).resolves.toEqual({ owned: false });
    await expect(store.writeSnapshot({
      generationId: 'generation-1',
      producerToken,
      snapshot: {
        status: 'completed',
        markdown: 'terminal',
        reasoning: '',
        lastEventId: null,
        updatedAt: '2026-08-25T00:00:04.000Z',
      },
      now: '2026-08-25T00:00:04.000Z',
    })).resolves.toEqual({ owned: true });
    await expect(store.readSnapshot({ generationId: 'generation-1' })).resolves.toMatchObject({
      status: 'completed',
      markdown: 'terminal',
    });
  });

  it('atomically clears an older running snapshot when terminal content exceeds its budget', async () => {
    const store = createMemoryGenerationReplayStore();
    await reserve(store);
    await store.markRunning({
      generationId: 'generation-1',
      producerToken,
      now: '2026-08-25T00:00:00.000Z',
      leaseExpiresAt: '2026-08-25T00:01:00.000Z',
    });
    await store.writeSnapshot({
      generationId: 'generation-1',
      producerToken,
      snapshot: {
        status: 'running',
        markdown: 'stale partial',
        reasoning: '',
        lastEventId: null,
        updatedAt: '2026-08-25T00:00:01.000Z',
      },
      now: '2026-08-25T00:00:01.000Z',
    });

    await store.markTerminal({
      generationId: 'generation-1',
      producerToken,
      terminal: { status: 'failed', code: 'GENERATION_FAILED' },
      terminalEvent: {
        type: 'error',
        data: { ok: false, status: 'failed', code: 'GENERATION_FAILED' },
      },
      clearTerminalSnapshot: true,
      now: '2026-08-25T00:00:02.000Z',
    });

    await expect(store.readSnapshot({ generationId: 'generation-1' })).resolves.toBeNull();
    await expect(store.readState({ generationId: 'generation-1' })).resolves.toMatchObject({
      status: 'failed',
      lastEventId: '1-0',
      snapshot: null,
      terminal: { status: 'failed', code: 'GENERATION_FAILED' },
    });
  });

  it('expires terminal state and its request-id reservation within the configured bound', async () => {
    let timestamp = 0;
    const store = createMemoryGenerationReplayStore({
      terminalTtlMs: 100,
      activeTtlMs: 1_000,
      now: () => timestamp,
    });
    await reserve(store);
    await store.markTerminal({
      generationId: 'generation-1',
      producerToken,
      terminal: { status: 'completed' },
      terminalEvent: { type: 'done', data: { ok: true, status: 'completed' } },
      clearTerminalSnapshot: true,
      now: '2026-08-25T00:00:01.000Z',
    });
    timestamp = 101;

    await expect(store.readState({ generationId: 'generation-1' })).resolves.toBeNull();
    await expect(reserve(store)).resolves.toEqual({
      kind: 'created',
      generationId: 'generation-1',
      preparationSeed,
      preparationVersion: 'arena-runtime-v1',
    });
  });
});
