import { describe, expect, it, vi } from 'vitest';
import {
  createHostedApiCorsPreflightResponse,
  createHostedDrReadinessService,
  hasValidHostedApiProductionCorsOrigins,
  HOSTED_API_CORS_ALLOW_HEADERS,
  HOSTED_API_CORS_ALLOW_METHODS,
  parseHostedApiDeploymentTarget,
  resolveHostedApiCorsOrigin,
  selectHostedDrRuntime,
  withHostedApiCorsHeaders,
  type HostedDrReadinessDatabaseProvider,
} from '../src/hosted-dr';

describe('Hosted deployment target contract', () => {
  it.each(['production', 'preview', 'local', 'test'] as const)(
    'accepts explicit %s target',
    (target) => {
      expect(parseHostedApiDeploymentTarget(target)).toBe(target);
      expect(parseHostedApiDeploymentTarget(` ${target.toUpperCase()} `)).toBe(target);
    },
  );

  it.each([undefined, '', 'development', 'staging', 'prod'])(
    'rejects missing or unknown target: %s',
    (target) => {
      expect(parseHostedApiDeploymentTarget(target)).toBeNull();
    },
  );
});

describe('Hosted API cross-runtime CORS contract', () => {
  const allowedOrigins = ['https://app.example.test', 'https://*.colanns.me'];

  it('Hono/Next 共用 exact/wildcard origin 与固定 allow contract', () => {
    expect(resolveHostedApiCorsOrigin('https://app.example.test', allowedOrigins)).toBe(
      'https://app.example.test',
    );
    expect(resolveHostedApiCorsOrigin('https://mahoshojo.colanns.me', allowedOrigins)).toBe(
      'https://mahoshojo.colanns.me',
    );
    expect(resolveHostedApiCorsOrigin('https://colanns.me', allowedOrigins)).toBe('');
    expect(HOSTED_API_CORS_ALLOW_METHODS).toContain('POST');
    expect(HOSTED_API_CORS_ALLOW_HEADERS).toContain('Authorization');
    expect(hasValidHostedApiProductionCorsOrigins(allowedOrigins)).toBe(true);
    expect(hasValidHostedApiProductionCorsOrigins(['*'])).toBe(false);
    expect(hasValidHostedApiProductionCorsOrigins(['http://localhost:3000'])).toBe(false);
    expect(hasValidHostedApiProductionCorsOrigins(['https://127.0.0.1'])).toBe(false);
    expect(hasValidHostedApiProductionCorsOrigins(['not-an-origin'])).toBe(false);
  });

  it('为合法浏览器 preflight 返回无凭据的 204 contract', () => {
    const response = createHostedApiCorsPreflightResponse(new Request(
      'https://api.example.test/api/generate-free',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://app.example.test',
          'Access-Control-Request-Method': 'POST',
        },
      },
    ), allowedOrigins);

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://app.example.test');
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
    expect(response.headers.get('access-control-allow-headers')).toContain('Authorization');
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('只给允许的实际跨域响应附加公开 CORS header', () => {
    const request = new Request('https://api.example.test/api/generate-free', {
      headers: { Origin: 'https://app.example.test' },
    });
    const response = withHostedApiCorsHeaders(
      request,
      new Response('ok', { headers: { 'X-Request-Id': 'request-1' } }),
      allowedOrigins,
    );

    expect(response.headers.get('access-control-allow-origin')).toBe('https://app.example.test');
    expect(response.headers.get('access-control-expose-headers')).toContain('X-Request-Id');
    expect(response.headers.get('vary')).toContain('Origin');
  });
});

describe('Hosted DR runtime selector', () => {
  it('把尚未 dispatch 的 safe read 在 primary unavailable 时交给 Next DR', () => {
    expect(selectHostedDrRuntime({
      requestClass: 'safe-read',
      dispatchState: 'not-dispatched',
      primaryHealth: 'unavailable',
      hasDurableIdempotencyProof: false,
    })).toBe('next-dr');
  });

  it('只让带 durable proof 的幂等命令在 primary unavailable 时进入 Next DR', () => {
    const input = {
      requestClass: 'durably-idempotent-command' as const,
      dispatchState: 'not-dispatched' as const,
      primaryHealth: 'unavailable' as const,
    };

    expect(selectHostedDrRuntime({
      ...input,
      hasDurableIdempotencyProof: true,
    })).toBe('next-dr');
    expect(selectHostedDrRuntime({
      ...input,
      hasDurableIdempotencyProof: false,
    })).toBe('fail-closed');
  });

  it('允许控制面把尚未 dispatch 的非幂等新 operation 直接选择到 Next DR', () => {
    expect(selectHostedDrRuntime({
      requestClass: 'non-idempotent-operation',
      dispatchState: 'not-dispatched',
      primaryHealth: 'unavailable',
      hasDurableIdempotencyProof: false,
    })).toBe('next-dr');
  });

  it.each(['dispatched', 'unknown'] as const)(
    '对 %s 的非幂等 operation fail closed，禁止透明第二次 POST',
    (dispatchState) => {
      expect(selectHostedDrRuntime({
        requestClass: 'non-idempotent-operation',
        dispatchState,
        primaryHealth: 'unavailable',
        hasDurableIdempotencyProof: false,
      })).toBe('fail-closed');
    },
  );

  it('primary 健康时只把后续未 dispatch 请求交给 Hono，不改变既有请求的决定', () => {
    expect(selectHostedDrRuntime({
      requestClass: 'non-idempotent-operation',
      dispatchState: 'not-dispatched',
      primaryHealth: 'healthy',
      hasDurableIdempotencyProof: false,
    })).toBe('hono-primary');
    expect(selectHostedDrRuntime({
      requestClass: 'non-idempotent-operation',
      dispatchState: 'unknown',
      primaryHealth: 'healthy',
      hasDurableIdempotencyProof: false,
    })).toBe('fail-closed');
  });

  it('primary 健康状态不明确时 fail closed', () => {
    expect(selectHostedDrRuntime({
      requestClass: 'safe-read',
      dispatchState: 'not-dispatched',
      primaryHealth: 'unknown',
      hasDurableIdempotencyProof: false,
    })).toBe('fail-closed');
  });
});

const readinessProvider = (
  result: unknown = { success: true, results: [{ ok: 1 }], meta: {} },
): {
  provider: HostedDrReadinessDatabaseProvider;
  sql: string[];
  options: unknown[];
} => {
  const sql: string[] = [];
  const options: unknown[] = [];
  return {
    provider: {
      id: 'cloudflare-d1-binding',
      openSession: ({ consistency }) => ({
        consistency,
        initialBookmark: 'bookmark-secret-canary',
        getBookmark: () => 'bookmark-secret-canary',
        client: {
          prepare: (statementSql) => {
            sql.push(statementSql);
            return {
              bind: () => {
                throw new Error('readiness SQL 不得 bind 任意输入');
              },
              run: async () => {
                throw new Error('readiness 必须使用 all safe-read');
              },
              all: async (queryOptions) => {
                options.push(queryOptions);
                return result as never;
              },
            };
          },
        },
      }),
    },
    sql,
    options,
  };
};

describe('Hosted DR readiness application contract', () => {
  it('只执行固定 SELECT 1 safe-read 并返回最小公开 contract', async () => {
    const { provider, sql, options } = readinessProvider();
    const service = createHostedDrReadinessService({
      placement: 'next-dr',
      provider,
    });

    const response = await service(new Request('https://example.test/api/hosted/dr-readiness'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      ok: true,
      contractVersion: 'g25e1-v1',
      placement: 'next-dr',
      databaseProvider: 'cloudflare-d1-binding',
      consistency: 'replica-ok',
    });
    expect(sql).toEqual(['SELECT 1 AS ok']);
    expect(options).toEqual([{ retry: 'safe-read' }]);
  });

  it('HEAD 保持状态与 header parity 且 body 为空', async () => {
    const { provider } = readinessProvider();
    const service = createHostedDrReadinessService({
      placement: 'hono-primary',
      provider,
    });

    const response = await service(new Request(
      'https://example.test/api/hosted/dr-readiness',
      { method: 'HEAD' },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('');
  });

  it.each([
    ['missing provider', null],
    ['query failure', new Error('db-url-secret-canary')],
    ['invalid result', { success: true, results: [{ ok: 0 }], meta: {} }],
  ] as const)('%s 时返回固定 503 且不泄漏内部值', async (_label, outcome) => {
    const provider = outcome === null
      ? { id: 'cloudflare-d1-binding' as const, openSession: () => null }
      : readinessProvider(outcome).provider;
    if (outcome instanceof Error) {
      provider.openSession = () => ({
        consistency: 'replica-ok',
        initialBookmark: 'bookmark-secret-canary',
        getBookmark: () => 'bookmark-secret-canary',
        client: {
          prepare: () => ({
            bind: () => { throw outcome; },
            run: async () => { throw outcome; },
            all: async () => { throw outcome; },
          }),
        },
      });
    }
    const service = createHostedDrReadinessService({
      placement: 'next-dr',
      provider,
    });

    const response = await service(new Request('https://example.test/api/hosted/dr-readiness'));
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toEqual({
      ok: false,
      code: 'HOSTED_DR_CAPABILITY_UNAVAILABLE',
      contractVersion: 'g25e1-v1',
    });
    expect(body).not.toMatch(/bookmark-secret-canary|db-url-secret-canary|SELECT 1/u);
  });

  it('拒绝 GET/HEAD 之外的方法且不打开 provider session', async () => {
    const openSession = vi.fn();
    const service = createHostedDrReadinessService({
      placement: 'next-dr',
      provider: { id: 'cloudflare-d1-binding', openSession },
    });

    const response = await service(new Request(
      'https://example.test/api/hosted/dr-readiness',
      { method: 'POST' },
    ));

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
    expect(openSession).not.toHaveBeenCalled();
  });
});
