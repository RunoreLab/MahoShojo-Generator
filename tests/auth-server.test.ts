import { describe, expect, test } from 'bun:test';
import { createAuthServer } from '@/lib/auth/server';

const createJsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });

describe('auth/server unified chain', () => {
  test('session 链路应透传并解析 admin/exempt 字段', async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const authServer = createAuthServer({
      hasBetterAuthSessionCookieImpl: () => true,
      getUserByAuthKeyImpl: async () => null,
      buildSubrequestAuthHeadersImpl: () => ({
        'cf-access-jwt-assertion': 'cf-jwt-token',
      }),
      fetchImpl: async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        fetchCalls.push({ url, init });
        return createJsonResponse({
          user: {
            id: '12',
            username: 'session-user',
            prefix: '会话前缀',
            is_banned: null,
            is_admin: true,
            is_review_exempt: '1',
          },
        });
      },
    });

    const req = new Request('https://example.com/api/data-cards', {
      headers: {
        cookie: '__Secure-better-auth.session_token=token',
        authorization: 'Bearer should-not-win',
        'cf-access-jwt-assertion': 'source-token',
      },
    });

    const context = await authServer.getAuthUser(req);
    expect(context).not.toBeNull();
    expect(context?.source).toBe('better-auth-session');
    expect(context?.user.id).toBe(12);
    expect(context?.user.username).toBe('session-user');
    expect(context?.user.is_admin).toBe(1);
    expect(context?.user.is_review_exempt).toBe(1);

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toBe('https://example.com/api/auth/verify');
    const headers = new Headers(fetchCalls[0]?.init?.headers);
    expect(headers.get('cf-access-jwt-assertion')).toBe('cf-jwt-token');
    expect(headers.get('cookie')?.includes('session_token=token')).toBeTrue();
  });

  test('无会话时应回落到 legacy bearer 鉴权', async () => {
    let receivedAuthKey: string | null = null;
    const authServer = createAuthServer({
      hasBetterAuthSessionCookieImpl: () => false,
      buildSubrequestAuthHeadersImpl: () => ({}),
      fetchImpl: async () => createJsonResponse({}, 500),
      getUserByAuthKeyImpl: async (authKey) => {
        receivedAuthKey = authKey;
        return {
          id: 7,
          username: 'legacy-user',
          prefix: null,
          is_banned: null,
          is_admin: 1,
          is_review_exempt: 0,
        };
      },
    });

    const req = new Request('https://example.com/api/decks', {
      headers: {
        authorization: 'Bearer legacy-auth-key',
      },
    });

    const result = await authServer.requireAuthUser(req);
    expect('response' in result).toBeFalse();
    if ('response' in result) return;
    expect(result.source).toBe('legacy-bearer');
    expect(result.user.id).toBe(7);
    expect(result.user.is_admin).toBe(1);
    expect(result.user.is_review_exempt).toBe(0);
    expect(receivedAuthKey).toBe('legacy-auth-key');
  });

  test('未登录用户应返回 401', async () => {
    const authServer = createAuthServer({
      hasBetterAuthSessionCookieImpl: () => false,
      buildSubrequestAuthHeadersImpl: () => ({}),
      fetchImpl: async () => createJsonResponse({}, 500),
      getUserByAuthKeyImpl: async () => null,
    });

    const req = new Request('https://example.com/api/favorites');
    const result = await authServer.requireAuthUser(req);
    expect('response' in result).toBeTrue();
    if (!('response' in result)) return;
    expect(result.response.status).toBe(401);
    const payload = (await result.response.json()) as { error?: string };
    expect(payload.error).toBe('未授权');
  });

  test('封禁用户应返回 403', async () => {
    const authServer = createAuthServer({
      hasBetterAuthSessionCookieImpl: () => true,
      buildSubrequestAuthHeadersImpl: () => ({}),
      getUserByAuthKeyImpl: async () => null,
      fetchImpl: async () =>
        createJsonResponse({
          user: {
            id: 99,
            username: 'banned-user',
            is_banned: '2026-02-26T00:00:00.000Z',
          },
        }),
    });

    const req = new Request('https://example.com/api/public-decks', {
      headers: {
        cookie: '__Secure-better-auth.session_token=token',
      },
    });

    const result = await authServer.requireAuthUser(req);
    expect('response' in result).toBeTrue();
    if (!('response' in result)) return;
    expect(result.response.status).toBe(403);
    const payload = (await result.response.json()) as { error?: string };
    expect(payload.error).toBe('账号已被封禁');
  });

  test('存在会话时应优先使用 session，不回落 bearer', async () => {
    let bearerLookupCount = 0;
    const authServer = createAuthServer({
      hasBetterAuthSessionCookieImpl: () => true,
      buildSubrequestAuthHeadersImpl: () => ({}),
      getUserByAuthKeyImpl: async () => {
        bearerLookupCount += 1;
        return {
          id: 1,
          username: 'legacy',
        };
      },
      fetchImpl: async () =>
        createJsonResponse({
          user: {
            id: 88,
            username: 'session-first',
            is_admin: 0,
            is_review_exempt: 0,
          },
        }),
    });

    const req = new Request('https://example.com/api/redeem-code', {
      headers: {
        cookie: '__Secure-better-auth.session_token=token',
        authorization: 'Bearer legacy-auth-key',
      },
    });

    const context = await authServer.getAuthUser(req);
    expect(context).not.toBeNull();
    expect(context?.source).toBe('better-auth-session');
    expect(context?.user.id).toBe(88);
    expect(bearerLookupCount).toBe(0);
  });
});
