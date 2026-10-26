import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DESKTOP_RELEASE,
  type DesktopReleaseFailure,
  type PublishedDesktopRelease,
} from '@mahoshojo/contracts/desktop-release';
import type { HonoServerConfig } from '#/config';
import { createHonoApp } from '#/app';
import type { DesktopReleaseDependencies, DesktopReleaseFetch } from '#/desktop-release';
import type { RedisService } from '#/redis/runtime';

const routeIds = JSON.parse(readFileSync(
  path.resolve(import.meta.dirname, '..', '..', '..', 'config', 'hono-api-routes.json'),
  'utf8',
)) as { sharedRouteIds: string[] };

const config: HonoServerConfig = {
  arenaMultiplayerEnabled: false,
  host: '127.0.0.1',
  port: 8787,
  nodeEnv: 'test',
  redisUrl: null,
  redisKeyPrefix: '',
  redisRequired: false,
  d1Required: false,
  corsOrigins: ['https://mahoshojo.colanns.me'],
  arenaRoomAllowedOrigins: [],
  authMode: 'hybrid',
};

const rateLimit = vi.fn(async (_input: {
  namespace: string;
  identity: string;
  limit: number;
  windowSeconds: number;
}) => null);
const redis = (): RedisService => ({
  connect: async () => undefined,
  close: async () => undefined,
  getStatus: () => ({ configured: false, connected: false, ready: false, lastError: null }),
  ping: async () => false,
  consumeFixedWindow: async (input) => {
    rateLimit(input);
    return null;
  },
});

const asset = (name: string, browserDownloadUrl: string) => ({
  name,
  state: 'uploaded',
  size: 10,
  browser_download_url: browserDownloadUrl,
});

const expectedProjection: PublishedDesktopRelease = {
  status: 'published',
  version: DESKTOP_RELEASE.version,
  installerUrl: `https://github.com/${DESKTOP_RELEASE.repository}/releases/download/desktop-v${DESKTOP_RELEASE.version}/MahoShojo-Generator_${DESKTOP_RELEASE.version}_x64-setup.exe`,
  sha256Url: `https://github.com/${DESKTOP_RELEASE.repository}/releases/download/desktop-v${DESKTOP_RELEASE.version}/SHA256SUMS.txt`,
  manifestUrl: `https://github.com/${DESKTOP_RELEASE.repository}/releases/download/desktop-v${DESKTOP_RELEASE.version}/latest.json`,
};

const publishedRelease = () => ({
  tag_name: `desktop-v${DESKTOP_RELEASE.version}`,
  draft: false,
  prerelease: false,
  assets: [
    asset(`MahoShojo-Generator_${DESKTOP_RELEASE.version}_x64-setup.exe`, expectedProjection.installerUrl),
    asset(`MahoShojo-Generator_${DESKTOP_RELEASE.version}_x64-setup.exe.sig`, `${expectedProjection.installerUrl}.sig`),
    asset('SHA256SUMS.txt', expectedProjection.sha256Url),
    asset('latest.json', expectedProjection.manifestUrl),
  ],
});

const githubResponse = (body: unknown, status = 200, headers?: HeadersInit): Response => (
  Response.json(body, { status, headers })
);

const defaultFetch = (response: Response): DesktopReleaseFetch => vi.fn(async () => response);

const appFor = (dependencies: DesktopReleaseDependencies) => (
  createHonoApp(config, redis(), undefined, { desktopRelease: dependencies })
);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fixed Desktop stable release infrastructure endpoint', () => {
  it('registers on the actual app outside the generated registry and returns a minimal projection', async () => {
    const fetch = defaultFetch(githubResponse(publishedRelease()));
    const app = appFor({ fetch });
    const response = await app.request(
      '/api/desktop/releases/stable?repository=attacker.invalid&tag=desktop-v9.9.9&url=https://evil.invalid',
      {
        headers: {
          cookie: 'session-secret',
          authorization: 'Bearer user-secret',
          origin: 'https://mahoshojo.colanns.me',
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
    expect(response.headers.get('access-control-allow-origin')).toBe('https://mahoshojo.colanns.me');
    expect(await response.json()).toEqual(expectedProjection);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`https://api.github.com/repos/${DESKTOP_RELEASE.repository}/releases/tags/desktop-v${DESKTOP_RELEASE.version}`);
    expect(init?.method).toBe('GET');
    expect(init?.headers).toEqual({
      accept: 'application/vnd.github+json',
      'user-agent': 'MahoShojo-Generator-Hono',
      'x-github-api-version': '2022-11-28',
    });
    expect(init?.headers).not.toHaveProperty('cookie');
    expect(init?.headers).not.toHaveProperty('authorization');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(routeIds.sharedRouteIds).not.toContain('desktop-release');
    expect(rateLimit).toHaveBeenCalledOnce();
    expect(rateLimit).toHaveBeenCalledWith(expect.objectContaining({ namespace: 'api' }));
  });

  it('serves HEAD with the same cached status and headers without a body', async () => {
    const fetch = defaultFetch(githubResponse(publishedRelease()));
    const app = appFor({ fetch });
    await app.request('/api/desktop/releases/stable');
    const response = await app.request('/api/desktop/releases/stable', { method: 'HEAD' });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
    expect(await response.text()).toBe('');
    expect(fetch).toHaveBeenCalledOnce();
    expect(rateLimit).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent misses into one upstream request', async () => {
    let resolveResponse!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { resolveResponse = resolve; }));
    const app = appFor({ fetch });
    const first = app.request('/api/desktop/releases/stable');
    await Promise.resolve();
    const second = app.request('/api/desktop/releases/stable');
    await Promise.resolve();

    expect(fetch).toHaveBeenCalledOnce();
    resolveResponse(githubResponse(publishedRelease()));
    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('caches only the validated published projection for 300 seconds', async () => {
    let time = 1_000;
    const fetch = vi.fn(async () => githubResponse(publishedRelease()));
    const app = appFor({ fetch, now: () => time });

    await app.request('/api/desktop/releases/stable');
    time += 299_999;
    await app.request('/api/desktop/releases/stable');
    expect(fetch).toHaveBeenCalledOnce();
    time += 1;
    await app.request('/api/desktop/releases/stable');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['upstream tag not found', () => githubResponse({ message: 'not found' }, 404)],
    ['draft release', () => githubResponse({ ...publishedRelease(), draft: true })],
    ['prerelease', () => githubResponse({ ...publishedRelease(), prerelease: true })],
    ['missing required asset', () => githubResponse({ ...publishedRelease(), assets: [] })],
  ])('returns an uncached empty 204 for %s', async (_label, responseFactory) => {
    const fetch = vi.fn(async () => responseFactory());
    let time = 0;
    const app = appFor({ fetch, now: () => time });
    for (let request = 0; request < 2; request += 1) {
      const response = await app.request('/api/desktop/releases/stable');
      expect(response.status).toBe(204);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.text()).toBe('');
    }
    expect(fetch).toHaveBeenCalledOnce();
    time += 120_000;
    expect((await app.request('/api/desktop/releases/stable')).status).toBe(204);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      name: 'network error',
      fetch: async () => { throw new Error('secret upstream URL and body'); },
      failure: 'network' as DesktopReleaseFailure,
      upstreamStatus: null,
      retryAfter: null,
    },
    {
      name: 'upstream server error',
      fetch: async () => githubResponse({ message: 'secret upstream body' }, 503),
      failure: 'upstream-http-error' as DesktopReleaseFailure,
      upstreamStatus: '503',
      retryAfter: null,
    },
    {
      name: 'rate limit with bounded retry-after',
      fetch: async () => githubResponse({ message: 'secret rate limit body' }, 403, {
        'retry-after': '31', 'x-ratelimit-remaining': '0',
      }),
      failure: 'rate-limited' as DesktopReleaseFailure,
      upstreamStatus: '403',
      retryAfter: '31',
    },
    {
      name: 'invalid retry-after omitted',
      fetch: async () => githubResponse({ message: 'secret rate limit body' }, 403, {
        'retry-after': '3601', 'x-ratelimit-remaining': '0',
      }),
      failure: 'rate-limited' as DesktopReleaseFailure,
      upstreamStatus: '403',
      retryAfter: null,
    },
    {
      name: 'malformed JSON',
      fetch: async () => new Response('secret invalid upstream body', { status: 200 }),
      failure: 'invalid-json' as DesktopReleaseFailure,
      upstreamStatus: '200',
      retryAfter: null,
    },
  ])('returns an uncached no-store empty 503 for $name without leaking upstream content', async (testCase) => {
    const fetch = vi.fn(testCase.fetch);
    let time = 0;
    const app = appFor({ fetch, now: () => time });
    for (let request = 0; request < 2; request += 1) {
      const response = await app.request('/api/desktop/releases/stable');
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-desktop-release-failure')).toBe(testCase.failure);
      expect(response.headers.get('x-desktop-release-upstream-status')).toBe(testCase.upstreamStatus);
      expect(response.headers.get('retry-after')).toBe(testCase.retryAfter);
      const body = await response.text();
      expect(body).toBe('');
      expect(body).not.toContain('secret');
    }
    expect(fetch).toHaveBeenCalledOnce();
    time += 120_000;
    expect((await app.request('/api/desktop/releases/stable')).status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rechecks after the preparing cooldown and can recover to a published release', async () => {
    let time = 0;
    const fetch = vi.fn()
      .mockResolvedValueOnce(githubResponse({ message: 'not found' }, 404))
      .mockResolvedValueOnce(githubResponse(publishedRelease()));
    const app = appFor({ fetch, now: () => time });

    expect((await app.request('/api/desktop/releases/stable')).status).toBe(204);
    expect((await app.request('/api/desktop/releases/stable')).status).toBe(204);
    expect(fetch).toHaveBeenCalledOnce();
    time += 120_000;
    const recovered = await app.request('/api/desktop/releases/stable');
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual(expectedProjection);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('honors a valid long Retry-After within the 3600 second bound', async () => {
    let time = 0;
    const fetch = vi.fn()
      .mockResolvedValueOnce(githubResponse({ message: 'rate limited' }, 429, { 'retry-after': '3600' }))
      .mockResolvedValueOnce(githubResponse(publishedRelease()));
    const app = appFor({ fetch, now: () => time });

    const limited = await app.request('/api/desktop/releases/stable');
    expect(limited.status).toBe(503);
    expect(limited.headers.get('retry-after')).toBe('3600');
    time += 3_599_999;
    expect((await app.request('/api/desktop/releases/stable')).status).toBe(503);
    expect(fetch).toHaveBeenCalledOnce();
    time += 1;
    expect((await app.request('/api/desktop/releases/stable')).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not fall back to an expired published cache after a later upstream failure', async () => {
    let time = 0;
    const fetch = vi.fn()
      .mockResolvedValueOnce(githubResponse(publishedRelease()))
      .mockRejectedValueOnce(new Error('private upstream failure'));
    const app = appFor({ fetch, now: () => time });

    expect((await app.request('/api/desktop/releases/stable')).status).toBe(200);
    time += 300_000;
    const failedRefresh = await app.request('/api/desktop/releases/stable');
    expect(failedRefresh.status).toBe(503);
    expect(failedRefresh.headers.get('x-desktop-release-failure')).toBe('network');
    expect(await failedRefresh.text()).toBe('');
    time += 119_999;
    const cooledFailure = await app.request('/api/desktop/releases/stable');
    expect(cooledFailure.status).toBe(503);
    expect(await cooledFailure.text()).toBe('');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not classify unrelated 403 responses as rate-limited or forward Retry-After', async () => {
    const fetch = defaultFetch(githubResponse({ message: 'private upstream detail' }, 403, { 'retry-after': '30' }));
    const app = appFor({ fetch });
    const response = await app.request('/api/desktop/releases/stable');

    expect(response.status).toBe(503);
    expect(response.headers.get('x-desktop-release-failure')).toBe('upstream-http-error');
    expect(response.headers.get('x-desktop-release-upstream-status')).toBe('403');
    expect(response.headers.get('retry-after')).toBeNull();
    expect(await response.text()).toBe('');
  });

  it('bounds a response without Content-Length and cancels an oversized body', async () => {
    let cancelled = false;
    const fetch = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024 + 1));
      },
      cancel() { cancelled = true; },
    }), { status: 200 }));
    const app = appFor({ fetch });
    const response = await app.request('/api/desktop/releases/stable');

    expect(response.status).toBe(503);
    expect(response.headers.get('x-desktop-release-failure')).toBe('invalid-json');
    expect(response.headers.get('x-desktop-release-upstream-status')).toBe('200');
    expect(await response.text()).toBe('');
    expect(cancelled).toBe(true);
  });

  it('rejects declared oversized responses before reading and cancels the stream', async () => {
    let cancelled = false;
    const fetch = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([0x7b])); },
      cancel() { cancelled = true; },
    }), { status: 200, headers: { 'content-length': String(1024 * 1024 + 1) } }));
    const app = appFor({ fetch });
    const response = await app.request('/api/desktop/releases/stable');

    expect(response.status).toBe(503);
    expect(response.headers.get('x-desktop-release-failure')).toBe('invalid-json');
    expect(cancelled).toBe(true);
  });

  it('applies one total timeout to fetch and body consumption', async () => {
    const fetch = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
    }));
    const app = appFor({ fetch, timeoutMs: 5 });
    const response = await app.request('/api/desktop/releases/stable');

    expect(response.status).toBe(503);
    expect(response.headers.get('x-desktop-release-failure')).toBe('timeout');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('');
  });
});
