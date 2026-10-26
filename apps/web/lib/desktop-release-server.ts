import 'server-only';

import { DESKTOP_RELEASE, parsePublishedDesktopRelease, type PublishedDesktopRelease } from './desktop-release';
import { withEdgeCache } from './edge-cache';

export type DesktopReleaseStatus = PublishedDesktopRelease | { status: 'preparing' | 'unavailable' };

const RELEASE_CACHE_URL = `https://mahoshojo.invalid/_edge-cache/desktop-release/${encodeURIComponent(DESKTOP_RELEASE.version)}`;
const RELEASE_CACHE_TTL_SECONDS = 300;

function logUpstreamFailure(reason: string, response?: Response) {
  console.warn('[desktop-release] GitHub release lookup failed', {
    reason,
    status: response?.status,
    requestId: response?.headers.get('x-github-request-id') ?? undefined,
    rateLimitRemaining: response?.headers.get('x-ratelimit-remaining') ?? undefined,
    retryAfter: response?.headers.get('retry-after') ?? undefined,
  });
}

/** 无凭据公开查询；短缓存避免每次页面访问都消耗 GitHub API 配额。 */
export async function getDesktopRelease(): Promise<DesktopReleaseStatus> {
  const cacheResponse = await withEdgeCache(
    new Request(RELEASE_CACHE_URL),
    { key: RELEASE_CACHE_URL, ttlSeconds: RELEASE_CACHE_TTL_SECONDS },
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
          logUpstreamFailure(error instanceof Error ? error.name : 'fetch_error');
          if (attempt === 0) continue;
          return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store' } });
        }

        if (response.status === 404) {
          return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
        }
        if (!response.ok) {
          logUpstreamFailure('http_error', response);
          if (attempt === 0 && response.status >= 500) continue;
          return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store' } });
        }

        try {
          const published = parsePublishedDesktopRelease(await response.json());
          if (!published) return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
          return Response.json(published, {
            headers: { 'Cache-Control': `public, max-age=${RELEASE_CACHE_TTL_SECONDS}` },
          });
        } catch {
          logUpstreamFailure('invalid_json', response);
          return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store' } });
        }
      }

      return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    },
  );

  if (cacheResponse.status === 204) return { status: 'preparing' };
  if (cacheResponse.status !== 200) return { status: 'unavailable' };

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

  logUpstreamFailure('invalid_cached_projection');
  return { status: 'unavailable' };
}
