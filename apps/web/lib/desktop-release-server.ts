import 'server-only';

import {
  DESKTOP_RELEASE,
  parseDesktopReleaseProjection,
  type DesktopReleaseFailure,
  type PublishedDesktopRelease,
} from '@mahoshojo/contracts/desktop-release';
import { withEdgeCache } from './edge-cache';

type DesktopReleaseUnavailable = {
  status: 'unavailable';
  failure?: DesktopReleaseFailure;
  upstreamStatus?: number;
  retryAfterSeconds?: number;
};
export type DesktopReleaseStatus = PublishedDesktopRelease | { status: 'preparing' } | DesktopReleaseUnavailable;

const RELEASE_CACHE_URL = `https://mahoshojo.colanns.me/_edge-cache/desktop-release/${encodeURIComponent(DESKTOP_RELEASE.version)}`;
const RELEASE_CACHE_TTL_SECONDS = 300;
const RELEASE_SERVICE_URL = 'https://homura.colanns.me/api/desktop/releases/stable';
const RELEASE_FAILURES = new Set<DesktopReleaseFailure>([
  'network', 'timeout', 'upstream-http-error', 'rate-limited', 'invalid-json', 'invalid-cache',
]);

function boundedRetryAfter(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= 3600 ? seconds : undefined;
}

function logUpstreamFailure(failure: DesktopReleaseFailure, upstreamStatus?: number, retryAfterSeconds?: number) {
  console.warn('[desktop-release] Release service lookup failed', {
    failure,
    ...(upstreamStatus !== undefined ? { upstreamStatus } : {}),
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  });
}

function unavailableResponse(
  failure: DesktopReleaseFailure,
  upstreamStatus?: number,
  retryAfterSeconds?: number,
): Response {
  const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Desktop-Release-Failure': failure });
  if (Number.isInteger(upstreamStatus) && upstreamStatus! >= 100 && upstreamStatus! <= 599) {
    headers.set('X-Desktop-Release-Upstream-Status', String(upstreamStatus));
  }
  if (Number.isInteger(retryAfterSeconds) && retryAfterSeconds! >= 1 && retryAfterSeconds! <= 3600) {
    headers.set('Retry-After', String(retryAfterSeconds));
  }
  return new Response(null, { status: 503, headers });
}

function unavailableFromResponse(response: Response): DesktopReleaseUnavailable {
  const rawFailure = response.headers.get('X-Desktop-Release-Failure');
  const failure = rawFailure && RELEASE_FAILURES.has(rawFailure as DesktopReleaseFailure)
    ? rawFailure as DesktopReleaseFailure
    : undefined;
  const rawStatus = response.headers.get('X-Desktop-Release-Upstream-Status');
  const parsedStatus = rawStatus && /^\d{3}$/.test(rawStatus) ? Number(rawStatus) : undefined;
  const upstreamStatus = parsedStatus !== undefined && parsedStatus >= 100 && parsedStatus <= 599 ? parsedStatus : undefined;
  const retryAfterSeconds = failure === 'rate-limited'
    ? boundedRetryAfter(response.headers.get('Retry-After'))
    : undefined;
  return {
    status: 'unavailable',
    ...(failure ? { failure } : {}),
    ...(upstreamStatus !== undefined ? { upstreamStatus } : {}),
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  };
}

/** 固定服务端点公开查询；Web edge cache 仅缓存已验证的固定版本投影。 */
export async function getDesktopRelease(): Promise<DesktopReleaseStatus> {
  const cacheResponse = await withEdgeCache(
    new Request(RELEASE_CACHE_URL),
    { key: RELEASE_CACHE_URL, ttlSeconds: RELEASE_CACHE_TTL_SECONDS, awaitCacheWrite: true },
    async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let response: Response;
        try {
          response = await fetch(RELEASE_SERVICE_URL, {
            headers: { Accept: 'application/json' },
            cache: 'no-store',
            signal: AbortSignal.timeout(5000),
          });
        } catch (error) {
          const failure = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
            ? 'timeout' : 'network';
          logUpstreamFailure(failure);
          if (attempt === 0) continue;
          return unavailableResponse(failure);
        }

        if (response.status === 404) {
          logUpstreamFailure('upstream-http-error', response.status);
          return unavailableResponse('upstream-http-error', response.status);
        }
        if (response.status === 204) {
          return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
        }
        if (response.status !== 200) {
          const diagnostic = unavailableFromResponse(response);
          const failure: DesktopReleaseFailure = diagnostic.failure ?? 'upstream-http-error';
          const retryAfterSeconds = failure === 'rate-limited' ? diagnostic.retryAfterSeconds : undefined;
          const upstreamStatus = diagnostic.upstreamStatus ?? response.status;
          logUpstreamFailure(failure, upstreamStatus, retryAfterSeconds);
          if (attempt === 0 && response.status >= 500 && failure !== 'rate-limited') continue;
          return unavailableResponse(failure, upstreamStatus, retryAfterSeconds);
        }

        let rawProjection: unknown;
        try {
          rawProjection = await response.json();
        } catch {
          logUpstreamFailure('invalid-json', response.status);
          return unavailableResponse('invalid-json', response.status);
        }
        const published = parseDesktopReleaseProjection(rawProjection);
        if (!published) {
          logUpstreamFailure('invalid-cache', response.status);
          return unavailableResponse('invalid-cache', response.status);
        }
        return Response.json(published, {
          headers: { 'Cache-Control': `public, max-age=${RELEASE_CACHE_TTL_SECONDS}` },
        });
      }

      return unavailableResponse('network');
    },
  );

  if (cacheResponse.status === 204) return { status: 'preparing' };
  if (cacheResponse.status !== 200) return unavailableFromResponse(cacheResponse);

  let cachedProjection: unknown;
  try {
    cachedProjection = await cacheResponse.json();
  } catch {
    cachedProjection = null;
  }
  const cached = parseDesktopReleaseProjection(cachedProjection);
  if (cached) return cached;
  // 损坏的共享缓存保持关闭状态；等条目过期或被淘汰后才重新查询固定服务端点。
  logUpstreamFailure('invalid-cache');
  return { status: 'unavailable', failure: 'invalid-cache' };
}
