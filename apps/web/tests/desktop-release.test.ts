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

  test('a published release directs updater to the same versioned manifest', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(completeRelease()));
    vi.stubGlobal('fetch', fetch);
    const response = await GET();
    expect(response.status).toBe(307);
    expect(response.headers.get('Location')).toBe(`${baseUrl}/latest.json`);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/releases/tags/desktop-v0.1.0'), expect.objectContaining({ cache: 'no-store' }));
    const [cacheRequest, cacheOptions] = withEdgeCacheMock.mock.calls[0] ?? [];
    expect(cacheRequest).toBeInstanceOf(Request);
    expect(cacheRequest.headers.get('cookie')).toBeNull();
    expect(cacheRequest.headers.get('authorization')).toBeNull();
    expect(cacheOptions).toEqual({ key: 'https://mahoshojo.invalid/_edge-cache/desktop-release/0.1.0', ttlSeconds: 300 });
  });

  test('an unpublished release means no update, without an installer link', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(null, { status: 404 })));
    expect(await getDesktopRelease()).toEqual({ status: 'preparing' });
    expect((await GET()).status).toBe(204);
  });

  test.each(['network', 'rate-limit', 'invalid-json'])('failure remains retryable: %s', async (fault) => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      if (fault === 'network') throw new TypeError('offline');
      return fault === 'rate-limit' ? new Response(null, { status: 403 }) : new Response('invalid JSON');
    }));
    expect(await getDesktopRelease()).toEqual({ status: 'unavailable' });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  test('retries a transient GitHub server error once and keeps the unpublished tag preparing', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('upstream unavailable', { status: 502 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await getDesktopRelease()).toEqual({ status: 'preparing' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('logs safe GitHub rate-limit diagnostics without retrying a 403', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, {
      status: 403,
      headers: { 'x-github-request-id': 'SAFE-REQUEST-ID', 'x-ratelimit-remaining': '0' },
    }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', fetch);

    expect(await getDesktopRelease()).toEqual({ status: 'unavailable' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[desktop-release] GitHub release lookup failed', {
      reason: 'http_error', status: 403, requestId: 'SAFE-REQUEST-ID', rateLimitRemaining: '0', retryAfter: undefined,
    });
  });
});
