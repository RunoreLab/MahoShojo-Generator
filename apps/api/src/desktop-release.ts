import {
  DESKTOP_RELEASE,
  parseDesktopReleaseProjection,
  parsePublishedDesktopRelease,
  type DesktopReleaseFailure,
  type PublishedDesktopRelease,
} from '@mahoshojo/contracts/desktop-release';
import type { Context, Env, Hono } from 'hono';

const RELEASE_ENDPOINT = `https://api.github.com/repos/${DESKTOP_RELEASE.repository}/releases/tags/desktop-v${DESKTOP_RELEASE.version}`;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const CACHE_TTL_MS = 300_000;
const UPSTREAM_COOLDOWN_MS = 120_000;
const FETCH_TIMEOUT_MS = 5_000;

type ReleaseResult =
  | { readonly kind: 'published'; readonly release: PublishedDesktopRelease }
  | { readonly kind: 'preparing' }
  | {
    readonly kind: 'unavailable';
    readonly failure: DesktopReleaseFailure;
    readonly upstreamStatus?: number;
    readonly retryAfter?: number;
  };

export type DesktopReleaseFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type DesktopReleaseDependencies = {
  readonly fetch?: DesktopReleaseFetch;
  readonly now?: () => number;
  readonly timeoutMs?: number;
};

export type DesktopReleaseService = ReturnType<typeof createDesktopReleaseService>;

const isValidHttpStatus = (status: number): boolean => (
  Number.isInteger(status) && status >= 100 && status <= 599
);

const parseRetryAfter = (value: string | null): number | undefined => {
  if (value === null || !/^\d+$/u.test(value.trim())) return undefined;
  const seconds = Number(value.trim());
  return Number.isInteger(seconds) && seconds >= 1 && seconds <= 3600 ? seconds : undefined;
};

const cancelResponseBody = async (response: Response): Promise<void> => {
  try {
    await response.body?.cancel();
  } catch {
    // The response is already aborted or closed; this must not alter the public outcome.
  }
};

class UpstreamBodyError extends Error {
  constructor(readonly failure: 'invalid-json' | 'network') {
    super(failure);
  }
}

const readBoundedJson = async (response: Response, signal: AbortSignal): Promise<unknown> => {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const normalizedLength = contentLength.trim();
    if (!/^\d+$/u.test(normalizedLength) || Number(normalizedLength) > MAX_RESPONSE_BYTES) {
      await cancelResponseBody(response);
      throw new UpstreamBodyError('invalid-json');
    }
  }

  if (!response.body) throw new UpstreamBodyError('invalid-json');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const cancelReader = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', cancelReader, { once: true });
  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        throw new UpstreamBodyError('network');
      }
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new UpstreamBodyError('invalid-json');
      }
      chunks.push(chunk.value);
    }
  } finally {
    signal.removeEventListener('abort', cancelReader);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new UpstreamBodyError('invalid-json');
  }
};

const fetchPublishedRelease = async (
  fetcher: DesktopReleaseFetch,
  timeoutMs: number,
): Promise<ReleaseResult> => {
  const controller = new AbortController();
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let rejectTimeout: ((reason: Error) => void) | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject;
  });

  const request = async (): Promise<ReleaseResult> => {
    let response: Response;
    try {
      response = await fetcher(RELEASE_ENDPOINT, {
        method: 'GET',
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'MahoShojo-Generator-Hono',
          'x-github-api-version': '2022-11-28',
        },
        redirect: 'error',
        signal: controller.signal,
      });
    } catch {
      return timedOut
        ? { kind: 'unavailable', failure: 'timeout' }
        : { kind: 'unavailable', failure: 'network' };
    }

    const upstreamStatus = response.status;
    if (upstreamStatus === 404 || upstreamStatus === 204) {
      await cancelResponseBody(response);
      return { kind: 'preparing' };
    }
    const isRateLimited = upstreamStatus === 429
      || (upstreamStatus === 403 && response.headers.get('x-ratelimit-remaining') === '0');
    if (isRateLimited) {
      const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
      await cancelResponseBody(response);
      return {
        kind: 'unavailable',
        failure: 'rate-limited',
        ...(isValidHttpStatus(upstreamStatus) ? { upstreamStatus } : {}),
        ...(retryAfter === undefined ? {} : { retryAfter }),
      };
    }
    if (!response.ok) {
      await cancelResponseBody(response);
      return {
        kind: 'unavailable',
        failure: 'upstream-http-error',
        ...(isValidHttpStatus(upstreamStatus) ? { upstreamStatus } : {}),
      };
    }

    try {
      const raw = await readBoundedJson(response, controller.signal);
      const release = parsePublishedDesktopRelease(raw);
      return release ? { kind: 'published', release } : { kind: 'preparing' };
    } catch (error) {
      if (timedOut) return { kind: 'unavailable', failure: 'timeout' };
      if (error instanceof UpstreamBodyError) {
        return {
          kind: 'unavailable',
          failure: error.failure,
          ...(isValidHttpStatus(upstreamStatus) ? { upstreamStatus } : {}),
        };
      }
      return {
        kind: 'unavailable',
        failure: 'network',
        ...(isValidHttpStatus(upstreamStatus) ? { upstreamStatus } : {}),
      };
    }
  };

  timeoutId = setTimeout(() => {
    timedOut = true;
    rejectTimeout?.(new Error('timeout'));
    controller.abort();
  }, timeoutMs);
  try {
    return await Promise.race([request(), timeout]);
  } catch {
    return { kind: 'unavailable', failure: 'timeout' };
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
};

/** A per-app, single-flight service with a short cache for validated published metadata only. */
export const createDesktopReleaseService = (dependencies: DesktopReleaseDependencies = {}) => {
  const fetcher = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
  const now = dependencies.now ?? Date.now;
  const timeoutMs = dependencies.timeoutMs ?? FETCH_TIMEOUT_MS;
  let cached: { readonly value: unknown; readonly expiresAt: number } | undefined;
  let cooldown: { readonly value: Exclude<ReleaseResult, { kind: 'published' }>; readonly expiresAt: number } | undefined;
  let inFlight: Promise<ReleaseResult> | undefined;

  const get = async (): Promise<ReleaseResult> => {
    const currentTime = now();
    if (cached && currentTime < cached.expiresAt) {
      const release = parseDesktopReleaseProjection(cached.value);
      if (release) return { kind: 'published', release };
      cached = undefined;
      return { kind: 'unavailable', failure: 'invalid-cache' };
    }
    cached = undefined;
    if (cooldown && currentTime < cooldown.expiresAt) return cooldown.value;
    cooldown = undefined;
    if (inFlight) return inFlight;

    const request = fetchPublishedRelease(fetcher, timeoutMs);
    inFlight = request;
    try {
      const result = await request;
      if (result.kind === 'published') {
        cached = { value: { ...result.release }, expiresAt: now() + CACHE_TTL_MS };
        cooldown = undefined;
      } else {
        const cooldownMs = result.kind === 'unavailable' && result.failure === 'rate-limited'
          && result.retryAfter !== undefined
          ? Math.max(120, result.retryAfter) * 1_000
          : UPSTREAM_COOLDOWN_MS;
        cooldown = { value: result, expiresAt: now() + cooldownMs };
      }
      return result;
    } finally {
      if (inFlight === request) inFlight = undefined;
    }
  };

  return { get };
};

const failureHeaders = (result: Extract<ReleaseResult, { kind: 'unavailable' }>): Record<string, string> => {
  const headers: Record<string, string> = {
    'cache-control': 'no-store',
    'x-desktop-release-failure': result.failure,
  };
  if (result.upstreamStatus !== undefined && isValidHttpStatus(result.upstreamStatus)) {
    headers['x-desktop-release-upstream-status'] = String(result.upstreamStatus);
  }
  if (result.failure === 'rate-limited' && result.retryAfter !== undefined
    && result.retryAfter >= 1 && result.retryAfter <= 3600) {
    headers['retry-after'] = String(result.retryAfter);
  }
  return headers;
};

const releaseResponse = <E extends Env>(context: Context<E>, result: ReleaseResult): Response => {
  if (result.kind === 'published') {
    const headers = {
      'cache-control': 'public, max-age=300',
      'content-type': 'application/json; charset=UTF-8',
    };
    return context.req.method === 'HEAD'
      ? context.body(null, 200, headers)
      : context.json(result.release, 200, headers);
  }
  if (result.kind === 'preparing') {
    return context.body(null, 204, { 'cache-control': 'no-store' });
  }
  return context.body(null, 503, failureHeaders(result));
};

/** Infrastructure read route; intentionally independent of the shared route registry. */
export const registerDesktopReleaseRoute = <E extends Env>(
  app: Hono<E>,
  service: DesktopReleaseService,
): void => {
  app.on(['GET', 'HEAD'], '/api/desktop/releases/stable', async (context) => (
    releaseResponse(context, await service.get())
  ));
};
