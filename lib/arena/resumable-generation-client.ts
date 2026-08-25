import { parseGenerationSseBlock } from '@mahoshojo/hosted-api/arena-generation/sse';

export const ARENA_GENERATION_CLIENT_STATE_KEY = 'mahoshojo:arena:generation:v1';
export const ARENA_GENERATION_ACTOR_TOKEN_KEY = 'mahoshojo:arena:generation-actor:v1';
export const ARENA_GENERATION_ACTOR_TOKEN_HEADER = 'X-Mahoshojo-Generation-Actor-Token';

export type ArenaGenerationConnectionState =
  | 'connecting'
  | 'generating'
  | 'reconnecting'
  | 'resuming'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'producer_lost';

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
    && ['connecting', 'generating', 'reconnecting', 'resuming'].includes(previous.state)
    ? previous
    : null;
  const generationRequestId = resumablePrevious?.generationRequestId
    ?? options.generationRequestId
    ?? crypto.randomUUID();
  let generationId = resumablePrevious?.generationId ?? null;
  let lastEventId = resumablePrevious?.lastEventId ?? null;
  let state: ArenaGenerationConnectionState = resumablePrevious?.generationId
    ? 'resuming'
    : 'connecting';
  let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let stopped = false;
  let terminal = false;
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
  const cancelOnUserAbort = (): void => {
    if (options.signal?.reason !== 'user' || terminal) return;
    stopped = true;
    void currentReader?.cancel('user').catch(() => undefined);
    const cancelTarget = generationId
      ? `/api/arena/generations/${encodeURIComponent(generationId)}/cancel`
      : options.endpoint;
    void options.fetcher(cancelTarget, generationId
      ? {
          method: 'POST',
          headers: withActorToken({ 'Content-Type': 'application/json' }, actorStorage),
        }
      : {
          method: 'DELETE',
          headers: withActorToken({ 'Content-Type': 'application/json' }, actorStorage),
          body: JSON.stringify({ generationRequestId }),
        }).catch(() => undefined);
    updateState('cancelled');
  };
  options.signal?.addEventListener('abort', cancelOnUserAbort, { once: true });
  if (options.signal?.aborted) cancelOnUserAbort();
  if (stopped) throw new Error('ARENA_GENERATION_CANCELLED');
  const fetchInitial = (): Promise<Response> => resumablePrevious?.generationId
    ? fetchResume()
    : options.fetcher(options.endpoint, {
      method: 'POST',
      headers: initialHeaders,
      body: createBody,
      signal: options.signal,
    });
  let initialAttempt = 0;
  let response: Response;
  while (true) {
    try {
      response = await fetchInitial();
      captureActorToken(actorStorage, response);
      generationId = response.headers.get('x-mahoshojo-generation-id')?.trim() || generationId;
      const incompleteSuccess = response.ok && (!response.body || !generationId);
      const transientFailure = [429, 502, 503, 504].includes(response.status);
      if (!incompleteSuccess && !transientFailure) break;
      await response.body?.cancel('retry incomplete generation handshake').catch(() => undefined);
      if (options.signal?.aborted || initialAttempt >= maxAttempts) {
        if (!incompleteSuccess) break;
        response = new Response(JSON.stringify({
          code: 'ARENA_GENERATION_HANDSHAKE_INCOMPLETE',
          error: 'Arena generation handshake incomplete',
        }), {
          status: 502,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
        break;
      }
      updateState('reconnecting');
      const exponential = Math.min(30_000, baseDelayMs * (2 ** initialAttempt));
      await waitForReconnectOpportunity(
        Math.floor(exponential * (0.75 + random() * 0.5)),
        options.signal,
      );
      initialAttempt += 1;
    } catch (error) {
      if (options.signal?.aborted || initialAttempt >= maxAttempts) throw error;
      updateState('reconnecting');
      const exponential = Math.min(30_000, baseDelayMs * (2 ** initialAttempt));
      await waitForReconnectOpportunity(
        Math.floor(exponential * (0.75 + random() * 0.5)),
        options.signal,
      );
      initialAttempt += 1;
    }
  }
  if (!response.ok || !response.body || !generationId) {
    options.signal?.removeEventListener('abort', cancelOnUserAbort);
    return response;
  }
  updateState(resumablePrevious?.generationId ? 'resuming' : 'generating');

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
          options.signal?.removeEventListener('abort', cancelOnUserAbort);
        }
      };
      void pump();
    },
    cancel(reason) {
      stopped = true;
      void currentReader?.cancel(reason).catch(() => undefined);
      options.signal?.removeEventListener('abort', cancelOnUserAbort);
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
