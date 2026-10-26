/** 本次 Desktop 目标版本；实际下载状态由同名公开 GitHub Release 决定。 */
export const DESKTOP_RELEASE = {
  version: '0.1.0',
  repository: 'RunoreLab/MahoShojo-Generator',
} as const;

export type PublishedDesktopRelease = {
  status: 'published';
  version: string;
  installerUrl: string;
  sha256Url: string;
  manifestUrl: string;
};

export function parsePublishedDesktopRelease(raw: unknown): PublishedDesktopRelease | null {
  if (!raw || typeof raw !== 'object') return null;
  const release = raw as Record<string, unknown>;
  const { version, repository } = DESKTOP_RELEASE;
  const tag = `desktop-v${version}`;
  if (release.tag_name !== tag || release.draft !== false || release.prerelease !== false || !Array.isArray(release.assets)) return null;
  const installer = `MahoShojo-Generator_${version}_x64-setup.exe`;
  const assetUrl = (name: string) => `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(name)}`;
  // 以维护者手动发布且上传完整的 Release 为准，不把 CI artifact/RC 当作正式下载。
  for (const name of [installer, `${installer}.sig`, 'SHA256SUMS.txt', 'latest.json']) {
    if (!release.assets.some((item: unknown) => {
      if (!item || typeof item !== 'object') return false;
      const asset = item as Record<string, unknown>;
      return asset.name === name && asset.state === 'uploaded' && typeof asset.size === 'number' && asset.size > 0
        && asset.browser_download_url === assetUrl(name);
    })) return null;
  }
  return { status: 'published', version, installerUrl: assetUrl(installer), sha256Url: assetUrl('SHA256SUMS.txt'), manifestUrl: assetUrl('latest.json') };
}
