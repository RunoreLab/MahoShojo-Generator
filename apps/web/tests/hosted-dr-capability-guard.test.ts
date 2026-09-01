import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseProvider } from '@mahoshojo/hosted-runtime/database-provider';
import hostedRouting from '../../../config/hosted-routing.json';
import routeInventory from '../../../config/hono-api-routes.json';
import {
  isExecutableHostedDrOperationSafety,
  withNextDrCapability,
} from '@/lib/hosted-dr/capability-guard';

const readyProvider: DatabaseProvider = {
  id: 'cloudflare-d1-binding',
  openSession: ({ consistency }) => ({
    consistency,
    initialBookmark: null,
    getBookmark: () => null,
    client: { prepare: vi.fn() },
  }),
};

const productionOptions = {
  deploymentTarget: 'production' as const,
  environment: {
    HONO_CORS_ORIGINS: 'https://app.example.test',
  } as Record<string, string | undefined>,
  provider: readyProvider,
  logUnavailable: vi.fn(),
};

describe('Next production DR capability guard', () => {
  beforeEach(() => {
    productionOptions.logUnavailable.mockClear();
  });

  it('未列入 Next DR 运行规则的 route 不调用 handler', async () => {
    const handler = vi.fn(async () => new Response('should-not-run'));
    const guarded = withNextDrCapability('arena/generate', handler, productionOptions);

    const response = await guarded(new Request(
      'https://next.test/api/arena/generate',
      { method: 'POST' },
    ));

    expect(response.status).toBe(503);
    expect(handler).not.toHaveBeenCalled();
    expect(productionOptions.logUnavailable).toHaveBeenCalledWith({
      capabilityId: 'arena/generate',
      category: 'contract',
    });
  });

  it('只信显式 deployment target，不能用 NODE_ENV=development 绕过 production guard', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const handler = vi.fn(async () => new Response('should-not-run'));
    const guarded = withNextDrCapability('arena/generate', handler, {
      ...productionOptions,
      deploymentTarget: 'production',
    });

    const response = await guarded(new Request(
      'https://next.test/api/arena/generate',
      { method: 'POST' },
    ));

    expect(response.status).toBe(503);
    expect(handler).not.toHaveBeenCalled();
  });

  it('缺失或未知 deployment target 时 fail closed', async () => {
    vi.stubEnv('NEXT_PUBLIC_HOSTED_API_ENVIRONMENT', '');
    for (const deploymentTarget of [undefined, 'staging']) {
      const handler = vi.fn(async () => new Response('should-not-run'));
      const guarded = withNextDrCapability('generate-free', handler, {
        environment: productionOptions.environment,
        provider: readyProvider,
        logUnavailable: productionOptions.logUnavailable,
        deploymentTarget,
      });

      const response = await guarded(new Request(
        'https://next.test/api/generate-free',
        { method: 'POST' },
      ));
      expect(response.status, deploymentTarget ?? '<missing>').toBe(503);
      expect(handler).not.toHaveBeenCalled();
    }
  });

  it('missing/short secret 时不调用 handler，且日志不投影 secret 值', async () => {
    const handler = vi.fn(async () => new Response('should-not-run'));
    const guarded = withNextDrCapability('generate-magical-girl', handler, {
      ...productionOptions,
      environment: { SIGNATURE_SECRET_KEY: 'short-secret-canary' },
    });

    const response = await guarded(new Request(
      'https://next.test/api/generate-magical-girl',
      { method: 'POST' },
    ));

    expect(response.status).toBe(503);
    expect(handler).not.toHaveBeenCalled();
    expect(JSON.stringify(productionOptions.logUnavailable.mock.calls)).not.toContain(
      'short-secret-canary',
    );
  });

  it('binding/session 缺失时不调用 handler', async () => {
    const handler = vi.fn(async () => new Response('should-not-run'));
    const guarded = withNextDrCapability('generate-free', handler, {
      ...productionOptions,
      provider: { id: 'cloudflare-d1-binding', openSession: () => null },
    });

    const response = await guarded(new Request(
      'https://next.test/api/generate-free',
      { method: 'POST' },
    ));

    expect(response.status).toBe(503);
    expect(handler).not.toHaveBeenCalled();
    expect(productionOptions.logUnavailable).toHaveBeenCalledWith({
      capabilityId: 'generate-free',
      category: 'database-provider',
    });
  });

  it('binding/session 初始化抛错时仍固定 fail closed', async () => {
    const handler = vi.fn(async () => new Response('should-not-run'));
    const guarded = withNextDrCapability('generate-free', handler, {
      ...productionOptions,
      provider: {
        id: 'cloudflare-d1-binding',
        openSession: () => {
          throw new Error('database-binding-secret-canary');
        },
      },
    });

    const response = await guarded(new Request(
      'https://next.test/api/generate-free',
      { method: 'POST' },
    ));

    expect(response.status).toBe(503);
    expect(handler).not.toHaveBeenCalled();
    expect(JSON.stringify(productionOptions.logUnavailable.mock.calls)).not.toContain(
      'database-binding-secret-canary',
    );
  });

  it('ready capability 原样透传 handler response，不实现 retry/fallback', async () => {
    const original = new Response('original-body', {
      status: 202,
      headers: { 'X-Original': 'preserved' },
    });
    const handler = vi.fn(async () => original);
    const guarded = withNextDrCapability('generate-free', handler, productionOptions);

    const response = await guarded(new Request(
      'https://next.test/api/generate-free',
      { method: 'POST' },
    ));

    expect(response).toBe(original);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('routing 未声明的方法返回 405，非 production 保持现有本地行为', async () => {
    const handler = vi.fn(async () => new Response('local'));
    const production = withNextDrCapability('generate-free', handler, productionOptions);
    const methodResponse = await production(new Request(
      'https://next.test/api/generate-free',
      { method: 'GET' },
    ));
    expect(methodResponse.status).toBe(405);
    expect(methodResponse.headers.get('allow')).toBe('POST');
    expect(await methodResponse.json()).toEqual({ error: 'Method not allowed' });
    expect(handler).not.toHaveBeenCalled();

    const local = withNextDrCapability('generate-free', handler, {
      ...productionOptions,
      deploymentTarget: 'test',
    });
    expect(await (await local(new Request('https://next.test/api/generate-free'))).text()).toBe('local');
    expect(handler).toHaveBeenCalledOnce();
  });

  it('在 capability method 判断前处理合法 preflight，并给实际响应附加同核 CORS', async () => {
    const handler = vi.fn(async () => new Response('ok', {
      headers: { 'X-Request-Id': 'request-1' },
    }));
    const guarded = withNextDrCapability('generate-free', handler, productionOptions);
    const requestHeaders = {
      Origin: 'https://app.example.test',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization, content-type',
    };

    const preflight = await guarded(new Request(
      'https://api.example.test/api/generate-free',
      { method: 'OPTIONS', headers: requestHeaders },
    ));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://app.example.test');
    expect(preflight.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      'authorization',
    );
    expect(handler).not.toHaveBeenCalled();

    const response = await guarded(new Request(
      'https://api.example.test/api/generate-free',
      { method: 'POST', headers: { Origin: 'https://app.example.test' } },
    ));
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://app.example.test');
    expect(response.headers.get('access-control-expose-headers')).toContain('X-Request-Id');
    expect(handler).toHaveBeenCalledOnce();
  });

  it('production wildcard/localhost CORS 配置 fail closed，不反射任意 Origin', async () => {
    for (const configuredOrigins of ['*', 'http://localhost:3000']) {
      const handler = vi.fn(async () => new Response('should-not-run'));
      const guarded = withNextDrCapability('generate-free', handler, {
        ...productionOptions,
        environment: { HONO_CORS_ORIGINS: configuredOrigins },
      });
      const response = await guarded(new Request(
        'https://api.example.test/api/generate-free',
        {
          method: 'POST',
          headers: { Origin: 'https://evil.example' },
        },
      ));

      expect(response.status, configuredOrigins).toBe(503);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
      expect(handler).not.toHaveBeenCalled();
      expect(productionOptions.logUnavailable).toHaveBeenCalledWith({
        capabilityId: 'generate-free',
        category: 'cors',
      });
      productionOptions.logUnavailable.mockClear();
    }
  });

  it('production 缺失或非法 CORS 配置在无 Origin 的 GET/HEAD/POST 上也 fail closed', async () => {
    for (const configuredOrigins of [undefined, '*', 'http://localhost:3000']) {
      for (const method of ['GET', 'HEAD', 'POST']) {
        const handler = vi.fn(async () => new Response('should-not-run'));
        const guarded = withNextDrCapability('generate-free', handler, {
          ...productionOptions,
          environment: configuredOrigins === undefined
            ? {}
            : { HONO_CORS_ORIGINS: configuredOrigins },
        });
        const response = await guarded(new Request(
          'https://api.example.test/api/generate-free',
          { method },
        ));

        const label = `${method}:${configuredOrigins ?? '<missing>'}`;
        expect(response.status, label).toBe(503);
        expect(handler, label).not.toHaveBeenCalled();
        expect(productionOptions.logUnavailable, label).toHaveBeenCalledWith({
          capabilityId: 'generate-free',
          category: 'cors',
        });
        productionOptions.logUnavailable.mockClear();
      }
    }
  });

  it('Arena terminal safe-read 缺 R2 logical binding 配置时不进入 handler', async () => {
    const handler = vi.fn(async () => new Response('should-not-run'));
    const guarded = withNextDrCapability(
      'arena/generations/[generationId]/stream',
      handler,
      {
        ...productionOptions,
        environment: {
          HONO_CORS_ORIGINS: 'https://app.example.test',
          R2_ACCESS_KEY_ID: 'local-access-key',
          R2_SECRET_ACCESS_KEY: 'local-secret-key',
        },
      },
    );

    const response = await guarded(new Request(
      'https://api.example.test/api/arena/generations/generation-1/stream',
    ));

    expect(response.status).toBe(503);
    expect(handler).not.toHaveBeenCalled();
    expect(productionOptions.logUnavailable).toHaveBeenCalledWith({
      capabilityId: 'arena/generations/[generationId]/stream',
      category: 'binding',
    });
  });

  it('每条 shared Next route 都显式包裹同一 guard', () => {
    for (const routeId of routeInventory.sharedRouteIds) {
      const source = readFileSync(path.join(
        process.cwd(),
        'app/api',
        routeId,
        'route.ts',
      ), 'utf8');
      expect(source, routeId).toContain('withNextDrCapability');
      expect(source, routeId).toContain(`'${routeId}'`);
    }
  });

  it('未知 operation safety 运行时 fail closed', () => {
    expect(isExecutableHostedDrOperationSafety('safe-read')).toBe(true);
    expect(isExecutableHostedDrOperationSafety('new-non-idempotent')).toBe(true);
    expect(isExecutableHostedDrOperationSafety('durably-idempotent')).toBe(false);
    expect(isExecutableHostedDrOperationSafety('unknown-mode')).toBe(false);
    expect(isExecutableHostedDrOperationSafety(undefined)).toBe(false);
  });

  it('逐项执行实际 Next DR operation 的 safety/provider 边界', async () => {
    const completeEnvironment: Record<string, string> = {
      HONO_CORS_ORIGINS: 'https://app.example.test',
      SIGNATURE_SECRET_KEY: 's'.repeat(32),
      R2_ACCESS_KEY_ID: 'local-access-key',
      R2_SECRET_ACCESS_KEY: 'local-secret-key',
      R2_BUCKET_NAME: 'local-bucket',
      R2_ACCOUNT_ID: 'local-account',
    };

    for (const operation of hostedRouting.operations) {
      const capabilityId = operation.route.slice('/api/'.length);
      const handler = vi.fn(async () => new Response('executed'));
      const guarded = withNextDrCapability(capabilityId, handler, {
        ...productionOptions,
        environment: completeEnvironment,
      });
      const response = await guarded(new Request(
        `https://api.example.test${operation.route.replace(/\[[^\]]+\]/gu, 'test-id')}`,
        { method: operation.method },
      ));

      if (operation.safety === 'durably-idempotent') {
        expect(response.status, `${capabilityId}:${operation.method}`).toBe(503);
        expect(handler, `${capabilityId}:${operation.method}`).not.toHaveBeenCalled();
      } else {
        expect(response.status, `${capabilityId}:${operation.method}`).toBe(200);
        expect(handler, `${capabilityId}:${operation.method}`).toHaveBeenCalledOnce();

        const unavailableProviderHandler = vi.fn(async () => new Response('should-not-run'));
        const unavailableProviderRoute = withNextDrCapability(
          capabilityId,
          unavailableProviderHandler,
          {
            ...productionOptions,
            environment: completeEnvironment,
            provider: { id: 'cloudflare-d1-binding', openSession: () => null },
          },
        );
        expect((await unavailableProviderRoute(new Request(
          `https://api.example.test${operation.route.replace(/\[[^\]]+\]/gu, 'test-id')}`,
          { method: operation.method },
        ))).status, `${capabilityId}:${operation.method}:provider`).toBe(503);
        expect(unavailableProviderHandler).not.toHaveBeenCalled();
      }
    }
  });

  it('需要签名或 R2 的 route 在依赖缺失时 fail closed', async () => {
    for (const [capabilityId, route, method, environment] of [
      [
        'generate-magical-girl',
        '/api/generate-magical-girl',
        'POST',
        { ...productionOptions.environment, SIGNATURE_SECRET_KEY: '' },
      ],
      [
        'arena/generations/[generationId]/stream',
        '/api/arena/generations/generation-1/stream',
        'GET',
        { ...productionOptions.environment },
      ],
    ] as const) {
      const handler = vi.fn(async () => new Response('should-not-run'));
      const guarded = withNextDrCapability(capabilityId, handler, {
          ...productionOptions,
          environment,
        });
      const response = await guarded(new Request(`https://api.example.test${route}`, { method }));
      expect(response.status, capabilityId).toBe(503);
      expect(handler, capabilityId).not.toHaveBeenCalled();
    }
  });
});
