import { describe, expect, test, vi } from 'vitest';

import {
  ArenaGenerationFinalizationPendingError,
  createArenaGenerationService,
  MAX_ARENA_CREATE_BODY_BYTES,
  type ArenaGenerationExecutor,
  type ArenaGenerationTerminalStore,
  type GenerationReplayStore,
  type GenerationReplayStoreState,
  type GenerationStreamEvent,
} from '../src/arena-generation/service';

const readResponseText = async (response: Response): Promise<string> => response.text();

class MemoryReplayStore implements GenerationReplayStore {
  readonly requests = new Map<string, {
    payloadHash: string;
    generationId: string;
    preparationSeed: string | null;
    preparationVersion: string | null;
  }>();
  readonly states = new Map<string, GenerationReplayStoreState>();
  readonly events = new Map<string, GenerationStreamEvent[]>();
  reserveUnavailable = false;
  markRunningUnavailable = false;
  appendUnavailable = false;
  cancelUnavailable = false;
  cancelBeforeMarkRunning = false;
  markTerminalCalls = 0;
  readonly appendBatches: Array<GenerationStreamEvent[]> = [];

  async reserve(input: Parameters<GenerationReplayStore['reserve']>[0]) {
    if (this.reserveUnavailable) throw new Error('redis unavailable');
    const key = `${input.actorKey}:${input.generationRequestId}`;
    const previous = this.requests.get(key);
    if (previous) {
      return previous.payloadHash === input.payloadHash
        ? {
          kind: 'reused' as const,
          generationId: previous.generationId,
          preparationSeed: previous.preparationSeed,
          preparationVersion: previous.preparationVersion,
        }
        : { kind: 'conflict' as const };
    }
    this.requests.set(key, {
      payloadHash: input.payloadHash,
      generationId: input.generationId,
      preparationSeed: input.preparationSeed ?? null,
      preparationVersion: input.preparationVersion ?? null,
    });
    this.states.set(input.generationId, {
      actorKey: input.actorKey,
      generationId: input.generationId,
      generationRequestId: input.generationRequestId,
      payloadHash: input.payloadHash,
      producerToken: input.producerToken,
      status: 'reserved',
      lastEventId: null,
      updatedAt: input.now,
      leaseExpiresAt: input.leaseExpiresAt,
      snapshot: null,
      terminal: null,
      cancelRequested: false,
      cancelReason: null,
      preparationSeed: input.preparationSeed ?? null,
      preparationVersion: input.preparationVersion ?? null,
    });
    return {
      kind: 'created' as const,
      generationId: input.generationId,
      preparationSeed: input.preparationSeed ?? null,
      preparationVersion: input.preparationVersion ?? null,
    };
  }

  async markRunning(input: Parameters<GenerationReplayStore['markRunning']>[0]) {
    if (this.markRunningUnavailable) throw new Error('redis unavailable');
    const state = this.states.get(input.generationId)!;
    if (state.producerToken !== input.producerToken) {
      return { owned: false, cancelRequested: false };
    }
    if (this.cancelBeforeMarkRunning) {
      this.states.set(input.generationId, {
        ...state,
        status: 'finalizing',
        cancelRequested: true,
        cancelReason: 'user',
        updatedAt: input.now,
        leaseExpiresAt: input.leaseExpiresAt,
      });
      return { owned: true, cancelRequested: true, cancelReason: 'user' as const };
    }
    this.states.set(input.generationId, {
      ...state,
      status: 'running',
      updatedAt: input.now,
      leaseExpiresAt: input.leaseExpiresAt,
    });
    return { owned: true, cancelRequested: false };
  }

  async claimFinalization(input: Parameters<GenerationReplayStore['claimFinalization']>[0]) {
    const state = this.states.get(input.generationId);
    if (!state || state.producerToken !== input.producerToken) return { kind: 'fenced' as const };
    this.states.set(input.generationId, {
      ...state,
      status: 'finalizing',
      updatedAt: input.now,
      leaseExpiresAt: input.leaseExpiresAt,
    });
    return state.cancelRequested
      ? { kind: 'cancelled' as const, cancelReason: state.cancelReason ?? 'user' as const }
      : { kind: 'claimed' as const };
  }

  async claimLeaseExpiry(input: Parameters<GenerationReplayStore['claimLeaseExpiry']>[0]) {
    const state = this.states.get(input.generationId);
    if (!state) return { kind: 'not-found' as const };
    if (state.actorKey !== input.actorKey) return { kind: 'forbidden' as const };
    if (state.terminal) return { kind: 'terminal' as const, status: state.terminal.status };
    if (!state.leaseExpiresAt || Date.parse(state.leaseExpiresAt) > Date.parse(input.now)) {
      return { kind: 'not-expired' as const };
    }
    this.states.set(input.generationId, {
      ...state,
      producerToken: input.reaperToken,
      status: 'finalizing',
      updatedAt: input.now,
      leaseExpiresAt: input.leaseExpiresAt,
    });
    return {
      kind: 'claimed' as const,
      generationRequestId: state.generationRequestId,
      payloadHash: state.payloadHash,
      mode: state.mode ?? null,
    };
  }

  async releaseReservation(input: Parameters<GenerationReplayStore['releaseReservation']>[0]) {
    const state = this.states.get(input.generationId);
    if (!state || state.producerToken !== input.producerToken || state.status !== 'reserved') {
      return { released: false };
    }
    this.states.delete(input.generationId);
    for (const [key, request] of this.requests) {
      if (request.generationId === input.generationId) this.requests.delete(key);
    }
    return { released: true };
  }

  async heartbeat(input: Parameters<GenerationReplayStore['heartbeat']>[0]) {
    const state = this.states.get(input.generationId)!;
    if (state.producerToken !== input.producerToken) {
      return { owned: false, cancelRequested: false };
    }
    this.states.set(input.generationId, {
      ...state,
      updatedAt: input.now,
      leaseExpiresAt: input.leaseExpiresAt,
    });
    return state.cancelRequested
      ? {
        owned: true,
        cancelRequested: true,
        cancelReason: state.cancelReason ?? 'user' as const,
      }
      : { owned: true, cancelRequested: false };
  }

  async appendEvents(input: Parameters<GenerationReplayStore['appendEvents']>[0]) {
    if (this.appendUnavailable) throw new Error('redis append unavailable');
    const state = this.states.get(input.generationId)!;
    if (state.producerToken !== input.producerToken) return { owned: false, events: [] };
    const current = this.events.get(input.generationId) ?? [];
    const appended = input.events.map((event, index) => ({
      ...event,
      id: `${current.length + index + 1}-0`,
    }));
    this.events.set(input.generationId, [...current, ...appended]);
    this.appendBatches.push(appended);
    this.states.set(input.generationId, {
      ...state,
      lastEventId: appended.at(-1)?.id ?? state.lastEventId,
      updatedAt: input.now,
    });
    return { owned: true, events: appended };
  }

  async writeSnapshot(input: Parameters<GenerationReplayStore['writeSnapshot']>[0]) {
    const state = this.states.get(input.generationId)!;
    if (state.producerToken !== input.producerToken) return { owned: false };
    this.states.set(input.generationId, {
      ...state,
      snapshot: input.snapshot,
      updatedAt: input.now,
    });
    return { owned: true };
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
    this.markTerminalCalls += 1;
    const state = this.states.get(input.generationId)!;
    if (state.producerToken !== input.producerToken) return { owned: false, applied: false };
    if (state.terminal) return { owned: true, applied: false };
    this.states.set(input.generationId, {
      ...state,
      status: input.terminal.status,
      terminal: input.terminal,
      updatedAt: input.now,
      leaseExpiresAt: null,
    });
    return { owned: true, applied: true };
  }

  async readState(input: Parameters<GenerationReplayStore['readState']>[0]) {
    const state = this.states.get(input.generationId) ?? null;
    return !state || (input.actorKey && state.actorKey !== input.actorKey) ? null : state;
  }

  async requestCancel(input: Parameters<GenerationReplayStore['requestCancel']>[0]) {
    if (this.cancelUnavailable) throw new Error('redis unavailable');
    const state = this.states.get(input.generationId);
    if (!state) return { kind: 'not-found' as const };
    if (state.actorKey !== input.actorKey) return { kind: 'forbidden' as const };
    if (state.terminal) return { kind: 'terminal' as const, status: state.terminal.status };
    if (state.status === 'finalizing') return { kind: 'finalizing' as const };
    const cancelReason = state.cancelRequested
      ? state.cancelReason ?? 'user'
      : input.reason;
    this.states.set(input.generationId, {
      ...state,
      cancelRequested: true,
      cancelReason,
    });
    return { kind: 'accepted' as const, cancelReason };
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
    snapshotMaxBytes?: number;
    heartbeatIntervalMs?: number;
    leaseDurationMs?: number;
    now?: () => Date;
    terminalStore?: ArenaGenerationTerminalStore;
    authenticated?: boolean;
    actorKey?: string;
    actorResponseHeaders?: Record<string, string>;
    observer?: { observeArenaGeneration(_observation: unknown): void };
  } = {},
) => createArenaGenerationService({
  store,
  executor,
  resolveActor: async () => options.authenticated === false ? null : ({
    actorKey: options.actorKey ?? 'user:42',
    responseHeaders: options.actorResponseHeaders,
  }),
  deriveGenerationId: async () => 'generation-1',
  now: options.now ?? (() => new Date('2026-08-25T04:00:00.000Z')),
  hashPayload: async (payload) => `hash:${JSON.stringify(payload)}`,
  heartbeatIntervalMs: options.heartbeatIntervalMs ?? 60_000,
  leaseDurationMs: options.leaseDurationMs ?? 120_000,
  replayPollMs: 1,
  deltaFlushIntervalMs: options.deltaFlushIntervalMs ?? 5,
  deltaFlushBytes: options.deltaFlushBytes ?? 1_024,
  ...(options.snapshotMaxBytes !== undefined
    ? { snapshotMaxBytes: options.snapshotMaxBytes }
    : {}),
  ...(options.terminalStore ? { terminalStore: options.terminalStore } : {}),
  ...(options.observer ? { observer: options.observer } : {}),
});

describe('Arena generation lifecycle service', () => {
  test('returns newly issued actor credential without treating generation id as credential', async () => {
    const store = new MemoryReplayStore();
    const service = createService(
      store,
      { execute: async () => ({ status: 'completed' }) },
      { actorResponseHeaders: { 'X-Mahoshojo-Generation-Actor-Token': 'signed-token' } },
    );

    const response = await service.create(createRequest('request-1'));
    expect(response.headers.get('x-mahoshojo-generation-actor-token')).toBe('signed-token');
    await response.text();
  });

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

  test('exposes the replay lifecycle as typed subscriptions without starting a second producer', async () => {
    const store = new MemoryReplayStore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const execute = vi.fn(async ({ emit }) => {
      await emit({ type: 'markdown', data: { chunk: 'typed' } });
      await gate;
      return { status: 'completed' as const, resultRef: 'arena/generation-1.md' };
    });
    const service = createService(store, { execute }, {
      actorResponseHeaders: { 'X-Mahoshojo-Generation-Actor-Token': 'signed-token' },
    });

    const first = await (service as any).createSubscription(createRequest('request-typed'));
    const second = await (service as any).createSubscription(createRequest('request-typed'));

    expect(first).not.toBeInstanceOf(Response);
    expect(second).not.toBeInstanceOf(Response);
    expect(first).toMatchObject({
      generationId: 'generation-1',
      generationRequestId: 'request-typed',
      headers: {
        'X-Mahoshojo-Generation-Actor-Token': 'signed-token',
      },
    });
    expect(execute).toHaveBeenCalledTimes(1);

    release();
    const readEvents = async (stream: ReadableStream<GenerationStreamEvent>) => {
      const reader = stream.getReader();
      const events: GenerationStreamEvent[] = [];
      while (true) {
        const next = await reader.read();
        if (next.done) return events;
        events.push(next.value);
      }
    };
    const [firstEvents, secondEvents] = await Promise.all([
      readEvents(first.events),
      readEvents(second.events),
    ]);

    for (const events of [firstEvents, secondEvents]) {
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: '1-0', type: 'markdown', data: { chunk: 'typed' } }),
        expect.objectContaining({ type: 'done', data: expect.objectContaining({
          ok: true,
          status: 'completed',
        }) }),
      ]));
    }
  });

  test('looks up an actor-owned generation by stable request id', async () => {
    const store = new MemoryReplayStore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const service = createService(store, {
      execute: vi.fn(async () => {
        await gate;
        return { status: 'completed' as const };
      }),
    }, {
      actorResponseHeaders: { 'X-Mahoshojo-Generation-Actor-Token': 'signed-token' },
    });
    const created = await service.create(createRequest('request-lookup'));

    const lookedUp = await service.lookup(new Request(
      'https://example.test/api/arena/generation-requests/request-lookup',
    ), { generationRequestId: 'request-lookup' });

    expect(lookedUp.status).toBe(200);
    expect(lookedUp.headers.get('x-mahoshojo-generation-actor-token')).toBe('signed-token');
    expect(await lookedUp.json()).toMatchObject({
      generationId: 'generation-1',
      generationRequestId: 'request-lookup',
      status: expect.stringMatching(/^(reserved|running)$/u),
      resumable: true,
    });
    release();
    await created.text();
  });

  test('validates and actor-scopes request-id lookup', async () => {
    const store = new MemoryReplayStore();
    const ownerService = createService(store, {
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    });
    const created = await ownerService.create(createRequest('request-lookup'));
    await created.text();

    const invalid = await ownerService.lookup(new Request(
      'https://example.test/api/arena/generation-requests/short',
    ), { generationRequestId: 'short' });
    const otherActorService = createService(store, {
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    }, { actorKey: 'user:other' });
    const hidden = await otherActorService.lookup(new Request(
      'https://example.test/api/arena/generation-requests/request-lookup',
    ), { generationRequestId: 'request-lookup' });

    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: 'GENERATION_REQUEST_ID_INVALID' });
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toMatchObject({ code: 'GENERATION_REQUEST_NOT_FOUND' });
  });

  test('reports bounded resume lifecycle telemetry without actor or payload data', async () => {
    const store = new MemoryReplayStore();
    const observeArenaGeneration = vi.fn();
    const service = createService(store, {
      execute: vi.fn(async ({ emit }) => {
        await emit({ type: 'markdown', data: { chunk: '正文' } });
        return { status: 'completed' as const };
      }),
    }, { observer: { observeArenaGeneration } });

    const initial = await service.create(createRequest('request-1'));
    await initial.text();
    const reused = await service.create(createRequest('request-1'));
    await reused.body?.cancel('subscriber closed');
    const resumed = await service.resume(new Request(
      'https://example.test/api/arena/generations/generation-1/stream?after=999-0',
    ), { generationId: 'generation-1' });
    await resumed.text();

    expect(observeArenaGeneration).toHaveBeenCalledWith(expect.objectContaining({
      event: 'request',
      outcome: 'created',
      generationId: 'generation-1',
      inputBytes: expect.any(Number),
    }));
    expect(observeArenaGeneration).toHaveBeenCalledWith(expect.objectContaining({
      event: 'request',
      outcome: 'reused',
    }));
    expect(observeArenaGeneration).toHaveBeenCalledWith(expect.objectContaining({
      event: 'client_disconnect',
    }));
    expect(observeArenaGeneration).toHaveBeenCalledWith(expect.objectContaining({
      event: 'resume',
      outcome: 'success',
      latencyMs: expect.any(Number),
    }));
    expect(observeArenaGeneration).toHaveBeenCalledWith(expect.objectContaining({
      event: 'replay',
      snapshotBootstrap: true,
    }));
    expect(JSON.stringify(observeArenaGeneration.mock.calls)).not.toMatch(/user:42|正文/u);
  });

  test('prepares validation and semantic hash before reservation without dropping execution secrets', async () => {
    const store = new MemoryReplayStore();
    const prepare = vi.fn(async ({ payload }) => ({
      executionPayload: payload,
      semanticPayload: { value: payload.value },
    }));
    const execute = vi.fn(async ({ payload }) => {
      expect(payload.providerSecret).toBe('server-use-only');
      return { status: 'completed' as const };
    });
    const service = createService(store, { prepare, execute });
    const request = new Request('https://example.test/api/arena/generate-stream?format=sse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        generationRequestId: 'request-1',
        value: 'same',
        providerSecret: 'server-use-only',
      }),
    });

    const response = await service.create(request);
    await readResponseText(response);

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(store.states.get('generation-1')?.payloadHash).toBe(
      'hash:{"value":"same"}',
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test('freezes one reservation seed for reused materialization and Provider execution', async () => {
    const store = new MemoryReplayStore();
    const materializedSeeds: string[] = [];
    const materializedRolls: number[] = [];
    let releaseMaterialization!: () => void;
    const materializationGate = new Promise<void>((resolve) => {
      releaseMaterialization = resolve;
    });
    const execute = vi.fn(async ({ payload: input }) => {
      expect(input.adjudicationRoll).toBe(materializedRolls[0]);
      return { status: 'completed' as const };
    });
    const executor = {
      materializationVersion: 'test-materialization-v1',
      preflight: vi.fn(async ({ payload: input }) => ({
        materializationPayload: { ...input, apiKey: 'provider-secret' },
        semanticPayload: { value: input.value },
      })),
      materialize: vi.fn(async ({ payload: input, preparationSeed }) => {
        const adjudicationRoll = Number.parseInt(preparationSeed.slice(0, 2), 16) % 100;
        materializedSeeds.push(preparationSeed);
        materializedRolls.push(adjudicationRoll);
        if (materializedSeeds.length === 2) releaseMaterialization();
        await materializationGate;
        return {
          executionPayload: { ...input, adjudicationRoll },
          responseHeaders: { 'X-Test-Meta': String(adjudicationRoll) },
        };
      }),
      execute,
    } as unknown as ArenaGenerationExecutor;
    const service = createService(store, executor);

    const [first, second] = await Promise.all([
      service.create(createRequest('request-seeded')),
      service.create(createRequest('request-seeded')),
    ]);

    expect(materializedSeeds).toHaveLength(2);
    expect(new Set(materializedSeeds).size).toBe(1);
    expect(first.headers.get('x-test-meta')).toBe(String(materializedRolls[0]));
    expect(second.headers.get('x-test-meta')).toBe(String(materializedRolls[0]));
    expect(execute).toHaveBeenCalledOnce();
    expect(JSON.stringify(store.states.get('generation-1'))).not.toContain('provider-secret');
    expect(JSON.stringify(store.requests)).not.toContain('provider-secret');
    await first.text();
    await second.text();
  });

  test('replays a legacy seedless reservation without rerolling metadata or restarting Provider', async () => {
    const store = new MemoryReplayStore();
    await store.reserve({
      actorKey: 'user:42',
      generationRequestId: 'request-legacy',
      generationId: 'generation-1',
      payloadHash: 'hash:{"value":"same"}',
      producerToken: 'legacy-producer',
      now: '2026-08-25T04:00:00.000Z',
      leaseExpiresAt: '2026-08-25T04:02:00.000Z',
    });
    const materialize = vi.fn(async () => ({
      executionPayload: { shouldNotRun: true },
      responseHeaders: { 'X-Test-Seed': 'rerolled' },
    }));
    const execute = vi.fn(async () => ({ status: 'completed' as const }));
    const service = createService(store, {
      materializationVersion: 'test-materialization-v1',
      preflight: async ({ payload: input }) => ({
        materializationPayload: input,
        semanticPayload: { value: input.value },
      }),
      materialize,
      execute,
    });

    const response = await service.create(createRequest('request-legacy'));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-test-seed')).toBeNull();
    expect(materialize).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    await response.body?.cancel();
  });

  test('fails an old materialization path closed against a new seeded reservation', async () => {
    const store = new MemoryReplayStore();
    const seededExecute = vi.fn(async () => ({ status: 'completed' as const }));
    const seededService = createService(store, {
      materializationVersion: 'test-materialization-v1',
      preflight: async ({ payload: input }) => ({
        materializationPayload: input,
        semanticPayload: { value: input.value },
      }),
      materialize: async ({ payload: input }) => ({
        executionPayload: input,
        responseHeaders: { 'X-Test-Meta': 'frozen' },
      }),
      execute: seededExecute,
    });
    const legacyExecute = vi.fn(async () => ({ status: 'completed' as const }));
    const legacyService = createService(store, {
      prepare: async ({ payload: input }) => ({
        executionPayload: input,
        semanticPayload: { value: input.value },
        responseHeaders: { 'X-Test-Meta': 'rerolled-by-old-instance' },
      }),
      execute: legacyExecute,
    });

    const seeded = await seededService.create(createRequest('request-version-skew'));
    const legacyRetry = await legacyService.create(createRequest('request-version-skew'));

    expect(legacyRetry.status).toBe(409);
    expect(legacyRetry.headers.get('x-test-meta')).toBeNull();
    expect(legacyExecute).not.toHaveBeenCalled();
    expect(seededExecute).toHaveBeenCalledOnce();
    await seeded.text();
  });

  test.each([
    ['response', async () => new Response('invalid materialization', { status: 422 }), 422],
    ['exception', async () => { throw new Error('materialization failed'); }, 500],
  ] as const)(
    'releases a new reservation when materialization returns a %s failure',
    async (_kind, materialize, expectedStatus) => {
      const store = new MemoryReplayStore();
      const execute = vi.fn(async () => ({ status: 'completed' as const }));
      const service = createService(store, {
        materializationVersion: 'test-materialization-v1',
        preflight: async ({ payload: input }) => ({
          materializationPayload: input,
          semanticPayload: { value: input.value },
        }),
        materialize,
        execute,
      });

      const response = await service.create(createRequest('request-materialization-failure'));

      expect(response.status).toBe(expectedStatus);
      expect(store.requests.size).toBe(0);
      expect(store.states.size).toBe(0);
      expect(execute).not.toHaveBeenCalled();
    },
  );

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

  test.each([
    { name: 'missing Content-Length', contentLength: undefined },
    { name: 'forged small Content-Length', contentLength: '16' },
  ])('incrementally rejects an oversized create body with $name before preparation, reservation, or Provider', async ({ contentLength }) => {
    const store = new MemoryReplayStore();
    const prepare = vi.fn(async ({ payload }) => ({
      executionPayload: payload,
      semanticPayload: payload,
    }));
    const execute = vi.fn(async () => ({ status: 'completed' as const }));
    const service = createService(store, { prepare, execute });
    const oversizedChunk = new Uint8Array(MAX_ARENA_CREATE_BODY_BYTES + 1);
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(oversizedChunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (contentLength) headers.set('Content-Length', contentLength);
    const response = await service.create(new Request(
      'https://example.test/api/arena/generate-stream',
      {
        method: 'POST',
        headers,
        body,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' },
    ));

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: 'ARENA_REQUEST_TOO_LARGE' });
    expect(cancelled).toBe(true);
    expect(prepare).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(store.states).toHaveLength(0);
  });

  test('rejects a declared oversized body without reading it', async () => {
    const store = new MemoryReplayStore();
    const execute = vi.fn(async () => ({ status: 'completed' as const }));
    const service = createService(store, { execute });
    const pull = vi.fn();
    const response = await service.create(new Request(
      'https://example.test/api/arena/generate-stream',
      {
        method: 'POST',
        headers: {
          'Content-Length': String(MAX_ARENA_CREATE_BODY_BYTES + 1),
          'Content-Type': 'application/json',
        },
        body: new ReadableStream<Uint8Array>({ pull }, { highWaterMark: 0 }),
        duplex: 'half',
      } as RequestInit & { duplex: 'half' },
    ));

    expect(response.status).toBe(413);
    expect(pull).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  test('accepts a valid create body exactly at the byte boundary', async () => {
    const store = new MemoryReplayStore();
    const execute = vi.fn(async () => ({ status: 'completed' as const }));
    const service = createService(store, { execute });
    const prefix = '{"generationRequestId":"request-boundary","value":"';
    const suffix = '"}';
    const exactBody = `${prefix}${'x'.repeat(MAX_ARENA_CREATE_BODY_BYTES - prefix.length - suffix.length)}${suffix}`;

    const response = await service.create(new Request(
      'https://example.test/api/arena/generate-stream',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: exactBody,
      },
    ));

    expect(response.status).toBe(200);
    await response.text();
    expect(execute).toHaveBeenCalledOnce();
  });

  test('does not read an unauthenticated create body', async () => {
    const store = new MemoryReplayStore();
    const execute = vi.fn(async () => ({ status: 'completed' as const }));
    const service = createService(store, { execute }, { authenticated: false });
    const pull = vi.fn();
    const response = await service.create(new Request(
      'https://example.test/api/arena/generate-stream',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: new ReadableStream<Uint8Array>({ pull }, { highWaterMark: 0 }),
        duplex: 'half',
      } as RequestInit & { duplex: 'half' },
    ));

    expect(response.status).toBe(401);
    expect(pull).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  test('reservation unavailable reuses an actor-owned durable terminal without starting provider', async () => {
    const store = new MemoryReplayStore();
    store.reserveUnavailable = true;
    const execute = vi.fn(async () => ({ status: 'completed' as const }));
    const service = createService(store, { execute }, {
      terminalStore: {
        readOwnedTerminal: vi.fn(async () => ({
          generationId: 'generation-1',
          generationRequestId: 'request-1',
          status: 'completed' as const,
          updatedAt: '2026-08-25T03:59:00.000Z',
          resultRef: 'arena-reports/generation-1.json',
          markdown: 'durable terminal',
          reasoning: '',
          payloadHash: 'hash:{"value":"same"}',
          contentAvailable: true,
        })),
      },
    });

    const response = await service.create(createRequest('request-1'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(await response.text()).toContain('durable terminal');
    expect(execute).not.toHaveBeenCalled();
  });

  test('seeded runtime accepts a matching legacy durable hash without rematerializing metadata', async () => {
    const store = new MemoryReplayStore();
    store.reserveUnavailable = true;
    const materialize = vi.fn(async () => ({ executionPayload: {} }));
    const execute = vi.fn(async () => ({ status: 'completed' as const }));
    const service = createService(store, {
      materializationVersion: 'test-materialization-v1',
      preflight: async ({ payload: input }) => ({
        materializationPayload: input,
        semanticPayload: { value: input.value },
      }),
      materialize,
      execute,
    }, {
      terminalStore: {
        readOwnedTerminal: vi.fn(async () => ({
          generationId: 'generation-1',
          generationRequestId: 'request-legacy-durable',
          status: 'completed' as const,
          updatedAt: '2026-08-25T03:59:00.000Z',
          resultRef: 'arena-reports/generation-1.json',
          markdown: 'legacy durable terminal',
          reasoning: '',
          payloadHash: 'hash:{"value":"same"}',
          contentAvailable: true,
        })),
      },
    });

    const response = await service.create(createRequest('request-legacy-durable'));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('legacy durable terminal');
    expect(materialize).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  test('an incomplete durable finalization blocks provider restart after Redis state loss', async () => {
    const store = new MemoryReplayStore();
    const execute = vi.fn(async () => ({ status: 'completed' as const }));
    const service = createService(store, { execute }, {
      terminalStore: {
        readOwnedTerminal: vi.fn(async () => null),
        inspectOwnedFinalization: vi.fn(async () => ({
          kind: 'pending' as const,
          payloadHash: 'hash:{"value":"same"}',
        })),
      },
    });

    const response = await service.create(createRequest('request-1'));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'GENERATION_FINALIZATION_PENDING' });
    expect(execute).not.toHaveBeenCalled();
    expect(store.states.has('generation-1')).toBe(false);
  });

  test('owned pending durable finalization is 503 rather than 404 after Redis expiry', async () => {
    const store = new MemoryReplayStore();
    const service = createService(store, {
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    }, {
      terminalStore: {
        readOwnedTerminal: vi.fn(async () => null),
        inspectOwnedFinalization: vi.fn(async () => ({
          kind: 'pending' as const,
          payloadHash: 'payload-hash',
        })),
      },
    });

    const response = await service.status(new Request(
      'https://example.test/api/arena/generations/generation-1',
    ), { generationId: 'generation-1' });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'GENERATION_FINALIZATION_PENDING' });
  });

  test('keeps Redis finalizing for lease reaping when durable finalization fails', async () => {
    const store = new MemoryReplayStore();
    const execute = vi.fn(async (input: Parameters<ArenaGenerationExecutor['execute']>[0]) => {
      await input.claimFinalization({ status: 'completed' });
      throw new ArenaGenerationFinalizationPendingError();
    });
    const service = createService(store, { execute });

    const response = await service.create(createRequest('request-1'));
    await vi.waitFor(() => {
      expect(store.states.get('generation-1')).toMatchObject({
        status: 'finalizing',
        terminal: null,
      });
    });
    await response.body?.cancel();

    expect(execute).toHaveBeenCalledOnce();
  });

  test('an indeterminate finalization claim cannot be converted into a Redis-only terminal', async () => {
    const store = new MemoryReplayStore();
    const execute = vi.fn(async (input: Parameters<ArenaGenerationExecutor['execute']>[0]) => {
      try {
        await input.claimFinalization({ status: 'completed' });
      } catch (error) {
        throw new ArenaGenerationFinalizationPendingError(error);
      }
      throw new Error('unexpected claim success');
    });
    store.claimFinalization = vi.fn(async () => { throw new Error('Redis timeout'); });
    const service = createService(store, { execute });

    const response = await service.create(createRequest('request-1'));
    await vi.waitFor(() => {
      expect(store.states.get('generation-1')).toMatchObject({
        status: 'running',
        terminal: null,
      });
    });
    await response.body?.cancel();

    expect(store.markTerminalCalls).toBe(0);
    expect(execute).toHaveBeenCalledOnce();
  });

  test('an already-open replay stream reaps an expired pending finalization without Provider replay', async () => {
    const store = new MemoryReplayStore();
    let currentTime = new Date('2026-08-25T04:00:00.000Z');
    const execute = vi.fn(async (input: Parameters<ArenaGenerationExecutor['execute']>[0]) => {
      await input.claimFinalization({ status: 'completed' });
      throw new ArenaGenerationFinalizationPendingError(new Error('D1 unavailable'));
    });
    const terminalStore: ArenaGenerationTerminalStore = {
      readOwnedTerminal: vi.fn(async () => null),
      reconcileExpiredLease: vi.fn(async (input) => ({
        generationId: input.generationId,
        generationRequestId: input.generationRequestId,
        status: 'producer_lost' as const,
        updatedAt: input.updatedAt,
        resultRef: null,
        markdown: '',
        reasoning: '',
        payloadHash: input.payloadHash,
      })),
    };
    const service = createService(store, { execute }, {
      terminalStore,
      leaseDurationMs: 10,
      now: () => currentTime,
    });

    const response = await service.create(createRequest('request-1'));
    currentTime = new Date('2026-08-25T04:01:00.000Z');
    const body = await response.text();

    expect(body).toContain('producer_lost');
    expect(terminalStore.reconcileExpiredLease).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
  });

  test('cancel-by-request fails closed to durable terminal state when Redis is unavailable', async () => {
    const store = new MemoryReplayStore();
    store.cancelUnavailable = true;
    const service = createService(store, {
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    }, {
      terminalStore: {
        readOwnedTerminal: vi.fn(async () => null),
        inspectOwnedFinalization: vi.fn(async () => ({
          kind: 'terminal' as const,
          terminal: {
            generationId: 'generation-1',
            generationRequestId: 'request-1',
            status: 'completed' as const,
            updatedAt: '2026-08-25T04:00:00.000Z',
            resultRef: 'r2:terminal',
            markdown: 'done',
            reasoning: '',
            payloadHash: 'payload-hash',
          },
        })),
      },
    });

    const response = await service.cancelRequest(new Request(
      'https://example.test/api/arena/generate-stream',
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generationRequestId: 'request-1' }),
      },
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'completed', cancelled: false });
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

  test('transient replay writes may degrade but never start a second provider', async () => {
    const store = new MemoryReplayStore();
    store.appendUnavailable = true;
    const observeArenaGeneration = vi.fn();
    const execute = vi.fn(async ({ emit }) => {
      await emit({ type: 'markdown', data: { chunk: '仍完成' } });
      return { status: 'completed' as const, resultRef: 'r2://terminal' };
    });
    const service = createService(store, { execute }, {
      observer: { observeArenaGeneration },
    });

    const response = await service.create(createRequest('request-1'));
    await response.text();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(store.states.get('generation-1')?.terminal).toMatchObject({
      status: 'completed',
      resultRef: 'r2://terminal',
    });
    expect(observeArenaGeneration).toHaveBeenCalledWith(expect.objectContaining({
      event: 'redis_degraded',
      generationId: 'generation-1',
    }));
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

  test('content-policy cancel reaches the matching producer with its fixed reason', async () => {
    const store = new MemoryReplayStore();
    let resolveAbort!: () => void;
    const aborted = new Promise<void>((resolve) => { resolveAbort = resolve; });
    let observedReason: unknown;
    const service = createService(store, {
      execute: vi.fn(async ({ signal }) => {
        signal.addEventListener('abort', () => {
          observedReason = signal.reason;
          resolveAbort();
        }, { once: true });
        await aborted;
        return {
          status: 'cancelled' as const,
          code: signal.reason === 'content_policy'
            ? 'CONTENT_POLICY_CANCELLED'
            : 'USER_CANCELLED',
        };
      }),
    });
    const response = await service.create(createRequest('request-1'));

    const cancelled = await service.cancel(new Request(
      'https://example.test/api/arena/generations/generation-1/cancel',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'content_policy' }),
      },
    ), { generationId: 'generation-1' });

    expect(cancelled.status).toBe(202);
    await aborted;
    await readResponseText(response);
    expect(observedReason).toBe('content_policy');
    expect(store.states.get('generation-1')).toMatchObject({
      cancelRequested: true,
      cancelReason: 'content_policy',
      terminal: { status: 'cancelled', code: 'CONTENT_POLICY_CANCELLED' },
    });
  });

  test('rejects cancel reasons outside the fixed allowlist before mutating producer state', async () => {
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

    const invalid = await service.cancel(new Request(
      'https://example.test/api/arena/generations/generation-1/cancel',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'arbitrary-client-value' }),
      },
    ), { generationId: 'generation-1' });
    const invalidStatus = invalid.status;
    const cancelRequestedAfterInvalid = store.states.get('generation-1')?.cancelRequested;
    const cleanup = await service.cancel(new Request(
      'https://example.test/api/arena/generations/generation-1/cancel',
      { method: 'POST' },
    ), { generationId: 'generation-1' });
    expect([200, 202]).toContain(cleanup.status);
    await aborted;
    await readResponseText(response);

    expect(invalidStatus).toBe(400);
    expect(cancelRequestedAfterInvalid).toBe(false);
    await expect(invalid.json()).resolves.toMatchObject({ code: 'GENERATION_CANCEL_REASON_INVALID' });
  });

  test('rejects an oversized cancel body before mutating producer state', async () => {
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

    const oversized = await service.cancel(new Request(
      'https://example.test/api/arena/generations/generation-1/cancel',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'user', padding: 'x'.repeat(2_048) }),
      },
    ), { generationId: 'generation-1' });
    const oversizedStatus = oversized.status;
    const cancelRequestedAfterOversized = store.states.get('generation-1')?.cancelRequested;
    await service.cancel(new Request(
      'https://example.test/api/arena/generations/generation-1/cancel',
      { method: 'POST' },
    ), { generationId: 'generation-1' });
    await aborted;
    await readResponseText(response);

    expect(oversizedStatus).toBe(413);
    expect(cancelRequestedAfterOversized).toBe(false);
    await expect(oversized.json()).resolves.toMatchObject({
      code: 'GENERATION_CANCEL_REQUEST_TOO_LARGE',
    });
  });

  test('cancels a pending handshake by actor-scoped request id', async () => {
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
    const stream = await service.create(createRequest('request-pending-cancel'));

    const cancelled = await service.cancelRequest(new Request(
      'https://example.test/api/arena/generate-stream',
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generationRequestId: 'request-pending-cancel' }),
      },
    ));

    expect(cancelled.status).toBe(202);
    await aborted;
    await stream.text();
    expect(store.states.get('generation-1')?.cancelRequested).toBe(true);
  });

  test('cancel accepted before markRunning prevents any Provider execution', async () => {
    const store = new MemoryReplayStore();
    store.cancelBeforeMarkRunning = true;
    const execute = vi.fn(async () => ({ status: 'completed' as const }));
    const service = createService(store, { execute });

    const stream = await service.create(createRequest('request-cancel-before-running'));

    expect(await stream.text()).toContain('"status":"cancelled"');
    expect(execute).not.toHaveBeenCalled();
    expect(store.states.get('generation-1')?.terminal?.status).toBe('cancelled');
  });

  test('content-policy cancel routed to another instance preserves its reason through heartbeat', async () => {
    vi.useFakeTimers();
    try {
      const store = new MemoryReplayStore();
      let resolveAbort!: () => void;
      const aborted = new Promise<void>((resolve) => { resolveAbort = resolve; });
      let observedReason: unknown;
      const producer = createService(store, {
        execute: vi.fn(async ({ signal }) => {
          signal.addEventListener('abort', () => {
            observedReason = signal.reason;
            resolveAbort();
          }, { once: true });
          await aborted;
          return { status: 'cancelled' as const, code: 'CONTENT_POLICY_CANCELLED' };
        }),
      }, { heartbeatIntervalMs: 10 });
      const remoteInstance = createService(store, {
        execute: vi.fn(async () => ({ status: 'completed' as const })),
      }, { heartbeatIntervalMs: 10 });
      const response = await producer.create(createRequest('request-1'));

      const cancel = await remoteInstance.cancel(new Request(
        'https://example.test/api/arena/generations/generation-1/cancel',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'content_policy' }),
        },
      ), { generationId: 'generation-1' });
      expect(cancel.status).toBe(202);
      await vi.advanceTimersByTimeAsync(10);
      await aborted;
      await readResponseText(response);

      expect(observedReason).toBe('content_policy');
      expect(store.states.get('generation-1')?.terminal).toMatchObject({
        status: 'cancelled',
        code: 'CONTENT_POLICY_CANCELLED',
      });
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

  test('bounds Redis snapshot bytes while retaining the terminal fallback path', async () => {
    const store = new MemoryReplayStore();
    const observeArenaGeneration = vi.fn();
    const service = createService(store, {
      execute: vi.fn(async ({ emit }) => {
        await emit({ type: 'markdown', data: { chunk: 'X'.repeat(512) } });
        return { status: 'completed' as const, resultRef: 'r2://report/large' };
      }),
    }, {
      snapshotMaxBytes: 128,
      observer: { observeArenaGeneration },
    });

    const response = await service.create(createRequest('request-1'));
    await response.text();

    expect(store.states.get('generation-1')?.snapshot).toBeNull();
    expect(observeArenaGeneration).toHaveBeenCalledWith(expect.objectContaining({
      event: 'redis_degraded',
      operation: 'snapshot_budget',
    }));
  });

  test('expired producer lease reconciles to producer_lost and never starts another provider', async () => {
    const store = new MemoryReplayStore();
    await store.reserve({
      actorKey: 'user:42',
      generationRequestId: 'request-1',
      generationId: 'generation-1',
      payloadHash: 'payload-hash',
      producerToken: 'producer-token-1',
      now: '2026-08-25T03:00:00.000Z',
      leaseExpiresAt: '2026-08-25T03:01:00.000Z',
    });
    await store.markRunning({
      generationId: 'generation-1',
      producerToken: 'producer-token-1',
      now: '2026-08-25T03:00:00.000Z',
      leaseExpiresAt: '2026-08-25T03:01:00.000Z',
    });
    const execute = vi.fn(async () => ({ status: 'completed' as const }));
    const terminalStore: ArenaGenerationTerminalStore = {
      readOwnedTerminal: vi.fn(async () => null),
      reconcileExpiredLease: vi.fn(async (input) => ({
        generationId: input.generationId,
        generationRequestId: input.generationRequestId,
        status: 'producer_lost' as const,
        updatedAt: input.updatedAt,
        resultRef: null,
        markdown: '',
        reasoning: '',
        payloadHash: input.payloadHash,
      })),
    };
    const service = createService(store, { execute }, { terminalStore });

    const response = await service.status(new Request(
      'https://example.test/api/arena/generations/generation-1',
    ), { generationId: 'generation-1' });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'producer_lost', resumable: false });
    expect(terminalStore.reconcileExpiredLease).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
  });

  test('expired Redis lease adopts a durable completed finalization instead of overwriting it', async () => {
    const store = new MemoryReplayStore();
    await store.reserve({
      actorKey: 'user:42',
      generationRequestId: 'request-1',
      generationId: 'generation-1',
      payloadHash: 'payload-hash',
      producerToken: 'producer-token-1',
      now: '2026-08-25T03:00:00.000Z',
      leaseExpiresAt: '2026-08-25T03:01:00.000Z',
    });
    await store.markRunning({
      generationId: 'generation-1',
      producerToken: 'producer-token-1',
      now: '2026-08-25T03:00:00.000Z',
      leaseExpiresAt: '2026-08-25T03:01:00.000Z',
    });
    const terminalStore: ArenaGenerationTerminalStore = {
      readOwnedTerminal: vi.fn(async () => null),
      reconcileExpiredLease: vi.fn(async (input) => ({
        generationId: input.generationId,
        generationRequestId: input.generationRequestId,
        status: 'completed' as const,
        updatedAt: input.updatedAt,
        resultRef: 'r2:terminal',
        markdown: 'durable completed report',
        reasoning: '',
        payloadHash: input.payloadHash,
      })),
    };
    const service = createService(store, {
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    }, { terminalStore });

    const response = await service.status(new Request(
      'https://example.test/api/arena/generations/generation-1',
    ), { generationId: 'generation-1' });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'completed', resumable: false });
    expect(store.states.get('generation-1')?.terminal).toMatchObject({
      status: 'completed',
      resultRef: 'r2:terminal',
    });
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

  test('validates the resume cursor before generation lookup and advances terminal fallback ids', async () => {
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
    const service = createService(store, {
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    }, { terminalStore });

    const malformed = await service.resume(new Request(
      'https://example.test/api/arena/generations/missing/stream?after=bad-cursor',
    ), { generationId: 'missing' });
    const resumed = await service.resume(new Request(
      'https://example.test/api/arena/generations/generation-1/stream?after=9-4',
    ), { generationId: 'generation-1' });
    const replay = await resumed.text();

    expect(malformed.status).toBe(400);
    expect(replay).toContain('id: 9-5\nevent: snapshot');
    expect(replay).toContain('id: 9-6\nevent: done');
  });

  test('emits one monotonic snapshot then an explicit error when the replay stream stays missing', async () => {
    const store = new MemoryReplayStore();
    await store.reserve({
      actorKey: 'user:42',
      generationRequestId: 'request-1',
      generationId: 'generation-1',
      payloadHash: 'payload-hash',
      producerToken: 'producer-token-1',
      now: '2026-08-25T04:00:00.000Z',
      leaseExpiresAt: '2026-08-25T04:10:00.000Z',
    });
    await store.markRunning({
      generationId: 'generation-1',
      producerToken: 'producer-token-1',
      now: '2026-08-25T04:00:00.000Z',
      leaseExpiresAt: '2026-08-25T04:10:00.000Z',
    });
    await store.writeSnapshot({
      generationId: 'generation-1',
      producerToken: 'producer-token-1',
      snapshot: {
        status: 'running',
        markdown: 'snapshot',
        reasoning: '',
        lastEventId: '1-0',
        updatedAt: '2026-08-25T04:00:00.000Z',
      },
      now: '2026-08-25T04:00:00.000Z',
    });
    vi.spyOn(store as GenerationReplayStore, 'readAfter').mockResolvedValue({
      kind: 'stream-missing',
      events: [],
    });
    const service = createService(store, {
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    });

    const resumed = await service.resume(new Request(
      'https://example.test/api/arena/generations/generation-1/stream?after=9-4',
    ), { generationId: 'generation-1' });
    const replay = await resumed.text();

    expect(replay.match(/event: snapshot/gu)).toHaveLength(1);
    expect(replay).toContain('id: 9-5\nevent: snapshot');
    expect(replay).toContain('id: 9-6\nevent: error');
    expect(replay).toContain('REPLAY_STREAM_MISSING');
  });

  test('reuses a deterministic D1 terminal after Redis TTL without starting Provider again', async () => {
    const store = new MemoryReplayStore();
    const terminalStore: ArenaGenerationTerminalStore = {
      readOwnedTerminal: vi.fn(async () => ({
        generationId: 'generation-1',
        generationRequestId: 'request-1',
        status: 'completed' as const,
        updatedAt: '2026-08-25T04:00:00.000Z',
        resultRef: 'r2:terminal',
        markdown: 'durable terminal body',
        reasoning: '',
        payloadHash: 'hash:{"value":"same"}',
      })),
    };
    const execute = vi.fn(async () => ({ status: 'completed' as const }));
    const service = createService(store, { execute }, { terminalStore });

    const response = await service.create(createRequest('request-1'));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-mahoshojo-generation-fallback')).toBe('terminal');
    expect(await response.text()).toContain('durable terminal body');
    expect(execute).not.toHaveBeenCalled();
    expect(store.states.get('generation-1')?.terminal?.status).toBe('completed');
  });

  test('rejects deterministic terminal identity reuse when the semantic payload hash differs', async () => {
    const store = new MemoryReplayStore();
    const terminalStore: ArenaGenerationTerminalStore = {
      readOwnedTerminal: vi.fn(async () => ({
        generationId: 'generation-1',
        generationRequestId: 'request-1',
        status: 'failed' as const,
        updatedAt: '2026-08-25T04:00:00.000Z',
        resultRef: null,
        markdown: '',
        reasoning: '',
        payloadHash: 'different-payload-hash',
      })),
    };
    const execute = vi.fn(async () => ({ status: 'completed' as const }));
    const service = createService(store, { execute }, { terminalStore });

    const response = await service.create(createRequest('request-1'));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'GENERATION_REQUEST_CONFLICT' });
    expect(execute).not.toHaveBeenCalled();
    expect(store.states.has('generation-1')).toBe(false);
  });

  test('fails closed when durable completed output is temporarily unavailable', async () => {
    const store = new MemoryReplayStore();
    const terminalStore: ArenaGenerationTerminalStore = {
      readOwnedTerminal: vi.fn(async () => ({
        generationId: 'generation-1',
        generationRequestId: 'request-1',
        status: 'completed' as const,
        updatedAt: '2026-08-25T04:00:00.000Z',
        resultRef: 'r2://report/1',
        markdown: 'truncated preview',
        reasoning: '',
        contentAvailable: false,
      })),
    };
    const service = createService(store, {
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    }, { terminalStore });

    const resumed = await service.resume(new Request(
      'https://example.test/api/arena/generations/generation-1/stream',
    ), { generationId: 'generation-1' });

    expect(resumed.status).toBe(503);
    await expect(resumed.json()).resolves.toMatchObject({
      code: 'GENERATION_TERMINAL_CONTENT_UNAVAILABLE',
    });
  });

  test('synthesizes a monotonic terminal event when the replay terminal entry was trimmed', async () => {
    const store = new MemoryReplayStore();
    const service = createService(store, {
      execute: vi.fn(async ({ emit }) => {
        await emit({ type: 'markdown', data: { chunk: '完整正文' } });
        return { status: 'completed' as const, resultRef: 'r2://report/1' };
      }),
    });
    const initial = await service.create(createRequest('request-1'));
    await initial.text();
    store.events.set('generation-1', []);

    const resumed = await service.resume(new Request(
      'https://example.test/api/arena/generations/generation-1/stream?after=9-4',
    ), { generationId: 'generation-1' });
    const replay = await resumed.text();

    expect(replay).toContain('id: 9-5\nevent: snapshot');
    expect(replay).toContain('id: 9-6\nevent: done');
    expect(replay).toContain('"status":"completed"');
  });

  test('synthesizes terminal cursors beyond the JavaScript safe integer range', async () => {
    const store = new MemoryReplayStore();
    const service = createService(store, {
      execute: vi.fn(async () => ({
        status: 'completed' as const,
        resultRef: 'r2://report/large-cursor',
      })),
    });
    const initial = await service.create(createRequest('request-large-cursor'));
    await initial.text();
    store.events.set('generation-1', []);

    const resumed = await service.resume(new Request(
      'https://example.test/api/arena/generations/generation-1/stream?after=9-999999999999999999999999999999',
    ), { generationId: 'generation-1' });
    const replay = await resumed.text();

    expect(replay).toContain('id: 9-1000000000000000000000000000000\nevent: snapshot');
    expect(replay).toContain('id: 9-1000000000000000000000000000001\nevent: done');
  });
});
