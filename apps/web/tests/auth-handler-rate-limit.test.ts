import { describe, expect, vi, test } from 'vitest';

const postJsonRequest = (url: string, payload: unknown): Request =>
  new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

describe('auth handlers rate limit short circuit', () => {
  test('register: 命中限流后不再继续调用 turnstile 与 Better Auth', async () => {
    const { createRegisterHandler } = await import('@/app/api/auth/register/handler');

    const auditLogs: Array<Record<string, unknown>> = [];
    let turnstileCalls = 0;
    let bridgeCalls = 0;

    const post = createRegisterHandler({
      recordAuthAuditLog: async (input: Record<string, unknown>) => {
        auditLogs.push(input);
      },
      getBetterAuthBridgeAvailability: () => ({
        available: true as const,
      }),
      acquireAuthAttemptRateLimit: () => ({
        allowed: false as const,
        retryAfterSeconds: 42,
        reason: 'email_burst' as const,
        scope: 'email' as const,
      }),
      verifyTurnstileToken: async () => {
        turnstileCalls += 1;
        return true;
      },
      invokeBetterAuthJsonEndpoint: async () => {
        bridgeCalls += 1;
        return {
          ok: false as const,
          code: 'SHOULD_NOT_RUN',
          message: 'should not run',
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

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('42');
    const payload = (await response.json()) as { reason?: string };
    expect(payload.reason).toBe('email_burst');
    expect(turnstileCalls).toBe(0);
    expect(bridgeCalls).toBe(0);
    expect(auditLogs[0]?.resultCode).toBe('RATE_LIMITED');
  });

  test('login: 命中限流后不再继续调用 turnstile 与 Better Auth', async () => {
    const { createLoginHandler } = await import('@/app/api/auth/login/handler');

    const auditLogs: Array<Record<string, unknown>> = [];
    let turnstileCalls = 0;
    let bridgeCalls = 0;

    const post = createLoginHandler({
      recordAuthAuditLog: async (input: Record<string, unknown>) => {
        auditLogs.push(input);
      },
      getBetterAuthBridgeAvailability: () => ({
        available: true as const,
      }),
      acquireAuthAttemptRateLimit: () => ({
        allowed: false as const,
        retryAfterSeconds: 30,
        reason: 'identifier_burst' as const,
        scope: 'identifier' as const,
      }),
      verifyTurnstileToken: async () => {
        turnstileCalls += 1;
        return true;
      },
      invokeBetterAuthJsonEndpoint: async () => {
        bridgeCalls += 1;
        return {
          ok: false as const,
          code: 'SHOULD_NOT_RUN',
          message: 'should not run',
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

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('30');
    const payload = (await response.json()) as { reason?: string };
    expect(payload.reason).toBe('identifier_burst');
    expect(turnstileCalls).toBe(0);
    expect(bridgeCalls).toBe(0);
    expect(auditLogs[0]?.resultCode).toBe('RATE_LIMITED');
    expect(auditLogs[0]?.identifierType).toBe('email');
  });
});
