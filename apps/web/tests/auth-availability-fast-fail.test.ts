import { describe, expect, vi, test } from 'vitest';

const postJsonRequest = (url: string, payload: unknown): Request =>
  new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

describe('auth 快速失败预检', () => {
  test('register: Better Auth 不可用时应直接返回 503，且不触发 turnstile', async () => {
    const { createRegisterHandler } = await import('@/app/api/auth/register/handler');

    let turnstileCalls = 0;
    let bridgeCalls = 0;

    const post = createRegisterHandler({
      recordAuthAuditLog: async () => {},
      getBetterAuthBridgeAvailability: () => ({
        available: false as const,
        code: 'BETTER_AUTH_DB_UNAVAILABLE',
        message: 'db unavailable',
      }),
      verifyTurnstileToken: async () => {
        turnstileCalls += 1;
        return true;
      },
      invokeBetterAuthJsonEndpoint: async () => {
        bridgeCalls += 1;
        return {
          ok: false as const,
          code: 'BETTER_AUTH_INIT_FAILED',
          message: 'unexpected call',
        };
      },
    });

    const response = await post(
      postJsonRequest('https://example.com/api/auth/register', {
        username: 'hikari',
        email: 'hikari@example.com',
        password: 'password-123',
        turnstileToken: 'turnstile-ok',
      }),
    );

    expect(response.status).toBe(503);
    const payload = (await response.json()) as { code?: string; error?: string };
    expect(payload.code).toBe('BETTER_AUTH_DB_UNAVAILABLE');
    expect(payload.error).toContain('密码注册当前不可用');
    expect(turnstileCalls).toBe(0);
    expect(bridgeCalls).toBe(0);
  });

  test('login(password): Better Auth 不可用时应直接返回 503，且不触发 turnstile', async () => {
    const { createLoginHandler } = await import('@/app/api/auth/login/handler');

    let turnstileCalls = 0;
    let bridgeCalls = 0;

    const post = createLoginHandler({
      recordAuthAuditLog: async () => {},
      getBetterAuthBridgeAvailability: () => ({
        available: false as const,
        code: 'BETTER_AUTH_DB_UNAVAILABLE',
        message: 'db unavailable',
      }),
      verifyTurnstileToken: async () => {
        turnstileCalls += 1;
        return true;
      },
      invokeBetterAuthJsonEndpoint: async () => {
        bridgeCalls += 1;
        return {
          ok: false as const,
          code: 'BETTER_AUTH_INIT_FAILED',
          message: 'unexpected call',
        };
      },
    });

    const response = await post(
      postJsonRequest('https://example.com/api/auth/login', {
        identifier: 'hikari@example.com',
        credential: 'password-123',
        mode: 'password',
        turnstileToken: 'turnstile-ok',
      }),
    );

    expect(response.status).toBe(503);
    const payload = (await response.json()) as { code?: string; error?: string };
    expect(payload.code).toBe('BETTER_AUTH_DB_UNAVAILABLE');
    expect(payload.error).toContain('密码登录当前不可用');
    expect(turnstileCalls).toBe(0);
    expect(bridgeCalls).toBe(0);
  });
});
