import { describe, expect, vi, test } from 'vitest';

import { authApi, authStorage } from '@/lib/auth';

class LocalStorageMock {
  private store = new Map<string, string>();

  getItem(key: string) {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }
}

describe('authStorage session bootstrap', () => {
  test('通行密钥会话校验拒绝旧 bearer 和与验签结果不一致的账号', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', new LocalStorageMock());
    try {
      await authStorage.setAuth({ username: 'previous', userId: 8, authKey: 'synthetic-stored-key' });
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(new Headers(init?.headers).get('Authorization')).toBeNull();
        return new Response(JSON.stringify({
          success: true, authSource: 'better-auth-session', user: { id: 8, username: 'previous' },
        }));
      });
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
        success: true, authSource: 'legacy-bearer', user: { id: 7, username: 'expected' },
      })));
      vi.stubGlobal('fetch', fetchMock);

      expect(await authApi.verify({ expectedSessionUserId: 7 })).toEqual({ success: false });
      expect(await authApi.verify({ expectedSessionUserId: 7 })).toEqual({ success: false });
      expect((await authStorage.getAuth())?.userId).toBe(8);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      for (const [, init] of fetchMock.mock.calls) {
        expect(new Headers(init?.headers).get('Authorization')).toBeNull();
      }
    } finally {
      authStorage.clearAuth();
      vi.unstubAllGlobals();
    }
  });

  test('本地 authKey 缺失但会话有效时，应自动从 verify 回填兼容凭证', async () => {
    const previousWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
    const previousLocalStorage = (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage;
    const previousFetch = globalThis.fetch;

    try {
      (globalThis as typeof globalThis & { window?: unknown }).window = {};
      (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage = new LocalStorageMock();

      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe('/api/auth/verify');
        expect(init?.method).toBe('POST');

        const headers = new Headers(init?.headers);
        expect(headers.get('Authorization')).toBeNull();

        return new Response(
          JSON.stringify({
            success: true,
            authKey: 'legacy-auth-key-0007',
            user: {
              id: 7,
              username: 'session-user',
            },
            activityToken: 'activity-7-0001',
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        );
      });
      globalThis.fetch = fetchMock as typeof fetch;

      const authHeader = await authStorage.getAuthHeader();
      expect(authHeader).toBe('Bearer legacy-auth-key-0007');

      const storedAuth = await authStorage.getAuth();
      expect(storedAuth).toEqual({
        username: 'session-user',
        authKey: 'legacy-auth-key-0007',
        userId: 7,
        activityToken: 'activity-7-0001',
      });

      const activityHeaders = await authStorage.getActivityHeaders();
      expect(activityHeaders).toEqual({
        'x-mahoshojo-activity-token': 'activity-7-0001',
        'x-mahoshojo-user-id': '7',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      authStorage.clearAuth();
      globalThis.fetch = previousFetch;
      (globalThis as typeof globalThis & { window?: unknown }).window = previousWindow;
      (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage = previousLocalStorage;
    }
  });

  test('会话校验失败时，不应伪造本地凭证', async () => {
    const previousWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
    const previousLocalStorage = (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage;
    const previousFetch = globalThis.fetch;

    try {
      (globalThis as typeof globalThis & { window?: unknown }).window = {};
      (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage = new LocalStorageMock();

      const fetchMock = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            success: false,
            error: '未授权',
          }),
          {
            status: 401,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        );
      });
      globalThis.fetch = fetchMock as typeof fetch;

      const authHeader = await authStorage.getAuthHeader();
      expect(authHeader).toBeNull();
      expect(await authStorage.getAuth()).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      authStorage.clearAuth();
      globalThis.fetch = previousFetch;
      (globalThis as typeof globalThis & { window?: unknown }).window = previousWindow;
      (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage = previousLocalStorage;
    }
  });

  test('兼容 bearer 缺失时，authStorage.fetch 仍应继续发起业务请求', async () => {
    const previousWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
    const previousLocalStorage = (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage;
    const previousFetch = globalThis.fetch;

    try {
      (globalThis as typeof globalThis & { window?: unknown }).window = {};
      (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage = new LocalStorageMock();

      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/auth/verify') {
          return new Response(JSON.stringify({ success: false, error: '未授权' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        expect(url).toBe('/api/redeem-code');
        expect(init?.method).toBe('POST');
        expect(init?.credentials).toBe('same-origin');
        const headers = new Headers(init?.headers);
        expect(headers.get('Authorization')).toBeNull();
        expect(headers.get('Content-Type')).toBe('application/json');

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });
      globalThis.fetch = fetchMock as typeof fetch;

      const response = await authStorage.fetch('/api/redeem-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'A3F8-E9C2-1D4B' }),
      });

      expect(response.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      authStorage.clearAuth();
      globalThis.fetch = previousFetch;
      (globalThis as typeof globalThis & { window?: unknown }).window = previousWindow;
      (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage = previousLocalStorage;
    }
  });
});
