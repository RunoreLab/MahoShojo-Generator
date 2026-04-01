import { describe, expect, test } from 'bun:test';
import { createInternalTokenAuth } from '@/lib/auth/internal-token';

const createEnvReader = (env: Record<string, string | undefined>) => (key: string): string | undefined => env[key];

describe('auth/internal-token', () => {
  test('未启用内部接口时返回 503', async () => {
    const auth = createInternalTokenAuth({
      getEnv: createEnvReader({
        INTERNAL_API_ENABLED: 'false',
      }),
    });

    const result = await auth.requireInternalToken(new Request('https://example.com/api/internal/badges/sponsor'));
    expect('response' in result).toBeTrue();
    if (!('response' in result)) return;
    expect(result.response.status).toBe(503);
    const payload = (await result.response.json()) as { error?: string };
    expect(payload.error).toBe('内部自动化接口未启用');
  });

  test('单 token 配置可通过任意 scope 校验', async () => {
    const auth = createInternalTokenAuth({
      getEnv: createEnvReader({
        INTERNAL_API_ENABLED: 'true',
        INTERNAL_API_TOKEN: 'super-secret-token',
      }),
    });

    const result = await auth.requireInternalToken(
      new Request('https://example.com/api/internal/badges/excellent-reporter', {
        headers: {
          authorization: 'Bearer super-secret-token',
        },
      }),
      { scopes: ['badges:grant:excellent-reporter'] },
    );

    expect('response' in result).toBeFalse();
    if ('response' in result) return;
    expect(result.principal.name).toBe('default');
    expect(result.principal.scopes).toEqual(['*']);
  });

  test('多 token 配置会校验 scope', async () => {
    const auth = createInternalTokenAuth({
      getEnv: createEnvReader({
        INTERNAL_API_ENABLED: 'true',
        INTERNAL_API_TOKENS: JSON.stringify([
          {
            name: 'badge-cron',
            token: 'badge-token',
            scopes: ['badges:grant:*'],
          },
        ]),
      }),
    });

    const okResult = await auth.requireInternalToken(
      new Request('https://example.com/api/internal/badges/sponsor', {
        headers: {
          authorization: 'Bearer badge-token',
        },
      }),
      { scopes: ['badges:grant:sponsor'] },
    );
    expect('response' in okResult).toBeFalse();

    const forbiddenResult = await auth.requireInternalToken(
      new Request('https://example.com/api/internal/badges/sponsor', {
        headers: {
          authorization: 'Bearer badge-token',
        },
      }),
      { scopes: ['users:write'] },
    );
    expect('response' in forbiddenResult).toBeTrue();
    if (!('response' in forbiddenResult)) return;
    expect(forbiddenResult.response.status).toBe(403);
    const payload = (await forbiddenResult.response.json()) as { error?: string };
    expect(payload.error).toBe('权限不足');
  });

  test('错误 token 返回 401', async () => {
    const auth = createInternalTokenAuth({
      getEnv: createEnvReader({
        INTERNAL_API_ENABLED: 'true',
        INTERNAL_API_TOKEN: 'super-secret-token',
      }),
    });

    const result = await auth.requireInternalToken(
      new Request('https://example.com/api/internal/badges/excellent-reporter', {
        headers: {
          authorization: 'Bearer wrong-token',
        },
      }),
    );

    expect('response' in result).toBeTrue();
    if (!('response' in result)) return;
    expect(result.response.status).toBe(401);
    const payload = (await result.response.json()) as { error?: string };
    expect(payload.error).toBe('未授权');
  });
});
