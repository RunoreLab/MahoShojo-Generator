// @vitest-environment jsdom
import '@/tests/helpers/fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WEB_PACKAGE_INSTANCE_PREFIX } from '@mahoshojo/web-package';

type FetchListener = (event: unknown) => void;

const listeners = new Map<string, FetchListener>();
const respondWith = vi.fn();

const workerScope = {
  location: { origin: 'https://example.test' },
  skipWaiting: vi.fn(async () => undefined),
  clients: { claim: vi.fn(async () => undefined) },
  addEventListener: (type: string, listener: (event: unknown) => void) => {
    listeners.set(type, listener);
  },
};

(globalThis as { self?: unknown }).self = workerScope;

const loadServiceWorker = async () => {
  vi.resetModules();
  listeners.clear();
  await import('../service-worker/web-package-sw');
  return listeners;
};

describe('Web package service worker preflight and fetch', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    listeners.clear();
    (globalThis as { self?: unknown }).self = workerScope;
    await loadServiceWorker();
  });
  afterEach(() => {
    vi.resetModules();
  });

  it('answers OPTIONS preflight with CORS headers before any instance read', async () => {
    const fetchListener = listeners.get('fetch');
    expect(fetchListener).toBeTypeOf('function');
    respondWith.mockClear();
    fetchListener!({
      request: new Request(`https://example.test${WEB_PACKAGE_INSTANCE_PREFIX}inst_x/index.html`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'null',
          'Access-Control-Request-Method': 'GET',
        },
      }),
      respondWith,
    });
    expect(respondWith).toHaveBeenCalledOnce();
    const response = await respondWith.mock.calls[0]![0] as Response;
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toContain('GET');
    expect(response.headers.get('access-control-allow-methods')).toContain('HEAD');
    expect(response.headers.get('access-control-allow-methods')).toContain('OPTIONS');
    expect(response.headers.get('access-control-max-age')).toBe('86400');
  });

  it('does not intercept non-instance paths', () => {
    const fetchListener = listeners.get('fetch');
    respondWith.mockClear();
    fetchListener!({
      request: new Request('https://example.test/arena'),
      respondWith,
    });
    expect(respondWith).not.toHaveBeenCalled();
  });

  it('skips unsupported methods on instance paths', () => {
    const fetchListener = listeners.get('fetch');
    respondWith.mockClear();
    fetchListener!({
      request: new Request(`https://example.test${WEB_PACKAGE_INSTANCE_PREFIX}inst_x/index.html`, {
        method: 'POST',
      }),
      respondWith,
    });
    expect(respondWith).not.toHaveBeenCalled();
  });
});
