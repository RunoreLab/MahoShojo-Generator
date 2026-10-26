import 'server-only';

import { DESKTOP_RELEASE, parsePublishedDesktopRelease, type PublishedDesktopRelease } from './desktop-release';

export type DesktopReleaseStatus = PublishedDesktopRelease | { status: 'preparing' | 'unavailable' };

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
  const url = `https://api.github.com/repos/${DESKTOP_RELEASE.repository}/releases/tags/desktop-v${DESKTOP_RELEASE.version}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'MahoShojo-Desktop-Downloads' },
        next: { revalidate: 300 },
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      logUpstreamFailure(error instanceof Error ? error.name : 'fetch_error');
      if (attempt === 0) continue;
      return { status: 'unavailable' };
    }

    if (response.status === 404) return { status: 'preparing' };
    if (!response.ok) {
      logUpstreamFailure('http_error', response);
      if (attempt === 0 && response.status >= 500) continue;
      return { status: 'unavailable' };
    }

    try {
      return parsePublishedDesktopRelease(await response.json()) ?? { status: 'preparing' };
    } catch {
      logUpstreamFailure('invalid_json', response);
      return { status: 'unavailable' };
    }
  }

  return { status: 'unavailable' };
}
