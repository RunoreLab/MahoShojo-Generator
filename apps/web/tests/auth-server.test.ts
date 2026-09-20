import { afterEach, describe, expect, test, vi } from 'vitest';
import { createAuthServer } from '@/lib/auth/server';

describe('auth/server unified chain', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  test('本地校验 session，保留权限且不发 HTTP 子请求', async () => {
    const fetchSpy = vi.fn(() => { throw new Error('不得调用 HTTP verify'); });
    vi.stubGlobal('fetch', fetchSpy);
    const getSessionAuthUserImpl = vi.fn(async () => ({
      id: '12', username: 'session-user', is_banned: null, is_admin: true, is_review_exempt: '1',
    }));
    const getUserByAuthKeyImpl = vi.fn(async () => null);
    const auth = createAuthServer({ hasBetterAuthSessionCookieImpl: () => true, getSessionAuthUserImpl, getUserByAuthKeyImpl });
    const req = new Request('https://example.test', { headers: { authorization: 'Bearer ignored' } });
    expect(await auth.requireAuthUser(req)).toMatchObject({
      source: 'better-auth-session', user: { id: 12, is_admin: 1, is_review_exempt: 1 },
    });
    expect(getSessionAuthUserImpl).toHaveBeenCalledWith(req);
    expect(getUserByAuthKeyImpl).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test.each([null, { id: 0, username: 'invalid' }])('无效 session %j 回落 legacy bearer', async (session) => {
    const getUserByAuthKeyImpl = vi.fn(async () => ({ id: 7, username: 'legacy' }));
    const auth = createAuthServer({
      hasBetterAuthSessionCookieImpl: () => true, getSessionAuthUserImpl: async () => session, getUserByAuthKeyImpl,
    });
    expect(await auth.getAuthUser(new Request('https://example.test', {
      headers: { authorization: 'Bearer legacy-key' },
    }))).toMatchObject({ source: 'legacy-bearer', user: { id: 7 } });
    expect(getUserByAuthKeyImpl).toHaveBeenCalledWith('legacy-key');
  });

  test('解析异常且无有效 bearer 时返回 401', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const auth = createAuthServer({
      hasBetterAuthSessionCookieImpl: () => true,
      getSessionAuthUserImpl: async () => { throw new Error('invalid session'); },
      getUserByAuthKeyImpl: async () => null,
    });
    const result = await auth.requireAuthUser(new Request('https://example.test'));
    expect('response' in result && result.response.status).toBe(401);
  });

  test('封禁 session 返回 403，不能通过 bearer 回落绕过', async () => {
    const getUserByAuthKeyImpl = vi.fn(async () => ({ id: 7, username: 'other' }));
    const auth = createAuthServer({
      hasBetterAuthSessionCookieImpl: () => true,
      getSessionAuthUserImpl: async () => ({ id: 99, username: 'banned', is_banned: '2026-01-01' }),
      getUserByAuthKeyImpl,
    });
    const result = await auth.requireAuthUser(new Request('https://example.test', {
      headers: { authorization: 'Bearer other-user' },
    }));
    expect('response' in result && result.response.status).toBe(403);
    expect(getUserByAuthKeyImpl).not.toHaveBeenCalled();
  });

  test('无 cookie 时不初始化 Better Auth', async () => {
    const getSessionAuthUserImpl = vi.fn(async () => null);
    const auth = createAuthServer({ hasBetterAuthSessionCookieImpl: () => false, getSessionAuthUserImpl });
    const result = await auth.requireAuthUser(new Request('https://example.test'));
    expect('response' in result && result.response.status).toBe(401);
    expect(getSessionAuthUserImpl).not.toHaveBeenCalled();
  });

  test('bearer-only 模式忽略 session，只有 cookie 时仍为 401', async () => {
    vi.stubEnv('HONO_AUTH_MODE', 'bearer');
    const getSessionAuthUserImpl = vi.fn(async () => ({ id: 88, username: 'session' }));
    const auth = createAuthServer({
      hasBetterAuthSessionCookieImpl: () => true, getSessionAuthUserImpl,
      getUserByAuthKeyImpl: async (key) => key === 'valid' ? { id: 21, username: 'bearer' } : null,
    });
    expect(await auth.getAuthUser(new Request('https://example.test', {
      headers: { authorization: 'Bearer valid' },
    }))).toMatchObject({ source: 'legacy-bearer', user: { id: 21 } });
    const result = await auth.requireAuthUser(new Request('https://example.test'));
    expect('response' in result && result.response.status).toBe(401);
    expect(getSessionAuthUserImpl).not.toHaveBeenCalled();
  });
});
