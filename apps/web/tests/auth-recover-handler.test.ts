import { describe, expect, vi, test } from 'vitest';

const loadCreateRecoverHandler = async () => {
  const route = await import('@/app/api/auth/recover/handler');
  return route.createRecoverHandler;
};

const postJsonRequest = (url: string, payload: unknown): Request =>
  new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

describe('auth/recover handler', () => {
  test('仅提供邮箱且唯一命中账号时会发送重置邮件', async () => {
    const createRecoverHandler = await loadCreateRecoverHandler();
    const mailPayloads: Record<string, unknown>[] = [];

    const handler = createRecoverHandler({
      generateRecoveryToken: () => 'recover-token-0001',
      hashRecoveryToken: async (token: string) => `hash:${token}`,
      recoveryTokenTtlSeconds: 15 * 60,
      getDrizzleDbFromRuntime: () => ({}),
      getBusinessUserByUsername: async () => null,
      consumePasswordResetTokenById: async () => {},
      createPasswordResetToken: async () => ({
        id: 'reset-1',
        userId: 7,
        tokenHash: 'hash:recover-token-0001',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
      }),
      getUserByUsername: async () => null,
      verifyTurnstileToken: async () => true,
      fetchImpl: async (_input: RequestInfo | URL, init?: RequestInit) => {
        mailPayloads.push(JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>);
        return new Response(JSON.stringify({ id: 'mail-1' }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        });
      },
      getResendApiKey: () => 'resend-test-key',
      now: () => Date.UTC(2026, 3, 18, 10, 0, 0),
      listBusinessUsersByEmailInsensitive: async (_db: unknown, email: string) =>
        email === 'hana@example.com'
          ? [{ id: 7, username: 'hana', email: 'hana@example.com' }]
          : [],
    } as any);

    const response = await handler(
      postJsonRequest('https://example.com/api/auth/recover', {
        email: 'hana@example.com',
        turnstileToken: 'turnstile-ok',
      }),
    );

    expect(response.status).toBe(200);
    expect(mailPayloads).toHaveLength(1);
    expect(String(mailPayloads[0]?.text ?? '')).toContain('recover-token-0001');
  });

  test('邮箱命中多个历史账号时保持统一响应但不发送重置邮件', async () => {
    const createRecoverHandler = await loadCreateRecoverHandler();
    const mailPayloads: Record<string, unknown>[] = [];

    const handler = createRecoverHandler({
      generateRecoveryToken: () => 'recover-token-dup',
      hashRecoveryToken: async (token: string) => `hash:${token}`,
      recoveryTokenTtlSeconds: 15 * 60,
      getDrizzleDbFromRuntime: () => ({}),
      getBusinessUserByUsername: async () => null,
      consumePasswordResetTokenById: async () => {},
      createPasswordResetToken: async () => ({
        id: 'reset-dup',
        userId: 9,
        tokenHash: 'hash:recover-token-dup',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
      }),
      getUserByUsername: async () => null,
      verifyTurnstileToken: async () => true,
      fetchImpl: async (_input: RequestInfo | URL, init?: RequestInit) => {
        mailPayloads.push(JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>);
        return new Response(JSON.stringify({ id: 'mail-dup' }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        });
      },
      getResendApiKey: () => 'resend-test-key',
      now: () => Date.UTC(2026, 3, 18, 10, 0, 0),
      listBusinessUsersByEmailInsensitive: async (_db: unknown, email: string) =>
        email === 'duplicate@example.com'
          ? [
              { id: 9, username: 'hana', email: 'duplicate@example.com' },
              { id: 10, username: 'mika', email: 'duplicate@example.com' },
            ]
          : [],
    } as any);

    const response = await handler(
      postJsonRequest('https://example.com/api/auth/recover', {
        email: 'duplicate@example.com',
        turnstileToken: 'turnstile-ok',
      }),
    );

    const payload = (await response.json()) as { success?: boolean; message?: string };
    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mailPayloads).toHaveLength(0);
  });
});
