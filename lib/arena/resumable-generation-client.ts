import { parseGenerationSseBlock } from '@mahoshojo/hosted-api/arena-generation/sse';
import {
  STREAM_ABORT_REASON_CONTENT_POLICY,
  STREAM_ABORT_REASON_USER,
} from '@/lib/stream/abort';

export const ARENA_GENERATION_CLIENT_STATE_KEY = 'mahoshojo:arena:generation:v1';
export const ARENA_GENERATION_ACTOR_TOKEN_KEY = 'mahoshojo:arena:generation-actor:v1';
export const ARENA_GENERATION_ACTOR_TOKEN_HEADER = 'X-Mahoshojo-Generation-Actor-Token';

export type ArenaGenerationConnectionState =
  | 'connecting'
  | 'generating'
  | 'recovering_initial'
  | 'reconnecting'
  | 'resuming'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'producer_lost'
  | 'unknown';

export type PersistedArenaGeneration = {
  version: 1 | 2;
  generationRequestId: string;
  generationId: string | null;
  lastEventId: string | null;
  state: ArenaGenerationConnectionState;
  updatedAt: string;
  endpoint?: string;
  bodyHash?: string;
};

type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

let inMemoryActorToken: string | null = null;

export type OpenArenaGenerationStreamOptions = {
  endpoint: string;
  body: Record<string, unknown>;
  headers: HeadersInit;
  signal?: AbortSignal;
  fetcher(_input: string, _init?: RequestInit): Promise<Response>;
  storage?: StoragePort | null;
  generationRequestId?: string;
  maxReconnectAttempts?: number;
  baseReconnectDelayMs?: number;
  random?: () => number;
  now?: () => Date;
  onStateChange?(_state: ArenaGenerationConnectionState): void;
};

const defaultStorage = (): StoragePort | null => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

const defaultActorStorage = (): StoragePort | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

export const readPersistedArenaGeneration = (
  storage: StoragePort | null = defaultStorage(),
  key = ARENA_GENERATION_CLIENT_STATE_KEY,
): PersistedArenaGeneration | null => {
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? '') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const value = parsed as Partial<PersistedArenaGeneration>;
    if (
      (value.version !== 1 && value.version !== 2)
      || typeof value.generationRequestId !== 'string'
      || !value.generationRequestId
      || (value.generationId !== null && typeof value.generationId !== 'string')
      || (value.lastEventId !== null && typeof value.lastEventId !== 'string')
      || typeof value.state !== 'string'
      || typeof value.updatedAt !== 'string'
    ) return null;
    return value as PersistedArenaGeneration;
  } catch {
    return null;
  }
};

const save = (
  storage: StoragePort | null,
  key: string,
  value: PersistedArenaGeneration,
): void => {
  try {
    const serialized = JSON.stringify(value);
    storage?.setItem(key, serialized);
    // Keep the legacy pointer for diagnostics and older callers. The resume path
    // itself only reads the body-scoped key, so parallel tabs/intents cannot steal it.
    storage?.setItem(ARENA_GENERATION_CLIENT_STATE_KEY, serialized);
  } catch {
    // Resume persistence is best effort; the live stream remains authoritative.
  }
};

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(',')}}`;
};

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const compareDecimal = (left: string, right: string): number => {
  const normalizedLeft = left.replace(/^0+(?=\d)/u, '');
  const normalizedRight = right.replace(/^0+(?=\d)/u, '');
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length < normalizedRight.length ? -1 : 1;
  }
  return normalizedLeft < normalizedRight ? -1 : normalizedLeft > normalizedRight ? 1 : 0;
};

const compareStreamIds = (left: string, right: string): number | null => {
  const leftMatch = left.match(/^(\d+)-(\d+)$/u);
  const rightMatch = right.match(/^(\d+)-(\d+)$/u);
  if (!leftMatch || !rightMatch) return null;
  const milliseconds = compareDecimal(leftMatch[1]!, rightMatch[1]!);
  return milliseconds !== 0 ? milliseconds : compareDecimal(leftMatch[2]!, rightMatch[2]!);
};

const actorToken = (storage: StoragePort | null): string | null => {
  try {
    const stored = storage?.getItem(ARENA_GENERATION_ACTOR_TOKEN_KEY)?.trim() || null;
    if (stored) inMemoryActorToken = stored;
    return stored ?? inMemoryActorToken;
  } catch {
    return inMemoryActorToken;
  }
};

const ensureActorToken = (storage: StoragePort | null): string | null => {
  const existing = actorToken(storage);
  if (existing) return existing;
  const bootstrap = `bootstrap.${crypto.randomUUID()}`;
  inMemoryActorToken = bootstrap;
  try {
    storage?.setItem(ARENA_GENERATION_ACTOR_TOKEN_KEY, bootstrap);
    return bootstrap;
  } catch {
    return null;
  }
};

const captureActorToken = (storage: StoragePort | null, response: Response): void => {
  const token = response.headers.get(ARENA_GENERATION_ACTOR_TOKEN_HEADER)?.trim();
  if (!token) return;
  inMemoryActorToken = token;
  try {
    storage?.setItem(ARENA_GENERATION_ACTOR_TOKEN_KEY, token);
  } catch {
    // A blocked storage backend only disables anonymous cross-network resume.
  }
};

const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => {
  const timer = setTimeout(resolve, milliseconds);
  timer.unref?.();
});

const waitForReconnectOpportunity = (
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> => {
  if (
    typeof window === 'undefined'
    || typeof window.addEventListener !== 'function'
    || typeof document === 'undefined'
    || typeof document.addEventListener !== 'function'
  ) return delay(milliseconds);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener('online', finish);
      document.removeEventListener('visibilitychange', onVisibility);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') finish();
    };
    const timer = window.setTimeout(finish, milliseconds);
    window.addEventListener('online', finish, { once: true });
    document.addEventListener('visibilitychange', onVisibility);
    signal?.addEventListener('abort', finish, { once: true });
  });
};

const terminalState = (event: string, data: string): ArenaGenerationConnectionState | null => {
  if (event === 'done') {
    try {
      const parsed = JSON.parse(data) as { status?: unknown };
      return parsed.status === 'cancelled' ? 'cancelled' : 'completed';
    } catch {
      return 'completed';
    }
  }
  if (event !== 'error') return null;
  try {
    const parsed = JSON.parse(data) as { status?: unknown };
    return parsed.status === 'producer_lost' ? 'producer_lost' : 'failed';
  } catch {
    return 'failed';
  }
};

const withActorToken = (
  headersInit: HeadersInit,
  storage: StoragePort | null,
  createIfMissing = false,
): Headers => {
  const headers = new Headers(headersInit);
  const token = createIfMissing ? ensureActorToken(storage) : actorToken(storage);
  if (token) headers.set(ARENA_GENERATION_ACTOR_TOKEN_HEADER, token);
  return headers;
};

export const withArenaGenerationActorToken = (
  headersInit: HeadersInit = {},
  options: { storage?: StoragePort | null; createIfMissing?: boolean } = {},
): Headers => withActorToken(
  headersInit,
  options.storage === undefined ? defaultActorStorage() : options.storage,
  options.createIfMissing ?? true,
);

export const captureArenaGenerationActorToken = (
  response: Response,
  storage: StoragePort | null = defaultActorStorage(),
): void => captureActorToken(storage, response);

export const openArenaGenerationStream = async (
  options: OpenArenaGenerationStreamOptions,
): Promise<Response> => {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const actorStorage = options.storage === undefined ? defaultActorStorage() : options.storage;
  const now = options.now ?? (() => new Date());
  const random = options.random ?? Math.random;
  const maxAttempts = options.maxReconnectAttempts ?? 8;
  const baseDelayMs = options.baseReconnectDelayMs ?? 500;
  const bodyHash = await sha256(canonicalJson(options.body));
  const stateIdentity = await sha256(`${options.endpoint}\n${bodyHash}`);
  const scopedStateKey = `${ARENA_GENERATION_CLIENT_STATE_KEY}:${stateIdentity}`;
  const previous = readPersistedArenaGeneration(storage, scopedStateKey);
  const resumablePrevious = previous
    && previous.version === 2
    && (
      previous.endpoint === options.endpoint
      && previous.bodyHash === bodyHash
    )
    && [
      'connecting',
      'generating',
      'recovering_initial',
      'reconnecting',
      'resuming',
      'unknown',
    ].includes(previous.state)
    ? previous
    : null;
  const generationRequestId = resumablePrevious?.generationRequestId
    ?? options.generationRequestId
    ?? crypto.randomUUID();
  let generationId = resumablePrevious?.generationId ?? null;
  let lastEventId = resumablePrevious?.lastEventId ?? null;
  let state: ArenaGenerationConnectionState = resumablePrevious?.generationId
    ? 'resuming'
    : resumablePrevious
      ? 'recovering_initial'
      : 'connecting';
  let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let stopped = false;
  let terminal = false;
  let connectedViaResume = false;
  const updateState = (next: ArenaGenerationConnectionState): void => {
    state = next;
    options.onStateChange?.(next);
    save(storage, scopedStateKey, {
      version: 2,
      generationRequestId,
      generationId,
      lastEventId,
      state,
      updatedAt: now().toISOString(),
      endpoint: options.endpoint,
      bodyHash,
    });
  };

  const fetchResume = async (): Promise<Response> => {
    if (!generationId) throw new Error('ARENA_GENERATION_ID_MISSING');
    const cursor = lastEventId ? `?after=${encodeURIComponent(lastEventId)}` : '';
    updateState('resuming');
    connectedViaResume = true;
    return options.fetcher(`/api/arena/generations/${encodeURIComponent(generationId)}/stream${cursor}`, {
      method: 'GET',
      headers: withActorToken({ Accept: 'text/event-stream' }, actorStorage),
      signal: options.signal,
    });
  };

  updateState(state);
  const initialHeaders = withActorToken(options.headers, actorStorage, true);
  initialHeaders.set('Accept', 'text/event-stream');
  initialHeaders.set('Content-Type', 'application/json');
  const createBody = JSON.stringify({ ...options.body, generationRequestId });
  const cancelOnExplicitAbort = (): void => {
    const cancelReason = options.signal?.reason === STREAM_ABORT_REASON_CONTENT_POLICY
      ? 'content_policy'
      : options.signal?.reason === STREAM_ABORT_REASON_USER
        ? 'user'
        : null;
    if (!cancelReason || terminal) return;
    stopped = true;
    void currentReader?.cancel(cancelReason).catch(() => undefined);
    const cancelTarget = generationId
      ? `/api/arena/generations/${encodeURIComponent(generationId)}/cancel`
      : options.endpoint;
    void options.fetcher(cancelTarget, generationId
        ? {
          method: 'POST',
          headers: withActorToken({ 'Content-Type': 'application/json' }, actorStorage),
          body: JSON.stringify({ reason: cancelReason }),
        }
        : {
          method: 'DELETE',
          headers: withActorToken({ 'Content-Type': 'application/json' }, actorStorage),
          body: JSON.stringify({ generationRequestId, reason: cancelReason }),
        }).catch(() => undefined);
    updateState('cancelled');
  };
  options.signal?.addEventListener('abort', cancelOnExplicitAbort, { once: true });
  if (options.signal?.aborted) cancelOnExplicitAbort();
  if (stopped) throw new Error('ARENA_GENERATION_CANCELLED');
  const fetchCreate = (): Promise<Response> => options.fetcher(options.endpoint, {
      method: 'POST',
      headers: initialHeaders,
      body: createBody,
      signal: options.signal,
    });
  const fetchLookup = (): Promise<Response> => options.fetcher(
    `/api/arena/generation-requests/${encodeURIComponent(generationRequestId)}`,
    {
      method: 'GET',
      headers: withActorToken({ Accept: 'application/json' }, actorStorage),
      signal: options.signal,
    },
  );
  const fetchResumeWithRetry = async (): Promise<Response> => {
    let attempt = 0;
    while (true) {
      try {
        const resumed = await fetchResume();
        captureActorToken(actorStorage, resumed);
        const transient = resumed.status === 408
          || resumed.status === 429
          || resumed.status >= 500;
        if (!transient || attempt >= maxAttempts) return resumed;
        await resumed.body?.cancel('retry initial generation resume').catch(() => undefined);
      } catch (error) {
        if (options.signal?.aborted || attempt >= maxAttempts) throw error;
      }
      updateState('reconnecting');
      const exponential = Math.min(30_000, baseDelayMs * (2 ** attempt));
      await waitForReconnectOpportunity(
        Math.floor(exponential * (0.75 + random() * 0.5)),
        options.signal,
      );
      attempt += 1;
    }
  };
  const isKnownGenerationStatus = (value: unknown): boolean => (
    typeof value === 'string'
    && [
      'reserved',
      'running',
      'finalizing',
      'completed',
      'failed',
      'cancelled',
      'producer_lost',
    ].includes(value)
  );
  const recoverInitial = async (): Promise<Response> => {
    updateState('recovering_initial');
    const lookupAttempts = Math.max(1, maxAttempts + 1);
    for (let attempt = 0; attempt < lookupAttempts; attempt += 1) {
      if (attempt > 0) {
        const exponential = Math.min(30_000, baseDelayMs * (2 ** (attempt - 1)));
        await waitForReconnectOpportunity(
          Math.floor(exponential * (0.75 + random() * 0.5)),
          options.signal,
        );
      }
      if (options.signal?.aborted) throw new Error('ARENA_GENERATION_CANCELLED');
      let lookup: Response;
      try {
        lookup = await fetchLookup();
      } catch (error) {
        if (options.signal?.aborted) throw error;
        continue;
      }
      captureActorToken(actorStorage, lookup);
      if (lookup.ok) {
        let payload: unknown = null;
        try {
          payload = await lookup.json();
        } catch (error) {
          if (options.signal?.aborted) throw error;
          // A malformed success is ambiguous and consumes the same lookup budget.
        }
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          const record = payload as Record<string, unknown>;
          if (
            record.generationRequestId === generationRequestId
            && typeof record.generationId === 'string'
            && record.generationId.length > 0
            && isKnownGenerationStatus(record.status)
          ) {
            generationId = record.generationId;
            return fetchResumeWithRetry();
          }
        }
        continue;
      }
      const retryable = lookup.status === 404
        || lookup.status === 408
        || lookup.status === 429
        || lookup.status >= 500;
      if (!retryable) {
        updateState('unknown');
        return lookup;
      }
      await lookup.body?.cancel('retry generation request lookup').catch(() => undefined);
    }
    updateState('unknown');
    throw new Error('ARENA_GENERATION_STATE_UNKNOWN');
  };
  let response!: Response;
  try {
    if (resumablePrevious?.generationId) {
      response = await fetchResumeWithRetry();
    } else if (resumablePrevious) {
      response = await recoverInitial();
    } else {
      let created: Response | null = null;
      try {
        created = await fetchCreate();
      } catch (error) {
        if (options.signal?.aborted) throw error;
        response = await recoverInitial();
      }
      if (created) {
        captureActorToken(actorStorage, created);
        generationId = created.headers.get('x-mahoshojo-generation-id')?.trim() || generationId;
        const completeSuccess = created.ok && created.body && generationId;
        const ambiguous = (created.ok && !completeSuccess)
          || created.status === 408
          || created.status === 429
          || created.status >= 500;
        if (completeSuccess) {
          response = created;
        } else if (ambiguous) {
          await created.body?.cancel('recover incomplete generation handshake').catch(() => undefined);
          response = generationId ? await fetchResumeWithRetry() : await recoverInitial();
        } else {
          updateState('failed');
          response = created;
        }
      }
    }
  } catch (error) {
    options.signal?.removeEventListener('abort', cancelOnExplicitAbort);
    throw error;
  }
  captureActorToken(actorStorage, response);
  generationId = response.headers.get('x-mahoshojo-generation-id')?.trim() || generationId;
  if (!response.ok || !response.body || !generationId) {
    options.signal?.removeEventListener('abort', cancelOnExplicitAbort);
    return response;
  }
  updateState(connectedViaResume ? 'resuming' : 'generating');

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const pump = async (): Promise<void> => {
        let reconnectAttempt = 0;
        const reconnect = async (): Promise<void> => {
          while (true) {
            if (reconnectAttempt >= maxAttempts) {
              throw new Error('ARENA_RESUME_ATTEMPTS_EXHAUSTED');
            }
            updateState('reconnecting');
            const exponential = Math.min(30_000, baseDelayMs * (2 ** reconnectAttempt));
            await waitForReconnectOpportunity(
              Math.floor(exponential * (0.75 + random() * 0.5)),
              options.signal,
            );
            reconnectAttempt += 1;
            try {
              response = await fetchResume();
              captureActorToken(actorStorage, response);
              if (![429, 502, 503, 504].includes(response.status)) return;
            } catch (error) {
              if (options.signal?.aborted || reconnectAttempt >= maxAttempts) throw error;
            }
          }
        };
        try {
          while (!stopped && !terminal) {
            if (!response.ok || !response.body) {
              if ([429, 502, 503, 504].includes(response.status)) {
                await reconnect();
                continue;
              }
              throw new Error(`ARENA_RESUME_HTTP_${response.status}`);
            }
            currentReader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            try {
              while (!stopped) {
                const next = await currentReader.read();
                if (next.done) break;
                buffer += decoder.decode(next.value, { stream: true }).replace(/\r\n?/gu, '\n');
                let separator = buffer.indexOf('\n\n');
                while (separator >= 0) {
                  const block = buffer.slice(0, separator);
                  buffer = buffer.slice(separator + 2);
                  const parsed = parseGenerationSseBlock(block);
                  if (parsed?.id) {
                    const comparison = lastEventId ? compareStreamIds(parsed.id, lastEventId) : 1;
                    if (comparison === null || comparison <= 0) {
                      separator = buffer.indexOf('\n\n');
                      continue;
                    }
                    lastEventId = parsed.id;
                  }
                  const nextTerminal = parsed ? terminalState(parsed.event, parsed.data) : null;
                  controller.enqueue(encoder.encode(`${block}\n\n`));
                  updateState(nextTerminal ?? 'generating');
                  if (nextTerminal) {
                    terminal = true;
                    break;
                  }
                  separator = buffer.indexOf('\n\n');
                }
                if (terminal) break;
              }
            } catch {
              // Connection-level failures are recoverable. Cursor only advances after
              // a complete SSE block, so a partial block is safely replayed in full.
            } finally {
              currentReader.releaseLock();
              currentReader = null;
            }
            if (stopped || terminal) break;
            await reconnect();
          }
          if (!stopped) controller.close();
        } catch (error) {
          if (!stopped) {
            updateState('failed');
            controller.error(error);
          }
        } finally {
          options.signal?.removeEventListener('abort', cancelOnExplicitAbort);
        }
      };
      void pump();
    },
    cancel(reason) {
      stopped = true;
      void currentReader?.cancel(reason).catch(() => undefined);
      options.signal?.removeEventListener('abort', cancelOnExplicitAbort);
    },
  });

  const headers = new Headers(response.headers);
  headers.set('X-Mahoshojo-Generation-Id', generationId);
  headers.set('X-Mahoshojo-Generation-Request-Id', generationRequestId);
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
