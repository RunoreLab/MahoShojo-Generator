import {
  compareGenerationSseIds,
  encodeGenerationSseEvent,
  resolveResumeCursor,
} from './sse';

export const MAX_ARENA_CREATE_BODY_BYTES = 12 * 1_024 * 1_024;
export const MAX_ARENA_CANCEL_BODY_BYTES = 1_024;

export class ArenaGenerationFinalizationPendingError extends Error {
  readonly originalError: unknown;

  constructor(originalError?: unknown) {
    super('ARENA_GENERATION_FINALIZATION_PENDING');
    this.name = 'ArenaGenerationFinalizationPendingError';
    this.originalError = originalError;
  }
}

const addSmallDecimal = (value: string, increment: 1 | 2): string => {
  const digits = value.split('');
  let carry: number = increment;
  for (let index = digits.length - 1; index >= 0 && carry > 0; index -= 1) {
    const sum = Number(digits[index]) + carry;
    digits[index] = String(sum % 10);
    carry = Math.floor(sum / 10);
  }
  return carry > 0 ? `${carry}${digits.join('')}` : digits.join('');
};

export type GenerationStatus =
  | 'reserved'
  | 'running'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'producer_lost';

export type GenerationEventInput = {
  type: string;
  data: unknown;
};

export type GenerationStreamEvent = GenerationEventInput & {
  id: string;
};

export type GenerationSnapshot = {
  status: GenerationStatus;
  markdown: string;
  reasoning: string;
  lastEventId: string | null;
  updatedAt: string;
  telemetry?: Record<string, unknown> | null;
  terminalResultRef?: string | null;
};

export type GenerationTerminal = {
  status: Extract<GenerationStatus, 'completed' | 'failed' | 'cancelled' | 'producer_lost'>;
  code?: string;
  resultRef?: string | null;
};

export type GenerationCancelReason = 'user' | 'content_policy';

export const isGenerationCancelReason = (value: unknown): value is GenerationCancelReason =>
  value === 'user' || value === 'content_policy';

export const generationCancelCode = (reason: GenerationCancelReason): string =>
  reason === 'content_policy' ? 'CONTENT_POLICY_CANCELLED' : 'USER_CANCELLED';

export type GenerationReplayStoreState = {
  actorKey: string;
  generationId: string;
  generationRequestId: string;
  payloadHash: string;
  mode?: string | null;
  producerToken: string;
  status: GenerationStatus;
  lastEventId: string | null;
  updatedAt: string;
  leaseExpiresAt: string | null;
  snapshot: GenerationSnapshot | null;
  terminal: GenerationTerminal | null;
  cancelRequested: boolean;
  cancelReason?: GenerationCancelReason | null;
};

export interface GenerationReplayStore {
  reserve(_input: {
    actorKey: string;
    generationRequestId: string;
    generationId: string;
    payloadHash: string;
    producerToken: string;
    now: string;
    leaseExpiresAt: string;
    mode?: string;
  }): Promise<
    | { kind: 'created'; generationId: string }
    | { kind: 'reused'; generationId: string }
    | { kind: 'conflict' }
  >;
  markRunning(_input: {
    generationId: string;
    producerToken: string;
    now: string;
    leaseExpiresAt: string;
  }): Promise<{
    owned: boolean;
    cancelRequested: boolean;
    cancelReason?: GenerationCancelReason | null;
  }>;
  claimFinalization(_input: {
    generationId: string;
    producerToken: string;
    now: string;
    leaseExpiresAt: string;
  }): Promise<ArenaGenerationFinalizationClaim>;
  claimLeaseExpiry(_input: {
    generationId: string;
    actorKey: string;
    reaperToken: string;
    now: string;
    leaseExpiresAt: string;
  }): Promise<
    | {
      kind: 'claimed';
      generationRequestId: string;
      payloadHash: string;
      mode: string | null;
    }
    | { kind: 'terminal'; status: GenerationTerminal['status'] }
    | { kind: 'not-expired' }
    | { kind: 'forbidden' }
    | { kind: 'not-found' }
  >;
  releaseReservation(_input: {
    generationId: string;
    producerToken: string;
  }): Promise<{ released: boolean }>;
  heartbeat(_input: {
    generationId: string;
    producerToken: string;
    now: string;
    leaseExpiresAt: string;
  }): Promise<{
    owned: boolean;
    cancelRequested: boolean;
    cancelReason?: GenerationCancelReason | null;
  }>;
  appendEvents(_input: {
    generationId: string;
    producerToken: string;
    events: GenerationEventInput[];
    now: string;
  }): Promise<{ owned: boolean; events: GenerationStreamEvent[] }>;
  writeSnapshot(_input: {
    generationId: string;
    producerToken: string;
    snapshot: GenerationSnapshot;
    now: string;
  }): Promise<{ owned: boolean }>;
  readSnapshot(_input: { generationId: string }): Promise<GenerationSnapshot | null>;
  readAfter(_input: {
    generationId: string;
    after: string | null;
    blockMs: number;
  }): Promise<
    | { kind: 'events'; events: GenerationStreamEvent[] }
    | { kind: 'window-lost'; events: GenerationStreamEvent[] }
    | { kind: 'stream-missing'; events: GenerationStreamEvent[] }
  >;
  markTerminal(_input: {
    generationId: string;
    producerToken: string;
    terminal: GenerationTerminal;
    now: string;
  }): Promise<{
    owned: boolean;
    applied: boolean;
    status?: GenerationTerminal['status'];
  }>;
  readState(_input: {
    generationId: string;
    actorKey?: string;
  }): Promise<GenerationReplayStoreState | null>;
  requestCancel(_input: {
    generationId: string;
    actorKey: string;
    reason: GenerationCancelReason;
    now: string;
  }): Promise<
    | { kind: 'accepted'; cancelReason: GenerationCancelReason }
    | { kind: 'finalizing' }
    | { kind: 'terminal'; status: GenerationTerminal['status'] }
    | { kind: 'forbidden' }
    | { kind: 'not-found' }
  >;
}

export type ArenaGenerationExecutionInput = {
  generationId: string;
  generationRequestId: string;
  actorKey: string;
  producerToken: string;
  payloadHash: string;
  payload: Record<string, unknown>;
  signal: AbortSignal;
  emit: (_event: GenerationEventInput) => Promise<void>;
  claimFinalization(_terminal: GenerationTerminal): Promise<ArenaGenerationFinalizationClaim>;
};

export type ArenaGenerationFinalizationClaim =
  | { kind: 'claimed' }
  | { kind: 'cancelled'; cancelReason?: GenerationCancelReason }
  | { kind: 'fenced' };

export type PreparedArenaGeneration = {
  executionPayload: Record<string, unknown>;
  semanticPayload: Record<string, unknown>;
  responseHeaders?: Readonly<Record<string, string>>;
};

export interface ArenaGenerationExecutor {
  prepare?(_input: {
    request: Request;
    actorKey: string;
    payload: Record<string, unknown>;
  }): Promise<PreparedArenaGeneration | Response>;
  execute(_input: ArenaGenerationExecutionInput): Promise<GenerationTerminal>;
}

export type ArenaGenerationTerminalRecord = {
  generationId: string;
  generationRequestId: string;
  status: GenerationTerminal['status'];
  updatedAt: string;
  resultRef: string | null;
  markdown: string;
  reasoning: string;
  payloadHash?: string | null;
  contentAvailable?: boolean;
};

export interface ArenaGenerationTerminalStore {
  readOwnedTerminal(_input: {
    generationId: string;
    actorKey: string;
  }): Promise<ArenaGenerationTerminalRecord | null>;
  inspectOwnedFinalization?(_input: {
    generationId: string;
    actorKey: string;
  }): Promise<
    | { kind: 'not-found' }
    | { kind: 'pending'; payloadHash: string | null }
    | { kind: 'terminal'; terminal: ArenaGenerationTerminalRecord }
  >;
  reconcileExpiredLease?(_input: {
    generationId: string;
    generationRequestId: string;
    actorKey: string;
    payloadHash: string;
    mode: string | null;
    updatedAt: string;
    code: string;
  }): Promise<ArenaGenerationTerminalRecord>;
}

export type ArenaGenerationObservation =
  | {
    event: 'request';
    generationId: string;
    outcome: 'created' | 'reused' | 'conflict' | 'unavailable';
    inputBytes: number;
  }
  | { event: 'client_disconnect'; generationId: string }
  | {
    event: 'resume';
    generationId: string;
    outcome: 'attempt' | 'success' | 'failure';
    latencyMs?: number;
    reason?: 'unauthorized' | 'not_found' | 'state_unavailable' | 'cursor_conflict' | 'unknown';
  }
  | {
    event: 'replay';
    generationId: string;
    events: number;
    bytes: number;
    snapshotBootstrap: boolean;
  }
  | {
    event: 'provider';
    generationId: string;
    outcome: 'started' | 'success' | 'failure' | 'cancelled';
    durationMs?: number;
  }
  | {
    event: 'phase';
    generationId?: string;
    phase: 'safety' | 'prompt' | 'finalization';
    outcome: 'success' | 'failure';
    durationMs: number;
  }
  | {
    event: 'storage';
    generationId: string;
    storage: 'r2';
    outcome: 'success' | 'failure';
    durationMs: number;
    bytes?: number;
  }
  | {
    event: 'cancel';
    generationId: string;
    reason: GenerationCancelReason;
    outcome: 'accepted' | 'terminal';
  }
  | { event: 'producer_lost'; generationId: string; reason: string }
  | { event: 'redis_degraded'; generationId: string; operation: string }
  | {
    event: 'terminal';
    generationId: string;
    status: GenerationTerminal['status'];
    code: string | null;
  };

export interface ArenaGenerationObserver {
  observeArenaGeneration(_observation: ArenaGenerationObservation): void;
}

export type ArenaGenerationActor = {
  actorKey: string;
  responseHeaders?: Readonly<Record<string, string>>;
};

export type ArenaGenerationServiceDependencies = {
  store: GenerationReplayStore;
  executor: ArenaGenerationExecutor;
  resolveActor(_request: Request): Promise<ArenaGenerationActor | null>;
  deriveGenerationId(_input: {
    actorKey: string;
    generationRequestId: string;
  }): Promise<string>;
  createProducerToken?(): string;
  hashPayload(_payload: Record<string, unknown>): Promise<string>;
  now(): Date;
  heartbeatIntervalMs?: number;
  leaseDurationMs?: number;
  replayPollMs?: number;
  deltaFlushIntervalMs?: number;
  deltaFlushBytes?: number;
  snapshotMaxBytes?: number;
  terminalStore?: ArenaGenerationTerminalStore;
  observer?: ArenaGenerationObserver;
};

export type ArenaGenerationRouteParams = {
  generationId: string;
};

export type ArenaGenerationRequestRouteParams = {
  generationRequestId: string;
};

export interface ArenaGenerationService {
  create(_request: Request): Promise<Response>;
  cancelRequest(_request: Request): Promise<Response>;
  lookup(
    _request: Request,
    _params: ArenaGenerationRequestRouteParams,
  ): Promise<Response>;
  resume(_request: Request, _params: ArenaGenerationRouteParams): Promise<Response>;
  status(_request: Request, _params: ArenaGenerationRouteParams): Promise<Response>;
  cancel(_request: Request, _params: ArenaGenerationRouteParams): Promise<Response>;
}

type ActiveProducer = {
  controller: AbortController;
  promise: Promise<void>;
};

const jsonResponse = (payload: unknown, status: number): Response => new Response(
  JSON.stringify(payload),
  {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  },
);

const withActorHeaders = (
  response: Response,
  actor: ArenaGenerationActor,
): Response => {
  if (!actor.responseHeaders || Object.keys(actor.responseHeaders).length === 0) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(actor.responseHeaders)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const isGenerationRequestId = (value: string): boolean => (
  /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(value)
);

const invalidCancelReasonResponse = (): Response => jsonResponse({
  code: 'GENERATION_CANCEL_REASON_INVALID',
  error: 'reason must be user or content_policy',
}, 400);

const cancelReasonFromPayload = (
  payload: unknown,
): GenerationCancelReason | Response => {
  if (payload === null || payload === undefined) return 'user';
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return invalidCancelReasonResponse();
  }
  const reason = (payload as Record<string, unknown>).reason;
  if (reason === undefined) return 'user';
  return isGenerationCancelReason(reason) ? reason : invalidCancelReasonResponse();
};

const readOptionalCancelPayload = async (
  request: Request,
): Promise<unknown | Response> => {
  const tooLarge = (): Response => jsonResponse({
    code: 'GENERATION_CANCEL_REQUEST_TOO_LARGE',
    error: 'Cancel request body exceeds the allowed size',
  }, 413);
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_ARENA_CANCEL_BODY_BYTES) {
    return tooLarge();
  }
  if (!request.body) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bodyBytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bodyBytes += next.value.byteLength;
      if (bodyBytes > MAX_ARENA_CANCEL_BODY_BYTES) {
        await reader.cancel('arena cancel body exceeds byte limit').catch(() => undefined);
        return tooLarge();
      }
      chunks.push(next.value);
    }
  } catch {
    return jsonResponse({ code: 'INVALID_JSON', error: 'Invalid JSON body' }, 400);
  } finally {
    reader.releaseLock();
  }
  if (bodyBytes === 0) return null;
  const body = new Uint8Array(bodyBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    return jsonResponse({ code: 'INVALID_JSON', error: 'Invalid JSON body' }, 400);
  }
};

const parseCreatePayload = async (
  request: Request,
): Promise<{ generationRequestId: string; payload: Record<string, unknown> } | Response> => {
  if (request.method !== 'POST') {
    return jsonResponse({ code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' }, 405);
  }

  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_ARENA_CREATE_BODY_BYTES) {
    return jsonResponse({
      code: 'ARENA_REQUEST_TOO_LARGE',
      error: '请求体超过允许的大小',
    }, 413);
  }

  let body: unknown;
  try {
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bodyBytes = 0;
    if (reader) {
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          bodyBytes += next.value.byteLength;
          if (bodyBytes > MAX_ARENA_CREATE_BODY_BYTES) {
            await reader.cancel('arena create body exceeds byte limit').catch(() => undefined);
            return jsonResponse({
              code: 'ARENA_REQUEST_TOO_LARGE',
              error: '请求体超过允许的大小',
            }, 413);
          }
          chunks.push(next.value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    const bodyBuffer = new Uint8Array(bodyBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bodyBuffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
    body = JSON.parse(new TextDecoder().decode(bodyBuffer));
  } catch {
    return jsonResponse({ code: 'INVALID_JSON', error: '请求体必须是 JSON' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonResponse({ code: 'INVALID_REQUEST', error: '请求体必须是对象' }, 400);
  }

  const payload = { ...(body as Record<string, unknown>) };
  const generationRequestId = typeof payload.generationRequestId === 'string'
    ? payload.generationRequestId.trim()
    : '';
  if (!isGenerationRequestId(generationRequestId)) {
    return jsonResponse({
      code: 'INVALID_GENERATION_REQUEST_ID',
      error: 'generationRequestId 无效',
    }, 400);
  }
  delete payload.generationRequestId;
  return { generationRequestId, payload };
};

const addLeaseDuration = (now: Date, durationMs: number): string => new Date(
  now.getTime() + durationMs,
).toISOString();

export const createArenaGenerationService = (
  dependencies: ArenaGenerationServiceDependencies,
): ArenaGenerationService => {
  const heartbeatIntervalMs = dependencies.heartbeatIntervalMs ?? 15_000;
  const leaseDurationMs = dependencies.leaseDurationMs ?? 45_000;
  const replayPollMs = dependencies.replayPollMs ?? 1_000;
  const deltaFlushIntervalMs = dependencies.deltaFlushIntervalMs ?? 75;
  const deltaFlushBytes = dependencies.deltaFlushBytes ?? 1_024;
  const snapshotMaxBytes = dependencies.snapshotMaxBytes ?? 2 * 1_024 * 1_024;
  const activeProducers = new Map<string, ActiveProducer>();
  const observe = (observation: ArenaGenerationObservation): void => {
    try {
      dependencies.observer?.observeArenaGeneration(observation);
    } catch {
      // Telemetry must never change generation behavior.
    }
  };
  const encodedBytes = (value: unknown): number => {
    try {
      return new TextEncoder().encode(JSON.stringify(value) ?? '').byteLength;
    } catch {
      return 0;
    }
  };

  if (!Number.isFinite(deltaFlushIntervalMs) || deltaFlushIntervalMs < 1) {
    throw new Error('deltaFlushIntervalMs 必须是正有限数字');
  }
  if (!Number.isFinite(deltaFlushBytes) || deltaFlushBytes < 1) {
    throw new Error('deltaFlushBytes 必须是正有限数字');
  }
  if (!Number.isFinite(snapshotMaxBytes) || snapshotMaxBytes < 1) {
    throw new Error('snapshotMaxBytes 必须是正有限数字');
  }

  const createReplayWriter = (
    generationId: string,
    producerToken: string,
    onOwnershipLost: () => void,
  ) => {
    const textEncoder = new TextEncoder();
    let markdown = '';
    let reasoning = '';
    let telemetry: Record<string, unknown> | null = null;
    let lastEventId: string | null = null;
    let pendingType: 'markdown' | 'reasoning' | null = null;
    let pendingChunks: string[] = [];
    let pendingBytes = 0;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let operation = Promise.resolve();

    const snapshot = (
      status: GenerationStatus,
      updatedAt: string,
      terminalResultRef: string | null = null,
    ): GenerationSnapshot => ({
      status,
      markdown,
      reasoning,
      lastEventId,
      updatedAt,
      telemetry,
      terminalResultRef,
    });

    const writeSnapshot = async (
      status: GenerationStatus,
      now: string,
      terminalResultRef: string | null = null,
    ): Promise<void> => {
      const nextSnapshot = snapshot(status, now, terminalResultRef);
      if (encodedBytes(nextSnapshot) > snapshotMaxBytes) {
        observe({ event: 'redis_degraded', generationId, operation: 'snapshot_budget' });
        return;
      }
      try {
        const result = await dependencies.store.writeSnapshot({
          generationId,
          producerToken,
          snapshot: nextSnapshot,
          now,
        });
        if (!result.owned) {
          onOwnershipLost();
          throw new Error('GENERATION_PRODUCER_FENCED');
        }
      } catch {
        observe({ event: 'redis_degraded', generationId, operation: 'write_snapshot' });
      }
    };

    const append = async (events: GenerationEventInput[], now: string): Promise<void> => {
      let result: Awaited<ReturnType<GenerationReplayStore['appendEvents']>> | null = null;
      try {
        result = await dependencies.store.appendEvents({
          generationId,
          producerToken,
          events,
          now,
        });
        if (!result.owned) {
          onOwnershipLost();
          throw new Error('GENERATION_PRODUCER_FENCED');
        }
      } catch {
        observe({ event: 'redis_degraded', generationId, operation: 'append_events' });
      }
      lastEventId = result?.events.at(-1)?.id ?? lastEventId;
      await writeSnapshot('running', now);
    };

    const flushPending = async (): Promise<void> => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (!pendingType || pendingChunks.length === 0) return;
      const type = pendingType;
      const chunk = pendingChunks.join('');
      pendingType = null;
      pendingChunks = [];
      pendingBytes = 0;
      if (type === 'markdown') markdown += chunk;
      else reasoning += chunk;
      await append([{ type, data: { chunk } }], dependencies.now().toISOString());
    };

    const enqueue = (task: () => Promise<void>): Promise<void> => {
      operation = operation.then(task, task);
      return operation;
    };

    const scheduleFlush = (): void => {
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void enqueue(flushPending);
      }, deltaFlushIntervalMs);
      flushTimer.unref?.();
    };

    return Object.freeze({
      emit(event: GenerationEventInput): Promise<void> {
        return enqueue(async () => {
          const isDelta = event.type === 'markdown' || event.type === 'reasoning';
          const chunk = isDelta
            && event.data
            && typeof event.data === 'object'
            && typeof (event.data as { chunk?: unknown }).chunk === 'string'
            ? (event.data as { chunk: string }).chunk
            : null;
          if (!isDelta || chunk === null) {
            await flushPending();
            if (
              event.type === 'telemetry'
              && event.data
              && typeof event.data === 'object'
              && !Array.isArray(event.data)
            ) {
              telemetry = { ...(event.data as Record<string, unknown>) };
            }
            await append([event], dependencies.now().toISOString());
            return;
          }

          if (pendingType && pendingType !== event.type) await flushPending();
          pendingType = event.type as 'markdown' | 'reasoning';
          pendingChunks.push(chunk);
          pendingBytes += textEncoder.encode(chunk).byteLength;
          if (pendingBytes >= deltaFlushBytes) await flushPending();
          else scheduleFlush();
        });
      },

      finish(terminal: GenerationTerminal): Promise<void> {
        return enqueue(async () => {
          await flushPending();
          const now = dependencies.now().toISOString();
          await append([{
            type: terminal.status === 'failed' || terminal.status === 'producer_lost'
              ? 'error'
              : 'done',
            data: {
              ok: terminal.status === 'completed',
              status: terminal.status,
              ...(terminal.code ? { code: terminal.code } : {}),
            },
          }], now);
          await dependencies.store.markTerminal({
            generationId,
            producerToken,
            terminal,
            now,
          }).catch(() => ({ owned: true, applied: false }));
          await writeSnapshot(terminal.status, now, terminal.resultRef ?? null);
          observe({
            event: 'terminal',
            generationId,
            status: terminal.status,
            code: terminal.code ?? null,
          });
        });
      },
    });
  };

  const readOwnedTerminal = async (
    generationId: string,
    actorKey: string,
  ): Promise<ArenaGenerationTerminalRecord | null> => {
    return dependencies.terminalStore?.readOwnedTerminal({
      generationId,
      actorKey,
    }) ?? null;
  };

  const inspectOwnedFinalization = async (
    generationId: string,
    actorKey: string,
  ): Promise<
    | { kind: 'not-found' }
    | { kind: 'pending'; payloadHash: string | null }
    | { kind: 'terminal'; terminal: ArenaGenerationTerminalRecord }
  > => {
    if (dependencies.terminalStore?.inspectOwnedFinalization) {
      return dependencies.terminalStore.inspectOwnedFinalization({ generationId, actorKey });
    }
    const terminal = await readOwnedTerminal(generationId, actorKey);
    return terminal ? { kind: 'terminal', terminal } : { kind: 'not-found' };
  };

  const reconcileOwnedActiveState = async (
    actor: ArenaGenerationActor,
    state: GenerationReplayStoreState,
  ): Promise<{
    actor: ArenaGenerationActor;
    state: GenerationReplayStoreState;
    terminalFallback: ArenaGenerationTerminalRecord | null;
  } | Response> => {
    const generationId = state.generationId;
    const leaseExpired = (
      state.status === 'reserved'
      || state.status === 'running'
      || state.status === 'finalizing'
    )
      && state.leaseExpiresAt !== null
      && Date.parse(state.leaseExpiresAt) <= dependencies.now().getTime();
    if (!leaseExpired) return { actor, state, terminalFallback: null };

    let terminalFallback = await readOwnedTerminal(generationId, actor.actorKey);
    if (terminalFallback) {
      const terminal: GenerationTerminal = {
        status: terminalFallback.status,
        ...(terminalFallback.resultRef ? { resultRef: terminalFallback.resultRef } : {}),
      };
      await dependencies.store.markTerminal({
        generationId,
        producerToken: state.producerToken,
        terminal,
        now: dependencies.now().toISOString(),
      }).catch(() => ({ owned: true, applied: false }));
      return {
        actor,
        terminalFallback,
        state: { ...state, status: terminal.status, leaseExpiresAt: null, terminal },
      };
    }

    const now = dependencies.now().toISOString();
    const reaperToken = dependencies.createProducerToken?.() ?? crypto.randomUUID();
    const claimed = await dependencies.store.claimLeaseExpiry({
      generationId,
      actorKey: actor.actorKey,
      reaperToken,
      now,
      leaseExpiresAt: addLeaseDuration(dependencies.now(), leaseDurationMs),
    }).catch(() => null);
    if (!claimed || claimed.kind === 'not-expired') {
      return jsonResponse({
        code: 'GENERATION_TERMINAL_RECONCILIATION_PENDING',
        error: 'Generation terminal reconciliation pending',
      }, 503);
    }
    if (claimed.kind === 'forbidden' || claimed.kind === 'not-found') {
      return jsonResponse({ code: 'GENERATION_NOT_FOUND', error: 'Generation not found' }, 404);
    }
    if (claimed.kind === 'terminal') {
      return {
        actor,
        terminalFallback: null,
        state: {
          ...state,
          status: claimed.status,
          leaseExpiresAt: null,
          terminal: { status: claimed.status },
        },
      };
    }
    if (!dependencies.terminalStore?.reconcileExpiredLease) {
      return jsonResponse({
        code: 'GENERATION_TERMINAL_RECONCILIATION_PENDING',
        error: 'Generation terminal reconciliation unavailable',
      }, 503);
    }
    terminalFallback = await dependencies.terminalStore.reconcileExpiredLease({
      generationId,
      generationRequestId: claimed.generationRequestId,
      actorKey: actor.actorKey,
      payloadHash: claimed.payloadHash,
      mode: claimed.mode,
      updatedAt: now,
      code: 'PRODUCER_LEASE_EXPIRED',
    }).catch(() => null);
    if (!terminalFallback) {
      return jsonResponse({
        code: 'GENERATION_TERMINAL_RECONCILIATION_PENDING',
        error: 'Generation terminal reconciliation pending',
      }, 503);
    }
    const terminal: GenerationTerminal = {
      status: terminalFallback.status,
      ...(terminalFallback.resultRef ? { resultRef: terminalFallback.resultRef } : {}),
    };
    await dependencies.store.markTerminal({
      generationId,
      producerToken: reaperToken,
      terminal,
      now,
    }).catch(() => ({ owned: true, applied: false }));
    if (terminalFallback.status === 'producer_lost') {
      observe({ event: 'producer_lost', generationId, reason: 'lease_expired' });
    }
    return {
      actor,
      terminalFallback,
      state: {
        ...state,
        status: terminalFallback.status,
        updatedAt: now,
        leaseExpiresAt: null,
        terminal,
      },
    };
  };

  const resolveOwnedStateForActor = async (
    actor: ArenaGenerationActor,
    generationId: string,
  ): Promise<{
    actor: ArenaGenerationActor;
    state: GenerationReplayStoreState;
    terminalFallback: ArenaGenerationTerminalRecord | null;
  } | Response> => {
    let state: GenerationReplayStoreState | null;
    let terminalFallback: ArenaGenerationTerminalRecord | null = null;
    try {
      state = await dependencies.store.readState({
        generationId,
        actorKey: actor.actorKey,
      });
    } catch {
      const durable = await inspectOwnedFinalization(generationId, actor.actorKey)
        .catch(() => ({ kind: 'not-found' as const }));
      if (durable.kind === 'pending') {
        return jsonResponse({
          code: 'GENERATION_FINALIZATION_PENDING',
          error: 'Generation durable finalization remains pending',
        }, 503);
      }
      if (durable.kind === 'terminal') terminalFallback = durable.terminal;
      if (durable.kind === 'not-found') {
        return jsonResponse({
          code: 'GENERATION_STATE_UNAVAILABLE',
          error: 'Generation state unavailable',
        }, 503);
      }
      state = null;
    }

    if (!state) {
      if (!terminalFallback) {
        const durable = await inspectOwnedFinalization(generationId, actor.actorKey)
          .catch(() => ({ kind: 'not-found' as const }));
        if (durable.kind === 'pending') {
          return jsonResponse({
            code: 'GENERATION_FINALIZATION_PENDING',
            error: 'Generation durable finalization remains pending',
          }, 503);
        }
        if (durable.kind === 'terminal') terminalFallback = durable.terminal;
      }
      if (!terminalFallback) {
        return jsonResponse({ code: 'GENERATION_NOT_FOUND', error: 'Generation not found' }, 404);
      }
      state = {
        actorKey: actor.actorKey,
        generationId: terminalFallback.generationId,
        generationRequestId: terminalFallback.generationRequestId,
        payloadHash: terminalFallback.payloadHash ?? '',
        mode: null,
        producerToken: '',
        status: terminalFallback.status,
        lastEventId: null,
        updatedAt: terminalFallback.updatedAt,
        leaseExpiresAt: null,
        snapshot: {
          status: terminalFallback.status,
          markdown: terminalFallback.markdown,
          reasoning: terminalFallback.reasoning,
          lastEventId: null,
          updatedAt: terminalFallback.updatedAt,
          terminalResultRef: terminalFallback.resultRef,
        },
        terminal: {
          status: terminalFallback.status,
          resultRef: terminalFallback.resultRef,
        },
        cancelRequested: terminalFallback.status === 'cancelled',
        cancelReason: terminalFallback.status === 'cancelled' ? 'user' : null,
      };
    }
    if (state.actorKey !== actor.actorKey) {
      return jsonResponse({ code: 'GENERATION_NOT_FOUND', error: 'Generation not found' }, 404);
    }
    if (terminalFallback) return { actor, state, terminalFallback };
    return reconcileOwnedActiveState(actor, state);
  };

  const resolveOwnedState = async (
    request: Request,
    generationId: string,
  ): Promise<{
    actor: ArenaGenerationActor;
    state: GenerationReplayStoreState;
    terminalFallback: ArenaGenerationTerminalRecord | null;
  } | Response> => {
    const actor = await dependencies.resolveActor(request);
    if (!actor) return jsonResponse({ code: 'UNAUTHORIZED', error: 'Unauthorized' }, 401);
    return resolveOwnedStateForActor(actor, generationId);
  };

  const createStatusResponse = (
    state: GenerationReplayStoreState,
    actor: ArenaGenerationActor,
  ): Response => withActorHeaders(jsonResponse({
    generationId: state.generationId,
    generationRequestId: state.generationRequestId,
    status: state.status,
    resumable: state.status === 'reserved'
      || state.status === 'running'
      || state.status === 'finalizing',
    lastEventId: state.lastEventId,
    updatedAt: state.updatedAt,
    ...(state.terminal?.resultRef ? { resultRef: state.terminal.resultRef } : {}),
  }, 200), actor);

  const createTerminalFallbackResponse = (
    terminal: ArenaGenerationTerminalRecord,
    after: string | null = null,
  ): Response => {
    if (terminal.status === 'completed' && terminal.contentAvailable === false) {
      return jsonResponse({
        code: 'GENERATION_TERMINAL_CONTENT_UNAVAILABLE',
        error: 'Generation terminal content is temporarily unavailable',
      }, 503);
    }
    const [snapshotId, terminalId] = (() => {
      if (!after) return ['0-0', '0-1'];
      const match = after.match(/^(\d+)-(\d+)$/u);
      if (!match) return ['0-0', '0-1'];
      const milliseconds = match[1]!;
      const sequence = match[2]!;
      return [
        `${milliseconds}-${addSmallDecimal(sequence, 1)}`,
        `${milliseconds}-${addSmallDecimal(sequence, 2)}`,
      ];
    })();
    const snapshot: GenerationSnapshot = {
      status: terminal.status,
      markdown: terminal.markdown,
      reasoning: terminal.reasoning,
      lastEventId: null,
      updatedAt: terminal.updatedAt,
      terminalResultRef: terminal.resultRef,
    };
    const snapshotEvent = encodeGenerationSseEvent({
      id: snapshotId,
      type: 'snapshot',
      data: snapshot,
    });
    const terminalEvent = encodeGenerationSseEvent({
      id: terminalId,
      type: terminal.status === 'failed' || terminal.status === 'producer_lost'
        ? 'error'
        : 'done',
      data: {
        ok: terminal.status === 'completed',
        status: terminal.status,
        ...(terminal.resultRef ? { resultRef: terminal.resultRef } : {}),
      },
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(snapshotEvent);
        controller.enqueue(terminalEvent);
        observe({
          event: 'replay',
          generationId: terminal.generationId,
          events: 2,
          bytes: snapshotEvent.byteLength + terminalEvent.byteLength,
          snapshotBootstrap: true,
        });
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        'Cache-Control': 'no-cache, no-transform',
        'Content-Type': 'text/event-stream; charset=utf-8',
        'X-Mahoshojo-Generation-Id': terminal.generationId,
        'X-Mahoshojo-Generation-Request-Id': terminal.generationRequestId,
        'X-Mahoshojo-Generation-Fallback': 'terminal',
      },
    });
  };

  const createReplayResponse = (
    generationId: string,
    generationRequestId: string,
    after: string | null,
    actorKey: string,
    responseHeaders: Readonly<Record<string, string>> = {},
  ): Response => {
    let cancelled = false;
    let cursor = after;
    let snapshotBootstrapped = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const pump = async (): Promise<void> => {
          const terminalFallback = async (): Promise<ArenaGenerationTerminalRecord | null> => (
            readOwnedTerminal(generationId, actorKey)
          );
          const nextSyntheticId = (increment: 1 | 2 = 1): string => {
            const match = cursor?.match(/^(\d+)-(\d+)$/u);
            if (!match) return increment === 1 ? '0-0' : '0-1';
            return `${match[1]}-${addSmallDecimal(match[2]!, increment)}`;
          };
          const monotonicSnapshotId = (candidate: string | null): string => {
            if (!cursor) return candidate ?? '0-0';
            return candidate && compareGenerationSseIds(candidate, cursor) > 0
              ? candidate
              : nextSyntheticId();
          };
          const enqueueReplayError = (code: string): void => {
            const id = nextSyntheticId();
            controller.enqueue(encodeGenerationSseEvent({
              id,
              type: 'error',
              data: {
                code,
                status: code === 'GENERATION_STATE_LOST' ? 'producer_lost' : 'failed',
              },
            }));
            cursor = id;
            controller.close();
          };
          const enqueueTerminalSnapshot = (
            snapshot: GenerationSnapshot,
            terminal: GenerationTerminal,
          ): void => {
            const base = cursor?.match(/^(\d+)-(\d+)$/u);
            const milliseconds = base?.[1] ?? '0';
            const sequence = base?.[2] ?? null;
            const snapshotId = `${milliseconds}-${sequence ? addSmallDecimal(sequence, 1) : '0'}`;
            const terminalId = `${milliseconds}-${sequence ? addSmallDecimal(sequence, 2) : '1'}`;
            const snapshotEvent = encodeGenerationSseEvent({
              id: snapshotId,
              type: 'snapshot',
              data: { ...snapshot, status: terminal.status },
            });
            const terminalEvent = encodeGenerationSseEvent({
              id: terminalId,
              type: terminal.status === 'failed' || terminal.status === 'producer_lost'
                ? 'error'
                : 'done',
              data: {
                ok: terminal.status === 'completed',
                status: terminal.status,
                ...(terminal.code ? { code: terminal.code } : {}),
                ...(terminal.resultRef ? { resultRef: terminal.resultRef } : {}),
              },
            });
            controller.enqueue(snapshotEvent);
            controller.enqueue(terminalEvent);
            observe({
              event: 'replay',
              generationId,
              events: 2,
              bytes: snapshotEvent.byteLength + terminalEvent.byteLength,
              snapshotBootstrap: true,
            });
            controller.close();
          };
          const pipeTerminalFallback = async (
            fallback: ArenaGenerationTerminalRecord,
          ): Promise<void> => {
            if (fallback.status === 'completed' && fallback.contentAvailable === false) {
              throw new Error('GENERATION_TERMINAL_CONTENT_UNAVAILABLE');
            }
            const fallbackResponse = createTerminalFallbackResponse(fallback, cursor);
            const fallbackReader = fallbackResponse.body!.getReader();
            while (true) {
              const next = await fallbackReader.read();
              if (next.done) break;
              controller.enqueue(next.value);
            }
            controller.close();
          };
          try {
            while (!cancelled) {
              const batch = await dependencies.store.readAfter({
                generationId,
                after: cursor,
                blockMs: replayPollMs,
              });
              if (cancelled) return;

              if (batch.kind === 'window-lost') {
                const snapshot = await dependencies.store.readSnapshot({ generationId });
                if (!snapshot) {
                  const fallback = await terminalFallback();
                  if (fallback) {
                    await pipeTerminalFallback(fallback);
                    return;
                  }
                  enqueueReplayError('REPLAY_WINDOW_LOST');
                  return;
                }
                const state = await dependencies.store.readState({ generationId });
                if (state?.terminal) {
                  enqueueTerminalSnapshot(snapshot, state.terminal);
                  return;
                }
                if (snapshotBootstrapped) {
                  enqueueReplayError('REPLAY_WINDOW_LOST');
                  return;
                }
                const snapshotCursor = monotonicSnapshotId(snapshot.lastEventId);
                const encoded = encodeGenerationSseEvent({
                  id: snapshotCursor,
                  type: 'snapshot',
                  data: snapshot,
                });
                controller.enqueue(encoded);
                observe({
                  event: 'replay',
                  generationId,
                  events: 1,
                  bytes: encoded.byteLength,
                  snapshotBootstrap: true,
                });
                cursor = snapshotCursor;
                snapshotBootstrapped = true;
              } else if (batch.kind === 'stream-missing') {
                const state = await dependencies.store.readState({ generationId });
                const snapshot = state?.snapshot
                  ?? await dependencies.store.readSnapshot({ generationId });
                if (state?.terminal && snapshot) {
                  enqueueTerminalSnapshot(snapshot, state.terminal);
                  return;
                }
                if (state?.terminal) {
                  const fallback = await terminalFallback();
                  if (fallback) {
                    await pipeTerminalFallback(fallback);
                    return;
                  }
                }
                if (snapshot) {
                  if (snapshotBootstrapped) {
                    enqueueReplayError('REPLAY_STREAM_MISSING');
                    return;
                  }
                  const snapshotId = monotonicSnapshotId(snapshot.lastEventId);
                  const encoded = encodeGenerationSseEvent({
                    id: snapshotId,
                    type: 'snapshot',
                    data: snapshot,
                  });
                  controller.enqueue(encoded);
                  cursor = snapshotId;
                  snapshotBootstrapped = true;
                  observe({
                    event: 'replay',
                    generationId,
                    events: 1,
                    bytes: encoded.byteLength,
                    snapshotBootstrap: true,
                  });
                } else {
                  enqueueReplayError('REPLAY_STREAM_MISSING');
                  return;
                }
              } else {
                let replayBytes = 0;
                let sawTerminal = false;
                for (const event of batch.events) {
                  if (cancelled) return;
                  const encoded = encodeGenerationSseEvent(event);
                  controller.enqueue(encoded);
                  replayBytes += encoded.byteLength;
                  cursor = event.id;
                  if (event.type === 'done' || event.type === 'error') sawTerminal = true;
                }
                if (batch.events.length > 0) {
                  observe({
                    event: 'replay',
                    generationId,
                    events: batch.events.length,
                    bytes: replayBytes,
                    snapshotBootstrap: false,
                  });
                }
                if (sawTerminal) {
                  controller.close();
                  return;
                }
              }

              let state = await dependencies.store.readState({ generationId });
              if (!state) {
                const durable = await inspectOwnedFinalization(generationId, actorKey)
                  .catch(() => ({ kind: 'not-found' as const }));
                if (durable.kind === 'terminal') {
                  await pipeTerminalFallback(durable.terminal);
                  return;
                }
                if (durable.kind === 'pending') {
                  await new Promise<void>((resolve) => setTimeout(resolve, replayPollMs));
                  continue;
                }
                enqueueReplayError('GENERATION_STATE_LOST');
                return;
              }
              const reconciled = await reconcileOwnedActiveState({ actorKey }, state);
              if (reconciled instanceof Response) {
                if (reconciled.status === 503) {
                  await new Promise<void>((resolve) => setTimeout(resolve, replayPollMs));
                  continue;
                }
                enqueueReplayError('GENERATION_STATE_LOST');
                return;
              }
              state = reconciled.state;
              if (reconciled.terminalFallback) {
                await pipeTerminalFallback(reconciled.terminalFallback);
                return;
              }
              if (state.terminal && batch.events.length === 0) {
                const snapshot = state.snapshot ?? await dependencies.store.readSnapshot({ generationId });
                if (snapshot) {
                  enqueueTerminalSnapshot(snapshot, state.terminal);
                  return;
                }
                const fallback = await terminalFallback();
                if (fallback) {
                  await pipeTerminalFallback(fallback);
                  return;
                }
                enqueueReplayError('GENERATION_TERMINAL_EVIDENCE_MISSING');
                return;
              }
              if (batch.events.length === 0) {
                await new Promise<void>((resolve) => setTimeout(resolve, replayPollMs));
              }
            }
          } catch (error) {
            if (cancelled) return;
            observe({ event: 'redis_degraded', generationId, operation: 'read_replay' });
            controller.error(error);
          }
        };
        void pump();
      },
      cancel() {
        cancelled = true;
        observe({ event: 'client_disconnect', generationId });
      },
    });

    const headers = new Headers({
      'Cache-Control': 'no-cache, no-transform',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Mahoshojo-Generation-Id': generationId,
      'X-Mahoshojo-Generation-Request-Id': generationRequestId,
    });
    for (const [name, value] of Object.entries(responseHeaders)) headers.set(name, value);
    return new Response(stream, {
      status: 200,
      headers,
    });
  };

  const launchProducer = async (input: {
    generationId: string;
    generationRequestId: string;
    actorKey: string;
    producerToken: string;
    payloadHash: string;
    payload: Record<string, unknown>;
  }): Promise<void> => {
    if (activeProducers.has(input.generationId)) return;
    const controller = new AbortController();
    const loseOwnership = (): void => {
      if (!controller.signal.aborted) controller.abort('producer_lost');
    };
    const replayWriter = createReplayWriter(
      input.generationId,
      input.producerToken,
      loseOwnership,
    );
    const now = dependencies.now();
    const running = await dependencies.store.markRunning({
      generationId: input.generationId,
      producerToken: input.producerToken,
      now: now.toISOString(),
      leaseExpiresAt: addLeaseDuration(now, leaseDurationMs),
    });
    if (!running.owned) throw new Error('GENERATION_PRODUCER_FENCED');
    if (running.cancelRequested) {
      const cancelReason = running.cancelReason ?? 'user';
      await replayWriter.finish({
        status: 'cancelled',
        code: generationCancelCode(cancelReason),
      });
      return;
    }

    let heartbeat: ReturnType<typeof setInterval> | null = null;
    const executionPromise = dependencies.executor.execute({
      ...input,
      signal: controller.signal,
      emit: replayWriter.emit,
      claimFinalization: async (_terminal) => {
        if (controller.signal.reason === 'producer_lost') return { kind: 'fenced' };
        const claimNow = dependencies.now();
        const claimed = await dependencies.store.claimFinalization({
          generationId: input.generationId,
          producerToken: input.producerToken,
          now: claimNow.toISOString(),
          leaseExpiresAt: addLeaseDuration(claimNow, leaseDurationMs),
        });
        if (claimed.kind === 'fenced') loseOwnership();
        if (claimed.kind === 'cancelled' && !controller.signal.aborted) {
          controller.abort(claimed.cancelReason ?? 'user');
        }
        return claimed;
      },
    });

    const promise = (async (): Promise<void> => {
      try {
        heartbeat = setInterval(() => {
          const heartbeatNow = dependencies.now();
          void dependencies.store.heartbeat({
            generationId: input.generationId,
            producerToken: input.producerToken,
            now: heartbeatNow.toISOString(),
            leaseExpiresAt: addLeaseDuration(heartbeatNow, leaseDurationMs),
          }).then((result) => {
            if (!result.owned) {
              loseOwnership();
              return;
            }
            if (result.cancelRequested) controller.abort(result.cancelReason ?? 'user');
          }).catch(() => {
            observe({
              event: 'redis_degraded',
              generationId: input.generationId,
              operation: 'heartbeat',
            });
          });
        }, heartbeatIntervalMs);
        const terminal = await executionPromise;
        await replayWriter.finish(terminal);
      } catch (error) {
        const terminal: GenerationTerminal = controller.signal.reason === 'producer_lost'
          ? { status: 'producer_lost', code: 'PRODUCER_OWNERSHIP_LOST' }
          : controller.signal.aborted
            ? {
              status: 'cancelled',
              code: generationCancelCode(
                isGenerationCancelReason(controller.signal.reason)
                  ? controller.signal.reason
                  : 'user',
              ),
            }
          : { status: 'failed', code: 'GENERATION_FAILED' };
        await replayWriter.emit({
          type: 'telemetry',
          data: { errorClass: error instanceof Error ? error.name : 'Error' },
        });
        if (error instanceof ArenaGenerationFinalizationPendingError) return;
        await replayWriter.finish(terminal);
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        activeProducers.delete(input.generationId);
      }
    })();

    activeProducers.set(input.generationId, { controller, promise });
    void promise.catch(() => undefined);
  };

  const service: ArenaGenerationService = {
    async create(request: Request): Promise<Response> {
      if (request.method !== 'POST') {
        return jsonResponse({ code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' }, 405);
      }
      const actor = await dependencies.resolveActor(request);
      if (!actor) return jsonResponse({ code: 'UNAUTHORIZED', error: 'Unauthorized' }, 401);
      const parsed = await parseCreatePayload(request);
      if (parsed instanceof Response) return parsed;

      const prepared = dependencies.executor.prepare
        ? await dependencies.executor.prepare({
          request,
          actorKey: actor.actorKey,
          payload: parsed.payload,
        })
        : {
          executionPayload: parsed.payload,
          semanticPayload: parsed.payload,
        };
      if (prepared instanceof Response) return prepared;

      const generationId = await dependencies.deriveGenerationId({
        actorKey: actor.actorKey,
        generationRequestId: parsed.generationRequestId,
      });
      const producerToken = dependencies.createProducerToken?.() ?? crypto.randomUUID();
      const inputBytes = encodedBytes(prepared.semanticPayload);
      const payloadHash = await dependencies.hashPayload(prepared.semanticPayload);
      const now = dependencies.now();
      let reservation: Awaited<ReturnType<GenerationReplayStore['reserve']>>;
      try {
        reservation = await dependencies.store.reserve({
          actorKey: actor.actorKey,
          generationRequestId: parsed.generationRequestId,
          generationId,
          payloadHash,
          ...(typeof prepared.semanticPayload.mode === 'string'
            ? { mode: prepared.semanticPayload.mode }
            : {}),
          producerToken,
          now: now.toISOString(),
          leaseExpiresAt: addLeaseDuration(now, leaseDurationMs),
        });
      } catch {
        observe({ event: 'request', generationId, outcome: 'unavailable', inputBytes });
        observe({ event: 'redis_degraded', generationId, operation: 'reserve' });
        let durable: Awaited<ReturnType<typeof inspectOwnedFinalization>> = { kind: 'not-found' };
        try {
          durable = await inspectOwnedFinalization(generationId, actor.actorKey);
        } catch {
          // The response below remains fail closed when neither Redis nor D1 can prove ownership.
        }
        if (durable.kind === 'pending') {
          if (durable.payloadHash && durable.payloadHash !== payloadHash) {
            return jsonResponse({
              code: 'GENERATION_REQUEST_CONFLICT',
              error: 'generationRequestId 已用于不同请求',
            }, 409);
          }
          return jsonResponse({
            code: 'GENERATION_FINALIZATION_PENDING',
            error: 'Generation durable finalization remains pending',
          }, 503);
        }
        if (durable.kind === 'terminal') {
          const terminal = durable.terminal;
          if (!terminal.payloadHash || terminal.payloadHash !== payloadHash) {
            observe({ event: 'request', generationId, outcome: 'conflict', inputBytes });
            return jsonResponse({
              code: 'GENERATION_REQUEST_CONFLICT',
              error: 'generationRequestId 已用于不同请求',
            }, 409);
          }
          observe({ event: 'request', generationId, outcome: 'reused', inputBytes });
          return withActorHeaders(createTerminalFallbackResponse(terminal), actor);
        }
        return jsonResponse({
          code: 'GENERATION_RESERVATION_UNAVAILABLE',
          error: '无法确认 generation reservation',
        }, 503);
      }

      if (reservation.kind === 'conflict') {
        observe({ event: 'request', generationId, outcome: 'conflict', inputBytes });
        return jsonResponse({
          code: 'GENERATION_REQUEST_CONFLICT',
          error: 'generationRequestId 已用于不同请求',
        }, 409);
      }
      if (reservation.kind === 'created' && dependencies.terminalStore) {
        let durable: Awaited<ReturnType<typeof inspectOwnedFinalization>>;
        try {
          durable = await inspectOwnedFinalization(generationId, actor.actorKey);
        } catch {
          await dependencies.store.releaseReservation({
            generationId,
            producerToken,
          }).catch(() => ({ released: false }));
          return jsonResponse({
            code: 'GENERATION_TERMINAL_LOOKUP_UNAVAILABLE',
            error: '无法确认 generation terminal state',
          }, 503);
        }
        if (durable.kind === 'pending') {
          await dependencies.store.releaseReservation({
            generationId,
            producerToken,
          }).catch(() => ({ released: false }));
          if (durable.payloadHash && durable.payloadHash !== payloadHash) {
            return jsonResponse({
              code: 'GENERATION_REQUEST_CONFLICT',
              error: 'generationRequestId 已用于不同请求',
            }, 409);
          }
          return jsonResponse({
            code: 'GENERATION_FINALIZATION_PENDING',
            error: 'Generation durable finalization remains pending',
          }, 503);
        }
        if (durable.kind === 'terminal') {
          const terminal = durable.terminal;
          if (!terminal.payloadHash || terminal.payloadHash !== payloadHash) {
            await dependencies.store.releaseReservation({
              generationId,
              producerToken,
            }).catch(() => ({ released: false }));
            observe({ event: 'request', generationId, outcome: 'conflict', inputBytes });
            return jsonResponse({
              code: 'GENERATION_REQUEST_CONFLICT',
              error: 'generationRequestId 已用于不同请求',
            }, 409);
          }
          await dependencies.store.markTerminal({
            generationId,
            producerToken,
            terminal: {
              status: terminal.status,
              ...(terminal.resultRef ? { resultRef: terminal.resultRef } : {}),
            },
            now: dependencies.now().toISOString(),
          }).catch(() => ({ owned: true, applied: false }));
          observe({ event: 'request', generationId, outcome: 'reused', inputBytes });
          return withActorHeaders(createTerminalFallbackResponse(terminal), actor);
        }
      }
      observe({
        event: 'request',
        generationId: reservation.generationId,
        outcome: reservation.kind,
        inputBytes,
      });
      if (reservation.kind === 'created') {
        try {
          await launchProducer({
            generationId: reservation.generationId,
            generationRequestId: parsed.generationRequestId,
            actorKey: actor.actorKey,
            producerToken,
            payloadHash,
            payload: prepared.executionPayload,
          });
        } catch {
          const lostTerminal: GenerationTerminal = {
            status: 'producer_lost',
            code: 'PRODUCER_OWNERSHIP_UNAVAILABLE',
          };
          await dependencies.store.markTerminal({
            generationId: reservation.generationId,
            producerToken,
            terminal: lostTerminal,
            now: dependencies.now().toISOString(),
          }).catch(() => ({ owned: true, applied: false }));
          observe({
            event: 'producer_lost',
            generationId: reservation.generationId,
            reason: 'ownership_unavailable',
          });
          return jsonResponse({
            code: 'GENERATION_OWNERSHIP_UNAVAILABLE',
            error: '无法建立 generation producer ownership',
          }, 503);
        }
      }
      return withActorHeaders(
        createReplayResponse(
          reservation.generationId,
          parsed.generationRequestId,
          null,
          actor.actorKey,
          prepared.responseHeaders,
        ),
        actor,
      );
    },

    async cancelRequest(request: Request): Promise<Response> {
      const actor = await dependencies.resolveActor(request);
      if (!actor) return jsonResponse({ code: 'UNAUTHORIZED', error: 'Unauthorized' }, 401);
      const payload = await readOptionalCancelPayload(request);
      if (payload instanceof Response) return payload;
      const generationRequestId = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).generationRequestId
        : null;
      if (
        typeof generationRequestId !== 'string'
        || !isGenerationRequestId(generationRequestId)
      ) {
        return jsonResponse({
          code: 'GENERATION_REQUEST_ID_INVALID',
          error: 'generationRequestId is required',
        }, 400);
      }
      const cancelReason = cancelReasonFromPayload(payload);
      if (cancelReason instanceof Response) return cancelReason;
      const generationId = await dependencies.deriveGenerationId({
        actorKey: actor.actorKey,
        generationRequestId,
      });
      let result: Awaited<ReturnType<GenerationReplayStore['requestCancel']>>;
      try {
        result = await dependencies.store.requestCancel({
          generationId,
          actorKey: actor.actorKey,
          reason: cancelReason,
          now: dependencies.now().toISOString(),
        });
      } catch {
        const durable = await inspectOwnedFinalization(generationId, actor.actorKey)
          .catch(() => ({ kind: 'not-found' as const }));
        if (durable.kind === 'terminal') {
          return withActorHeaders(jsonResponse({
            generationId,
            status: durable.terminal.status,
            cancelled: durable.terminal.status === 'cancelled',
          }, 200), actor);
        }
        if (durable.kind === 'pending') {
          return withActorHeaders(jsonResponse({
            code: 'GENERATION_FINALIZATION_IN_PROGRESS',
            generationId,
            status: 'finalizing',
            cancelled: false,
          }, 409), actor);
        }
        return jsonResponse({
          code: 'GENERATION_STATE_UNAVAILABLE',
          error: 'Generation state unavailable',
        }, 503);
      }
      if (result.kind === 'not-found' || result.kind === 'forbidden') {
        return jsonResponse({ code: 'GENERATION_NOT_FOUND', error: 'Generation not found' }, 404);
      }
      if (result.kind === 'accepted') {
        activeProducers.get(generationId)?.controller.abort(result.cancelReason);
        observe({
          event: 'cancel',
          generationId,
          reason: result.cancelReason,
          outcome: 'accepted',
        });
        return withActorHeaders(jsonResponse({
          generationId,
          status: 'cancelling',
          cancelled: true,
        }, 202), actor);
      }
      if (result.kind === 'finalizing') {
        return withActorHeaders(jsonResponse({
          code: 'GENERATION_FINALIZATION_IN_PROGRESS',
          generationId,
          status: 'finalizing',
          cancelled: false,
        }, 409), actor);
      }
      return withActorHeaders(jsonResponse({
        generationId,
        status: result.status,
        cancelled: result.status === 'cancelled',
      }, 200), actor);
    },

    async lookup(
      request: Request,
      params: ArenaGenerationRequestRouteParams,
    ): Promise<Response> {
      const actor = await dependencies.resolveActor(request);
      if (!actor) return jsonResponse({ code: 'UNAUTHORIZED', error: 'Unauthorized' }, 401);
      if (!isGenerationRequestId(params.generationRequestId)) {
        return jsonResponse({
          code: 'GENERATION_REQUEST_ID_INVALID',
          error: 'generationRequestId is invalid',
        }, 400);
      }
      const generationId = await dependencies.deriveGenerationId({
        actorKey: actor.actorKey,
        generationRequestId: params.generationRequestId,
      });
      const owned = await resolveOwnedStateForActor(actor, generationId);
      if (owned instanceof Response) {
        if (owned.status !== 404) return owned;
        return jsonResponse({
          code: 'GENERATION_REQUEST_NOT_FOUND',
          error: 'Generation request not found',
        }, 404);
      }
      if (owned.state.generationRequestId !== params.generationRequestId) {
        return jsonResponse({
          code: 'GENERATION_REQUEST_NOT_FOUND',
          error: 'Generation request not found',
        }, 404);
      }
      return createStatusResponse(owned.state, owned.actor);
    },

    async resume(request: Request, params: ArenaGenerationRouteParams): Promise<Response> {
      const startedAt = Date.now();
      observe({ event: 'resume', generationId: params.generationId, outcome: 'attempt' });
      let after: string | null;
      try {
        after = resolveResumeCursor(request);
      } catch {
        observe({
          event: 'resume',
          generationId: params.generationId,
          outcome: 'failure',
          reason: 'cursor_conflict',
          latencyMs: Date.now() - startedAt,
        });
        return jsonResponse({ code: 'RESUME_CURSOR_CONFLICT', error: '恢复游标冲突' }, 400);
      }
      const owned = await resolveOwnedState(request, params.generationId);
      if (owned instanceof Response) {
        const reason = owned.status === 401
          ? 'unauthorized'
          : owned.status === 404
            ? 'not_found'
            : owned.status === 503
              ? 'state_unavailable'
              : 'unknown';
        observe({
          event: 'resume',
          generationId: params.generationId,
          outcome: 'failure',
          reason,
          latencyMs: Date.now() - startedAt,
        });
        return owned;
      }
      observe({
        event: 'resume',
        generationId: params.generationId,
        outcome: 'success',
        latencyMs: Date.now() - startedAt,
      });
      if (owned.terminalFallback) {
        return withActorHeaders(
          createTerminalFallbackResponse(owned.terminalFallback, after),
          owned.actor,
        );
      }
      return withActorHeaders(
        createReplayResponse(
          owned.state.generationId,
          owned.state.generationRequestId,
          after,
          owned.actor.actorKey,
        ),
        owned.actor,
      );
    },

    async status(request: Request, params: ArenaGenerationRouteParams): Promise<Response> {
      const owned = await resolveOwnedState(request, params.generationId);
      if (owned instanceof Response) return owned;
      return createStatusResponse(owned.state, owned.actor);
    },

    async cancel(request: Request, params: ArenaGenerationRouteParams): Promise<Response> {
      const owned = await resolveOwnedState(request, params.generationId);
      if (owned instanceof Response) return owned;
      const cancelPayload = await readOptionalCancelPayload(request);
      if (cancelPayload instanceof Response) return cancelPayload;
      const cancelReason = cancelReasonFromPayload(cancelPayload);
      if (cancelReason instanceof Response) return cancelReason;
      if (owned.terminalFallback) {
        return withActorHeaders(jsonResponse({
          generationId: params.generationId,
          status: owned.terminalFallback.status,
          cancelled: owned.terminalFallback.status === 'cancelled',
        }, 200), owned.actor);
      }
      const result = await dependencies.store.requestCancel({
        generationId: params.generationId,
        actorKey: owned.actor.actorKey,
        reason: cancelReason,
        now: dependencies.now().toISOString(),
      });
      if (result.kind === 'not-found' || result.kind === 'forbidden') {
        return jsonResponse({ code: 'GENERATION_NOT_FOUND', error: 'Generation not found' }, 404);
      }
      if (result.kind === 'terminal') {
        observe({
          event: 'cancel',
          generationId: params.generationId,
          reason: cancelReason,
          outcome: 'terminal',
        });
        return withActorHeaders(jsonResponse({
          generationId: params.generationId,
          status: result.status,
          cancelled: result.status === 'cancelled',
        }, 200), owned.actor);
      }
      if (result.kind === 'finalizing') {
        return withActorHeaders(jsonResponse({
          code: 'GENERATION_FINALIZATION_IN_PROGRESS',
          generationId: params.generationId,
          status: 'finalizing',
          cancelled: false,
        }, 409), owned.actor);
      }
      observe({
        event: 'cancel',
        generationId: params.generationId,
        reason: result.cancelReason,
        outcome: 'accepted',
      });
      activeProducers.get(params.generationId)?.controller.abort(result.cancelReason);
      return withActorHeaders(jsonResponse({
        generationId: params.generationId,
        status: 'cancelling',
        cancelled: true,
      }, 202), owned.actor);
    },
  };
  return Object.freeze(service);
};
