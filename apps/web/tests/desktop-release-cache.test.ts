import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { DESKTOP_RELEASE } from '../lib/desktop-release';

const baseUrl = `https://github.com/${DESKTOP_RELEASE.repository}/releases/download/desktop-v${DESKTOP_RELEASE.version}`;
const installer = `MahoShojo-Generator_${DESKTOP_RELEASE.version}_x64-setup.exe`;

const completeRelease = () => ({
  status: 'published',
  version: DESKTOP_RELEASE.version,
  installerUrl: `${baseUrl}/${installer}`,
  sha256Url: `${baseUrl}/SHA256SUMS.txt`,
  manifestUrl: `${baseUrl}/latest.json`,
});

const loadGetDesktopRelease = async () => (await import('../lib/desktop-release-server')).getDesktopRelease;

const waitForCacheWrite = async () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('caches', undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('desktop release runtime cache', () => {
  test('reuses only a validated published projection when the following GitHub lookup fails', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json(completeRelease()))
      .mockRejectedValueOnce(new TypeError('upstream temporarily unavailable'));
    vi.stubGlobal('fetch', fetch);
    const getDesktopRelease = await loadGetDesktopRelease();

    expect(await getDesktopRelease()).toMatchObject({ status: 'published', version: DESKTOP_RELEASE.version });
    await waitForCacheWrite();
    expect(await getDesktopRelease()).toMatchObject({ status: 'published', version: DESKTOP_RELEASE.version });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test.each([
    { initialStatus: 204, expected: 'preparing' },
    { initialStatus: 503, expected: 'unavailable', failure: 'rate-limited' },
  ])('$expected results do not populate the published cache', async ({ initialStatus, expected, failure }) => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: initialStatus,
        ...(failure ? { headers: { 'X-Desktop-Release-Failure': failure, 'X-Desktop-Release-Upstream-Status': '403' } } : {}),
      }))
      .mockResolvedValueOnce(Response.json(completeRelease()));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const getDesktopRelease = await loadGetDesktopRelease();

    expect(await getDesktopRelease()).toMatchObject({ status: expected, ...(failure ? { failure } : {}) });
    expect(await getDesktopRelease()).toMatchObject({ status: 'published', version: DESKTOP_RELEASE.version });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('rechecks GitHub after the published projection cache TTL expires', async () => {
    let now = 1_800_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json(completeRelease()))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    const getDesktopRelease = await loadGetDesktopRelease();

    expect(await getDesktopRelease()).toMatchObject({ status: 'published', version: DESKTOP_RELEASE.version });
    await waitForCacheWrite();
    now += 300_001;

    expect(await getDesktopRelease()).toEqual({ status: 'preparing' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('accepts a validated projection from the Cache API without calling GitHub', async () => {
    const published = {
      status: 'published',
      version: DESKTOP_RELEASE.version,
      installerUrl: `${baseUrl}/${installer}`,
      sha256Url: `${baseUrl}/SHA256SUMS.txt`,
      manifestUrl: `${baseUrl}/latest.json`,
    };
    const match = vi.fn().mockResolvedValue(Response.json(published));
    const put = vi.fn();
    const fetch = vi.fn();
    vi.stubGlobal('caches', { default: { match, put } });
    vi.stubGlobal('fetch', fetch);
    const getDesktopRelease = await loadGetDesktopRelease();

    expect(await getDesktopRelease()).toEqual(published);
    expect(fetch).not.toHaveBeenCalled();
    expect(match).toHaveBeenCalledTimes(1);
  });

  test.each([
    {
      name: 'external installer URL',
      projection: {
        status: 'published', version: DESKTOP_RELEASE.version,
        installerUrl: 'https://attacker.invalid/install.exe',
        sha256Url: `${baseUrl}/SHA256SUMS.txt`, manifestUrl: `${baseUrl}/latest.json`,
      },
    },
    {
      name: 'wrong version',
      projection: {
        status: 'published', version: '9.9.9',
        installerUrl: `${baseUrl}/${installer}`,
        sha256Url: `${baseUrl}/SHA256SUMS.txt`, manifestUrl: `${baseUrl}/latest.json`,
      },
    },
  ])('rejects a cached projection with $name without exposing its URL', async ({ projection }) => {
    const match = vi.fn().mockResolvedValue(Response.json(projection));
    const fetch = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('caches', { default: { match, put: vi.fn() } });
    vi.stubGlobal('fetch', fetch);
    const getDesktopRelease = await loadGetDesktopRelease();

    const result = await getDesktopRelease();
    expect(result).toEqual({ status: 'unavailable', failure: 'invalid-cache' });
    expect(JSON.stringify(result)).not.toContain('attacker.invalid');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('attacker.invalid');
    expect(fetch).not.toHaveBeenCalled();
  });
});
