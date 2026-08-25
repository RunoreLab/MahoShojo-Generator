import {
  encodeGenerationSseEvent,
  resolveResumeCursor,
} from './sse';

export type GenerationStatus =
  | 'reserved'
  | 'running'
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

export type GenerationReplayStoreState = {
  actorKey: string;
  generationId: string;
  generationRequestId: string;
  payloadHash: string;
  status: GenerationStatus;
  lastEventId: string | null;
  updatedAt: string;
  leaseExpiresAt: string | null;
  snapshot: GenerationSnapshot | null;
  terminal: GenerationTerminal | null;
  cancelRequested: boolean;
};

export interface GenerationReplayStore {
  reserve(_input: {
    actorKey: string;
    generationRequestId: string;
    generationId: string;
    payloadHash: string;
    now: string;
    leaseExpiresAt: string;
  }): Promise<
    | { kind: 'created'; generationId: string }
    | { kind: 'reused'; generationId: string }
    | { kind: 'conflict' }
  >;
  markRunning(_input: {
    generationId: string;
    now: string;
    leaseExpiresAt: string;
  }): Promise<void>;
  heartbeat(_input: {
    generationId: string;
    now: string;
    leaseExpiresAt: string;
  }): Promise<void>;
  appendEvents(_input: {
    generationId: string;
    events: GenerationEventInput[];
    now: string;
  }): Promise<{ events: GenerationStreamEvent[] }>;
  writeSnapshot(_input: {
    generationId: string;
    snapshot: GenerationSnapshot;
    now: string;
  }): Promise<void>;
  readSnapshot(_input: { generationId: string }): Promise<GenerationSnapshot | null>;
  readAfter(_input: {
    generationId: string;
    after: string | null;
    blockMs: number;
  }): Promise<
    | { kind: 'events'; events: GenerationStreamEvent[] }
    | { kind: 'window-lost'; events: GenerationStreamEvent[] }
  >;
  markTerminal(_input: {
    generationId: string;
    terminal: GenerationTerminal;
    now: string;
  }): Promise<{ applied: boolean }>;
  readState(_input: { generationId: string }): Promise<GenerationReplayStoreState | null>;
  requestCancel(_input: {
    generationId: string;
    actorKey: string;
    reason: string;
    now: string;
  }): Promise<
    | { kind: 'accepted' }
    | { kind: 'terminal'; status: GenerationTerminal['status'] }
    | { kind: 'forbidden' }
    | { kind: 'not-found' }
  >;
}

export type ArenaGenerationExecutionInput = {
  generationId: string;
  generationRequestId: string;
  actorKey: string;
  payload: Record<string, unknown>;
  signal: AbortSignal;
  emit: (_event: GenerationEventInput) => Promise<void>;
};

export interface ArenaGenerationExecutor {
  execute(_input: ArenaGenerationExecutionInput): Promise<GenerationTerminal>;
}

export type ArenaGenerationActor = {
  actorKey: string;
};

export type ArenaGenerationServiceDependencies = {
  store: GenerationReplayStore;
  executor: ArenaGenerationExecutor;
  resolveActor(_request: Request): Promise<ArenaGenerationActor | null>;
  createGenerationId(): string;
  hashPayload(_payload: Record<string, unknown>): Promise<string>;
  now(): Date;
  heartbeatIntervalMs?: number;
  leaseDurationMs?: number;
  replayPollMs?: number;
  deltaFlushIntervalMs?: number;
  deltaFlushBytes?: number;
};

export type ArenaGenerationRouteParams = {
  generationId: string;
};

export interface ArenaGenerationService {
  create(_request: Request): Promise<Response>;
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

const parseCreatePayload = async (
  request: Request,
): Promise<{ generationRequestId: string; payload: Record<string, unknown> } | Response> => {
  if (request.method !== 'POST') {
    return jsonResponse({ code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' }, 405);
  }

  let body: unknown;
  try {
    body = await request.json();
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
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(generationRequestId)) {
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
  const activeProducers = new Map<string, ActiveProducer>();

  if (!Number.isFinite(deltaFlushIntervalMs) || deltaFlushIntervalMs < 1) {
    throw new Error('deltaFlushIntervalMs 必须是正有限数字');
  }
  if (!Number.isFinite(deltaFlushBytes) || deltaFlushBytes < 1) {
    throw new Error('deltaFlushBytes 必须是正有限数字');
  }

  const createReplayWriter = (generationId: string) => {
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
      await dependencies.store.writeSnapshot({
        generationId,
        snapshot: snapshot(status, now, terminalResultRef),
        now,
      }).catch(() => undefined);
    };

    const append = async (events: GenerationEventInput[], now: string): Promise<void> => {
      const result = await dependencies.store.appendEvents({
        generationId,
        events,
        now,
      }).catch(() => null);
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
            terminal,
            now,
          }).catch(() => ({ applied: false }));
          await writeSnapshot(terminal.status, now, terminal.resultRef ?? null);
        });
      },
    });
  };

  const resolveOwnedState = async (
    request: Request,
    generationId: string,
  ): Promise<{ actor: ArenaGenerationActor; state: GenerationReplayStoreState } | Response> => {
    const actor = await dependencies.resolveActor(request);
    if (!actor) return jsonResponse({ code: 'UNAUTHORIZED', error: 'Unauthorized' }, 401);
    const state = await dependencies.store.readState({ generationId });
    if (!state || state.actorKey !== actor.actorKey) {
      return jsonResponse({ code: 'GENERATION_NOT_FOUND', error: 'Generation not found' }, 404);
    }
    return { actor, state };
  };

  const createReplayResponse = (
    generationId: string,
    generationRequestId: string,
    after: string | null,
  ): Response => {
    let cancelled = false;
    let cursor = after;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const pump = async (): Promise<void> => {
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
                  controller.enqueue(encodeGenerationSseEvent({
                    id: cursor ?? '0-0',
                    type: 'error',
                    data: { code: 'REPLAY_WINDOW_LOST', status: 'producer_lost' },
                  }));
                  controller.close();
                  return;
                }
                const snapshotCursor = snapshot.lastEventId ?? cursor ?? '0-0';
                controller.enqueue(encodeGenerationSseEvent({
                  id: snapshotCursor,
                  type: 'snapshot',
                  data: snapshot,
                }));
                cursor = snapshot.lastEventId;
              } else {
                for (const event of batch.events) {
                  if (cancelled) return;
                  controller.enqueue(encodeGenerationSseEvent(event));
                  cursor = event.id;
                }
              }

              const state = await dependencies.store.readState({ generationId });
              if (!state) {
                controller.enqueue(encodeGenerationSseEvent({
                  id: cursor ?? '0-0',
                  type: 'error',
                  data: { code: 'GENERATION_STATE_LOST', status: 'producer_lost' },
                }));
                controller.close();
                return;
              }
              if (state.terminal && batch.events.length === 0) {
                controller.close();
                return;
              }
              if (batch.events.length === 0) {
                await new Promise<void>((resolve) => setTimeout(resolve, replayPollMs));
              }
            }
          } catch (error) {
            if (cancelled) return;
            controller.error(error);
          }
        };
        void pump();
      },
      cancel() {
        cancelled = true;
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Cache-Control': 'no-cache, no-transform',
        'Content-Type': 'text/event-stream; charset=utf-8',
        'X-Mahoshojo-Generation-Id': generationId,
        'X-Mahoshojo-Generation-Request-Id': generationRequestId,
      },
    });
  };

  const launchProducer = async (input: {
    generationId: string;
    generationRequestId: string;
    actorKey: string;
    payload: Record<string, unknown>;
  }): Promise<void> => {
    if (activeProducers.has(input.generationId)) return;
    const controller = new AbortController();
    const replayWriter = createReplayWriter(input.generationId);
    const now = dependencies.now();
    await dependencies.store.markRunning({
      generationId: input.generationId,
      now: now.toISOString(),
      leaseExpiresAt: addLeaseDuration(now, leaseDurationMs),
    });

    let heartbeat: ReturnType<typeof setInterval> | null = null;
    const executionPromise = dependencies.executor.execute({
      ...input,
      signal: controller.signal,
      emit: replayWriter.emit,
    });

    const promise = (async (): Promise<void> => {
      try {
        heartbeat = setInterval(() => {
          const heartbeatNow = dependencies.now();
          void dependencies.store.heartbeat({
            generationId: input.generationId,
            now: heartbeatNow.toISOString(),
            leaseExpiresAt: addLeaseDuration(heartbeatNow, leaseDurationMs),
          }).catch(() => undefined);
        }, heartbeatIntervalMs);
        const terminal = await executionPromise;
        await replayWriter.finish(terminal);
      } catch (error) {
        const terminal: GenerationTerminal = controller.signal.aborted
          ? { status: 'cancelled', code: 'USER_CANCELLED' }
          : { status: 'failed', code: 'GENERATION_FAILED' };
        await replayWriter.emit({
          type: 'telemetry',
          data: { errorClass: error instanceof Error ? error.name : 'Error' },
        });
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
      const parsed = await parseCreatePayload(request);
      if (parsed instanceof Response) return parsed;
      const actor = await dependencies.resolveActor(request);
      if (!actor) return jsonResponse({ code: 'UNAUTHORIZED', error: 'Unauthorized' }, 401);

      const generationId = dependencies.createGenerationId();
      const payloadHash = await dependencies.hashPayload(parsed.payload);
      const now = dependencies.now();
      let reservation: Awaited<ReturnType<GenerationReplayStore['reserve']>>;
      try {
        reservation = await dependencies.store.reserve({
          actorKey: actor.actorKey,
          generationRequestId: parsed.generationRequestId,
          generationId,
          payloadHash,
          now: now.toISOString(),
          leaseExpiresAt: addLeaseDuration(now, leaseDurationMs),
        });
      } catch {
        return jsonResponse({
          code: 'GENERATION_RESERVATION_UNAVAILABLE',
          error: '无法确认 generation reservation',
        }, 503);
      }

      if (reservation.kind === 'conflict') {
        return jsonResponse({
          code: 'GENERATION_REQUEST_CONFLICT',
          error: 'generationRequestId 已用于不同请求',
        }, 409);
      }
      if (reservation.kind === 'created') {
        await launchProducer({
          generationId: reservation.generationId,
          generationRequestId: parsed.generationRequestId,
          actorKey: actor.actorKey,
          payload: parsed.payload,
        });
      }
      return createReplayResponse(
        reservation.generationId,
        parsed.generationRequestId,
        null,
      );
    },

    async resume(request: Request, params: ArenaGenerationRouteParams): Promise<Response> {
      const owned = await resolveOwnedState(request, params.generationId);
      if (owned instanceof Response) return owned;
      let after: string | null;
      try {
        after = resolveResumeCursor(request);
      } catch {
        return jsonResponse({ code: 'RESUME_CURSOR_CONFLICT', error: '恢复游标冲突' }, 400);
      }
      return createReplayResponse(
        owned.state.generationId,
        owned.state.generationRequestId,
        after,
      );
    },

    async status(request: Request, params: ArenaGenerationRouteParams): Promise<Response> {
      const owned = await resolveOwnedState(request, params.generationId);
      if (owned instanceof Response) return owned;
      const { state } = owned;
      return jsonResponse({
        generationId: state.generationId,
        generationRequestId: state.generationRequestId,
        status: state.status,
        resumable: state.status === 'reserved' || state.status === 'running',
        lastEventId: state.lastEventId,
        updatedAt: state.updatedAt,
        ...(state.terminal?.resultRef ? { resultRef: state.terminal.resultRef } : {}),
      }, 200);
    },

    async cancel(request: Request, params: ArenaGenerationRouteParams): Promise<Response> {
      const owned = await resolveOwnedState(request, params.generationId);
      if (owned instanceof Response) return owned;
      const result = await dependencies.store.requestCancel({
        generationId: params.generationId,
        actorKey: owned.actor.actorKey,
        reason: 'user',
        now: dependencies.now().toISOString(),
      });
      if (result.kind === 'not-found' || result.kind === 'forbidden') {
        return jsonResponse({ code: 'GENERATION_NOT_FOUND', error: 'Generation not found' }, 404);
      }
      if (result.kind === 'terminal') {
        return jsonResponse({
          generationId: params.generationId,
          status: result.status,
          cancelled: result.status === 'cancelled',
        }, 200);
      }
      activeProducers.get(params.generationId)?.controller.abort('user');
      return jsonResponse({
        generationId: params.generationId,
        status: 'cancelling',
        cancelled: true,
      }, 202);
    },
  };
  return Object.freeze(service);
};
