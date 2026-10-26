import { describe, expect, test } from 'vitest';

import {
  DESKTOP_RELEASE,
  parseDesktopReleaseProjection,
  parsePublishedDesktopRelease,
} from '../src/desktop-release';

const baseUrl = `https://github.com/${DESKTOP_RELEASE.repository}/releases/download/desktop-v${DESKTOP_RELEASE.version}`;
const installer = `MahoShojo-Generator_${DESKTOP_RELEASE.version}_x64-setup.exe`;
const projection = () => ({
  status: 'published',
  version: DESKTOP_RELEASE.version,
  installerUrl: `${baseUrl}/${installer}`,
  sha256Url: `${baseUrl}/SHA256SUMS.txt`,
  manifestUrl: `${baseUrl}/latest.json`,
});
const githubRelease = () => ({
  tag_name: `desktop-v${DESKTOP_RELEASE.version}`,
  draft: false,
  prerelease: false,
  assets: [installer, `${installer}.sig`, 'SHA256SUMS.txt', 'latest.json'].map((name) => ({
    name,
    state: 'uploaded',
    size: 100,
    browser_download_url: `${baseUrl}/${name}`,
  })),
});

describe('fixed Desktop release contract', () => {
  test('projects only the complete published stable GitHub release', () => {
    expect(parsePublishedDesktopRelease(githubRelease())).toEqual(projection());
    expect(parsePublishedDesktopRelease({ ...githubRelease(), draft: true })).toBeNull();
    expect(parsePublishedDesktopRelease({ ...githubRelease(), prerelease: true })).toBeNull();
    expect(parsePublishedDesktopRelease({ ...githubRelease(), tag_name: 'desktop-v0.1.0-rc.1' })).toBeNull();
  });

  test.each([
    { name: 'missing asset', change: (release: ReturnType<typeof githubRelease>) => { release.assets.pop(); } },
    { name: 'empty asset', change: (release: ReturnType<typeof githubRelease>) => { release.assets[0]!.size = 0; } },
    { name: 'upload in progress', change: (release: ReturnType<typeof githubRelease>) => { release.assets[0]!.state = 'starter'; } },
    { name: 'external asset URL', change: (release: ReturnType<typeof githubRelease>) => { release.assets[0]!.browser_download_url = 'https://attacker.invalid/setup.exe'; } },
  ])('rejects $name', ({ change }) => {
    const release = githubRelease();
    change(release);
    expect(parsePublishedDesktopRelease(release)).toBeNull();
  });

  test('accepts only the exact minimum projection and returns a reconstructed object', () => {
    expect(parseDesktopReleaseProjection(projection())).toEqual(projection());
    expect(parseDesktopReleaseProjection({ ...projection(), internal: 'secret' })).toBeNull();
    expect(parseDesktopReleaseProjection({ ...projection(), installerUrl: 'https://attacker.invalid/setup.exe' })).toBeNull();
    expect(parseDesktopReleaseProjection({ status: 'published', version: DESKTOP_RELEASE.version })).toBeNull();
  });
});
