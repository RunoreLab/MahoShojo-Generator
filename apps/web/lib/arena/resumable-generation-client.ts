import {
  openArenaGenerationStreamClient,
  type PersistedArenaGeneration, type ArenaGenerationConnectionState,
} from '@mahoshojo/hosted-api/arena-generation/client';
export {
  arenaGenerationConnectionNotice, isArenaGenerationRecoveryState, mergeArenaGenerationSnapshotMarkdown,
} from '@mahoshojo/hosted-api/arena-generation/client';
export type { ArenaGenerationConnectionState, PersistedArenaGeneration } from '@mahoshojo/hosted-api/arena-generation/client';

import {
  STREAM_ABORT_REASON_CONTENT_POLICY,
  STREAM_ABORT_REASON_USER,
} from '@/lib/stream/abort';
import {
  isGenerationApiClientErrorCode,
  isGenerationApiRoutePin,
  type GenerationApiRoutePin,
} from '@/lib/hono-api-client';
import { encodeUtf8, secureRandomUUID, sha256Hex } from '@/lib/crypto';

export const ARENA_GENERATION_CLIENT_STATE_KEY = 'mahoshojo:arena:generation:v1';
export const ARENA_GENERATION_ACTOR_TOKEN_KEY = 'mahoshojo:arena:generation-actor:v1';
export const ARENA_GENERATION_ACTOR_TOKEN_HEADER = 'X-Mahoshojo-Generation-Actor-Token';

const GENERATION_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;

const isGenerationIdentifier = (value: unknown): value is string => (
  typeof value === 'string' && GENERATION_IDENTIFIER_PATTERN.test(value)
);

const shouldRecoverInitialCreateError = (error: unknown): boolean => (
  error instanceof TypeError
  || isGenerationApiClientErrorCode(error, 'AMBIGUOUS_OPERATION_OUTCOME')
);

type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

let inMemoryActorToken: string | null = null;

export type OpenArenaGenerationStreamOptions = {
  endpoint: string;
  body: Record<string, unknown>;
  headers: HeadersInit;
  signal?: AbortSignal;
  fetcher(
    _input: string,
    _init?: RequestInit,
    _routePin?: GenerationApiRoutePin,
    _onRoutePinSelected?: (_routePin: GenerationApiRoutePin) => void,
  ): Promise<Response>;
  storage?: StoragePort | null;
  generationRequestId?: string;
  maxReconnectAttempts?: number;
  baseReconnectDelayMs?: number;
  cancelConfirmationTimeoutMs?: number;
  random?: () => number;
  now?: () => Date;
  isInitialCreateOutcomeAmbiguous?(_error: unknown): boolean;
  getInitialRoutePin?(): GenerationApiRoutePin | null;
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
      (value.version !== 1 && value.version !== 2 && value.version !== 3)
      || !isGenerationIdentifier(value.generationRequestId)
      || (value.generationId !== null && !isGenerationIdentifier(value.generationId))
      || (value.lastEventId !== null && typeof value.lastEventId !== 'string')
      || typeof value.state !== 'string'
      || typeof value.updatedAt !== 'string'
      || (
        value.version === 3
        && !(
          Object.prototype.hasOwnProperty.call(value, 'routePin')
          && (value.routePin === null || isGenerationApiRoutePin(value.routePin))
        )
      )
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
  const bootstrap = `bootstrap.${secureRandomUUID()}`;
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
  if (options.generationRequestId !== undefined && !isGenerationIdentifier(options.generationRequestId)) {
    throw new Error('ARENA_GENERATION_REQUEST_ID_INVALID');
  }
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const actorStorage = options.storage === undefined ? defaultActorStorage() : options.storage;
  const bodyHash = await sha256Hex(canonicalJson(options.body));
  const stateIdentity = await sha256Hex(`${options.endpoint}\n${bodyHash}`);
  const scopedStateKey = `${ARENA_GENERATION_CLIENT_STATE_KEY}:${stateIdentity}`;
  let initialHeaders: Headers;
  let createBody: string;
  return openArenaGenerationStreamClient({
    endpoint: options.endpoint, bodyHash, signal: options.signal,
    generationRequestId: options.generationRequestId,
    maxReconnectAttempts: options.maxReconnectAttempts, baseReconnectDelayMs: options.baseReconnectDelayMs,
    cancelConfirmationTimeoutMs: options.cancelConfirmationTimeoutMs,
    random: options.random, now: options.now,
    getInitialRoutePin: options.getInitialRoutePin, onStateChange: options.onStateChange,
  }, {
    loadState: () => readPersistedArenaGeneration(storage, scopedStateKey),
    saveState: (value) => save(storage, scopedStateKey, value),
    createRequestId: secureRandomUUID, encodeUtf8, waitForReconnectOpportunity,
    isInitialCreateOutcomeAmbiguous: options.isInitialCreateOutcomeAmbiguous ?? shouldRecoverInitialCreateError,
    classifyExplicitAbort: (reason) => reason === STREAM_ABORT_REASON_CONTENT_POLICY
      ? 'content_policy' : reason === STREAM_ABORT_REASON_USER ? 'user' : null,
    prepareCreate: (generationRequestId) => {
      initialHeaders = withActorToken(options.headers, actorStorage, true);
      initialHeaders.set('Accept', 'text/event-stream');
      initialHeaders.set('Content-Type', 'application/json');
      createBody = JSON.stringify({ ...options.body, generationRequestId });
    },
    observeResponse: (response) => captureActorToken(actorStorage, response),
    transport: {
      create: ({ signal, onRoutePinSelected }) => options.fetcher(options.endpoint, {
        method: 'POST', headers: initialHeaders, body: createBody, signal,
      }, undefined, onRoutePinSelected),
      lookup: ({ generationRequestId, signal, routePin }) => options.fetcher(
        `/api/arena/generation-requests/${encodeURIComponent(generationRequestId)}`,
        { method: 'GET', headers: withActorToken({ Accept: 'application/json' }, actorStorage), signal }, routePin,
      ),
      resume: ({ generationId, lastEventId, signal, routePin }) => options.fetcher(
        `/api/arena/generations/${encodeURIComponent(generationId)}/stream${lastEventId ? `?after=${encodeURIComponent(lastEventId)}` : ''}`,
        { method: 'GET', headers: withActorToken({ Accept: 'text/event-stream' }, actorStorage), signal }, routePin,
      ),
      // Existing Web policy: cancel is an independent primary-only intent, not a pinned safe-read.
      cancel: ({ generationId, generationRequestId, reason, signal }) => options.fetcher(
        generationId ? `/api/arena/generations/${encodeURIComponent(generationId)}/cancel` : options.endpoint,
        { method: generationId ? 'POST' : 'DELETE',
          headers: withActorToken({ 'Content-Type': 'application/json' }, actorStorage),
          body: JSON.stringify(generationId ? { reason } : { generationRequestId, reason }), signal },
      ),
    },
  });
};
