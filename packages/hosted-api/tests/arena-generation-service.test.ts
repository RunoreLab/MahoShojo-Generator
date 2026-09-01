import { describe, expect, test, vi } from 'vitest';

import {
  ArenaGenerationFinalizationPendingError,
  createArenaGenerationService,
  isArenaGenerationDispatchReady,
  MAX_ARENA_CREATE_BODY_BYTES,
  type ArenaGenerationExecutor,
  type ArenaGenerationRejectedTerminalRecorder,
  type ArenaGenerationTerminalStore,
  type GenerationReplayStore,
  type GenerationReplayStoreState,
  type GenerationStreamEvent,
} from '../src/arena-generation/service';
import { evaluateHostedDrVersionGate } from '../src/hosted-dr';

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
  writeSnapshotCalls = 0;
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
    this.writeSnapshotCalls += 1;
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

  async readEvent(input: Parameters<GenerationReplayStore['readEvent']>[0]) {
    return (this.events.get(input.generationId) ?? [])
      .find((event) => event.id === input.eventId) ?? null;
  }

  async markTerminal(input: Parameters<GenerationReplayStore['markTerminal']>[0]) {
    this.markTerminalCalls += 1;
    const state = this.states.get(input.generationId)!;
    if (state.producerToken !== input.producerToken) return { owned: false, applied: false };
    if (state.terminal) return { owned: true, applied: false };
    const current = this.events.get(input.generationId) ?? [];
    const event = input.terminalEvent ? {
      ...input.terminalEvent,
      id: `${current.length + 1}-0`,
    } : undefined;
    if (event) this.events.set(input.generationId, [...current, event]);
    this.states.set(input.generationId, {
      ...state,
      status: input.terminal.status,
      terminal: input.terminal,
      lastEventId: event?.id ?? state.lastEventId,
      snapshot: input.terminalSnapshot ? {
        ...input.terminalSnapshot,
        lastEventId: event?.id ?? input.terminalSnapshot.lastEventId,
      } : input.clearTerminalSnapshot ? null : state.snapshot,
      updatedAt: input.now,
      leaseExpiresAt: null,
    });
    return { owned: true, applied: true, ...(event ? { event } : {}) };
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
    snapshotFlushIntervalMs?: number;
    snapshotFlushBytes?: number;
    snapshotMaxBytes?: number;
    replayPollMs?: number;
    heartbeatIntervalMs?: number;
    leaseDurationMs?: number;
    now?: () => Date;
    terminalStore?: ArenaGenerationTerminalStore;
    authenticated?: boolean;
    actorKey?: string;
    actorResponseHeaders?: Record<string, string>;
    observer?: { observeArenaGeneration(_observation: unknown): void };
    rejectedTerminalRecorder?: ArenaGenerationRejectedTerminalRecorder;
    productionDeltaDefaults?: boolean;
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
  replayPollMs: options.replayPollMs ?? 1,
  ...(options.productionDeltaDefaults ? {} : {
    deltaFlushIntervalMs: options.deltaFlushIntervalMs ?? 5,
    deltaFlushBytes: options.deltaFlushBytes ?? 1_024,
  }),
  ...(options.snapshotFlushIntervalMs === undefined
    ? {}
    : { snapshotFlushIntervalMs: options.snapshotFlushIntervalMs }),
  ...(options.snapshotFlushBytes === undefined
    ? {}
    : { snapshotFlushBytes: options.snapshotFlushBytes }),
  ...(options.snapshotMaxBytes !== undefined
    ? { snapshotMaxBytes: options.snapshotMaxBytes }
    : {}),
  ...(options.terminalStore ? { terminalStore: options.terminalStore } : {}),
  ...(options.observer ? { observer: options.observer } : {}),
  ...(options.rejectedTerminalRecorder
    ? { rejectedTerminalRecorder: options.rejectedTerminalRecorder }
    : {}),
});

describe('Arena generation lifecycle service', () => {
  test('dispatch readiness requires D1/signing but does not require an archive object store', () => {
    expect(isArenaGenerationDispatchReady({
      d1Available: true,
      signatureSecret: 'x'.repeat(32),
      finalizationBridgeReady: true,
    })).toBe(true);
    expect(isArenaGenerationDispatchReady({
      d1Available: false,
      signatureSecret: 'x'.repeat(32),
      finalizationBridgeReady: true,
    })).toBe(false);
  });
  test('trusted parsed seam does not consume or parse the request body again', async () => {
    const prepare = vi.fn(async ({ payload, actorKey }) => {
      expect(payload).toEqual({ value: 'already-parsed' });
      expect(actorKey).toBe('user:42');
      return Response.json({ code: 'TEST_STOP' }, { status: 409 });
    });
    const service = createService(new MemoryReplayStore(), {
      prepare,
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    });
    const request = new Request('https://example.test/api/arena/generate-stream', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-actor' },
      body: 'this body must remain unread',
    });

    const response = await service.createParsedSubscription(request, {
      generationRequestId: 'request-parsed-seam',
      payload: { value: 'already-parsed' },
      bodyBytes: 128,
    });

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(409);
    expect(request.bodyUsed).toBe(false);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  test('resolves payload-dependent operation actor after the single body parse', async () => {
    const resolveCreateActor = vi.fn(async ({ generationRequestId, payload }) => {
      expect(generationRequestId).toBe('request-operation-actor');
      expect(payload).toEqual({ roomId: 'room-1' });
      return { actorKey: 'pvp-room:room-1' };
    });
    const prepare = vi.fn(async ({ actorKey }) => {
      expect(actorKey).toBe('pvp-room:room-1');
      return Response.json({ code: 'TEST_STOP' }, { status: 409 });
    });
    const service = createArenaGenerationService({
      store: new MemoryReplayStore(),
      executor: {
        prepare,
        execute: vi.fn(async () => ({ status: 'completed' as const })),
      },
      resolveActor: async () => ({ actorKey: 'user:42' }),
      resolveCreateActor,
      deriveGenerationId: async () => 'generation-1',
      now: () => new Date('2026-08-25T04:00:00.000Z'),
      hashPayload: async (payload) => `hash:${JSON.stringify(payload)}`,
    });

    const response = await service.createSubscription(new Request(
      'https://example.test/api/arena/generate-stream',
      {
        method: 'POST',
        body: JSON.stringify({
          generationRequestId: 'request-operation-actor',
          roomId: 'room-1',
        }),
      },
    ));

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(409);
    expect(resolveCreateActor).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  test('G25E2-VERSION-SKEW：rollout 保持 authenticated authority 读写与 public contract 兼容', async () => {
    expect(evaluateHostedDrVersionGate({
      stage: 'rollout',
      primaryContractVersion: 'g25e1-v1',
      drContractVersion: 'g25e1-v2',
      clientContractVersion: 'g25e1-v1',
      schemaState: 'expanded',
    })).toEqual({ allowed: true, reason: 'compatible' });

    const createVersionedRequest = (payload: Record<string, unknown>) => new Request(
      'https://example.test/api/arena/generate-stream',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer version-skew-actor',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ generationRequestId: 'request-version-skew', ...payload }),
      },
    );
    const canonicalPreflight = async ({ payload }: { payload: Record<string, unknown> }) => ({
      semanticPayload: { value: payload.value ?? payload.legacyValue },
      materializationPayload: payload,
    });
    const runAuthorityRead = async (
      materializationVersion: string,
      payload: Record<string, unknown>,
    ) => {
      const store = new MemoryReplayStore();
      store.reserveUnavailable = true;
      const readOwnedTerminal = vi.fn(async () => ({
        generationId: 'generation-1',
        generationRequestId: 'request-version-skew',
        status: 'completed' as const,
        updatedAt: '2026-08-25T04:00:00.000Z',
        resultRef: 'r2:version-skew-terminal',
        markdown: 'version-compatible-terminal',
        reasoning: '',
        payloadHash: 'hash:{"value":"same"}',
        contentAvailable: true,
      }));
      const execute = vi.fn(async () => ({ status: 'completed' as const }));
      const service = createService(store, {
        materializationVersion,
        preflight: canonicalPreflight,
        materialize: vi.fn(),
        execute,
      }, {
        actorResponseHeaders: { 'X-Mahoshojo-Generation-Actor-Token': 'signed-actor' },
        terminalStore: { readOwnedTerminal },
      });
      const response = await service.create(createVersionedRequest(payload));
      return {
        actorHeader: response.headers.get('x-mahoshojo-generation-actor-token'),
        body: await response.text(),
        execute,
        readOwnedTerminal,
        status: response.status,
      };
    };

    const [legacyRead, currentRead] = await Promise.all([
      runAuthorityRead('g25e1-v1', { legacyValue: 'same' }),
      runAuthorityRead('g25e1-v2', { value: 'same', optionalExpandedField: 'ignored-by-v1' }),
    ]);
    for (const result of [legacyRead, currentRead]) {
      expect(result.status).toBe(200);
      expect(result.actorHeader).toBe('signed-actor');
      expect(result.body).toContain('version-compatible-terminal');
      expect(result.readOwnedTerminal).toHaveBeenCalledWith({
        actorKey: 'user:42',
        generationId: 'generation-1',
      });
      expect(result.execute).not.toHaveBeenCalled();
    }

    const runAuthorityWrite = async (payload: Record<string, unknown>) => {
      const authorityWrites: Array<Record<string, unknown>> = [];
      const service = createService(new MemoryReplayStore(), {
        materializationVersion: 'g25e1-v2',
        preflight: async ({ actorKey, generationRequestId, payload: input }) => ({
          kind: 'auditable-rejection' as const,
          actorKey,
          generationRequestId,
          response: Response.json({ error: 'version-compatible-rejection' }, { status: 400 }),
          code: 'ARENA_VERSION_COMPATIBILITY_REJECTED',
          stage: 'payload-validation',
          fingerprintPayload: { value: input.value ?? input.legacyValue },
          audit: {
            endpoint: 'api/arena/generate-stream',
            generationMode: 'stream' as const,
            startedAt: '2026-08-25T04:00:00.000Z',
            mode: 'classic',
            pvpContext: {
              roomId: 'version-skew-room',
              matchId: 'version-skew-match',
              roundId: 'version-skew-round',
            },
          },
        }),
        materialize: vi.fn(),
        execute: vi.fn(async () => ({ status: 'completed' as const })),
      }, {
        rejectedTerminalRecorder: {
          record: vi.fn(async (input) => {
            authorityWrites.push({
              actorKey: input.actorKey,
              code: input.code,
              payloadHash: input.payloadHash,
            });
            return { kind: 'recorded' as const };
          }),
        },
      });
      const response = await service.create(createVersionedRequest(payload));
      return { authorityWrites, body: await response.json(), status: response.status };
    };
    const [legacyWrite, currentWrite] = await Promise.all([
      runAuthorityWrite({ legacyValue: 'same' }),
      runAuthorityWrite({ value: 'same', optionalExpandedField: 'ignored-by-v1' }),
    ]);
    expect(legacyWrite).toEqual(currentWrite);
    expect(currentWrite).toEqual({
      authorityWrites: [{
        actorKey: 'user:42',
        code: 'ARENA_VERSION_COMPATIBILITY_REJECTED',
        payloadHash: 'hash:{"value":"same"}',
      }],
      body: {
        error: 'version-compatible-rejection',
        generationId: 'generation-1',
      },
      status: 400,
    });
  });

  test('durably records an auditable preflight rejection before exposing its stable identity', async () => {
    const store = new MemoryReplayStore();
    const reserve = vi.spyOn(store, 'reserve');
    const execute = vi.fn(async () => ({ status: 'completed' as const }));
    const record = vi.fn(async () => ({ kind: 'recorded' as const }));
    const service = createService(store, {
      materializationVersion: 'test-materialization-v1',
      preflight: vi.fn(async () => ({
        kind: 'auditable-rejection' as const,
        actorKey: 'user:42',
        generationRequestId: 'request-auditable',
        response: Response.json({
          error: '输入内容不合规',
          shouldRedirect: true,
          reason: '使用危险符文',
        }, { status: 400 }),
        code: 'ARENA_CONTENT_POLICY_REJECTED',
        stage: 'safety-policy',
        fingerprintPayload: { mode: 'classic', combatants: ['redacted'] },
        audit: {
          endpoint: 'api/generate-battle-story',
          generationMode: 'non-stream' as const,
          startedAt: '2026-08-25T04:00:00.000Z',
          mode: 'classic',
          pvpContext: { roomId: 'room-1', matchId: 'match-1', roundId: 'round-1' },
        },
      })),
      materialize: vi.fn(),
      execute,
    }, { rejectedTerminalRecorder: { record } });

    const response = await service.create(createRequest('request-auditable'));

    expect(response.status).toBe(400);
    expect(response.headers.get('x-mahoshojo-generation-id')).toBe('generation-1');
    expect(response.headers.get('x-mahoshojo-generation-terminal-status')).toBe('failed');
    expect(response.headers.get('x-mahoshojo-generation-request-id')).toBe('request-auditable');
    await expect(response.json()).resolves.toEqual({
      error: '输入内容不合规',
      shouldRedirect: true,
      reason: '使用危险符文',
      generationId: 'generation-1',
    });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      generationId: 'generation-1',
      generationRequestId: 'request-auditable',
      actorKey: 'user:42',
      payloadHash: 'hash:{"mode":"classic","combatants":["redacted"]}',
      code: 'ARENA_CONTENT_POLICY_REJECTED',
      stage: 'safety-policy',
      pvpContext: { roomId: 'room-1', matchId: 'match-1', roundId: 'round-1' },
    }));
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(store.states.get('generation-1')?.terminal).toMatchObject({
      status: 'failed',
      code: 'ARENA_CONTENT_POLICY_REJECTED',
    });
    expect(store.states.get('generation-1')?.snapshot).toMatchObject({
      status: 'failed',
      markdown: '',
      reasoning: '',
      lastEventId: '1-0',
    });
    expect(store.events.get('generation-1')).toEqual([
      expect.objectContaining({
        id: '1-0',
        type: 'error',
        data: expect.objectContaining({
          ok: false,
          status: 'failed',
          code: 'ARENA_CONTENT_POLICY_REJECTED',
        }),
      }),
    ]);
    expect(execute).not.toHaveBeenCalled();
  });

  test('snapshots rejection bytes before committing and preserves non-JSON bodies exactly', async () => {
    const record = vi.fn(async () => ({ kind: 'recorded' as const }));
    const bytes = new Uint8Array([0, 255, 1, 128, 10]);
    const service = createService(new MemoryReplayStore(), {
      materializationVersion: 'test-materialization-v1',
      preflight: vi.fn(async () => ({
        kind: 'auditable-rejection' as const,
        actorKey: 'user:42',
        generationRequestId: 'request-binary-rejection',
        response: new Response(bytes, {
          status: 400,
          headers: { 'Content-Type': 'application/octet-stream' },
        }),
        code: 'ARENA_BINARY_REJECTED',
        stage: 'payload-validation',
        fingerprintPayload: { value: 'same' },
        audit: {
          endpoint: 'api/generate-battle-story',
          generationMode: 'non-stream' as const,
          startedAt: '2026-08-25T04:00:00.000Z',
          mode: 'classic',
          pvpContext: { roomId: 'room-1', matchId: 'match-1', roundId: 'round-1' },
        },
      })),
      materialize: vi.fn(),
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    }, { rejectedTerminalRecorder: { record } });

    const response = await service.create(createRequest('request-binary-rejection'));

    expect(response.headers.get('x-mahoshojo-generation-terminal-status')).toBe('failed');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(record).toHaveBeenCalledTimes(1);
  });

  test('does not commit when an auditable rejection response cannot be snapshotted', async () => {
    const usedResponse = Response.json({ error: 'already read' }, { status: 400 });
    await usedResponse.text();
    const throwingResponse = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('stream failed'));
      },
    }), { status: 400 });
    const record = vi.fn(async () => ({ kind: 'recorded' as const }));
    const buildService = (response: Response, generationRequestId: string) => createService(
      new MemoryReplayStore(),
      {
        materializationVersion: 'test-materialization-v1',
        preflight: vi.fn(async () => ({
          kind: 'auditable-rejection' as const,
          actorKey: 'user:42',
          generationRequestId,
          response,
          code: 'ARENA_REJECTION_RESPONSE_INVALID',
          stage: 'payload-validation',
          fingerprintPayload: { value: 'same' },
          audit: {
            endpoint: 'api/generate-battle-story',
            generationMode: 'non-stream' as const,
            startedAt: '2026-08-25T04:00:00.000Z',
            mode: 'classic',
            pvpContext: { roomId: 'room-1', matchId: 'match-1', roundId: 'round-1' },
          },
        })),
        materialize: vi.fn(),
        execute: vi.fn(async () => ({ status: 'completed' as const })),
      },
      { rejectedTerminalRecorder: { record } },
    );

    const used = await buildService(usedResponse, 'request-used-response')
      .create(createRequest('request-used-response'));
    const throwing = await buildService(throwingResponse, 'request-throwing-response')
      .create(createRequest('request-throwing-response'));

    expect(used.headers.get('x-mahoshojo-generation-id')).toBeNull();
    expect(throwing.headers.get('x-mahoshojo-generation-id')).toBeNull();
    expect(record).not.toHaveBeenCalled();
  });

  test('keeps the durable identity when Redis terminal projection fails after D1 commit', async () => {
    const store = new MemoryReplayStore();
    vi.spyOn(store, 'markTerminal').mockRejectedValue(new Error('Redis unavailable'));
    const record = vi.fn(async () => ({ kind: 'recorded' as const }));
    const service = createService(store, {
      materializationVersion: 'test-materialization-v1',
      preflight: vi.fn(async () => ({
        kind: 'auditable-rejection' as const,
        actorKey: 'user:42',
        generationRequestId: 'request-d1-durable',
        response: Response.json({ error: 'rejected' }, { status: 400 }),
        code: 'ARENA_CONTENT_POLICY_REJECTED',
        stage: 'safety-policy',
        fingerprintPayload: { value: 'same' },
        audit: {
          endpoint: 'api/generate-battle-story',
          generationMode: 'non-stream' as const,
          startedAt: '2026-08-25T04:00:00.000Z',
          mode: 'classic',
          pvpContext: { roomId: 'room-1', matchId: 'match-1', roundId: 'round-1' },
        },
      })),
      materialize: vi.fn(),
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    }, { rejectedTerminalRecorder: { record } });

    const response = await service.create(createRequest('request-d1-durable'));

    expect(response.headers.get('x-mahoshojo-generation-id')).toBe('generation-1');
    expect(response.headers.get('x-mahoshojo-generation-terminal-status')).toBe('failed');
    expect(record).toHaveBeenCalledTimes(1);
    expect(store.states.has('generation-1')).toBe(true);
  });

  test('fails an auditable rejection soft without returning a dangling generation identity', async () => {
    const store = new MemoryReplayStore();
    const reserve = vi.spyOn(store, 'reserve');
    const service = createService(store, {
      materializationVersion: 'test-materialization-v1',
      preflight: vi.fn(async () => ({
        kind: 'auditable-rejection' as const,
        actorKey: 'user:42',
        generationRequestId: 'request-audit-failed',
        response: Response.json({ error: '业务校验失败' }, { status: 400 }),
        code: 'ARENA_PARTICIPANTS_INVALID',
        stage: 'payload-validation',
        fingerprintPayload: { value: 'same' },
        audit: {
          endpoint: 'api/generate-battle-story',
          generationMode: 'non-stream' as const,
          startedAt: '2026-08-25T04:00:00.000Z',
          mode: 'classic',
          pvpContext: { roomId: 'room-1', matchId: 'match-1', roundId: 'round-1' },
        },
      })),
      materialize: vi.fn(),
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    }, {
      rejectedTerminalRecorder: {
        record: vi.fn(async () => { throw new Error('D1 unavailable'); }),
      },
    });

    const response = await service.create(createRequest('request-audit-failed'));

    expect(response.status).toBe(400);
    expect(response.headers.get('x-mahoshojo-generation-id')).toBeNull();
    await expect(response.json()).resolves.toEqual({ error: '业务校验失败' });
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(store.states.size).toBe(0);
  });

  test('fails a conflicting auditable rejection closed without reusing the durable identity', async () => {
    const store = new MemoryReplayStore();
    const service = createService(store, {
      materializationVersion: 'test-materialization-v1',
      preflight: vi.fn(async () => ({
        kind: 'auditable-rejection' as const,
        actorKey: 'user:42',
        generationRequestId: 'request-audit-conflict',
        response: Response.json({ error: '业务校验失败' }, { status: 400 }),
        code: 'ARENA_PARTICIPANTS_INVALID',
        stage: 'payload-validation',
        fingerprintPayload: { value: 'changed' },
        audit: {
          endpoint: 'api/generate-battle-story',
          generationMode: 'non-stream' as const,
          startedAt: '2026-08-25T04:00:00.000Z',
          mode: 'classic',
          pvpContext: { roomId: 'room-1', matchId: 'match-1', roundId: 'round-1' },
        },
      })),
      materialize: vi.fn(),
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    }, {
      rejectedTerminalRecorder: {
        record: vi.fn(async () => ({ kind: 'conflict' as const })),
      },
    });

    const response = await service.create(createRequest('request-audit-conflict'));

    expect(response.status).toBe(409);
    expect(response.headers.get('x-mahoshojo-generation-id')).toBeNull();
    await expect(response.json()).resolves.toMatchObject({ code: 'GENERATION_REQUEST_CONFLICT' });
    expect(store.states.size).toBe(0);
  });

  test('fences a concurrent valid create while an auditable rejection becomes durable', async () => {
    const store = new MemoryReplayStore();
    let releaseRecord!: () => void;
    let notifyRecordStarted!: () => void;
    const recordGate = new Promise<void>((resolve) => { releaseRecord = resolve; });
    const recordStarted = new Promise<void>((resolve) => { notifyRecordStarted = resolve; });
    const record = vi.fn(async () => {
      notifyRecordStarted();
      await recordGate;
      return { kind: 'recorded' as const };
    });
    const execute = vi.fn(async () => ({ status: 'completed' as const }));
    let preflightCalls = 0;
    const service = createService(store, {
      materializationVersion: 'test-materialization-v1',
      preflight: vi.fn(async ({ actorKey, generationRequestId, payload }) => {
        preflightCalls += 1;
        if (preflightCalls === 1) {
          return {
            kind: 'auditable-rejection' as const,
            actorKey,
            generationRequestId,
            response: Response.json({ error: '业务校验失败' }, { status: 400 }),
            code: 'ARENA_PARTICIPANTS_INVALID',
            stage: 'payload-validation',
            fingerprintPayload: { value: payload.value },
            audit: {
              endpoint: 'api/generate-battle-story',
              generationMode: 'non-stream' as const,
              startedAt: '2026-08-25T04:00:00.000Z',
              mode: 'classic',
              pvpContext: { roomId: 'room-1', matchId: 'match-1', roundId: 'round-1' },
            },
          };
        }
        return {
          semanticPayload: { value: payload.value },
          materializationPayload: { value: payload.value },
        };
      }),
      materialize: vi.fn(async ({ payload }) => ({ executionPayload: payload })),
      execute,
    }, { rejectedTerminalRecorder: { record } });

    const rejectionPromise = service.createSubscription(
      createRequest('request-concurrent-audit'),
    );
    await recordStarted;
    const concurrent = await service.createSubscription(
      createRequest('request-concurrent-audit'),
    );

    expect(concurrent).not.toBeInstanceOf(Response);
    expect(execute).not.toHaveBeenCalled();
    releaseRecord();
    const rejection = await rejectionPromise;
    expect(rejection).toBeInstanceOf(Response);
    expect((rejection as Response).headers.get('x-mahoshojo-generation-id'))
      .toBe('generation-1');
    expect(store.states.get('generation-1')?.terminal?.status).toBe('failed');
    expect(execute).not.toHaveBeenCalled();
  });

  test('converts an owned reservation directly into an auditable materialization terminal', async () => {
    const store = new MemoryReplayStore();
    const releaseReservation = vi.spyOn(store, 'releaseReservation');
    const record = vi.fn(async () => ({ kind: 'recorded' as const }));
    const execute = vi.fn(async () => ({ status: 'completed' as const }));
    const service = createService(store, {
      materializationVersion: 'test-materialization-v1',
      preflight: vi.fn(async ({ payload }) => ({
        semanticPayload: payload,
        materializationPayload: payload,
      })),
      materialize: vi.fn(async () => ({
        kind: 'auditable-rejection' as const,
        actorKey: 'user:42',
        generationRequestId: 'request-materialization-audit',
        response: Response.json({ error: '生成准备失败' }, { status: 422 }),
        code: 'ARENA_MATERIALIZATION_REJECTED',
        stage: 'materialization',
        fingerprintPayload: { value: 'same' },
        audit: {
          endpoint: 'api/generate-battle-story',
          generationMode: 'non-stream' as const,
          startedAt: '2026-08-25T04:00:00.000Z',
          mode: 'classic',
          pvpContext: { roomId: 'room-1', matchId: 'match-1', roundId: 'round-1' },
        },
      })),
      execute,
    }, { rejectedTerminalRecorder: { record } });

    const response = await service.create(createRequest('request-materialization-audit'));

    expect(response.status).toBe(422);
    expect(response.headers.get('x-mahoshojo-generation-id')).toBe('generation-1');
    expect(releaseReservation).not.toHaveBeenCalled();
    expect(store.requests.size).toBe(1);
    expect(store.states.get('generation-1')?.terminal?.status).toBe('failed');
    expect(execute).not.toHaveBeenCalled();
  });

  test('keeps materialization rejection ownership fenced while D1 becomes durable', async () => {
    const store = new MemoryReplayStore();
    let releaseRecord!: () => void;
    let notifyRecordStarted!: () => void;
    const recordGate = new Promise<void>((resolve) => { releaseRecord = resolve; });
    const recordStarted = new Promise<void>((resolve) => { notifyRecordStarted = resolve; });
    const record = vi.fn(async () => {
      notifyRecordStarted();
      await recordGate;
      return { kind: 'recorded' as const };
    });
    const execute = vi.fn(async () => ({ status: 'completed' as const }));
    let materializeCalls = 0;
    const service = createService(store, {
      materializationVersion: 'test-materialization-v1',
      preflight: vi.fn(async ({ payload }) => ({
        semanticPayload: payload,
        materializationPayload: payload,
      })),
      materialize: vi.fn(async ({ actorKey, generationRequestId, payload }) => {
        materializeCalls += 1;
        if (materializeCalls === 1) {
          return {
            kind: 'auditable-rejection' as const,
            actorKey,
            generationRequestId,
            response: Response.json({ error: '生成准备失败' }, { status: 422 }),
            code: 'ARENA_MATERIALIZATION_REJECTED',
            stage: 'materialization',
            fingerprintPayload: payload,
            audit: {
              endpoint: 'api/generate-battle-story',
              generationMode: 'non-stream' as const,
              startedAt: '2026-08-25T04:00:00.000Z',
              mode: 'classic',
              pvpContext: { roomId: 'room-1', matchId: 'match-1', roundId: 'round-1' },
            },
          };
        }
        return { executionPayload: payload };
      }),
      execute,
    }, { rejectedTerminalRecorder: { record } });

    const rejected = service.createSubscription(createRequest('request-materialization-race'));
    await recordStarted;
    const concurrent = await service.createSubscription(createRequest('request-materialization-race'));

    expect(concurrent).not.toBeInstanceOf(Response);
    expect(execute).not.toHaveBeenCalled();
    releaseRecord();
    const response = await rejected;
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).headers.get('x-mahoshojo-generation-id'))
      .toBe('generation-1');
    expect(store.states.get('generation-1')?.terminal?.status).toBe('failed');
    expect(execute).not.toHaveBeenCalled();
  });

  test('does not expose identity when materialization recorder and fence release both fail', async () => {
    const store = new MemoryReplayStore();
    vi.spyOn(store, 'releaseReservation').mockRejectedValue(new Error('Redis unavailable'));
    const record = vi.fn(async () => { throw new Error('D1 unavailable'); });
    const service = createService(store, {
      materializationVersion: 'test-materialization-v1',
      preflight: vi.fn(async ({ payload }) => ({
        semanticPayload: payload,
        materializationPayload: payload,
      })),
      materialize: vi.fn(async () => ({
        kind: 'auditable-rejection' as const,
        actorKey: 'user:42',
        generationRequestId: 'request-materialization-release-failed',
        response: Response.json({ error: '生成准备失败' }, { status: 422 }),
        code: 'ARENA_MATERIALIZATION_REJECTED',
        stage: 'materialization',
        fingerprintPayload: { value: 'same' },
        audit: {
          endpoint: 'api/generate-battle-story',
          generationMode: 'non-stream' as const,
          startedAt: '2026-08-25T04:00:00.000Z',
          mode: 'classic',
          pvpContext: { roomId: 'room-1', matchId: 'match-1', roundId: 'round-1' },
        },
      })),
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    }, { rejectedTerminalRecorder: { record } });

    const response = await service.create(
      createRequest('request-materialization-release-failed'),
    );

    expect(response.status).toBe(422);
    expect(response.headers.get('x-mahoshojo-generation-id')).toBeNull();
    await expect(response.json()).resolves.toEqual({ error: '生成准备失败' });
    expect(record).toHaveBeenCalledTimes(1);
  });

  test('does not audit a typed rejection whose identity does not match the request', async () => {
    const store = new MemoryReplayStore();
    const record = vi.fn(async () => ({ kind: 'recorded' as const }));
    const service = createService(store, {
      materializationVersion: 'test-materialization-v1',
      preflight: vi.fn(async () => ({
        kind: 'auditable-rejection' as const,
        actorKey: 'user:42',
        generationRequestId: 'different-request-id',
        response: Response.json({ error: '业务校验失败' }, { status: 400 }),
        code: 'ARENA_PARTICIPANTS_INVALID',
        stage: 'payload-validation',
        fingerprintPayload: { value: 'same' },
        audit: {
          endpoint: 'api/generate-battle-story',
          generationMode: 'non-stream' as const,
          startedAt: '2026-08-25T04:00:00.000Z',
          mode: 'classic',
          pvpContext: { roomId: 'room-1', matchId: 'match-1', roundId: 'round-1' },
        },
      })),
      materialize: vi.fn(),
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    }, { rejectedTerminalRecorder: { record } });

    const response = await service.create(createRequest('request-identity-mismatch'));

    expect(response.status).toBe(400);
    expect(response.headers.get('x-mahoshojo-generation-id')).toBeNull();
    expect(record).not.toHaveBeenCalled();
  });

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

  test('projects actor-owned running state without reasoning, telemetry, or raw result refs', async () => {
    const store = new MemoryReplayStore();
    await store.reserve({
      actorKey: 'pvp-room:room-1',
      generationRequestId: 'request-owned-running',
      generationId: 'generation-1',
      payloadHash: 'payload-hash',
      producerToken: 'producer-1',
      now: '2026-08-25T04:00:00.000Z',
      leaseExpiresAt: '2026-08-25T04:02:00.000Z',
    });
    await store.markRunning({
      generationId: 'generation-1',
      producerToken: 'producer-1',
      now: '2026-08-25T04:00:00.000Z',
      leaseExpiresAt: '2026-08-25T04:02:00.000Z',
    });
    await store.writeSnapshot({
      generationId: 'generation-1',
      producerToken: 'producer-1',
      now: '2026-08-25T04:00:01.000Z',
      snapshot: {
        status: 'running',
        markdown: 'authoritative markdown',
        reasoning: 'private chain of thought',
        telemetry: { providerRequestId: 'provider-secret-diagnostic' },
        lastEventId: '7-0',
        updatedAt: '2026-08-25T04:00:01.000Z',
        terminalResultRef: 'r2:must-not-leak',
      },
    });
    const service = createService(store, {
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    });

    const result = await service.readOwnedProjection({
      actorKey: 'pvp-room:room-1',
      generationId: 'generation-1',
    });

    expect(result).toEqual({
      kind: 'found',
      projection: {
        generationId: 'generation-1',
        generationRequestId: 'request-owned-running',
        status: 'running',
        markdown: 'authoritative markdown',
        resumeCursor: '7-0',
        updatedAt: '2026-08-25T04:00:01.000Z',
        finalAuthoritative: false,
        resultAvailable: false,
        generationRecordId: null,
        errorCode: null,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/reasoning|telemetry|provider|r2:/u);
  });

  test('reads an actor-owned D1/R2 terminal as a safe authoritative projection', async () => {
    const store = new MemoryReplayStore();
    const terminalStore: ArenaGenerationTerminalStore = {
      readOwnedTerminal: vi.fn(async ({ actorKey }) => actorKey === 'pvp-room:room-1'
        ? {
          generationId: 'generation-1',
          generationRequestId: 'request-owned-terminal',
          status: 'failed' as const,
          updatedAt: '2026-08-25T04:05:00.000Z',
          resultRef: 'r2:v1/private/output.md',
          markdown: 'full authoritative markdown',
          reasoning: 'must not leak',
          errorCode: 'AI_UPSTREAM_REQUEST_FAILED',
          payloadHash: 'payload-hash',
          contentAvailable: true,
        }
        : null),
    };
    const service = createService(store, {
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    }, { terminalStore });

    const owned = await service.readOwnedProjection({
      actorKey: 'pvp-room:room-1',
      generationId: 'generation-1',
    });
    const hidden = await service.readOwnedProjection({
      actorKey: 'pvp-room:room-other',
      generationId: 'generation-1',
    });

    expect(owned).toEqual({
      kind: 'found',
      projection: {
        generationId: 'generation-1',
        generationRequestId: 'request-owned-terminal',
        status: 'failed',
        markdown: '',
        resumeCursor: null,
        updatedAt: '2026-08-25T04:05:00.000Z',
        finalAuthoritative: true,
        resultAvailable: false,
        generationRecordId: null,
        errorCode: 'AI_UPSTREAM_REQUEST_FAILED',
      },
    });
    expect(hidden).toEqual({ kind: 'not-found' });
    expect(JSON.stringify(owned)).not.toMatch(/reasoning|r2:/u);
  });

  test('rejects a durable terminal whose generation identity differs from the requested resource', async () => {
    const store = new MemoryReplayStore();
    const service = createService(store, {
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    }, {
      terminalStore: {
        readOwnedTerminal: vi.fn(async () => ({
          generationId: 'generation-other',
          generationRequestId: 'request-owned-terminal',
          status: 'failed' as const,
          updatedAt: '2026-08-25T04:05:00.000Z',
          resultRef: null,
          markdown: '',
          reasoning: '',
          payloadHash: 'payload-hash',
        })),
      },
    });

    await expect(service.readOwnedProjection({
      actorKey: 'user:42',
      generationId: 'generation-1',
    })).resolves.toEqual({ kind: 'not-found' });
  });

  test('resumes an actor-owned generation as a typed subscription without a public Request', async () => {
    const store = new MemoryReplayStore();
    await store.reserve({
      actorKey: 'pvp-room:room-1',
      generationRequestId: 'request-owned-resume',
      generationId: 'generation-1',
      payloadHash: 'payload-hash',
      producerToken: 'producer-1',
      now: '2026-08-25T04:00:00.000Z',
      leaseExpiresAt: '2026-08-25T04:02:00.000Z',
    });
    await store.markRunning({
      generationId: 'generation-1',
      producerToken: 'producer-1',
      now: '2026-08-25T04:00:00.000Z',
      leaseExpiresAt: '2026-08-25T04:02:00.000Z',
    });
    await store.appendEvents({
      generationId: 'generation-1',
      producerToken: 'producer-1',
      now: '2026-08-25T04:00:01.000Z',
      events: [{ type: 'markdown', data: { chunk: 'owned replay' } }],
    });
    const service = createService(store, {
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    });

    const result = await service.resumeOwnedSubscription({
      actorKey: 'pvp-room:room-1',
      generationId: 'generation-1',
      after: null,
    });

    expect(result.kind).toBe('subscribed');
    if (result.kind !== 'subscribed') throw new Error('expected owned subscription');
    const reader = result.subscription.events.getReader();
    await expect(reader.read()).resolves.toMatchObject({
      done: false,
      value: { id: '1-0', type: 'markdown', data: { chunk: 'owned replay' } },
    });
    await reader.cancel('test complete');
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

  test('marks failed durable terminal fallback identities explicitly', async () => {
    const store = new MemoryReplayStore();
    store.reserveUnavailable = true;
    const service = createService(store, {
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    }, {
      terminalStore: {
        readOwnedTerminal: vi.fn(async () => ({
          generationId: 'generation-1',
          generationRequestId: 'request-1',
          status: 'failed' as const,
          updatedAt: '2026-08-25T03:59:00.000Z',
          resultRef: null,
          markdown: '',
          reasoning: '',
          payloadHash: 'hash:{"value":"same"}',
          contentAvailable: true,
        })),
      },
    });

    const response = await service.create(createRequest('request-1'));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-mahoshojo-generation-fallback')).toBe('terminal');
    expect(response.headers.get('x-mahoshojo-generation-terminal-status')).toBe('failed');
    expect(await response.text()).toContain('event: error');
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

  test.each([
    ['request identity', { generationRequestId: 'request-other', payloadHash: 'payload-hash' }],
    ['payload identity', { generationRequestId: 'request-1', payloadHash: 'payload-other' }],
  ])('an already-open replay stream rejects a late durable terminal with mismatched %s', async (
    _label,
    terminalIdentity,
  ) => {
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
    const runningState = structuredClone(store.states.get('generation-1')!);
    const terminalState = {
      ...structuredClone(runningState),
      status: 'completed' as const,
      leaseExpiresAt: null,
      snapshot: null,
      terminal: { status: 'completed' as const, resultRef: 'r2:must-not-project' },
    };
    const readState = vi.spyOn(store, 'readState');
    readState
      .mockResolvedValueOnce(runningState)
      .mockResolvedValue(terminalState);
    vi.spyOn(store as GenerationReplayStore, 'readAfter').mockResolvedValue({
      kind: 'stream-missing',
      events: [],
    });
    const service = createService(store, {
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    }, {
      terminalStore: {
        readOwnedTerminal: vi.fn(async () => ({
          generationId: 'generation-1',
          ...terminalIdentity,
          status: 'completed' as const,
          updatedAt: '2026-08-25T04:01:00.000Z',
          resultRef: 'r2:must-not-project',
          markdown: 'must not be projected',
          reasoning: '',
          contentAvailable: true,
        })),
      },
    });

    const response = await service.resume(new Request(
      'https://example.test/api/arena/generations/generation-1/stream',
    ), { generationId: 'generation-1' });
    const replay = await response.text();

    expect(replay).toContain('GENERATION_TERMINAL_RECONCILIATION_PENDING');
    expect(replay).not.toContain('must not be projected');
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

  test('cancel-by-request does not project a durable terminal with another request identity', async () => {
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
            generationRequestId: 'request-other',
            status: 'completed' as const,
            updatedAt: '2026-08-25T04:00:00.000Z',
            resultRef: 'r2:must-not-project',
            markdown: 'must not be projected',
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

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'GENERATION_STATE_UNAVAILABLE',
    });
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
    expect(store.states.get('generation-1')?.snapshot).toMatchObject({
      status: 'producer_lost',
      lastEventId: '1-0',
    });
    expect(store.events.get('generation-1')).toEqual([
      expect.objectContaining({
        id: '1-0',
        type: 'error',
        data: expect.objectContaining({
          status: 'producer_lost',
          code: 'PRODUCER_OWNERSHIP_UNAVAILABLE',
        }),
      }),
    ]);
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

  test('trusted cancelOwned binds the exact server actor and aborts the active producer once', async () => {
    const store = new MemoryReplayStore();
    let abortCount = 0;
    let resolveAbort!: () => void;
    const aborted = new Promise<void>((resolve) => { resolveAbort = resolve; });
    const resolveActor = vi.fn(async () => ({ actorKey: 'pvp-room:room-1' }));
    const service = createArenaGenerationService({
      store,
      executor: {
        execute: vi.fn(async ({ signal }) => {
          signal.addEventListener('abort', () => {
            abortCount += 1;
            resolveAbort();
          }, { once: true });
          await aborted;
          return { status: 'cancelled' as const, code: 'USER_CANCELLED' };
        }),
      },
      resolveActor,
      deriveGenerationId: async () => 'generation-1',
      now: () => new Date('2026-08-25T04:00:00.000Z'),
      hashPayload: async (payload) => `hash:${JSON.stringify(payload)}`,
    });
    const stream = await service.create(createRequest('request-trusted-cancel'));
    const resolverCallsBeforeCancel = resolveActor.mock.calls.length;

    await expect(service.cancelOwned({
      actorKey: 'pvp-room:other-room',
      generationId: 'generation-1',
      reason: 'user',
    })).resolves.toEqual({ kind: 'forbidden' });
    const repeated = await service.cancelOwned({
      actorKey: 'pvp-room:room-1',
      generationId: 'generation-1',
      reason: 'user',
    });
    expect(repeated.kind === 'accepted' || repeated.kind === 'terminal').toBe(true);
    await expect(service.cancelOwned({
      actorKey: 'pvp-room:room-1',
      generationId: 'generation-1',
      reason: 'user',
    })).resolves.toEqual({ kind: 'accepted', cancelReason: 'user' });

    await aborted;
    await readResponseText(stream);
    expect(abortCount).toBe(1);
    expect(resolveActor).toHaveBeenCalledTimes(resolverCallsBeforeCancel);
  });

  test('trusted cancelOwned returns terminal state idempotently without touching another owner', async () => {
    const store = new MemoryReplayStore();
    store.states.set('generation-terminal', {
      actorKey: 'pvp-room:room-1',
      generationId: 'generation-terminal',
      generationRequestId: 'request-terminal',
      payloadHash: 'hash:terminal',
      producerToken: 'producer-terminal',
      status: 'completed',
      lastEventId: null,
      updatedAt: '2026-08-25T04:00:00.000Z',
      leaseExpiresAt: null,
      snapshot: null,
      terminal: {
        status: 'completed',
        resultRef: 'r2://report/terminal',
      },
      cancelRequested: false,
      cancelReason: null,
      preparationSeed: null,
      preparationVersion: null,
    });
    const service = createService(store, {
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    });

    await expect(service.cancelOwned({
      actorKey: 'pvp-room:other-room',
      generationId: 'generation-terminal',
      reason: 'user',
    })).resolves.toEqual({ kind: 'forbidden' });
    await expect(service.cancelOwned({
      actorKey: 'pvp-room:room-1',
      generationId: 'generation-terminal',
      reason: 'user',
    })).resolves.toEqual({ kind: 'terminal', status: 'completed' });
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
    expect(store.events.get('generation-1')?.at(-1)).toMatchObject({
      type: 'done',
      data: { status: 'completed', resultRef: 'r2://report/1' },
    });
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

  test('默认以 512 bytes 提前刷出 delta，避免长文本积压', async () => {
    const store = new MemoryReplayStore();
    let observedAppendCount = 0;
    const service = createService(store, {
      execute: vi.fn(async ({ emit }) => {
        await emit({ type: 'markdown', data: { chunk: 'A'.repeat(512) } });
        observedAppendCount = store.appendBatches.length;
        return { status: 'completed' as const };
      }),
    }, { productionDeltaDefaults: true });

    const response = await service.create(createRequest('request-default-byte-flush'));
    await readResponseText(response);

    expect(observedAppendCount).toBe(1);
  });

  test('默认在 40 ms 刷出小 delta，不等到生成结束', async () => {
    const store = new MemoryReplayStore();
    let observedAppendCount = 0;
    const service = createService(store, {
      execute: vi.fn(async ({ emit }) => {
        await emit({ type: 'markdown', data: { chunk: 'A' } });
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        observedAppendCount = store.appendBatches.length;
        return { status: 'completed' as const };
      }),
    }, { productionDeltaDefaults: true });

    const response = await service.create(createRequest('request-default-time-flush'));
    await readResponseText(response);

    expect(observedAppendCount).toBe(1);
  });

  test('阻塞读空批次后不再额外等待完整 replay poll 周期', async () => {
    class OneEmptyReadReplayStore extends MemoryReplayStore {
      private returnEmptyOnce = true;

      override async readAfter(input: Parameters<GenerationReplayStore['readAfter']>[0]) {
        if (this.returnEmptyOnce) {
          this.returnEmptyOnce = false;
          return { kind: 'events' as const, events: [] };
        }
        return super.readAfter(input);
      }
    }

    const store = new OneEmptyReadReplayStore();
    const service = createService(store, {
      execute: vi.fn(async ({ emit }) => {
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        await emit({ type: 'markdown', data: { chunk: 'A' } });
        return { status: 'completed' as const };
      }),
    }, {
      deltaFlushBytes: 1,
      deltaFlushIntervalMs: 60_000,
      replayPollMs: 1_000,
    });

    const startedAt = performance.now();
    const response = await service.create(createRequest('request-no-double-poll'));
    await readResponseText(response);

    expect(performance.now() - startedAt).toBeLessThan(300);
  });

  test('高频 delta 保留细粒度 event，但按独立预算合并运行中全量 snapshot', async () => {
    const store = new MemoryReplayStore();
    const service = createService(store, {
      execute: vi.fn(async ({ emit }) => {
        for (let index = 0; index < 5; index += 1) {
          await emit({ type: 'markdown', data: { chunk: 'ABCD' } });
        }
        return { status: 'completed' as const };
      }),
    }, {
      deltaFlushBytes: 4,
      deltaFlushIntervalMs: 60_000,
      snapshotFlushBytes: 16,
      snapshotFlushIntervalMs: 60_000,
    });

    const response = await service.create(createRequest('request-snapshot-budget'));
    await readResponseText(response);

    expect(store.appendBatches).toHaveLength(5);
    expect(store.writeSnapshotCalls).toBe(2);
    expect(store.states.get('generation-1')?.snapshot).toMatchObject({
      status: 'completed',
      markdown: 'ABCD'.repeat(5),
    });
  });

  test('Provider 安全诊断进入 live/replay error event，但 observation 保持低基数', async () => {
    const store = new MemoryReplayStore();
    const observeArenaGeneration = vi.fn();
    const service = createService(store, {
      execute: vi.fn(async () => ({
        status: 'failed' as const,
        code: 'AI_UPSTREAM_REQUEST_FAILED',
        publicError: {
          code: 'AI_UPSTREAM_REQUEST_FAILED' as const,
          message: 'AI_APICallError: 余额不足（HTTP 402）',
          upstreamStatus: 402,
          upstreamRequestId: 'req-arena-replay-402',
        },
      })),
    }, {
      observer: { observeArenaGeneration },
    });

    const first = await service.create(createRequest('request-provider-error'));
    const firstBody = await first.text();
    const replay = await service.resume(new Request(
      'https://example.test/api/arena/generations/generation-1/stream',
    ), { generationId: 'generation-1' });
    const replayBody = await replay.text();
    const windowLost = await service.resume(new Request(
      'https://example.test/api/arena/generations/generation-1/stream?after=999-0',
    ), { generationId: 'generation-1' });
    const windowLostBody = await windowLost.text();

    for (const body of [firstBody, replayBody, windowLostBody]) {
      expect(body).toContain('AI_APICallError: 余额不足（HTTP 402）');
      expect(body).toContain('"code":"AI_UPSTREAM_REQUEST_FAILED"');
      expect(body).toContain('"upstreamStatus":402');
      expect(body).toContain('req-arena-replay-402');
    }
    expect(store.states.get('generation-1')?.terminal).toMatchObject({
      status: 'failed',
      code: 'AI_UPSTREAM_REQUEST_FAILED',
      publicError: { upstreamStatus: 402 },
    });
    expect(JSON.stringify(observeArenaGeneration.mock.calls)).not.toContain('余额不足');
  });

  test('compacts an oversized completed Redis snapshot without dropping Markdown', async () => {
    const store = new MemoryReplayStore();
    const observeArenaGeneration = vi.fn();
    const service = createService(store, {
      execute: vi.fn(async ({ emit }) => {
        await emit({ type: 'markdown', data: { chunk: '完整正文' } });
        await emit({ type: 'reasoning', data: { chunk: 'R'.repeat(1_024) } });
        await emit({ type: 'telemetry', data: { trace: 'T'.repeat(1_024) } });
        return { status: 'completed' as const, resultRef: 'r2://report/compact' };
      }),
    }, {
      snapshotMaxBytes: 512,
      observer: { observeArenaGeneration },
    });

    const response = await service.create(createRequest('request-1'));
    await response.text();

    const state = store.states.get('generation-1');
    expect(state?.snapshot).toMatchObject({
      status: 'completed',
      markdown: '完整正文',
      reasoning: '',
      telemetry: null,
      terminalResultRef: 'r2://report/compact',
      lastEventId: state?.lastEventId,
    });
    expect(observeArenaGeneration).toHaveBeenCalledWith(expect.objectContaining({
      event: 'redis_degraded',
      operation: 'snapshot_budget',
    }));
  });

  test('clears a completed Redis snapshot when Markdown alone exceeds the byte budget', async () => {
    const store = new MemoryReplayStore();
    const observeArenaGeneration = vi.fn();
    let finalized = false;
    const terminalStore: ArenaGenerationTerminalStore = {
      readOwnedTerminal: vi.fn(async () => finalized ? ({
        generationId: 'generation-1',
        generationRequestId: 'request-1',
        status: 'completed' as const,
        updatedAt: '2026-08-25T04:00:00.000Z',
        resultRef: 'r2://report/large',
        markdown: 'X'.repeat(512),
        reasoning: '',
        payloadHash: 'hash:{"value":"same"}',
        contentAvailable: true,
      }) : null),
    };
    const service = createService(store, {
      execute: vi.fn(async ({ emit }) => {
        await emit({ type: 'markdown', data: { chunk: 'X'.repeat(512) } });
        finalized = true;
        return { status: 'completed' as const, resultRef: 'r2://report/large' };
      }),
    }, {
      snapshotMaxBytes: 256,
      observer: { observeArenaGeneration },
      terminalStore,
    });

    const response = await service.create(createRequest('request-1'));
    await response.text();

    expect(store.states.get('generation-1')?.snapshot).toBeNull();
    expect(observeArenaGeneration).toHaveBeenCalledWith(expect.objectContaining({
      event: 'redis_degraded',
      operation: 'snapshot_budget',
    }));
    await expect(service.readOwnedProjection({
      actorKey: 'user:42',
      generationId: 'generation-1',
    })).resolves.toMatchObject({
      kind: 'found',
      projection: {
        status: 'completed',
        markdown: 'X'.repeat(512),
        finalAuthoritative: true,
        resultAvailable: true,
      },
    });
    expect(terminalStore.readOwnedTerminal).toHaveBeenCalledWith({
      actorKey: 'user:42',
      generationId: 'generation-1',
    });
  });

  test('latches a running snapshot budget overflow instead of reserializing every later delta', async () => {
    const store = new MemoryReplayStore();
    const observeArenaGeneration = vi.fn();
    const service = createService(store, {
      execute: vi.fn(async ({ emit }) => {
        await emit({ type: 'markdown', data: { chunk: 'X'.repeat(300) } });
        await emit({ type: 'markdown', data: { chunk: 'Y'.repeat(300) } });
        await emit({ type: 'markdown', data: { chunk: 'Z'.repeat(300) } });
        return { status: 'completed' as const };
      }),
    }, {
      deltaFlushBytes: 1,
      snapshotFlushBytes: 1,
      snapshotMaxBytes: 256,
      observer: { observeArenaGeneration },
    });

    const response = await service.create(createRequest('request-snapshot-overflow-latch'));
    await response.text();

    const budgetObservations = observeArenaGeneration.mock.calls.filter(([observation]) => (
      observation.event === 'redis_degraded' && observation.operation === 'snapshot_budget'
    ));
    expect(budgetObservations).toHaveLength(2);
    expect(store.writeSnapshotCalls).toBe(0);
  });

  test('oversized failed terminal clears the old running partial and keeps bounded terminal evidence', async () => {
    const store = new MemoryReplayStore();
    const service = createService(store, {
      execute: vi.fn(async ({ emit }) => {
        await emit({ type: 'markdown', data: { chunk: 'small-running-partial' } });
        await emit({ type: 'telemetry', data: { phase: 'after-small' } });
        await emit({ type: 'markdown', data: { chunk: 'X'.repeat(512) } });
        return { status: 'failed' as const, code: 'GENERATION_FAILED' };
      }),
    }, { snapshotMaxBytes: 256 });

    const response = await service.create(createRequest('request-1'));
    await response.text();

    const state = store.states.get('generation-1');
    expect(state).toMatchObject({
      status: 'failed',
      terminal: { status: 'failed', code: 'GENERATION_FAILED' },
      snapshot: {
        status: 'failed',
        markdown: '',
        reasoning: '',
      },
    });
    expect(state?.snapshot?.markdown).not.toContain('small-running-partial');
    await expect(service.readOwnedProjection({
      actorKey: 'user:42',
      generationId: 'generation-1',
    })).resolves.toMatchObject({
      kind: 'found',
      projection: {
        status: 'failed',
        markdown: '',
        errorCode: 'GENERATION_FAILED',
      },
    });
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
    const durable = await store.readState({
      actorKey: 'user:42',
      generationId: 'generation-1',
    });
    const events = await store.readAfter({
      generationId: 'generation-1',
      after: null,
      blockMs: 0,
    });
    expect(durable).toMatchObject({
      status: 'producer_lost',
      leaseExpiresAt: null,
      terminal: { status: 'producer_lost' },
      snapshot: {
        status: 'producer_lost',
        markdown: '',
        reasoning: '',
      },
    });
    expect(events.events).toEqual([
      expect.objectContaining({
        type: 'error',
        data: expect.objectContaining({
          status: 'producer_lost',
          code: 'PRODUCER_OWNERSHIP_LOST',
        }),
      }),
    ]);
    expect(durable?.lastEventId).toBe(events.events[0]?.id);
    expect(durable?.snapshot?.lastEventId).toBe(events.events[0]?.id);
  });

  test('expired producer lease stays unavailable when durable terminal commit fails', async () => {
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
    store.markTerminal = vi.fn(async () => {
      throw new Error('redis terminal unavailable');
    });
    const execute = vi.fn(async () => ({ status: 'completed' as const }));
    const service = createService(store, { execute }, {
      terminalStore: {
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
      },
    });

    const response = await service.status(new Request(
      'https://example.test/api/arena/generations/generation-1',
    ), { generationId: 'generation-1' });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'GENERATION_TERMINAL_RECONCILIATION_PENDING',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  test('existing durable terminal stays unavailable when Redis adoption commit fails', async () => {
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
    store.markTerminal = vi.fn(async () => {
      throw new Error('redis terminal unavailable');
    });
    const reconcileExpiredLease = vi.fn(async () => {
      throw new Error('existing durable terminal must not be overwritten');
    });
    const service = createService(store, {
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    }, {
      terminalStore: {
        readOwnedTerminal: vi.fn(async () => ({
          generationId: 'generation-1',
          generationRequestId: 'request-1',
          status: 'completed' as const,
          updatedAt: '2026-08-25T03:30:00.000Z',
          resultRef: 'r2:terminal',
          markdown: 'durable completed report',
          reasoning: '',
          payloadHash: 'payload-hash',
          contentAvailable: true,
        })),
        reconcileExpiredLease,
      },
    });

    const response = await service.status(new Request(
      'https://example.test/api/arena/generations/generation-1',
    ), { generationId: 'generation-1' });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'GENERATION_TERMINAL_RECONCILIATION_PENDING',
    });
    expect(reconcileExpiredLease).not.toHaveBeenCalled();
  });

  test('expired lease adoption fails closed when the terminal event cannot be read back', async () => {
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
    vi.spyOn(store, 'readEvent').mockResolvedValue(null);
    const service = createService(store, {
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    }, {
      terminalStore: {
        readOwnedTerminal: vi.fn(async () => ({
          generationId: 'generation-1',
          generationRequestId: 'request-1',
          status: 'completed' as const,
          updatedAt: '2026-08-25T03:30:00.000Z',
          resultRef: 'r2:terminal',
          markdown: 'durable completed report',
          reasoning: '',
          payloadHash: 'payload-hash',
          contentAvailable: true,
        })),
      },
    });

    const response = await service.status(new Request(
      'https://example.test/api/arena/generations/generation-1',
    ), { generationId: 'generation-1' });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'GENERATION_TERMINAL_RECONCILIATION_PENDING',
    });
  });

  test('concurrent terminal lease claim reloads the committed terminal evidence', async () => {
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
    await store.writeSnapshot({
      generationId: 'generation-1',
      producerToken: 'producer-token-1',
      snapshot: {
        status: 'running',
        markdown: 'stale running preview',
        reasoning: '',
        lastEventId: null,
        updatedAt: '2026-08-25T03:00:00.000Z',
      },
      now: '2026-08-25T03:00:00.000Z',
    });
    vi.spyOn(store, 'claimLeaseExpiry').mockImplementation(async () => {
      await store.markTerminal({
        generationId: 'generation-1',
        producerToken: 'producer-token-1',
        terminal: { status: 'completed', resultRef: 'r2:terminal' },
        terminalEvent: {
          type: 'done',
          data: { ok: true, status: 'completed', resultRef: 'r2:terminal' },
        },
        terminalSnapshot: {
          status: 'completed',
          markdown: 'durable completed report',
          reasoning: '',
          lastEventId: null,
          updatedAt: '2026-08-25T03:30:00.000Z',
          terminalResultRef: 'r2:terminal',
        },
        now: '2026-08-25T03:30:00.000Z',
      });
      return { kind: 'terminal' as const, status: 'completed' as const };
    });
    const readOwnedTerminal = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        generationId: 'generation-1',
        generationRequestId: 'request-1',
        status: 'completed' as const,
        updatedAt: '2026-08-25T03:30:00.000Z',
        resultRef: 'r2:terminal',
        markdown: 'durable completed report',
        reasoning: '',
        payloadHash: 'payload-hash',
        contentAvailable: true,
        roomSafeResult: {
          version: 1,
          format: 'stream-markdown',
          mode: 'classic',
          report: { headline: '权威标题' },
          providerDiagnostic: 'must-be-presanitized-by-terminal-adapter',
        },
      });
    const service = createService(store, {
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    }, { terminalStore: { readOwnedTerminal } });

    const projection = await service.readOwnedProjection({
      actorKey: 'user:42',
      generationId: 'generation-1',
    });

    expect(projection).toEqual({
      kind: 'found',
      projection: expect.objectContaining({
        status: 'completed',
        markdown: 'durable completed report',
        resumeCursor: '1-0',
        finalAuthoritative: true,
        resultAvailable: true,
        roomSafeResult: {
          version: 1,
          format: 'stream-markdown',
          mode: 'classic',
          report: { headline: '权威标题' },
          providerDiagnostic: 'must-be-presanitized-by-terminal-adapter',
        },
      }),
    });
    expect(readOwnedTerminal).toHaveBeenCalledTimes(2);
  });

  test('completed owned projection reloads the durable Room-safe result after service recovery', async () => {
    const store = new MemoryReplayStore();
    const readOwnedTerminal = vi.fn(async () => ({
      generationId: 'generation-1',
      generationRequestId: 'request-1',
      status: 'completed' as const,
      updatedAt: '2026-08-25T03:30:00.000Z',
      resultRef: 'r2:terminal',
      markdown: 'durable completed report',
      reasoning: '',
      payloadHash: 'hash:{"value":"same"}',
      contentAvailable: true,
      roomSafeResult: { version: 1, format: 'stream-markdown', mode: 'classic' },
    }));
    const service = createService(store, {
      execute: vi.fn(async ({ emit }) => {
        await emit({ type: 'markdown', data: { chunk: 'durable completed report' } });
        return { status: 'completed' as const, resultRef: 'r2:terminal' };
      }),
    }, { terminalStore: { readOwnedTerminal } });
    const response = await service.create(createRequest('request-1'));
    await response.text();

    await expect(service.readOwnedProjection({
      actorKey: 'user:42',
      generationId: 'generation-1',
    })).resolves.toMatchObject({
      kind: 'found',
      projection: {
        status: 'completed',
        roomSafeResult: { version: 1, format: 'stream-markdown', mode: 'classic' },
      },
    });
    expect(readOwnedTerminal).toHaveBeenCalledWith({
      generationId: 'generation-1',
      actorKey: 'user:42',
    });
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
    await store.appendEvents({
      generationId: 'generation-1',
      producerToken: 'producer-token-1',
      events: Array.from({ length: 300 }, (_, index) => ({
        type: 'markdown',
        data: { chunk: `${index}` },
      })),
      now: '2026-08-25T03:00:30.000Z',
    });
    const boundedReplayRead = vi.spyOn(store, 'readAfter').mockRejectedValue(
      new Error('terminal verification must use an exact event-id read'),
    );
    const terminalStore: ArenaGenerationTerminalStore = {
      readOwnedTerminal: vi.fn(async () => ({
        generationId: 'generation-1',
        generationRequestId: 'request-1',
        status: 'completed' as const,
        updatedAt: '2026-08-25T03:30:00.000Z',
        resultRef: 'r2:terminal',
        markdown: 'durable completed report',
        reasoning: 'R'.repeat(1_024),
        payloadHash: 'payload-hash',
        contentAvailable: true,
      })),
      reconcileExpiredLease: vi.fn(async () => {
        throw new Error('existing durable terminal must be adopted directly');
      }),
    };
    const service = createService(store, {
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    }, { snapshotMaxBytes: 512, terminalStore });

    const response = await service.status(new Request(
      'https://example.test/api/arena/generations/generation-1',
    ), { generationId: 'generation-1' });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'completed', resumable: false });
    expect(store.states.get('generation-1')?.terminal).toMatchObject({
      status: 'completed',
      resultRef: 'r2:terminal',
    });
    expect(store.states.get('generation-1')?.snapshot).toMatchObject({
      status: 'completed',
      markdown: 'durable completed report',
      reasoning: '',
      telemetry: null,
      terminalResultRef: 'r2:terminal',
    });
    expect(store.events.get('generation-1')).toHaveLength(301);
    expect(store.events.get('generation-1')?.at(-1)).toEqual(expect.objectContaining({
      id: '301-0',
      type: 'done',
      data: expect.objectContaining({ status: 'completed', ok: true }),
    }));
    expect(boundedReplayRead).not.toHaveBeenCalled();
    expect(terminalStore.reconcileExpiredLease).not.toHaveBeenCalled();
  });

  test('expired Redis lease adopts a durable cancelled finalization with exact terminal code', async () => {
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
      readOwnedTerminal: vi.fn(async () => ({
        generationId: 'generation-1',
        generationRequestId: 'request-1',
        status: 'cancelled' as const,
        updatedAt: '2026-08-25T03:30:00.000Z',
        resultRef: null,
        markdown: '',
        reasoning: '',
        errorCode: 'USER_CANCELLED',
        payloadHash: 'payload-hash',
        contentAvailable: false,
      })),
      reconcileExpiredLease: vi.fn(async () => {
        throw new Error('existing durable cancellation must be adopted directly');
      }),
    };
    const service = createService(store, {
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    }, { terminalStore });

    const response = await service.status(new Request(
      'https://example.test/api/arena/generations/generation-1',
    ), { generationId: 'generation-1' });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'cancelled',
      resumable: false,
    });
    expect(store.states.get('generation-1')).toMatchObject({
      status: 'cancelled',
      terminal: { status: 'cancelled', code: 'USER_CANCELLED' },
      leaseExpiresAt: null,
      snapshot: {
        status: 'cancelled',
        markdown: '',
        reasoning: '',
      },
    });
    expect(store.events.get('generation-1')?.at(-1)).toEqual(expect.objectContaining({
      type: 'done',
      data: expect.objectContaining({
        status: 'cancelled',
        ok: false,
        code: 'USER_CANCELLED',
      }),
    }));
    expect(terminalStore.reconcileExpiredLease).not.toHaveBeenCalled();
  });

  test.each([
    ['request identity', { generationRequestId: 'request-other', payloadHash: 'payload-hash' }],
    ['payload identity', { generationRequestId: 'request-1', payloadHash: 'payload-other' }],
  ])('expired lease rejects a D1 terminal with mismatched %s', async (_label, identity) => {
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
    const service = createService(store, {
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    }, {
      terminalStore: {
        readOwnedTerminal: vi.fn(async () => ({
          generationId: 'generation-1',
          ...identity,
          status: 'completed' as const,
          updatedAt: '2026-08-25T03:30:00.000Z',
          resultRef: 'r2:terminal',
          markdown: 'must not be adopted',
          reasoning: '',
          contentAvailable: true,
        })),
      },
    });

    const response = await service.status(new Request(
      'https://example.test/api/arena/generations/generation-1',
    ), { generationId: 'generation-1' });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'GENERATION_TERMINAL_RECONCILIATION_PENDING',
    });
    expect(store.states.get('generation-1')?.terminal).toBeNull();
  });

  test('expired lease never promotes an unavailable durable preview to completed content', async () => {
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
      readOwnedTerminal: vi.fn(async () => ({
        generationId: 'generation-1',
        generationRequestId: 'request-1',
        status: 'completed' as const,
        updatedAt: '2026-08-25T03:30:00.000Z',
        resultRef: 'r2:terminal',
        markdown: 'truncated preview must never become final',
        reasoning: '',
        payloadHash: 'payload-hash',
        contentAvailable: false,
      })),
    };
    const service = createService(store, {
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    }, { terminalStore });
    const statusRequest = () => new Request(
      'https://example.test/api/arena/generations/generation-1',
    );

    const firstStatus = await service.status(statusRequest(), { generationId: 'generation-1' });
    const secondStatus = await service.status(statusRequest(), { generationId: 'generation-1' });
    const projection = await service.readOwnedProjection({
      actorKey: 'user:42',
      generationId: 'generation-1',
    });
    const resumed = await service.resume(new Request(
      'https://example.test/api/arena/generations/generation-1/stream',
    ), { generationId: 'generation-1' });

    for (const response of [firstStatus, secondStatus, resumed]) {
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        code: 'GENERATION_TERMINAL_CONTENT_UNAVAILABLE',
      });
    }
    expect(projection).toEqual({
      kind: 'unavailable',
      code: 'GENERATION_TERMINAL_CONTENT_UNAVAILABLE',
    });
    expect(store.states.get('generation-1')).toMatchObject({
      status: 'completed',
      terminal: { status: 'completed', resultRef: 'r2:terminal' },
      snapshot: null,
      leaseExpiresAt: null,
    });
    expect(JSON.stringify(store.states.get('generation-1'))).not.toContain('truncated preview');
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
        payloadHash: 'payload-hash',
        contentAvailable: true,
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

  test('durable failed terminal fallback emits only its stable code and no Provider message', async () => {
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
        errorCode: 'AI_UPSTREAM_REQUEST_FAILED',
        payloadHash: 'payload-hash',
      })),
    };
    const service = createService(store, {
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    }, { terminalStore });

    const response = await service.resume(new Request(
      'https://example.test/api/arena/generations/generation-1/stream',
    ), { generationId: 'generation-1' });
    const replay = await response.text();

    expect(replay).toContain('event: error');
    expect(replay).toContain('"code":"AI_UPSTREAM_REQUEST_FAILED"');
    expect(replay).not.toMatch(/message|余额不足|provider/u);
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
        payloadHash: 'payload-hash',
        contentAvailable: true,
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

  test('waits for the first event when a new generation has state but no Redis stream yet', async () => {
    const store = new MemoryReplayStore();
    const readAfterFromMemory = store.readAfter.bind(store);
    const readAfter = vi.spyOn(store as GenerationReplayStore, 'readAfter').mockImplementation(async (input) => {
      if ((store.events.get(input.generationId) ?? []).length === 0) {
        return { kind: 'stream-missing', events: [] };
      }
      return readAfterFromMemory(input);
    });
    let emitFirstEvent!: () => void;
    const firstEventGate = new Promise<void>((resolve) => { emitFirstEvent = resolve; });
    const execute = vi.fn(async ({ emit }) => {
      await firstEventGate;
      await emit({ type: 'markdown', data: { chunk: 'first event' } });
      return { status: 'completed' as const };
    });
    const service = createService(store, { execute });

    const response = await service.create(createRequest('request-first-event'));
    await vi.waitFor(() => expect(readAfter).toHaveBeenCalled());
    emitFirstEvent();
    const replay = await response.text();

    expect(replay).toContain('first event');
    expect(replay).toContain('event: done');
    expect(replay).not.toContain('REPLAY_STREAM_MISSING');
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
        contentAvailable: true,
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
    expect(store.states.get('generation-1')?.snapshot).toMatchObject({
      status: 'completed',
      markdown: 'durable terminal body',
      terminalResultRef: 'r2:terminal',
    });
    expect(store.events.get('generation-1')).toEqual([
      expect.objectContaining({
        type: 'done',
        data: expect.objectContaining({ ok: true, status: 'completed' }),
      }),
    ]);
  });

  test('D1 terminal reservation adoption fails closed when Redis evidence cannot commit', async () => {
    const store = new MemoryReplayStore();
    store.markTerminal = vi.fn(async () => {
      throw new Error('redis terminal unavailable');
    });
    const service = createService(store, {
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    }, {
      terminalStore: {
        readOwnedTerminal: vi.fn(async () => ({
          generationId: 'generation-1',
          generationRequestId: 'request-1',
          status: 'completed' as const,
          updatedAt: '2026-08-25T04:00:00.000Z',
          resultRef: 'r2:terminal',
          markdown: 'durable terminal body',
          reasoning: '',
          payloadHash: 'hash:{"value":"same"}',
          contentAvailable: true,
        })),
      },
    });

    const response = await service.create(createRequest('request-1'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'GENERATION_TERMINAL_RECONCILIATION_PENDING',
    });
  });

  test.each([
    ['request', { generationId: 'generation-1', generationRequestId: 'request-other' }],
    ['generation', { generationId: 'generation-other', generationRequestId: 'request-1' }],
  ])('D1 terminal reservation adoption rejects a mismatched %s identity', async (_label, identity) => {
    const store = new MemoryReplayStore();
    const execute = vi.fn(async () => ({ status: 'completed' as const }));
    const service = createService(store, { execute }, {
      terminalStore: {
        readOwnedTerminal: vi.fn(async () => ({
          ...identity,
          status: 'completed' as const,
          updatedAt: '2026-08-25T04:00:00.000Z',
          resultRef: 'r2:terminal',
          markdown: 'must not be adopted',
          reasoning: '',
          payloadHash: 'hash:{"value":"same"}',
          contentAvailable: true,
        })),
      },
    });

    const response = await service.create(createRequest('request-1'));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'GENERATION_REQUEST_CONFLICT',
    });
    expect(execute).not.toHaveBeenCalled();
    expect(store.states.has('generation-1')).toBe(false);
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
        payloadHash: 'payload-hash',
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

  test('reports an expired durable body as completed without a retryable storage failure', async () => {
    const store = new MemoryReplayStore();
    const terminalStore: ArenaGenerationTerminalStore = {
      readOwnedTerminal: vi.fn(async () => ({
        generationId: 'generation-1',
        generationRequestId: 'request-1',
        status: 'completed' as const,
        updatedAt: '2026-08-25T04:00:00.000Z',
        resultRef: 'r2://report/expired',
        markdown: '',
        reasoning: '',
        payloadHash: 'payload-hash',
        contentAvailable: false,
        contentUnavailableReason: 'not-found' as const,
      })),
    };
    const service = createService(store, {
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    }, { terminalStore });

    const status = await service.status(new Request(
      'https://example.test/api/arena/generations/generation-1',
    ), { generationId: 'generation-1' });
    const lookup = await service.lookup(new Request(
      'https://example.test/api/arena/generation-requests/request-1',
    ), { generationRequestId: 'request-1' });
    const projection = await service.readOwnedProjection({
      actorKey: 'user:42',
      generationId: 'generation-1',
    });
    const resumed = await service.resume(new Request(
      'https://example.test/api/arena/generations/generation-1/stream',
    ), { generationId: 'generation-1' });

    for (const response of [status, lookup]) {
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        status: 'completed',
        resumable: false,
        finalAuthoritative: true,
        resultAvailable: false,
        contentRetention: 'expired',
      });
    }
    expect(projection).toEqual({
      kind: 'found',
      projection: expect.objectContaining({
        status: 'completed',
        markdown: '',
        finalAuthoritative: true,
        resultAvailable: false,
        generationRecordId: null,
      }),
    });
    expect(resumed.status).toBe(410);
    await expect(resumed.json()).resolves.toMatchObject({
      code: 'GENERATION_TERMINAL_CONTENT_EXPIRED',
    });
    await expect(service.resumeOwnedSubscription({
      actorKey: 'user:42',
      generationId: 'generation-1',
      after: null,
    })).resolves.toEqual({
      kind: 'unavailable',
      code: 'GENERATION_TERMINAL_CONTENT_EXPIRED',
    });
  });

  test('reports a completed unarchived output as completed with a narrow warning', async () => {
    const store = new MemoryReplayStore();
    const terminalStore: ArenaGenerationTerminalStore = {
      readOwnedTerminal: vi.fn(async () => ({
        generationId: 'generation-1',
        generationRequestId: 'request-1',
        status: 'completed' as const,
        updatedAt: '2026-08-25T04:00:00.000Z',
        resultRef: null,
        markdown: '',
        reasoning: '',
        payloadHash: 'payload-hash',
        persistenceWarning: 'OUTPUT_NOT_ARCHIVED' as const,
        contentAvailable: false,
        contentUnavailableReason: 'not-archived' as const,
      })),
    };
    const service = createService(store, {
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    }, { terminalStore });

    const status = await service.status(new Request(
      'https://example.test/api/arena/generations/generation-1',
    ), { generationId: 'generation-1' });
    const lookup = await service.lookup(new Request(
      'https://example.test/api/arena/generation-requests/request-1',
    ), { generationRequestId: 'request-1' });
    const projection = await service.readOwnedProjection({
      actorKey: 'user:42',
      generationId: 'generation-1',
    });
    const resumed = await service.resume(new Request(
      'https://example.test/api/arena/generations/generation-1/stream',
    ), { generationId: 'generation-1' });
    const resumedBody = await resumed.text();

    for (const response of [status, lookup]) {
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        status: 'completed',
        resumable: false,
        finalAuthoritative: true,
        resultAvailable: false,
        persistenceWarning: 'OUTPUT_NOT_ARCHIVED',
        replayUnavailable: true,
      });
    }
    expect(projection).toEqual({
      kind: 'found',
      projection: expect.objectContaining({
        status: 'completed',
        finalAuthoritative: true,
        resultAvailable: false,
        persistenceWarning: 'OUTPUT_NOT_ARCHIVED',
        replayUnavailable: true,
      }),
    });
    expect(resumed.status).toBe(200);
    expect(resumedBody).toContain('event: done');
    expect(resumedBody).toContain('"status":"completed"');
    expect(resumedBody).toContain('"persistenceWarning":"OUTPUT_NOT_ARCHIVED"');
    expect(resumedBody).toContain('"replayUnavailable":true');
    expect(resumedBody).not.toContain('event: error');
  });

  test('keeps an expired terminal completed when durable fallback wins an SSE replay race', async () => {
    const store = new MemoryReplayStore();
    await store.reserve({
      actorKey: 'user:42',
      generationRequestId: 'request-1',
      generationId: 'generation-1',
      payloadHash: 'payload-hash',
      producerToken: 'producer-token-1',
      now: '2026-08-25T04:00:00.000Z',
      leaseExpiresAt: '2026-08-25T05:00:00.000Z',
    });
    await store.markRunning({
      generationId: 'generation-1',
      producerToken: 'producer-token-1',
      now: '2026-08-25T04:00:00.000Z',
      leaseExpiresAt: '2026-08-25T05:00:00.000Z',
    });
    const originalReadState = store.readState.bind(store);
    vi.spyOn(store, 'readState')
      .mockImplementationOnce(originalReadState)
      .mockResolvedValueOnce(null);
    const service = createService(store, {
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    }, {
      terminalStore: {
        readOwnedTerminal: vi.fn(async () => ({
          generationId: 'generation-1',
          generationRequestId: 'request-1',
          status: 'completed' as const,
          updatedAt: '2026-08-25T04:00:00.000Z',
          resultRef: 'r2://report/expired',
          markdown: '',
          reasoning: '',
          payloadHash: 'payload-hash',
          contentAvailable: false,
          contentUnavailableReason: 'not-found' as const,
        })),
      },
    });

    const resumed = await service.resume(new Request(
      'https://example.test/api/arena/generations/generation-1/stream',
    ), { generationId: 'generation-1' });
    const body = await resumed.text();

    expect(resumed.status).toBe(200);
    expect(body).toContain('event: snapshot');
    expect(body).toContain('event: done');
    expect(body).toContain('"status":"completed"');
    expect(body).toContain('"resultAvailable":false');
    expect(body).toContain('"contentRetention":"expired"');
    expect(body).not.toContain('"status":"failed"');
  });

  test('fails closed when the exact replay terminal entry was trimmed', async () => {
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
    expect(resumed.status).toBe(503);
    await expect(resumed.json()).resolves.toMatchObject({
      code: 'GENERATION_TERMINAL_RECONCILIATION_PENDING',
    });
  });

  test('synthesizes terminal cursors beyond the JavaScript safe integer range', async () => {
    const store = new MemoryReplayStore();
    const service = createService(store, {
      execute: vi.fn(async () => ({ status: 'completed' as const })),
    }, {
      terminalStore: {
        readOwnedTerminal: vi.fn(async () => ({
          generationId: 'generation-1',
          generationRequestId: 'request-1',
          status: 'completed' as const,
          updatedAt: '2026-08-25T04:00:00.000Z',
          resultRef: 'r2://report/large-cursor',
          markdown: '完整正文',
          reasoning: '',
          payloadHash: 'payload-hash',
          contentAvailable: true,
        })),
      },
    });

    const resumed = await service.resume(new Request(
      'https://example.test/api/arena/generations/generation-1/stream?after=9-999999999999999999999999999999',
    ), { generationId: 'generation-1' });
    const replay = await resumed.text();

    expect(replay).toContain('id: 9-1000000000000000000000000000000\nevent: snapshot');
    expect(replay).toContain('id: 9-1000000000000000000000000000001\nevent: done');
  });
});
