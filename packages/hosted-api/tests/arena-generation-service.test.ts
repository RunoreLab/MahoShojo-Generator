import { describe, expect, test, vi } from 'vitest';

import {
  createArenaGenerationService,
  type ArenaGenerationExecutor,
  type ArenaGenerationTerminalStore,
  type GenerationReplayStore,
  type GenerationReplayStoreState,
  type GenerationStreamEvent,
} from '../src/arena-generation/service';

const readResponseText = async (response: Response): Promise<string> => response.text();

class MemoryReplayStore implements GenerationReplayStore {
  readonly requests = new Map<string, { payloadHash: string; generationId: string }>();
  readonly states = new Map<string, GenerationReplayStoreState>();
  readonly events = new Map<string, GenerationStreamEvent[]>();
  reserveUnavailable = false;
  markRunningUnavailable = false;
  readonly appendBatches: Array<GenerationStreamEvent[]> = [];

  async reserve(input: Parameters<GenerationReplayStore['reserve']>[0]) {
    if (this.reserveUnavailable) throw new Error('redis unavailable');
    const key = `${input.actorKey}:${input.generationRequestId}`;
    const previous = this.requests.get(key);
    if (previous) {
      return previous.payloadHash === input.payloadHash
        ? { kind: 'reused' as const, generationId: previous.generationId }
        : { kind: 'conflict' as const };
    }
    this.requests.set(key, {
      payloadHash: input.payloadHash,
      generationId: input.generationId,
    });
    this.states.set(input.generationId, {
      actorKey: input.actorKey,
      generationId: input.generationId,
      generationRequestId: input.generationRequestId,
      payloadHash: input.payloadHash,
      status: 'reserved',
      lastEventId: null,
      updatedAt: input.now,
      leaseExpiresAt: input.leaseExpiresAt,
      snapshot: null,
      terminal: null,
      cancelRequested: false,
    });
    return { kind: 'created' as const, generationId: input.generationId };
  }

  async markRunning(input: Parameters<GenerationReplayStore['markRunning']>[0]) {
    if (this.markRunningUnavailable) throw new Error('redis unavailable');
    const state = this.states.get(input.generationId)!;
    this.states.set(input.generationId, {
      ...state,
      status: 'running',
      updatedAt: input.now,
      leaseExpiresAt: input.leaseExpiresAt,
    });
  }

  async heartbeat(input: Parameters<GenerationReplayStore['heartbeat']>[0]) {
    const state = this.states.get(input.generationId)!;
    this.states.set(input.generationId, {
      ...state,
      updatedAt: input.now,
      leaseExpiresAt: input.leaseExpiresAt,
    });
    return { cancelRequested: state.cancelRequested };
  }

  async appendEvents(input: Parameters<GenerationReplayStore['appendEvents']>[0]) {
    const current = this.events.get(input.generationId) ?? [];
    const appended = input.events.map((event, index) => ({
      ...event,
      id: `${current.length + index + 1}-0`,
    }));
    this.events.set(input.generationId, [...current, ...appended]);
    this.appendBatches.push(appended);
    const state = this.states.get(input.generationId)!;
    this.states.set(input.generationId, {
      ...state,
      lastEventId: appended.at(-1)?.id ?? state.lastEventId,
      updatedAt: input.now,
    });
    return { events: appended };
  }

  async writeSnapshot(input: Parameters<GenerationReplayStore['writeSnapshot']>[0]) {
    const state = this.states.get(input.generationId)!;
    this.states.set(input.generationId, {
      ...state,
      snapshot: input.snapshot,
      updatedAt: input.now,
    });
  }

  async readSnapshot(input: Parameters<GenerationReplayStore['readSnapshot']>[0]) {
    return this.states.get(input.generationId)?.snapshot ?? null;
  }

  async readAfter(input: Parameters<GenerationReplayStore['readAfter']>[0]) {
    const events = this.events.get(input.generationId) ?? [];
    if (!input.after) return { kind: 'events' as const, events };
    const index = events.findIndex((event) => event.id === input.after);
    return index < 0
      ? { kind: 'window-lost' as const, events: [] }
      : { kind: 'events' as const, events: events.slice(index + 1) };
  }

  async markTerminal(input: Parameters<GenerationReplayStore['markTerminal']>[0]) {
    const state = this.states.get(input.generationId)!;
    if (state.terminal) return { applied: false };
    this.states.set(input.generationId, {
      ...state,
      status: input.terminal.status,
      terminal: input.terminal,
      updatedAt: input.now,
      leaseExpiresAt: null,
    });
    return { applied: true };
  }

  async readState(input: Parameters<GenerationReplayStore['readState']>[0]) {
    return this.states.get(input.generationId) ?? null;
  }

  async requestCancel(input: Parameters<GenerationReplayStore['requestCancel']>[0]) {
    const state = this.states.get(input.generationId);
    if (!state) return { kind: 'not-found' as const };
    if (state.actorKey !== input.actorKey) return { kind: 'forbidden' as const };
    if (state.terminal) return { kind: 'terminal' as const, status: state.terminal.status };
    this.states.set(input.generationId, { ...state, cancelRequested: true });
    return { kind: 'accepted' as const };
  }
}

const createRequest = (generationRequestId: string, value = 'same') => new Request(
  'https://example.test/api/arena/generate-stream?format=sse',
  {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      Authorization: 'Bearer test-actor',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ generationRequestId, value }),
  },
);

const createService = (
  store: MemoryReplayStore,
  executor: ArenaGenerationExecutor,
  options: {
    deltaFlushIntervalMs?: number;
    deltaFlushBytes?: number;
    heartbeatIntervalMs?: number;
    terminalStore?: ArenaGenerationTerminalStore;
  } = {},
) => createArenaGenerationService({
  store,
  executor,
  resolveActor: async () => ({ actorKey: 'user:42' }),
  createGenerationId: () => 'generation-1',
  now: () => new Date('2026-08-25T04:00:00.000Z'),
  hashPayload: async (payload) => `hash:${JSON.stringify(payload)}`,
  heartbeatIntervalMs: options.heartbeatIntervalMs ?? 60_000,
  leaseDurationMs: 120_000,
  replayPollMs: 1,
  deltaFlushIntervalMs: options.deltaFlushIntervalMs ?? 5,
  deltaFlushBytes: options.deltaFlushBytes ?? 1_024,
  ...(options.terminalStore ? { terminalStore: options.terminalStore } : {}),
});

describe('Arena generation lifecycle service', () => {
  test('same actor/request/payload reuses one generation and starts only one producer', async () => {
    const store = new MemoryReplayStore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const execute = vi.fn(async ({ emit }) => {
      await emit({ type: 'markdown', data: { chunk: 'A' } });
      await gate;
      return { status: 'completed' as const };
    });
    const service = createService(store, { execute });

    const first = await service.create(createRequest('request-1'));
    const second = await service.create(createRequest('request-1'));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers.get('x-mahoshojo-generation-id')).toBe('generation-1');
    expect(second.headers.get('x-mahoshojo-generation-id')).toBe('generation-1');
    expect(execute).toHaveBeenCalledTimes(1);
    release();
    await readResponseText(first);
    await readResponseText(second);
  });

  test('same request id with conflicting semantic payload fails closed', async () => {
    const store = new MemoryReplayStore();
    const execute = vi.fn(async () => ({ status: 'completed' as const }));
    const service = createService(store, { execute });

    const first = await service.create(createRequest('request-1', 'first'));
    const conflict = await service.create(createRequest('request-1', 'second'));

    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: 'GENERATION_REQUEST_CONFLICT' });
    expect(execute).toHaveBeenCalledTimes(1);
    await readResponseText(first);
  });

  test('reservation unavailable fails before provider starts', async () => {
    const store = new MemoryReplayStore();
    store.reserveUnavailable = true;
    const execute = vi.fn(async () => ({ status: 'completed' as const }));
    const service = createService(store, { execute });

    const response = await service.create(createRequest('request-1'));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'GENERATION_RESERVATION_UNAVAILABLE' });
    expect(execute).not.toHaveBeenCalled();
  });

  test('producer ownership transition failure returns degraded and never calls provider', async () => {
    const store = new MemoryReplayStore();
    store.markRunningUnavailable = true;
    const execute = vi.fn(async () => ({ status: 'completed' as const }));
    const service = createService(store, { execute });

    const response = await service.create(createRequest('request-1'));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'GENERATION_OWNERSHIP_UNAVAILABLE' });
    expect(execute).not.toHaveBeenCalled();
    expect(store.states.get('generation-1')?.terminal?.status).toBe('producer_lost');
  });

  test('subscriber cancellation does not abort producer or mark it terminal', async () => {
    const store = new MemoryReplayStore();
    const producerSignals: AbortSignal[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const service = createService(store, {
      execute: vi.fn(async ({ signal }) => {
        producerSignals.push(signal);
        await gate;
        return { status: 'completed' as const };
      }),
    });

    const response = await service.create(createRequest('request-1'));
    await response.body?.cancel('reader closed');

    expect(producerSignals[0]?.aborted).toBe(false);
    expect(store.states.get('generation-1')?.terminal).toBeNull();
    release();
  });

  test('explicit cancel is authorized, idempotent, and aborts only the matching producer', async () => {
    const store = new MemoryReplayStore();
    let resolveAbort!: () => void;
    const aborted = new Promise<void>((resolve) => { resolveAbort = resolve; });
    const service = createService(store, {
      execute: vi.fn(async ({ signal }) => {
        signal.addEventListener('abort', resolveAbort, { once: true });
        await aborted;
        return { status: 'cancelled' as const, code: 'USER_CANCELLED' };
      }),
    });
    const response = await service.create(createRequest('request-1'));

    const firstCancel = await service.cancel(new Request(
      'https://example.test/api/arena/generations/generation-1/cancel',
      { method: 'POST' },
    ), { generationId: 'generation-1' });
    const secondCancel = await service.cancel(new Request(
      'https://example.test/api/arena/generations/generation-1/cancel',
      { method: 'POST' },
    ), { generationId: 'generation-1' });

    expect(firstCancel.status).toBe(202);
    expect([200, 202]).toContain(secondCancel.status);
    await aborted;
    await readResponseText(response);
    expect(store.states.get('generation-1')?.terminal?.status).toBe('cancelled');
  });

  test('cancel routed to another server instance reaches the producer through heartbeat state', async () => {
    vi.useFakeTimers();
    try {
      const store = new MemoryReplayStore();
      let resolveAbort!: () => void;
      const aborted = new Promise<void>((resolve) => { resolveAbort = resolve; });
      const producer = createService(store, {
        execute: vi.fn(async ({ signal }) => {
          signal.addEventListener('abort', resolveAbort, { once: true });
          await aborted;
          return { status: 'cancelled' as const, code: 'USER_CANCELLED' };
        }),
      }, { heartbeatIntervalMs: 10 });
      const remoteInstance = createService(store, {
        execute: vi.fn(async () => ({ status: 'completed' as const })),
      }, { heartbeatIntervalMs: 10 });
      const response = await producer.create(createRequest('request-1'));

      const cancel = await remoteInstance.cancel(new Request(
        'https://example.test/api/arena/generations/generation-1/cancel',
        { method: 'POST' },
      ), { generationId: 'generation-1' });
      expect(cancel.status).toBe(202);
      await vi.advanceTimersByTimeAsync(10);
      await aborted;
      await readResponseText(response);

      expect(store.states.get('generation-1')?.terminal?.status).toBe('cancelled');
    } finally {
      vi.useRealTimers();
    }
  });

  test('batches consecutive deltas and writes a complete snapshot before terminal close', async () => {
    const store = new MemoryReplayStore();
    const service = createService(store, {
      execute: vi.fn(async ({ emit }) => {
        await emit({ type: 'markdown', data: { chunk: 'A' } });
        await emit({ type: 'markdown', data: { chunk: 'B' } });
        await emit({ type: 'reasoning', data: { chunk: 'R' } });
        await emit({ type: 'reasoning_done', data: {} });
        return { status: 'completed' as const, resultRef: 'r2://report/1' };
      }),
    });

    const response = await service.create(createRequest('request-1'));
    await readResponseText(response);

    expect(store.appendBatches.map((batch) => batch.map((event) => event.type))).toEqual([
      ['markdown'],
      ['reasoning'],
      ['reasoning_done'],
      ['done'],
    ]);
    expect(store.events.get('generation-1')?.[0]).toMatchObject({
      type: 'markdown',
      data: { chunk: 'AB' },
    });
    expect(store.states.get('generation-1')?.snapshot).toMatchObject({
      status: 'completed',
      markdown: 'AB',
      reasoning: 'R',
      terminalResultRef: 'r2://report/1',
    });
    expect(store.states.get('generation-1')?.snapshot?.lastEventId).toBe('4-0');
  });

  test('flushes a delta batch early when its byte budget is reached', async () => {
    const store = new MemoryReplayStore();
    let observedAppendCount = 0;
    const service = createService(store, {
      execute: vi.fn(async ({ emit }) => {
        await emit({ type: 'markdown', data: { chunk: 'AB' } });
        await emit({ type: 'markdown', data: { chunk: 'CD' } });
        observedAppendCount = store.appendBatches.length;
        return { status: 'completed' as const };
      }),
    }, { deltaFlushBytes: 4, deltaFlushIntervalMs: 60_000 });

    const response = await service.create(createRequest('request-1'));
    await readResponseText(response);

    expect(observedAppendCount).toBe(1);
    expect(store.events.get('generation-1')?.[0]).toMatchObject({
      type: 'markdown',
      data: { chunk: 'ABCD' },
    });
  });

  test('expired producer lease reconciles to producer_lost and never starts another provider', async () => {
    const store = new MemoryReplayStore();
    await store.reserve({
      actorKey: 'user:42',
      generationRequestId: 'request-1',
      generationId: 'generation-1',
      payloadHash: 'payload-hash',
      now: '2026-08-25T03:00:00.000Z',
      leaseExpiresAt: '2026-08-25T03:01:00.000Z',
    });
    await store.markRunning({
      generationId: 'generation-1',
      now: '2026-08-25T03:00:00.000Z',
      leaseExpiresAt: '2026-08-25T03:01:00.000Z',
    });
    const execute = vi.fn(async () => ({ status: 'completed' as const }));
    const service = createService(store, { execute });

    const response = await service.status(new Request(
      'https://example.test/api/arena/generations/generation-1',
    ), { generationId: 'generation-1' });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'producer_lost', resumable: false });
    expect(execute).not.toHaveBeenCalled();
  });

  test('uses owned terminal storage when Redis state and replay have expired', async () => {
    const store = new MemoryReplayStore();
    const terminalStore: ArenaGenerationTerminalStore = {
      readOwnedTerminal: vi.fn(async () => ({
        generationId: 'generation-1',
        generationRequestId: 'request-1',
        status: 'completed' as const,
        updatedAt: '2026-08-25T04:00:00.000Z',
        resultRef: 'r2://report/1',
        markdown: '完整终态正文',
        reasoning: '',
      })),
    };
    const execute = vi.fn(async () => ({ status: 'completed' as const }));
    const service = createService(store, { execute }, { terminalStore });

    const status = await service.status(new Request(
      'https://example.test/api/arena/generations/generation-1',
    ), { generationId: 'generation-1' });
    const resume = await service.resume(new Request(
      'https://example.test/api/arena/generations/generation-1/stream',
    ), { generationId: 'generation-1' });

    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      status: 'completed',
      resultRef: 'r2://report/1',
    });
    expect(await resume.text()).toContain('event: snapshot');
    expect(await terminalStore.readOwnedTerminal).toHaveBeenCalledWith({
      actorKey: 'user:42',
      generationId: 'generation-1',
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
