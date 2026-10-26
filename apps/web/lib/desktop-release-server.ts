import 'server-only';

import { DESKTOP_RELEASE, parsePublishedDesktopRelease, type PublishedDesktopRelease } from './desktop-release';
import { withEdgeCache } from './edge-cache';

export type DesktopReleaseFailure = 'network' | 'timeout' | 'upstream-http-error' | 'rate-limited' | 'invalid-json' | 'invalid-cache';
type DesktopReleaseUnavailable = {
  status: 'unavailable';
  failure?: DesktopReleaseFailure;
  upstreamStatus?: number;
  retryAfterSeconds?: number;
};
export type DesktopReleaseStatus = PublishedDesktopRelease | { status: 'preparing' } | DesktopReleaseUnavailable;

const RELEASE_CACHE_URL = `https://mahoshojo.colanns.me/_edge-cache/desktop-release/${encodeURIComponent(DESKTOP_RELEASE.version)}`;
const RELEASE_CACHE_TTL_SECONDS = 300;
const RELEASE_FAILURES = new Set<DesktopReleaseFailure>([
  'network', 'timeout', 'upstream-http-error', 'rate-limited', 'invalid-json', 'invalid-cache',
]);

function boundedRetryAfter(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= 3600 ? seconds : undefined;
}

function logUpstreamFailure(failure: DesktopReleaseFailure, upstreamStatus?: number, retryAfterSeconds?: number) {
  console.warn('[desktop-release] GitHub release lookup failed', {
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
  const retryAfterSeconds = boundedRetryAfter(response.headers.get('Retry-After'));
  return {
    status: 'unavailable',
    ...(failure ? { failure } : {}),
    ...(upstreamStatus !== undefined ? { upstreamStatus } : {}),
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  };
}

/** 无凭据公开查询；短缓存避免每次页面访问都消耗 GitHub API 配额。 */
export async function getDesktopRelease(): Promise<DesktopReleaseStatus> {
  const cacheResponse = await withEdgeCache(
    new Request(RELEASE_CACHE_URL),
    { key: RELEASE_CACHE_URL, ttlSeconds: RELEASE_CACHE_TTL_SECONDS, awaitCacheWrite: true },
    async () => {
      const url = `https://api.github.com/repos/${DESKTOP_RELEASE.repository}/releases/tags/desktop-v${DESKTOP_RELEASE.version}`;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let response: Response;
        try {
          response = await fetch(url, {
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'MahoShojo-Desktop-Downloads' },
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
          return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
        }
        if (!response.ok) {
          const rateLimited = response.status === 429
            || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0');
          const failure: DesktopReleaseFailure = rateLimited ? 'rate-limited' : 'upstream-http-error';
          const retryAfterSeconds = rateLimited ? boundedRetryAfter(response.headers.get('retry-after')) : undefined;
          logUpstreamFailure(failure, response.status, retryAfterSeconds);
          if (attempt === 0 && response.status >= 500) continue;
          return unavailableResponse(failure, response.status, retryAfterSeconds);
        }

        try {
          const published = parsePublishedDesktopRelease(await response.json());
          if (!published) return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
          return Response.json(published, {
            headers: { 'Cache-Control': `public, max-age=${RELEASE_CACHE_TTL_SECONDS}` },
          });
        } catch {
          logUpstreamFailure('invalid-json', response.status);
          return unavailableResponse('invalid-json', response.status);
        }
      }

      return unavailableResponse('network');
    },
  );

  if (cacheResponse.status === 204) return { status: 'preparing' };
  if (cacheResponse.status !== 200) return unavailableFromResponse(cacheResponse);

  try {
    const cached = await cacheResponse.json() as PublishedDesktopRelease;
    const installer = `MahoShojo-Generator_${DESKTOP_RELEASE.version}_x64-setup.exe`;
    const base = `https://github.com/${DESKTOP_RELEASE.repository}/releases/download/desktop-v${DESKTOP_RELEASE.version}`;
    if (cached.status === 'published'
      && cached.version === DESKTOP_RELEASE.version
      && cached.installerUrl === `${base}/${installer}`
      && cached.sha256Url === `${base}/SHA256SUMS.txt`
      && cached.manifestUrl === `${base}/latest.json`) {
      return cached;
    }
  } catch {
    // 缓存数据损坏时保持关闭状态；等该条目过期或被淘汰后才会重新验证 GitHub。
  }

  logUpstreamFailure('invalid-cache');
  return { status: 'unavailable', failure: 'invalid-cache' };
}
