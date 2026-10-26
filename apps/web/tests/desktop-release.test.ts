import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { DESKTOP_RELEASE, parsePublishedDesktopRelease } from '../lib/desktop-release';
import { getDesktopRelease } from '../lib/desktop-release-server';
import { GET } from '../app/desktop/updates/stable/latest.json/route';

const { withEdgeCacheMock } = vi.hoisted(() => ({ withEdgeCacheMock: vi.fn() }));

vi.mock('../lib/edge-cache', () => ({ withEdgeCache: withEdgeCacheMock }));

const baseUrl = `https://github.com/${DESKTOP_RELEASE.repository}/releases/download/desktop-v0.1.0`;
const installer = 'MahoShojo-Generator_0.1.0_x64-setup.exe';
const completeRelease = () => ({
  tag_name: 'desktop-v0.1.0', draft: false, prerelease: false,
  assets: [installer, `${installer}.sig`, 'SHA256SUMS.txt', 'latest.json'].map((name) => ({
    name, state: 'uploaded', size: 100, browser_download_url: `${baseUrl}/${name}`,
  })),
});
const publishedProjection = () => ({
  status: 'published', version: DESKTOP_RELEASE.version,
  installerUrl: `${baseUrl}/${installer}`, sha256Url: `${baseUrl}/SHA256SUMS.txt`, manifestUrl: `${baseUrl}/latest.json`,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  withEdgeCacheMock.mockReset();
  withEdgeCacheMock.mockImplementation((_request, _options, handler) => handler());
});

describe('manual GitHub release publication', () => {
  test('opens downloads only for the complete published stable release', () => {
    expect(parsePublishedDesktopRelease(completeRelease())).toEqual({
      status: 'published', version: '0.1.0', installerUrl: `${baseUrl}/${installer}`,
      sha256Url: `${baseUrl}/SHA256SUMS.txt`, manifestUrl: `${baseUrl}/latest.json`,
    });
  });

  test.each([
    { draft: true }, { prerelease: true }, { tag_name: 'desktop-v0.1.0-rc.1' },
    { tag_name: 'desktop-v0.0.9' }, { assets: [] },
  ])('does not publish incomplete or non-final release: %j', (override) => {
    expect(parsePublishedDesktopRelease({ ...completeRelease(), ...override })).toBeNull();
  });

  test.each(['missing', 'empty', 'uploading', 'external-url'])('rejects unusable asset: %s', (fault) => {
    const release = completeRelease();
    if (fault === 'missing') release.assets.pop();
    if (fault === 'empty') release.assets[0].size = 0;
    if (fault === 'uploading') release.assets[0].state = 'starter';
    if (fault === 'external-url') release.assets[0].browser_download_url = 'https://example.invalid/install.exe';
    expect(parsePublishedDesktopRelease(release)).toBeNull();
  });

  test('a published release from the fixed service directs updater to its versioned manifest', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(publishedProjection()));
    vi.stubGlobal('fetch', fetch);
    const response = await GET();
    expect(response.status).toBe(307);
    expect(response.headers.get('Location')).toBe(`${baseUrl}/latest.json`);
    expect(fetch).toHaveBeenCalledWith('https://homura.colanns.me/api/desktop/releases/stable', expect.objectContaining({
      cache: 'no-store', headers: { Accept: 'application/json' },
    }));
    const [cacheRequest, cacheOptions] = withEdgeCacheMock.mock.calls[0] ?? [];
    expect(cacheRequest).toBeInstanceOf(Request);
    expect(cacheRequest.headers.get('cookie')).toBeNull();
    expect(cacheRequest.headers.get('authorization')).toBeNull();
    expect(cacheOptions).toEqual({ key: 'https://mahoshojo.colanns.me/_edge-cache/desktop-release/0.1.0', ttlSeconds: 300, awaitCacheWrite: true });
  });

  test('an unpublished release means no update, without an installer link', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(null, { status: 204 })));
    expect(await getDesktopRelease()).toEqual({ status: 'preparing' });
    expect((await GET()).status).toBe(204);
  });

  test.each([
    { fault: 'network', expected: { status: 'unavailable', failure: 'network' } },
    { fault: 'rate-limit', expected: { status: 'unavailable', failure: 'rate-limited', upstreamStatus: 403, retryAfterSeconds: 5 } },
    { fault: 'invalid-json', expected: { status: 'unavailable', failure: 'invalid-json', upstreamStatus: 200 } },
    { fault: 'timeout', expected: { status: 'unavailable', failure: 'timeout' } },
  ])('failure remains retryable: $fault', async ({ fault, expected }) => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      if (fault === 'network') throw new TypeError('secret network message');
      if (fault === 'timeout') throw Object.assign(new Error('secret timeout message'), { name: 'TimeoutError' });
      if (fault === 'rate-limit') return new Response(null, {
        status: 503,
        headers: {
          'X-Desktop-Release-Failure': 'rate-limited',
          'X-Desktop-Release-Upstream-Status': '403',
          'Retry-After': '5',
          'x-private-secret': 'never expose',
        },
      });
      return new Response('secret invalid JSON body');
    }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await getDesktopRelease()).toEqual(expected);
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).toBe('');
    if (fault === 'rate-limit') {
      expect(response.headers.get('X-Desktop-Release-Failure')).toBe('rate-limited');
      expect(response.headers.get('X-Desktop-Release-Upstream-Status')).toBe('403');
      expect(response.headers.get('Retry-After')).toBe('5');
    }
    expect(JSON.stringify([...response.headers])).not.toMatch(/secret|offline/i);
  });

  test('retries a transient release service server error once and preserves preparing state', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('upstream unavailable', { status: 502 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await getDesktopRelease()).toEqual({ status: 'preparing' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('logs bounded release service rate-limit diagnostics without retrying 503', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, {
      status: 503,
      headers: {
        'X-Desktop-Release-Failure': 'rate-limited',
        'X-Desktop-Release-Upstream-Status': '403',
      },
    }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', fetch);

    expect(await getDesktopRelease()).toEqual({ status: 'unavailable', failure: 'rate-limited', upstreamStatus: 403 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[desktop-release] Release service lookup failed', {
      failure: 'rate-limited', upstreamStatus: 403,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('x-private-secret');
  });

  test('does not expose secret upstream errors in safe failure diagnostics', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('secret URL https://private.invalid/token')));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await getDesktopRelease();
    expect(result).toEqual({ status: 'unavailable', failure: 'network' });
    expect(JSON.stringify(result)).not.toMatch(/secret|private\.invalid|token/);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/secret|private\.invalid|token/);
  });
});
