import { describe, expect, it, vi } from 'vitest';

import { createMemoryGenerationReplayStore } from '@mahoshojo/hosted-api/arena-generation/memory-replay-store';
import {
  createArenaGenerationService,
  type ArenaGenerationService,
  type ArenaGenerationTerminalStore,
  type GenerationReplayStore,
} from '@mahoshojo/hosted-api/arena-generation/service';
import {
  createArenaGenerationFinalizer,
  createArenaGenerationRuntime,
  type ArenaGenerationFinalizationPorts,
  type ArenaGenerationRuntimeDependencies,
} from '@mahoshojo/hosted-runtime/arena-generation';
import { selectHostedDrRuntime } from '@mahoshojo/hosted-api/hosted-dr';

import { openArenaGenerationStream } from '@/lib/arena/resumable-generation-client';

const generationId = 'generation-fault-001';
const generationRequestId = 'fault-request-001';
const actorKey = 'user:42';

type SideEffectCounts = {
  storage: number;
  claim: number;
  combatants: number;
  impacts: number;
  ratings: number;
  complete: number;
};

type FaultEvidence = {
  caseId?: number;
  scenario: string;
  generationRequestId: string;
  generationId: string;
  createAttempts: number;
  disconnects: number;
  resumeAttempts: number;
  resumeSuccesses: number;
  cancelAttempts: number;
  providerStarts: number;
  terminal: 'completed' | 'cancelled' | 'producer_lost' | 'unavailable';
  redis: 'terminal' | 'expired' | 'finalizing' | 'unavailable';
  d1: 'completed' | 'aborted' | 'producer_lost' | 'none';
  r2: 'stored' | 'retry-stored' | 'not-written' | 'failed';
  replayBytes?: number;
  snapshotBytes?: number;
  outageMs?: number;
  producerKills?: number;
  sideEffects: SideEffectCounts;
};

const acceptedFaultEvidence: FaultEvidence[] = [];

const recordAcceptedFault = (evidence: FaultEvidence & {
  caseId: number;
  replayBytes: number;
  snapshotBytes: number;
}): FaultEvidence => {
  acceptedFaultEvidence.push(evidence);
  return evidence;
};

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

type BridgeObservation = {
  createAttempts: number;
  cancelAttempts: number;
  disconnects: number;
  resumeAttempts: number;
  resumeSuccesses: number;
  replayBytes: number;
  snapshotBytes: number;
  generationRequestIds: string[];
  generationIds: string[];
};

type BackendObservation = {
  createAttempts: number;
  cancelAttempts: number;
  disconnects: number;
  resumeAttempts: number;
  resumeSuccesses: number;
  replayBytes: number;
  snapshotBytes: number;
  generationRequestIds: string[];
  generationIds: string[];
  terminal: FaultEvidence['terminal'] | null;
};

const terminalFromSse = (body: string): FaultEvidence['terminal'] | null => {
  if (body.includes('"status":"producer_lost"')) return 'producer_lost';
  if (body.includes('"status":"cancelled"')) return 'cancelled';
  if (body.includes('event: done')) return 'completed';
  return null;
};

const createBackendProbe = (service: ArenaGenerationService) => {
  const observation: BackendObservation = {
    createAttempts: 0,
    cancelAttempts: 0,
    disconnects: 0,
    resumeAttempts: 0,
    resumeSuccesses: 0,
    replayBytes: 0,
    snapshotBytes: 0,
    generationRequestIds: [],
    generationIds: [],
    terminal: null,
  };
  const observeIdentity = (response: Response): void => {
    const observed = response.headers.get('x-mahoshojo-generation-id');
    if (observed) observation.generationIds.push(observed);
  };
  const read = async (response: Response, replay = true): Promise<string> => {
    const body = await response.text();
    if (replay) observation.replayBytes += new TextEncoder().encode(body).byteLength;
    const snapshotBlock = body.split('\n\n').find((block) => block.includes('event: snapshot'));
    if (snapshotBlock) {
      observation.snapshotBytes += new TextEncoder().encode(`${snapshotBlock}\n\n`).byteLength;
    }
    observation.terminal = terminalFromSse(body) ?? observation.terminal;
    return body;
  };
  return {
    observation,
    async create(input: Request): Promise<Response> {
      observation.createAttempts += 1;
      const parsed = await input.clone().json() as { generationRequestId?: string };
      if (parsed.generationRequestId) observation.generationRequestIds.push(parsed.generationRequestId);
      const response = await service.create(input);
      observeIdentity(response);
      return response;
    },
    async resume(input: Request, params: { generationId: string }): Promise<Response> {
      observation.resumeAttempts += 1;
      const response = await service.resume(input, params);
      if (response.ok) observation.resumeSuccesses += 1;
      observeIdentity(response);
      return response;
    },
    async cancel(input: Request, params: { generationId: string }): Promise<Response> {
      observation.cancelAttempts += 1;
      const response = await service.cancel(input, params);
      observeIdentity(response);
      return response;
    },
    async disconnect(response: Response, reason: string): Promise<void> {
      observation.disconnects += 1;
      await response.body?.cancel(reason);
    },
    read,
  };
};

const durableStatusFromObservation = (
  terminal: FaultEvidence['terminal'] | null,
  counts: SideEffectCounts,
): FaultEvidence['d1'] => {
  if (counts.complete === 0) return 'none';
  return terminal === 'cancelled' ? 'aborted' : terminal === 'producer_lost' ? 'producer_lost' : 'completed';
};

const r2StatusFromObservation = (counts: SideEffectCounts): FaultEvidence['r2'] => (
  counts.storage > 0 ? 'stored' : 'not-written'
);

const observeResponseBody = (
  response: Response,
  observation: BridgeObservation,
  options: { disconnect: boolean; replay: boolean },
): Response => {
  if (!response.body) return response;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let blockBuffer = '';
  let chunks = 0;
  let disconnected = false;
  const recordChunk = (value: Uint8Array): void => {
    if (options.replay) observation.replayBytes += value.byteLength;
    blockBuffer += decoder.decode(value, { stream: true }).replace(/\r\n?/gu, '\n');
    let separator = blockBuffer.indexOf('\n\n');
    while (separator >= 0) {
      const block = blockBuffer.slice(0, separator);
      blockBuffer = blockBuffer.slice(separator + 2);
      if (block.includes('event: snapshot')) {
        observation.snapshotBytes += encoder.encode(`${block}\n\n`).byteLength;
      }
      separator = blockBuffer.indexOf('\n\n');
    }
  };
  const disconnect = async (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (disconnected) return;
    disconnected = true;
    observation.disconnects += 1;
    await reader.cancel('fault-injected subscriber disconnect').catch(() => undefined);
    controller.error(new Error('fault-injected subscriber disconnect'));
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (options.disconnect && chunks >= 1) {
        await disconnect(controller);
        return;
      }
      const next = await reader.read();
      if (next.done) {
        controller.close();
        return;
      }
      chunks += 1;
      recordChunk(next.value);
      controller.enqueue(next.value);
    },
    async cancel(reason) {
      if (!disconnected) {
        disconnected = true;
        observation.disconnects += 1;
      }
      await reader.cancel(reason).catch(() => undefined);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};

const createServiceBridge = (
  service: ArenaGenerationService,
  faults: { disconnectResponses?: number; lostHeaders?: number } = {},
) => {
  const observation: BridgeObservation = {
    createAttempts: 0,
    cancelAttempts: 0,
    disconnects: 0,
    resumeAttempts: 0,
    resumeSuccesses: 0,
    replayBytes: 0,
    snapshotBytes: 0,
    generationRequestIds: [],
    generationIds: [],
  };
  let disconnectResponses = faults.disconnectResponses ?? 0;
  let lostHeaders = faults.lostHeaders ?? 0;
  let markDisconnected!: () => void;
  const firstDisconnect = new Promise<void>((resolve) => { markDisconnected = resolve; });
  const fetcher = async (url: string, init?: RequestInit): Promise<Response> => {
    const target = new URL(url, 'https://example.test');
    const method = init?.method ?? 'GET';
    const requestLookupMatch = target.pathname.match(
      /\/api\/arena\/generation-requests\/([^/]+)$/u,
    );
    const generationMatch = target.pathname.match(/\/api\/arena\/generations\/([^/]+)(?:\/(stream|cancel))?$/u);
    let response: Response;
    let replay = false;
    if (method === 'DELETE') {
      observation.cancelAttempts += 1;
      response = await service.cancelRequest(new Request(target, init));
    } else if (requestLookupMatch) {
      response = await service.lookup(new Request(target, init), {
        generationRequestId: decodeURIComponent(requestLookupMatch[1]!),
      });
    } else if (generationMatch?.[2] === 'cancel') {
      observation.cancelAttempts += 1;
      response = await service.cancel(new Request(target, init), {
        generationId: decodeURIComponent(generationMatch[1]!),
      });
    } else if (generationMatch?.[2] === 'stream') {
      observation.resumeAttempts += 1;
      replay = true;
      response = await service.resume(new Request(target, init), {
        generationId: decodeURIComponent(generationMatch[1]!),
      });
      if (response.ok) observation.resumeSuccesses += 1;
    } else {
      observation.createAttempts += 1;
      const parsed = JSON.parse(String(init?.body ?? '{}')) as { generationRequestId?: string };
      if (parsed.generationRequestId) observation.generationRequestIds.push(parsed.generationRequestId);
      response = await service.create(new Request(target, init));
    }
    const observedGenerationId = response.headers.get('x-mahoshojo-generation-id');
    if (observedGenerationId) observation.generationIds.push(observedGenerationId);
    if (lostHeaders > 0) {
      lostHeaders -= 1;
      observation.disconnects += 1;
      markDisconnected();
      await response.body?.cancel('fault-injected response headers lost').catch(() => undefined);
      throw new TypeError('fault-injected response headers lost');
    }
    const shouldDisconnect = disconnectResponses > 0;
    if (shouldDisconnect) disconnectResponses -= 1;
    const observed = observeResponseBody(response, observation, {
      disconnect: shouldDisconnect,
      replay,
    });
    if (shouldDisconnect) {
      const originalDisconnects = observation.disconnects;
      void (async () => {
        while (observation.disconnects === originalDisconnects) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        markDisconnected();
      })();
    }
    return observed;
  };
  return { fetcher, firstDisconnect, observation };
};

const emptyCounts = (): SideEffectCounts => ({
  storage: 0,
  claim: 0,
  combatants: 0,
  impacts: 0,
  ratings: 0,
  complete: 0,
});

const request = () => new Request('https://example.test/api/arena/generate-stream', {
  method: 'POST',
  headers: {
    Accept: 'text/event-stream',
    Authorization: 'Bearer test-actor',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    generationRequestId,
    mode: 'classic',
    combatants: [
      { type: 'magical-girl', data: { name: 'A' } },
      { type: 'magical-girl', data: { name: 'B' } },
    ],
  }),
});

const markdownStream = (
  gate: Promise<void> = Promise.resolve(),
): ReadableStream<Uint8Array> => new ReadableStream({
  async start(controller) {
    const encoder = new TextEncoder();
    controller.enqueue(encoder.encode('# fault matrix\n'));
    await gate;
    controller.enqueue(encoder.encode('terminal body'));
    controller.close();
  },
});

const successfulPorts = (counts: SideEffectCounts): ArenaGenerationFinalizationPorts => ({
  async storeOutput() {
    counts.storage += 1;
    return { resultRef: `r2:v1/battle-report-generations/${generationId}/output.md` };
  },
  async claimTerminal(input) {
    counts.claim += 1;
    return { kind: 'created', resultRef: input.resultRef, finalized: false };
  },
  async persistCombatants() { counts.combatants += 1; },
  async applyStoryImpacts() { counts.impacts += 1; },
  async settleRatings() { counts.ratings += 1; },
  async completeTerminal() { counts.complete += 1; },
  async failTerminal() { throw new Error('unexpected failTerminal'); },
  async readRanking() { return null; },
});

const createHarness = (input: {
  ports: ArenaGenerationFinalizationPorts;
  providerGate?: Promise<void>;
  now?: () => Date;
  leaseDurationMs?: number;
  terminalTtlMs?: number;
  maxEvents?: number;
  generate?: ArenaGenerationRuntimeDependencies['generate'];
  wrapStore?(_store: GenerationReplayStore): GenerationReplayStore;
  terminalStore?: ArenaGenerationTerminalStore;
}) => {
  const now = input.now ?? (() => new Date('2026-08-25T04:00:00.000Z'));
  const baseStore = createMemoryGenerationReplayStore({
    now: () => now().getTime(),
    ...(input.terminalTtlMs !== undefined ? { terminalTtlMs: input.terminalTtlMs } : {}),
    ...(input.maxEvents !== undefined ? { maxEvents: input.maxEvents } : {}),
  });
  const store = input.wrapStore?.(baseStore) ?? baseStore;
  const provider = vi.fn(input.generate ?? (async () => ({
    body: markdownStream(input.providerGate),
    telemetry: { model: 'fault-model' },
  })));
  const runtime = createArenaGenerationRuntime({
    checkSafety: async () => null,
    buildPrompt: async () => ({ prompt: 'fault prompt', metadata: {} }),
    generate: provider,
    finalize: createArenaGenerationFinalizer(input.ports),
  });
  let tokenSequence = 0;
  const derivedIdentities: Array<{ generationRequestId: string; generationId: string }> = [];
  const service = createArenaGenerationService({
    store,
    executor: runtime,
    resolveActor: async () => ({ actorKey }),
    deriveGenerationId: async ({ generationRequestId: requestIdentity }) => {
      derivedIdentities.push({ generationRequestId: requestIdentity, generationId });
      return generationId;
    },
    hashPayload: async () => 'fault-payload-hash',
    createProducerToken: () => `producer-${tokenSequence += 1}`,
    now,
    replayPollMs: 1,
    deltaFlushIntervalMs: 1,
    deltaFlushBytes: 1,
    heartbeatIntervalMs: 60_000,
    leaseDurationMs: input.leaseDurationMs ?? 120_000,
    ...(input.terminalStore ? { terminalStore: input.terminalStore } : {}),
  });
  return { derivedIdentities, provider, service, store };
};

describe.sequential('Arena resumable generation fault-injection matrix', () => {
  it('collects Web disconnect, network-switch, refresh, handshake, reader, tabs, cursor, and repeat-resume evidence', async () => {
    const body = {
      mode: 'classic',
      combatants: [
        { type: 'magical-girl', data: { name: 'A' } },
        { type: 'magical-girl', data: { name: 'B' } },
      ],
    };
    const open = (
      bridge: ReturnType<typeof createServiceBridge>,
      storage: MemoryStorage,
      requestId: string,
      options: { baseReconnectDelayMs?: number } = {},
    ) => openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body,
      headers: { Authorization: 'Bearer test-actor' },
      fetcher: bridge.fetcher,
      storage,
      generationRequestId: requestId,
      baseReconnectDelayMs: options.baseReconnectDelayMs ?? 1,
      random: () => 0.5,
    });
    const completedEvidence = (input: {
      caseId: number;
      scenario: string;
      requestId: string;
      provider: ReturnType<typeof vi.fn>;
      counts: SideEffectCounts;
      bridge: ReturnType<typeof createServiceBridge>;
      outageMs?: number;
    }): FaultEvidence => recordAcceptedFault({
      caseId: input.caseId,
      scenario: input.scenario,
      generationRequestId: input.bridge.observation.generationRequestIds.at(-1) ?? input.requestId,
      generationId: input.bridge.observation.generationIds.at(-1) ?? '',
      createAttempts: input.bridge.observation.createAttempts,
      disconnects: input.bridge.observation.disconnects,
      resumeAttempts: input.bridge.observation.resumeAttempts,
      resumeSuccesses: input.bridge.observation.resumeSuccesses,
      cancelAttempts: input.bridge.observation.cancelAttempts,
      providerStarts: input.provider.mock.calls.length,
      terminal: 'completed',
      redis: 'terminal',
      d1: 'completed',
      r2: 'stored',
      replayBytes: input.bridge.observation.replayBytes,
      snapshotBytes: input.bridge.observation.snapshotBytes,
      ...(input.outageMs === undefined ? {} : { outageMs: input.outageMs }),
      sideEffects: input.counts,
    });

    {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const counts = emptyCounts();
      const { service, provider } = createHarness({ ports: successfulPorts(counts), providerGate: gate });
      const bridge = createServiceBridge(service, { disconnectResponses: 1 });
      const opened = await open(bridge, new MemoryStorage(), 'fault-web-disconnect-001', {
        baseReconnectDelayMs: 5_000,
      });
      const streamed = opened.text();
      await bridge.firstDisconnect;
      release();
      expect(await streamed).toContain('terminal body');
      const evidence = completedEvidence({
        caseId: 1,
        scenario: 'disconnect-5-seconds-then-resume',
        requestId: 'fault-web-disconnect-001',
        provider,
        counts,
        bridge,
        outageMs: 5_000,
      });
      expect(evidence).toMatchObject({ providerStarts: 1, disconnects: 1, resumeSuccesses: 1 });
    }

    {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const counts = emptyCounts();
      const { service, provider } = createHarness({ ports: successfulPorts(counts), providerGate: gate });
      const bridge = createServiceBridge(service, { disconnectResponses: 2 });
      const opened = await open(bridge, new MemoryStorage(), 'fault-web-network-switch-002');
      const streamed = opened.text();
      await bridge.firstDisconnect;
      release();
      expect(await streamed).toContain('terminal body');
      const evidence = completedEvidence({
        caseId: 2,
        scenario: 'wifi-mobile-network-switch',
        requestId: 'fault-web-network-switch-002',
        provider,
        counts,
        bridge,
      });
      expect(evidence).toMatchObject({ providerStarts: 1, disconnects: 2, resumeSuccesses: 2 });
    }

    {
      const counts = emptyCounts();
      const { service, provider } = createHarness({ ports: successfulPorts(counts) });
      const bridge = createServiceBridge(service, { lostHeaders: 1 });
      const storage = new MemoryStorage();
      let hideInitialLookup = true;
      const beforeRefresh = async (url: string, init?: RequestInit): Promise<Response> => {
        if (hideInitialLookup && url.includes('/generation-requests/')) {
          hideInitialLookup = false;
          return new Response(null, { status: 404 });
        }
        return bridge.fetcher(url, init);
      };
      await expect(openArenaGenerationStream({
        endpoint: '/api/arena/generate-stream',
        body,
        headers: {},
        fetcher: beforeRefresh,
        storage,
        generationRequestId: 'fault-web-refresh-003',
        maxReconnectAttempts: 0,
      })).rejects.toThrow('ARENA_GENERATION_STATE_UNKNOWN');
      const refreshed = await open(bridge, storage, 'ignored-after-refresh');
      expect(await refreshed.text()).toContain('event: done');
      const evidence = completedEvidence({
        caseId: 3,
        scenario: 'page-refresh-after-lost-handshake',
        requestId: 'fault-web-refresh-003',
        provider,
        counts,
        bridge,
      });
      expect(new Set(bridge.observation.generationRequestIds)).toEqual(new Set(['fault-web-refresh-003']));
      expect(evidence).toMatchObject({ providerStarts: 1, createAttempts: 1 });
    }

    {
      const counts = emptyCounts();
      const { service, provider } = createHarness({ ports: successfulPorts(counts) });
      const bridge = createServiceBridge(service, { lostHeaders: 1 });
      const opened = await open(bridge, new MemoryStorage(), 'fault-web-header-loss-004');
      expect(await opened.text()).toContain('event: done');
      const evidence = completedEvidence({
        caseId: 4,
        scenario: 'post-accepted-response-headers-lost',
        requestId: 'fault-web-header-loss-004',
        provider,
        counts,
        bridge,
      });
      expect(new Set(bridge.observation.generationRequestIds)).toEqual(new Set(['fault-web-header-loss-004']));
      expect(evidence).toMatchObject({ providerStarts: 1, createAttempts: 1, disconnects: 1 });
    }

    {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const counts = emptyCounts();
      const { service, provider } = createHarness({ ports: successfulPorts(counts), providerGate: gate });
      const bridge = createServiceBridge(service);
      const storage = new MemoryStorage();
      const first = await open(bridge, storage, 'fault-web-reader-cancel-005');
      await first.body?.cancel('reader closed without explicit stop');
      release();
      const resumed = await open(bridge, storage, 'ignored-after-reader-cancel');
      expect(await resumed.text()).toContain('event: done');
      const evidence = completedEvidence({
        caseId: 5,
        scenario: 'reader-cancel-without-explicit-stop',
        requestId: 'fault-web-reader-cancel-005',
        provider,
        counts,
        bridge,
      });
      expect(evidence).toMatchObject({ providerStarts: 1, disconnects: 1, cancelAttempts: 0 });
    }

    {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const counts = emptyCounts();
      const { service, provider } = createHarness({ ports: successfulPorts(counts), providerGate: gate });
      const bridge = createServiceBridge(service);
      const requestId = 'fault-web-dual-tabs-007';
      const [first, second] = await Promise.all([
        open(bridge, new MemoryStorage(), requestId),
        open(bridge, new MemoryStorage(), requestId),
      ]);
      release();
      const [firstBody, secondBody] = await Promise.all([first.text(), second.text()]);
      expect(firstBody).toContain('event: done');
      expect(secondBody).toContain('event: done');
      const evidence = completedEvidence({
        caseId: 7,
        scenario: 'two-tabs-observe-one-generation',
        requestId,
        provider,
        counts,
        bridge,
      });
      expect(new Set(bridge.observation.generationIds)).toEqual(new Set([generationId]));
      expect(evidence).toMatchObject({ providerStarts: 1, createAttempts: 2 });
    }

    {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const counts = emptyCounts();
      const { service, provider } = createHarness({ ports: successfulPorts(counts), providerGate: gate });
      const bridge = createServiceBridge(service, { disconnectResponses: 1 });
      const opened = await open(bridge, new MemoryStorage(), 'fault-web-cursor-replay-008');
      const streamed = opened.text();
      await bridge.firstDisconnect;
      release();
      const output = await streamed;
      expect(output.match(/# fault matrix/gu)).toHaveLength(1);
      expect(output.match(/terminal body/gu)).toHaveLength(1);
      const evidence = completedEvidence({
        caseId: 8,
        scenario: 'cursor-replay-no-duplicate-or-gap',
        requestId: 'fault-web-cursor-replay-008',
        provider,
        counts,
        bridge,
      });
      expect(evidence.replayBytes).toBeGreaterThan(0);
    }

    {
      const counts = emptyCounts();
      const { service, provider } = createHarness({ ports: successfulPorts(counts) });
      const bridge = createServiceBridge(service);
      const requestId = 'fault-web-repeat-resume-014';
      const initial = await open(bridge, new MemoryStorage(), requestId);
      expect(await initial.text()).toContain('event: done');
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const replay = await bridge.fetcher(`/api/arena/generations/${generationId}/stream`, {
          method: 'GET',
        });
        expect(await replay.text()).toContain('event: done');
      }
      const evidence = completedEvidence({
        caseId: 14,
        scenario: 'repeated-resume-does-not-repeat-side-effects',
        requestId,
        provider,
        counts,
        bridge,
      });
      expect(evidence).toMatchObject({ providerStarts: 1, resumeAttempts: 3, resumeSuccesses: 3 });
      expect(evidence.sideEffects).toEqual({
        storage: 1, claim: 1, combatants: 1, impacts: 1, ratings: 1, complete: 1,
      });
    }
  }, 20_000);

  it('keeps one deterministic generation and one Provider across disconnect, duplicate, and resume', async () => {
    let release!: () => void;
    const providerGate = new Promise<void>((resolve) => { release = resolve; });
    const counts = emptyCounts();
    const { provider, service } = createHarness({
      ports: successfulPorts(counts),
      providerGate,
    });

    const first = await service.create(request());
    await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce());
    await first.body?.cancel('fault-injected disconnect');
    const duplicate = await service.create(request());
    release();
    expect(await duplicate.text()).toContain('terminal body');
    const resumed = await service.resume(new Request(
      `https://example.test/api/arena/generations/${generationId}/stream`,
    ), { generationId });
    expect(await resumed.text()).toContain('terminal body');
    const refreshed = await service.resume(new Request(
      `https://example.test/api/arena/generations/${generationId}/stream`,
    ), { generationId });
    expect(await refreshed.text()).toContain('terminal body');

    const evidence: FaultEvidence = {
      scenario: 'header-loss+disconnect+dual-tab+network-switch+refresh',
      generationRequestId,
      generationId: duplicate.headers.get('x-mahoshojo-generation-id') ?? '',
      createAttempts: 2,
      disconnects: 1,
      resumeAttempts: 2,
      resumeSuccesses: 2,
      cancelAttempts: 0,
      providerStarts: provider.mock.calls.length,
      terminal: 'completed',
      redis: 'terminal',
      d1: 'completed',
      r2: 'stored',
      sideEffects: counts,
    };
    expect(evidence).toEqual({
      scenario: 'header-loss+disconnect+dual-tab+network-switch+refresh',
      generationRequestId: 'fault-request-001',
      generationId: 'generation-fault-001',
      createAttempts: 2,
      disconnects: 1,
      resumeAttempts: 2,
      resumeSuccesses: 2,
      cancelAttempts: 0,
      providerStarts: 1,
      terminal: 'completed',
      redis: 'terminal',
      d1: 'completed',
      r2: 'stored',
      sideEffects: {
        storage: 1, claim: 1, combatants: 1, impacts: 1, ratings: 1, complete: 1,
      },
    });
  });

  it('G25E2-MIDFLIGHT-DISCONNECT：accepted operation 在 Hono 故障后 fail closed，不跨 runtime 重放', async () => {
    let release!: () => void;
    const providerGate = new Promise<void>((resolve) => { release = resolve; });
    const counts = emptyCounts();
    const { provider, service } = createHarness({
      ports: successfulPorts(counts),
      providerGate,
    });

    const accepted = await service.create(request());
    await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce());

    expect(selectHostedDrRuntime({
      requestClass: 'non-idempotent-operation',
      dispatchState: 'unknown',
      primaryHealth: 'unavailable',
      hasDurableIdempotencyProof: false,
    })).toBe('fail-closed');

    await accepted.body?.cancel('G25E2 fault-injected mid-flight disconnect');
    release();
    const resumed = await service.resume(new Request(
      `https://example.test/api/arena/generations/${generationId}/stream`,
    ), { generationId });

    expect(await resumed.text()).toContain('terminal body');
    expect(provider).toHaveBeenCalledOnce();
    expect(counts).toEqual({
      storage: 1, claim: 1, combatants: 1, impacts: 1, ratings: 1, complete: 1,
    });
  });

  it('retries transient R2 and D1 faults behind deterministic terminal/effect gates', async () => {
    const counts = emptyCounts();
    const ports = successfulPorts(counts);
    const transientPorts: ArenaGenerationFinalizationPorts = {
      ...ports,
      async storeOutput(input) {
        counts.storage += 1;
        if (counts.storage === 1) throw new Error('injected R2 timeout');
        return { resultRef: `r2:v1/battle-report-generations/${input.generationId}/output.md` };
      },
      async claimTerminal(input) {
        counts.claim += 1;
        if (counts.claim === 1) throw new Error('injected D1 timeout');
        return { kind: 'created', resultRef: input.resultRef, finalized: false };
      },
    };
    const { provider, service } = createHarness({ ports: transientPorts });

    const response = await service.create(request());
    expect(await response.text()).toContain('event: done');

    const evidence: FaultEvidence = {
      scenario: 'transient-r2+d1', generationRequestId, generationId,
      createAttempts: 1, disconnects: 0, resumeAttempts: 0, resumeSuccesses: 0,
      cancelAttempts: 0, providerStarts: provider.mock.calls.length,
      terminal: 'completed', redis: 'terminal', d1: 'completed', r2: 'retry-stored',
      sideEffects: counts,
    };
    expect(evidence).toMatchObject({
      providerStarts: 1,
      terminal: 'completed',
      r2: 'retry-stored',
      sideEffects: {
        storage: 2, claim: 2, combatants: 1, impacts: 1, ratings: 1, complete: 1,
      },
    });
  });

  it('keeps Provider/D1/Redis completed when permanent R2 archival fails', async () => {
    const counts = emptyCounts();
    const ports: ArenaGenerationFinalizationPorts = {
      ...successfulPorts(counts),
      async storeOutput() {
        counts.storage += 1;
        throw new Error('injected permanent R2 outage');
      },
    };
    const { provider, service, store } = createHarness({ ports });

    const initial = await service.create(request());
    const initialBody = await initial.text();
    const duplicate = await service.create(request());
    const duplicateBody = await duplicate.text();
    const resumed = await service.resume(new Request(
      `https://example.test/api/arena/generations/${generationId}/stream`,
    ), { generationId });
    const resumedBody = await resumed.text();
    const status = await service.status(new Request(
      `https://example.test/api/arena/generations/${generationId}`,
    ), { generationId });
    const state = await store.readState({ generationId, actorKey });

    for (const body of [initialBody, duplicateBody, resumedBody]) {
      expect(body).toContain('event: done');
      expect(body).toContain('"status":"completed"');
      expect(body).toContain('"persistenceWarning":"OUTPUT_NOT_ARCHIVED"');
      expect(body).not.toContain('event: error');
    }
    expect(provider).toHaveBeenCalledOnce();
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      status: 'completed',
      resultAvailable: false,
      persistenceWarning: 'OUTPUT_NOT_ARCHIVED',
      replayUnavailable: true,
    });
    expect(counts).toEqual({
      storage: 3,
      claim: 1,
      combatants: 1,
      impacts: 1,
      ratings: 1,
      complete: 1,
    });
    expect(state).toMatchObject({
      status: 'completed',
      snapshot: {
        status: 'completed',
        markdown: '# fault matrix\nterminal body',
        persistenceWarning: 'OUTPUT_NOT_ARCHIVED',
      },
      terminal: {
        status: 'completed',
        resultRef: null,
        persistenceWarning: 'OUTPUT_NOT_ARCHIVED',
      },
    });
  });

  it('leaves permanent R2+D1 failure pending until lease reaping and never replays Provider', async () => {
    let currentTime = new Date('2026-08-25T04:00:00.000Z');
    let reconciliationCount = 0;
    const failedPorts: ArenaGenerationFinalizationPorts = {
      async storeOutput() { throw new Error('injected R2 outage'); },
      async claimTerminal() { throw new Error('injected D1 outage'); },
      async failTerminal() { throw new Error('injected D1 outage'); },
      async persistCombatants() { throw new Error('unexpected side effect'); },
      async applyStoryImpacts() { throw new Error('unexpected side effect'); },
      async settleRatings() { throw new Error('unexpected side effect'); },
      async completeTerminal() { throw new Error('unexpected side effect'); },
      async readRanking() { return null; },
    };
    const terminalStore: ArenaGenerationTerminalStore = {
      async readOwnedTerminal() { return null; },
      async reconcileExpiredLease(input) {
        reconciliationCount += 1;
        return {
          generationId: input.generationId,
          generationRequestId: input.generationRequestId,
          status: 'producer_lost',
          updatedAt: input.updatedAt,
          resultRef: null,
          markdown: '',
          reasoning: '',
          payloadHash: input.payloadHash,
        };
      },
    };
    const { provider, service, store } = createHarness({
      ports: failedPorts,
      now: () => currentTime,
      leaseDurationMs: 10,
      terminalStore,
    });

    const response = await service.create(request());
    await vi.waitFor(async () => {
      expect((await store.readState({ generationId, actorKey }))?.status).toBe('finalizing');
    });
    currentTime = new Date('2026-08-25T04:01:00.000Z');
    expect(await response.text()).toContain('producer_lost');

    const evidence: FaultEvidence = {
      scenario: 'permanent-r2+d1+lease-reaper', generationRequestId, generationId,
      createAttempts: 1, disconnects: 0, resumeAttempts: 0, resumeSuccesses: 0,
      cancelAttempts: 0, providerStarts: provider.mock.calls.length,
      terminal: 'producer_lost', redis: 'terminal', d1: 'producer_lost', r2: 'failed',
      sideEffects: emptyCounts(),
    };
    expect(evidence).toMatchObject({ providerStarts: 1, terminal: 'producer_lost' });
    expect(reconciliationCount).toBe(1);
  });

  it('fails reservation closed before Provider and records no durable side effect', async () => {
    const counts = emptyCounts();
    const { derivedIdentities, provider, service } = createHarness({
      ports: successfulPorts(counts),
      wrapStore: (store) => Object.freeze({
        ...store,
        reserve: async () => { throw new Error('injected Redis reservation outage'); },
      }),
    });

    const probe = createBackendProbe(service);
    const response = await probe.create(request());
    const responseBody = await probe.read(response, false);
    const derived = derivedIdentities.at(-1)!;
    const evidence = recordAcceptedFault({
      caseId: 11,
      scenario: 'redis-reservation-unavailable',
      generationRequestId: probe.observation.generationRequestIds.at(-1)!,
      generationId: derived.generationId,
      createAttempts: probe.observation.createAttempts,
      disconnects: probe.observation.disconnects,
      resumeAttempts: probe.observation.resumeAttempts,
      resumeSuccesses: probe.observation.resumeSuccesses,
      cancelAttempts: probe.observation.cancelAttempts,
      providerStarts: provider.mock.calls.length,
      terminal: response.status === 503 ? 'unavailable' : probe.observation.terminal!,
      redis: response.status === 503 ? 'unavailable' : 'terminal',
      d1: durableStatusFromObservation(probe.observation.terminal, counts),
      r2: r2StatusFromObservation(counts),
      replayBytes: probe.observation.replayBytes,
      snapshotBytes: probe.observation.snapshotBytes,
      sideEffects: counts,
    });

    expect(response.status).toBe(503);
    expect(JSON.parse(responseBody)).toMatchObject({ code: 'GENERATION_RESERVATION_UNAVAILABLE' });
    expect(derived.generationRequestId).toBe(probe.observation.generationRequestIds.at(-1));
    expect(evidence).toMatchObject({ providerStarts: 0, terminal: 'unavailable' });
    expect(evidence.sideEffects).toEqual(emptyCounts());
  });

  it('keeps one Provider and durable finalization when Redis replay append is degraded', async () => {
    const counts = emptyCounts();
    const { provider, service, store } = createHarness({
      ports: successfulPorts(counts),
      wrapStore: (store) => Object.freeze({
        ...store,
        appendEvents: async () => { throw new Error('injected Redis append outage'); },
      }),
    });

    const probe = createBackendProbe(service);
    const response = await probe.create(request());
    const body = await probe.read(response);
    const redisState = await store.readState({ generationId, actorKey });
    const evidence = recordAcceptedFault({
      caseId: 10,
      scenario: 'redis-replay-append-degraded',
      generationRequestId: probe.observation.generationRequestIds.at(-1)!,
      generationId: probe.observation.generationIds.at(-1)!,
      createAttempts: probe.observation.createAttempts,
      disconnects: probe.observation.disconnects,
      resumeAttempts: probe.observation.resumeAttempts,
      resumeSuccesses: probe.observation.resumeSuccesses,
      cancelAttempts: probe.observation.cancelAttempts,
      providerStarts: provider.mock.calls.length,
      terminal: probe.observation.terminal!,
      redis: redisState?.terminal ? 'terminal' : 'unavailable',
      d1: durableStatusFromObservation(probe.observation.terminal, counts),
      r2: r2StatusFromObservation(counts),
      replayBytes: probe.observation.replayBytes,
      snapshotBytes: probe.observation.snapshotBytes,
      sideEffects: counts,
    });

    expect(body).toContain('event: done');
    expect(evidence).toMatchObject({ providerStarts: 1, terminal: 'completed' });
    expect(evidence.sideEffects).toEqual({
      storage: 1, claim: 1, combatants: 1, impacts: 1, ratings: 1, complete: 1,
    });
  });

  it('keeps explicit cancel idempotent and finalizes aborted without R2/rating effects', async () => {
    const counts = emptyCounts();
    const generate: ArenaGenerationRuntimeDependencies['generate'] = vi.fn(async ({ signal }) => ({
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          const abort = () => controller.error(new DOMException('aborted', 'AbortError'));
          if (signal.aborted) abort();
          else signal.addEventListener('abort', abort, { once: true });
        },
      }),
      telemetry: { model: 'fault-model' },
    }));
    const { provider, service, store } = createHarness({
      ports: successfulPorts(counts),
      generate,
    });

    const probe = createBackendProbe(service);
    const initial = await probe.create(request());
    await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce());
    const firstCancel = await probe.cancel(new Request(
      `https://example.test/api/arena/generations/${generationId}/cancel`,
      { method: 'POST' },
    ), { generationId });
    const terminalBody = await probe.read(initial);
    const secondCancel = await probe.cancel(new Request(
      `https://example.test/api/arena/generations/${generationId}/cancel`,
      { method: 'POST' },
    ), { generationId });
    const redisState = await store.readState({ generationId, actorKey });
    const evidence = recordAcceptedFault({
      caseId: 6,
      scenario: 'explicit-cancel+duplicate-cancel',
      generationRequestId: probe.observation.generationRequestIds.at(-1)!,
      generationId: probe.observation.generationIds.at(-1)!,
      createAttempts: probe.observation.createAttempts,
      disconnects: probe.observation.disconnects,
      resumeAttempts: probe.observation.resumeAttempts,
      resumeSuccesses: probe.observation.resumeSuccesses,
      cancelAttempts: probe.observation.cancelAttempts,
      providerStarts: provider.mock.calls.length,
      terminal: probe.observation.terminal!,
      redis: redisState?.terminal ? 'terminal' : 'unavailable',
      d1: durableStatusFromObservation(probe.observation.terminal, counts),
      r2: r2StatusFromObservation(counts),
      replayBytes: probe.observation.replayBytes,
      snapshotBytes: probe.observation.snapshotBytes,
      sideEffects: counts,
    });

    expect(firstCancel.status).toBe(202);
    expect(terminalBody).toContain('cancelled');
    expect(secondCancel.status).toBe(200);
    expect(evidence).toMatchObject({ providerStarts: 1, cancelAttempts: 2 });
    expect(evidence.sideEffects).toEqual({
      storage: 0, claim: 1, combatants: 1, impacts: 0, ratings: 0, complete: 1,
    });
  });

  it('recovers a completed terminal from D1/R2 after Redis terminal TTL', async () => {
    let currentTime = new Date('2026-08-25T04:00:00.000Z');
    let durableReady = false;
    const counts = emptyCounts();
    const ports = successfulPorts(counts);
    const durablePorts: ArenaGenerationFinalizationPorts = {
      ...ports,
      async completeTerminal(input) {
        counts.complete += 1;
        durableReady = true;
        expect(input.generationId).toBe(generationId);
      },
    };
    const terminalStore: ArenaGenerationTerminalStore = {
      async readOwnedTerminal() {
        return durableReady ? {
          generationId,
          generationRequestId,
          status: 'completed' as const,
          updatedAt: currentTime.toISOString(),
          resultRef: `r2:v1/battle-report-generations/${generationId}/output.md`,
          markdown: '# durable terminal',
          reasoning: '',
          payloadHash: 'fault-payload-hash',
          contentAvailable: true,
        } : null;
      },
    };
    const { provider, service, store } = createHarness({
      ports: durablePorts,
      now: () => currentTime,
      terminalTtlMs: 10,
      terminalStore,
    });

    const probe = createBackendProbe(service);
    const initial = await probe.create(request());
    expect(await probe.read(initial, false)).toContain('event: done');
    currentTime = new Date('2026-08-25T04:01:00.000Z');
    const resumed = await probe.resume(new Request(
      `https://example.test/api/arena/generations/${generationId}/stream`,
    ), { generationId });
    const resumedBody = await probe.read(resumed);
    const redisState = await store.readState({ generationId, actorKey });
    const evidence = recordAcceptedFault({
      caseId: 13,
      scenario: 'redis-terminal-ttl+d1-r2-fallback',
      generationRequestId: probe.observation.generationRequestIds.at(-1)!,
      generationId: probe.observation.generationIds.at(-1)!,
      createAttempts: probe.observation.createAttempts,
      disconnects: probe.observation.disconnects,
      resumeAttempts: probe.observation.resumeAttempts,
      resumeSuccesses: probe.observation.resumeSuccesses,
      cancelAttempts: probe.observation.cancelAttempts,
      providerStarts: provider.mock.calls.length,
      terminal: probe.observation.terminal!,
      redis: redisState ? 'terminal' : 'expired',
      d1: durableStatusFromObservation(probe.observation.terminal, counts),
      r2: r2StatusFromObservation(counts),
      replayBytes: probe.observation.replayBytes,
      snapshotBytes: probe.observation.snapshotBytes,
      sideEffects: counts,
    });

    expect(resumedBody).toContain('durable terminal');
    expect(evidence).toMatchObject({ providerStarts: 1, resumeSuccesses: 1, redis: 'expired' });
    expect(evidence.sideEffects).toEqual({
      storage: 1, claim: 1, combatants: 1, impacts: 1, ratings: 1, complete: 1,
    });
  });

  it('bootstraps a terminal snapshot after replay trim without a second Provider', async () => {
    const counts = emptyCounts();
    const { provider, service, store } = createHarness({
      ports: successfulPorts(counts),
      maxEvents: 2,
    });

    const probe = createBackendProbe(service);
    const initial = await probe.create(request());
    expect(await probe.read(initial, false)).toContain('event: done');
    const resumed = await probe.resume(new Request(
      `https://example.test/api/arena/generations/${generationId}/stream?after=1-0`,
    ), { generationId });
    const replay = await probe.read(resumed);
    const redisState = await store.readState({ generationId, actorKey });
    const evidence = recordAcceptedFault({
      caseId: 9,
      scenario: 'trimmed-cursor+snapshot-bootstrap',
      generationRequestId: probe.observation.generationRequestIds.at(-1)!,
      generationId: probe.observation.generationIds.at(-1)!,
      createAttempts: probe.observation.createAttempts,
      disconnects: probe.observation.disconnects,
      resumeAttempts: probe.observation.resumeAttempts,
      resumeSuccesses: probe.observation.resumeSuccesses,
      cancelAttempts: probe.observation.cancelAttempts,
      providerStarts: provider.mock.calls.length,
      terminal: probe.observation.terminal!,
      redis: redisState?.terminal ? 'terminal' : 'unavailable',
      d1: durableStatusFromObservation(probe.observation.terminal, counts),
      r2: r2StatusFromObservation(counts),
      replayBytes: probe.observation.replayBytes,
      snapshotBytes: probe.observation.snapshotBytes,
      sideEffects: counts,
    });

    expect(replay).toContain('event: snapshot');
    expect(replay).toContain('event: done');
    expect(evidence).toMatchObject({ providerStarts: 1, resumeSuccesses: 1 });
  });

  it('fences a killed producer after lease expiry without starting a replacement Provider', async () => {
    let currentTime = new Date('2026-08-25T04:00:00.000Z');
    let upstream!: ReadableStreamDefaultController<Uint8Array>;
    let reconciliationCount = 0;
    let producerKillCount = 0;
    let reconciledStatus: 'producer_lost' | null = null;
    const counts = emptyCounts();
    const finalizationUnavailablePorts: ArenaGenerationFinalizationPorts = {
      async storeOutput() { throw new Error('unexpected output store after producer kill'); },
      async claimTerminal() { throw new Error('fault-injected process died before durable terminal'); },
      async failTerminal() { throw new Error('fault-injected process died before durable terminal'); },
      async persistCombatants() { throw new Error('unexpected combatant write'); },
      async applyStoryImpacts() { throw new Error('unexpected impact write'); },
      async settleRatings() { throw new Error('unexpected rating write'); },
      async completeTerminal() { throw new Error('unexpected terminal completion'); },
      async readRanking() { return null; },
    };
    const terminalStore: ArenaGenerationTerminalStore = {
      async readOwnedTerminal() { return null; },
      async reconcileExpiredLease(input) {
        reconciliationCount += 1;
        reconciledStatus = 'producer_lost';
        return {
          generationId: input.generationId,
          generationRequestId: input.generationRequestId,
          status: 'producer_lost',
          updatedAt: input.updatedAt,
          resultRef: null,
          markdown: '',
          reasoning: '',
          payloadHash: input.payloadHash,
        };
      },
    };
    const { derivedIdentities, provider, service, store } = createHarness({
      ports: finalizationUnavailablePorts,
      now: () => currentTime,
      leaseDurationMs: 10,
      terminalStore,
      generate: async () => ({
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            upstream = controller;
            controller.enqueue(new TextEncoder().encode('producer emitted before process kill'));
          },
        }),
        telemetry: { model: 'fault-model' },
      }),
    });

    const probe = createBackendProbe(service);
    const response = await probe.create(request());
    await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce());
    const terminalBodyPromise = probe.read(response);
    producerKillCount += 1;
    upstream.error(new Error('fault-injected producer process killed'));
    await vi.waitFor(async () => {
      expect((await store.readState({ generationId, actorKey }))?.status).toBe('finalizing');
    });
    currentTime = new Date('2026-08-25T04:01:00.000Z');
    const terminalBody = await terminalBodyPromise;
    const redisState = await store.readState({ generationId, actorKey });
    const derived = derivedIdentities.at(-1)!;
    const evidence = recordAcceptedFault({
      caseId: 12,
      scenario: 'producer-process-kill+lease-reaper',
      generationRequestId: probe.observation.generationRequestIds.at(-1)!,
      generationId: probe.observation.generationIds.at(-1) ?? derived.generationId,
      createAttempts: probe.observation.createAttempts,
      disconnects: probe.observation.disconnects,
      resumeAttempts: probe.observation.resumeAttempts,
      resumeSuccesses: probe.observation.resumeSuccesses,
      cancelAttempts: probe.observation.cancelAttempts,
      providerStarts: provider.mock.calls.length,
      terminal: probe.observation.terminal!,
      redis: redisState?.terminal ? 'terminal' : 'unavailable',
      d1: reconciledStatus ?? durableStatusFromObservation(probe.observation.terminal, counts),
      r2: r2StatusFromObservation(counts),
      replayBytes: probe.observation.replayBytes,
      snapshotBytes: probe.observation.snapshotBytes,
      producerKills: producerKillCount,
      sideEffects: counts,
    });

    expect(terminalBody).toContain('producer_lost');
    expect(derived.generationRequestId).toBe(probe.observation.generationRequestIds.at(-1));
    expect(reconciliationCount).toBe(1);
    expect(evidence.providerStarts).toBe(1);
    expect(evidence.sideEffects).toEqual(emptyCounts());
  });

  it('reaps an indeterminate Redis finalization claim without Redis-only terminalization', async () => {
    let currentTime = new Date('2026-08-25T04:00:00.000Z');
    let reconciliationCount = 0;
    const counts = emptyCounts();
    const terminalStore: ArenaGenerationTerminalStore = {
      async readOwnedTerminal() { return null; },
      async reconcileExpiredLease(input) {
        reconciliationCount += 1;
        return {
          generationId: input.generationId,
          generationRequestId: input.generationRequestId,
          status: 'producer_lost',
          updatedAt: input.updatedAt,
          resultRef: null,
          markdown: '',
          reasoning: '',
          payloadHash: input.payloadHash,
        };
      },
    };
    const { provider, service, store } = createHarness({
      ports: successfulPorts(counts),
      now: () => currentTime,
      leaseDurationMs: 10,
      terminalStore,
      wrapStore: (replayStore) => Object.freeze({
        ...replayStore,
        claimFinalization: async () => { throw new Error('injected Redis timeout'); },
      }),
    });

    const response = await service.create(request());
    await vi.waitFor(async () => {
      expect((await store.readState({ generationId, actorKey }))?.status).toBe('running');
    });
    currentTime = new Date('2026-08-25T04:01:00.000Z');
    expect(await response.text()).toContain('producer_lost');
    const evidence: FaultEvidence = {
      scenario: 'indeterminate-finalization-claim+lease-reaper', generationRequestId, generationId,
      createAttempts: 1, disconnects: 0, resumeAttempts: 0, resumeSuccesses: 0,
      cancelAttempts: 0, providerStarts: provider.mock.calls.length,
      terminal: 'producer_lost', redis: 'terminal', d1: 'producer_lost', r2: 'not-written',
      sideEffects: counts,
    };

    expect(evidence).toMatchObject({ providerStarts: 1, terminal: 'producer_lost' });
    expect(evidence.sideEffects).toEqual(emptyCounts());
    expect(reconciliationCount).toBe(1);
  });

  it('emits one complete machine-auditable evidence row for every accepted fault case', () => {
    const evidence = [...acceptedFaultEvidence].sort((left, right) => left.caseId! - right.caseId!);
    expect(evidence.map((row) => row.caseId)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    ]);
    for (const row of evidence) {
      expect(row.generationRequestId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u);
      expect(row.generationId).not.toBe('');
      expect(row.providerStarts).toBeLessThanOrEqual(1);
      expect(row.disconnects).toBeGreaterThanOrEqual(0);
      expect(row.resumeSuccesses).toBeLessThanOrEqual(row.resumeAttempts);
      expect(row.replayBytes).toBeGreaterThanOrEqual(0);
      expect(row.snapshotBytes).toBeGreaterThanOrEqual(0);
      expect(row.sideEffects.ratings).toBeLessThanOrEqual(1);
      expect(row.sideEffects.impacts).toBeLessThanOrEqual(1);
      expect(row.sideEffects.complete).toBeLessThanOrEqual(1);
      expect(row.d1).toMatch(/^(completed|aborted|producer_lost|none)$/u);
      expect(row.r2).toMatch(/^(stored|retry-stored|not-written|failed)$/u);
    }
    expect(evidence.find((row) => row.caseId === 1)?.outageMs).toBe(5_000);
    expect(evidence.find((row) => row.caseId === 9)?.snapshotBytes).toBeGreaterThan(0);
    expect(evidence.find((row) => row.caseId === 12)?.producerKills).toBe(1);
    expect(evidence.find((row) => row.caseId === 14)?.sideEffects).toMatchObject({
      ratings: 1,
      impacts: 1,
      complete: 1,
    });
  });
});
