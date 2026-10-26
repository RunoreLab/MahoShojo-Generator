import 'server-only';

import { DESKTOP_RELEASE, parsePublishedDesktopRelease, type PublishedDesktopRelease } from './desktop-release';

export type DesktopReleaseStatus = PublishedDesktopRelease | { status: 'preparing' | 'unavailable' };

/** 无凭据公开查询；短缓存避免每次页面访问都消耗 GitHub API 配额。 */
export async function getDesktopRelease(): Promise<DesktopReleaseStatus> {
  try {
    const response = await fetch(`https://api.github.com/repos/${DESKTOP_RELEASE.repository}/releases/tags/desktop-v${DESKTOP_RELEASE.version}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'MahoShojo-Desktop-Downloads' },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 404) return { status: 'preparing' };
    if (!response.ok) return { status: 'unavailable' };
    return parsePublishedDesktopRelease(await response.json()) ?? { status: 'preparing' };
  } catch {
    return { status: 'unavailable' };
  }
}
