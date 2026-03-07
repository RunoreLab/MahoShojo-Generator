import { describe, expect, mock, test } from 'bun:test';

import { authStorage } from '@/lib/auth';

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
  test('本地 authKey 缺失但会话有效时，应自动从 verify 回填兼容凭证', async () => {
    const previousWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
    const previousLocalStorage = (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage;
    const previousFetch = globalThis.fetch;

    try {
      (globalThis as typeof globalThis & { window?: unknown }).window = {};
      (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage = new LocalStorageMock();

      const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
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

      const fetchMock = mock(async () => {
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
});
