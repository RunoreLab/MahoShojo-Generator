import { describe, expect, test } from 'vitest';

import { DESKTOP_RELEASE, getPublishedDesktopRelease } from '../lib/desktop-release';

describe('desktop release publication gate', () => {
  test('does not show a download link before the official release is published', () => {
    expect(getPublishedDesktopRelease({ status: 'preparing', version: '0.1.0' })).toBeNull();
  });

  test('the current deployment config is internally consistent', () => {
    const published = getPublishedDesktopRelease(DESKTOP_RELEASE);
    if (published) {
      expect(published.installerUrl).toMatch(/^https:\/\/github\.com\/RunoreLab\/MahoShojo-Generator\/releases\/download\//);
      expect(published.sha256Url).toMatch(/^https:\/\/github\.com\/RunoreLab\/MahoShojo-Generator\/releases\/download\//);
    } else {
      expect(DESKTOP_RELEASE.status).toBe('preparing');
    }
  });

  test('publishes only an explicitly configured installer and checksum together', () => {
    expect(getPublishedDesktopRelease({
      status: 'published',
      version: '0.1.0',
      installerUrl: 'https://github.com/RunoreLab/MahoShojo-Generator/releases/download/desktop-v0.1.0/installer.exe',
      sha256Url: 'https://github.com/RunoreLab/MahoShojo-Generator/releases/download/desktop-v0.1.0/SHA256SUMS',
    })).toMatchObject({
      status: 'published',
      version: '0.1.0',
    });
  });
});
