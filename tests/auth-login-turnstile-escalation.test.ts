import { describe, expect, mock, test } from 'bun:test';

mock.module('server-only', () => ({}));

const postJsonRequest = (url: string, payload: unknown): Request =>
  new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

const createJsonResponse = (payload: unknown, status = 200, headers?: Headers): Response => {
  const merged = new Headers(headers ?? {});
  if (!merged.has('Content-Type')) {
    merged.set('Content-Type', 'application/json');
  }
  return new Response(JSON.stringify(payload), { status, headers: merged });
};

const mockBusinessUser = {
  id: 7,
  username: 'hikari',
  email: 'hikari@example.com',
  prefix: null,
  authKey: 'legacy-auth-key-0007',
};

describe('auth login Turnstile escalation', () => {
  const createSuccessfulLoginDeps = (overrides: Record<string, unknown> = {}) => {
    let bridgeCalls = 0;
    let turnstileCalls = 0;

    return {
      deps: {
        recordAuthAuditLog: async () => {},
        issueActivityToken: async () => 'activity-token',
        appendSetCookieHeaders: (target: Headers, source: Headers) => {
          const setCookie = source.get('set-cookie');
          if (setCookie) target.append('set-cookie', setCookie);
        },
        getBetterAuthBridgeAvailability: () => ({
          available: true as const,
        }),
        getDrizzleDbFromRuntime: () => ({ __mockDb: true }),
        extractErrorMessage: () => '账号或密码错误',
        invokeBetterAuthJsonEndpoint: async () => {
          bridgeCalls += 1;
          const headers = new Headers();
          headers.set('set-cookie', 'better-auth.session_token=session-1; Path=/; HttpOnly');
          return {
            ok: true as const,
            response: createJsonResponse(
              {
                user: {
                  id: 'auth-user-1',
                  email: 'hikari@example.com',
                  name: 'hikari',
                },
              },
              200,
              headers,
            ),
          };
        },
        readJsonSafely: async <T>(response: Response): Promise<T | null> => (await response.clone().json()) as T,
        ensureAuthUserLink: async () => mockBusinessUser,
        ensureBusinessUserLegacyAuthKey: async () => mockBusinessUser,
        getLinkedBusinessUserByAuthUserId: async () => mockBusinessUser,
        getUserById: async () => null,
        getUserByUsername: async () => null,
        verifyUserLogin: async () => null,
        verifyTurnstileToken: async () => {
          turnstileCalls += 1;
          return false;
        },
        countRecentFailedLoginsByLoginIdentifierHash: async () => 0,
        countRecentFailedLoginsByIpAnonymized: async () => 0,
        ...overrides,
      },
      getBridgeCalls: () => bridgeCalls,
      getTurnstileCalls: () => turnstileCalls,
    };
  };

  test('password login does not require Turnstile before a challenge is triggered', async () => {
    const { createLoginHandler } = await import('@/app/api/auth/login/handler');

    const harness = createSuccessfulLoginDeps();
    const post = createLoginHandler(harness.deps);

    const response = await post(
      postJsonRequest('https://example.com/api/auth/login', {
        identifier: 'hikari@example.com',
        credential: 'password-123',
        mode: 'password',
      }),
    );

    const payload = (await response.json()) as { success?: boolean; user?: { id?: number } };
    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.user?.id).toBe(7);
    expect(harness.getTurnstileCalls()).toBe(0);
    expect(harness.getBridgeCalls()).toBe(1);
  });

  test('password login asks for Turnstile after recent identifier failures', async () => {
    const { createLoginHandler } = await import('@/app/api/auth/login/handler');

    const harness = createSuccessfulLoginDeps({
      countRecentFailedLoginsByLoginIdentifierHash: async () => 5,
    });
    const post = createLoginHandler(harness.deps);

    const response = await post(
      postJsonRequest('https://example.com/api/auth/login', {
        identifier: 'hikari@example.com',
        credential: 'password-123',
        mode: 'password',
      }),
    );

    const payload = (await response.json()) as { requiresTurnstile?: boolean; error?: string };
    expect(response.status).toBe(400);
    expect(payload.requiresTurnstile).toBe(true);
    expect(payload.error).toContain('安全验证');
    expect(harness.getTurnstileCalls()).toBe(0);
    expect(harness.getBridgeCalls()).toBe(0);
  });

  test('password login continues after challenge when Turnstile token is valid', async () => {
    const { createLoginHandler } = await import('@/app/api/auth/login/handler');

    let validatedToken = '';
    const harness = createSuccessfulLoginDeps({
      countRecentFailedLoginsByLoginIdentifierHash: async () => 5,
      verifyTurnstileToken: async (token: string) => {
        validatedToken = token;
        return token === 'turnstile-ok';
      },
    });
    const post = createLoginHandler(harness.deps);

    const response = await post(
      postJsonRequest('https://example.com/api/auth/login', {
        identifier: 'hikari@example.com',
        credential: 'password-123',
        mode: 'password',
        turnstileToken: 'turnstile-ok',
      }),
    );

    const payload = (await response.json()) as { success?: boolean; user?: { id?: number } };
    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.user?.id).toBe(7);
    expect(validatedToken).toBe('turnstile-ok');
    expect(harness.getBridgeCalls()).toBe(1);
  });

  test('legacy login also asks for Turnstile after recent identifier failures', async () => {
    const { createLoginHandler } = await import('@/app/api/auth/login/handler');

    let legacyCalls = 0;
    const harness = createSuccessfulLoginDeps({
      countRecentFailedLoginsByLoginIdentifierHash: async () => 5,
      verifyUserLogin: async () => {
        legacyCalls += 1;
        return {
          id: 7,
          username: 'hikari',
          prefix: null,
        };
      },
    });
    const post = createLoginHandler(harness.deps);

    const response = await post(
      postJsonRequest('https://example.com/api/auth/login', {
        identifier: 'hikari',
        credential: 'legacy-auth-key-0007',
        mode: 'legacy',
      }),
    );

    const payload = (await response.json()) as { requiresTurnstile?: boolean; error?: string };
    expect(response.status).toBe(400);
    expect(payload.requiresTurnstile).toBe(true);
    expect(payload.error).toContain('安全验证');
    expect(legacyCalls).toBe(0);
    expect(harness.getTurnstileCalls()).toBe(0);
  });
});
