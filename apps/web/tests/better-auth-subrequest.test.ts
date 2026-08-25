import { afterEach, describe, expect, test, vi } from 'vitest';
import { invokeBetterAuthSubrequest } from '@/lib/auth/better-auth-subrequest';

describe('Better Auth subrequest target', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test('只向配置的可信 origin 发送凭据，不信任请求 URL', async () => {
    vi.stubEnv('BETTER_AUTH_URL', 'https://auth.example.com');
    vi.stubEnv('CF_ACCESS_CLIENT_ID', 'service-id');
    vi.stubEnv('CF_ACCESS_CLIENT_SECRET', 'service-secret');
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      fetchCalls.push({ url, init });
      return new Response('{}', { status: 200 });
    }));

    await invokeBetterAuthSubrequest({
      req: new Request('https://attacker.invalid/api/me/account/password', {
        headers: { cookie: 'better-auth.session_token=session' },
      }),
      path: '/api/auth/change-password',
      body: { currentPassword: 'old', newPassword: 'new' },
    });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toBe('https://auth.example.com/api/auth/change-password');
    const headers = new Headers(fetchCalls[0]?.init?.headers);
    expect(headers.get('cookie')).toBe('better-auth.session_token=session');
    expect(headers.get('cf-access-client-id')).toBe('service-id');
    expect(headers.get('cf-access-client-secret')).toBe('service-secret');
  });

  test('拒绝 authority-relative 路径且不得发出请求', async () => {
    vi.stubEnv('BETTER_AUTH_URL', 'https://auth.example.com');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(invokeBetterAuthSubrequest({
      req: new Request('https://app.example.com/api/me/account/password'),
      path: '//attacker.invalid/collect',
      body: {},
    })).rejects.toThrow('Better Auth 子请求路径无效');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.each([
    '/api/auth/../admin',
    '/api/auth/%2e%2e/admin',
    '/api/auth/change-password?redirect=/admin',
  ])('拒绝可在规范化后越出 auth endpoint 的路径：%s', async (path) => {
    vi.stubEnv('BETTER_AUTH_URL', 'https://auth.example.com');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(invokeBetterAuthSubrequest({
      req: new Request('https://app.example.com/api/me/account/password'),
      path,
      body: {},
    })).rejects.toThrow('Better Auth 子请求路径无效');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('拒绝缺失或不安全的 Better Auth URL 且不得发出请求', async () => {
    vi.stubEnv('BETTER_AUTH_URL', 'http://auth.example.com');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(invokeBetterAuthSubrequest({
      req: new Request('https://app.example.com/api/me/account/password'),
      path: '/api/auth/change-password',
      body: {},
    })).rejects.toThrow('BETTER_AUTH_URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
