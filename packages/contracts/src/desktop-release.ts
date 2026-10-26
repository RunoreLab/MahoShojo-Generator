/** Fixed public target for the currently supported stable Desktop release. */
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

export type DesktopReleaseFailure =
  | 'network'
  | 'timeout'
  | 'upstream-http-error'
  | 'rate-limited'
  | 'invalid-json'
  | 'invalid-cache';

const projectionKeys = ['status', 'version', 'installerUrl', 'sha256Url', 'manifestUrl'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const expectedProjection = (): PublishedDesktopRelease => {
  const { version, repository } = DESKTOP_RELEASE;
  const base = `https://github.com/${repository}/releases/download/desktop-v${version}`;
  return {
    status: 'published',
    version,
    installerUrl: `${base}/MahoShojo-Generator_${version}_x64-setup.exe`,
    sha256Url: `${base}/SHA256SUMS.txt`,
    manifestUrl: `${base}/latest.json`,
  };
};

/** Validate GitHub's fixed-tag release and return only the approved public projection. */
export function parsePublishedDesktopRelease(rawGitHub: unknown): PublishedDesktopRelease | null {
  if (!isRecord(rawGitHub) || rawGitHub.tag_name !== `desktop-v${DESKTOP_RELEASE.version}`
    || rawGitHub.draft !== false || rawGitHub.prerelease !== false || !Array.isArray(rawGitHub.assets)) return null;

  const { version } = DESKTOP_RELEASE;
  const expected = expectedProjection();
  const requiredAssets = [
    [`MahoShojo-Generator_${version}_x64-setup.exe`, expected.installerUrl],
    [`MahoShojo-Generator_${version}_x64-setup.exe.sig`, `${expected.installerUrl}.sig`],
    ['SHA256SUMS.txt', expected.sha256Url],
    ['latest.json', expected.manifestUrl],
  ] as const;

  for (const [name, url] of requiredAssets) {
    if (!rawGitHub.assets.some((item: unknown) => {
      if (!isRecord(item)) return false;
      return item.name === name && item.state === 'uploaded' && typeof item.size === 'number'
        && Number.isFinite(item.size) && item.size > 0 && item.browser_download_url === url;
    })) return null;
  }
  return expected;
}

/** Validate the small public projection returned by the release service. */
export function parseDesktopReleaseProjection(raw: unknown): PublishedDesktopRelease | null {
  if (!isRecord(raw) || Object.keys(raw).length !== projectionKeys.length
    || !projectionKeys.every((key) => Object.prototype.hasOwnProperty.call(raw, key))) return null;
  const expected = expectedProjection();
  return raw.status === expected.status
    && raw.version === expected.version
    && raw.installerUrl === expected.installerUrl
    && raw.sha256Url === expected.sha256Url
    && raw.manifestUrl === expected.manifestUrl
    ? expected
    : null;
}
