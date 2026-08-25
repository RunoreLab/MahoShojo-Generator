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
  version: 1;
  generationRequestId: string;
  generationId: string | null;
  lastEventId: string | null;
  state: ArenaGenerationConnectionState;
  updatedAt: string;
};

type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

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
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

export const readPersistedArenaGeneration = (
  storage: StoragePort | null = defaultStorage(),
): PersistedArenaGeneration | null => {
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(ARENA_GENERATION_CLIENT_STATE_KEY) ?? '') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const value = parsed as Partial<PersistedArenaGeneration>;
    if (
      value.version !== 1
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

const save = (storage: StoragePort | null, value: PersistedArenaGeneration): void => {
  try {
    storage?.setItem(ARENA_GENERATION_CLIENT_STATE_KEY, JSON.stringify(value));
  } catch {
    // Resume persistence is best effort; the live stream remains authoritative.
  }
};

const actorToken = (storage: StoragePort | null): string | null => {
  try {
    return storage?.getItem(ARENA_GENERATION_ACTOR_TOKEN_KEY)?.trim() || null;
  } catch {
    return null;
  }
};

const ensureActorToken = (storage: StoragePort | null): string | null => {
  const existing = actorToken(storage);
  if (existing) return existing;
  const bootstrap = `bootstrap.${crypto.randomUUID()}`;
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

export const openArenaGenerationStream = async (
  options: OpenArenaGenerationStreamOptions,
): Promise<Response> => {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const now = options.now ?? (() => new Date());
  const random = options.random ?? Math.random;
  const maxAttempts = options.maxReconnectAttempts ?? 8;
  const baseDelayMs = options.baseReconnectDelayMs ?? 500;
  const previous = readPersistedArenaGeneration(storage);
  const resumablePrevious = previous
    && previous.generationId
    && ['connecting', 'generating', 'reconnecting', 'resuming'].includes(previous.state)
    ? previous
    : null;
  const generationRequestId = resumablePrevious?.generationRequestId
    ?? options.generationRequestId
    ?? crypto.randomUUID();
  let generationId = resumablePrevious?.generationId ?? null;
  let lastEventId = resumablePrevious?.lastEventId ?? null;
  let state: ArenaGenerationConnectionState = resumablePrevious ? 'resuming' : 'connecting';
  let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let stopped = false;
  let terminal = false;
  const updateState = (next: ArenaGenerationConnectionState): void => {
    state = next;
    options.onStateChange?.(next);
    save(storage, {
      version: 1,
      generationRequestId,
      generationId,
      lastEventId,
      state,
      updatedAt: now().toISOString(),
    });
  };

  const fetchResume = async (): Promise<Response> => {
    if (!generationId) throw new Error('ARENA_GENERATION_ID_MISSING');
    const cursor = lastEventId ? `?after=${encodeURIComponent(lastEventId)}` : '';
    updateState('resuming');
    return options.fetcher(`/api/arena/generations/${encodeURIComponent(generationId)}/stream${cursor}`, {
      method: 'GET',
      headers: withActorToken({ Accept: 'text/event-stream' }, storage),
      signal: options.signal,
    });
  };

  updateState(state);
  const initialHeaders = withActorToken(options.headers, storage, true);
  initialHeaders.set('Accept', 'text/event-stream');
  initialHeaders.set('Content-Type', 'application/json');
  const createBody = JSON.stringify({ ...options.body, generationRequestId });
  const fetchInitial = (): Promise<Response> => resumablePrevious
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
      break;
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
  captureActorToken(storage, response);
  generationId = response.headers.get('x-mahoshojo-generation-id')?.trim() || generationId;
  if (!response.ok || !response.body || !generationId) return response;
  updateState(resumablePrevious ? 'resuming' : 'generating');

  const cancelOnUserAbort = (): void => {
    if (!generationId || options.signal?.reason !== 'user' || terminal) return;
    stopped = true;
    void currentReader?.cancel('user').catch(() => undefined);
    void options.fetcher(`/api/arena/generations/${encodeURIComponent(generationId)}/cancel`, {
      method: 'POST',
      headers: withActorToken({ 'Content-Type': 'application/json' }, storage),
    }).catch(() => undefined);
    updateState('cancelled');
  };
  options.signal?.addEventListener('abort', cancelOnUserAbort, { once: true });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const pump = async (): Promise<void> => {
        let reconnectAttempt = 0;
        try {
          while (!stopped && !terminal) {
            if (!response.ok || !response.body) throw new Error(`ARENA_RESUME_HTTP_${response.status}`);
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
                  if (parsed?.id) lastEventId = parsed.id;
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
            if (reconnectAttempt >= maxAttempts) throw new Error('ARENA_RESUME_ATTEMPTS_EXHAUSTED');
            updateState('reconnecting');
            const exponential = Math.min(30_000, baseDelayMs * (2 ** reconnectAttempt));
            await waitForReconnectOpportunity(
              Math.floor(exponential * (0.75 + random() * 0.5)),
              options.signal,
            );
            reconnectAttempt += 1;
            response = await fetchResume();
            captureActorToken(storage, response);
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
