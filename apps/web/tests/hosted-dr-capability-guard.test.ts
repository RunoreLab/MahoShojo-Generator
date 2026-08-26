import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseProvider } from '@mahoshojo/hosted-runtime/database-provider';
import hostedDrManifest from '../../../config/hosted-dr-capabilities.json';
import routeInventory from '../../../config/hono-api-routes.json';
import {
  isExecutableHostedDrMode,
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
  executionEnvironment: 'production' as const,
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

  it('drMode=fail-closed 时不调用 handler', async () => {
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
      category: 'dr-mode',
    });
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

  it('manifest 未声明的方法返回 405，非 production 保持现有本地行为', async () => {
    const handler = vi.fn(async () => new Response('local'));
    const production = withNextDrCapability('generate-free', handler, productionOptions);
    const methodResponse = await production(new Request(
      'https://next.test/api/generate-free',
      { method: 'GET' },
    ));
    expect(methodResponse.status).toBe(405);
    expect(handler).not.toHaveBeenCalled();

    const local = withNextDrCapability('generate-free', handler, {
      ...productionOptions,
      executionEnvironment: 'test',
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
    expect(hostedDrManifest.capabilities.map(({ id }) => id).sort()).toEqual(
      [...routeInventory.sharedRouteIds].sort(),
    );
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

  it('未知 drMode 运行时 fail closed', () => {
    expect(isExecutableHostedDrMode('safe-read')).toBe(true);
    expect(isExecutableHostedDrMode('new-request-only')).toBe(true);
    expect(isExecutableHostedDrMode('fail-closed')).toBe(false);
    expect(isExecutableHostedDrMode('unknown-mode')).toBe(false);
    expect(isExecutableHostedDrMode(undefined)).toBe(false);
  });

  it('逐项执行 23 capability 的 operation/secret/provider fail-closed 矩阵', async () => {
    const completeEnvironment: Record<string, string> = {
      HONO_CORS_ORIGINS: 'https://app.example.test',
      SIGNATURE_SECRET_KEY: 's'.repeat(32),
      R2_ACCESS_KEY_ID: 'local-access-key',
      R2_SECRET_ACCESS_KEY: 'local-secret-key',
      R2_BUCKET_NAME: 'local-bucket',
      R2_ACCOUNT_ID: 'local-account',
    };

    for (const capability of hostedDrManifest.capabilities) {
      for (const operation of capability.operations) {
        const handler = vi.fn(async () => new Response('executed'));
        const guarded = withNextDrCapability(capability.id, handler, {
          ...productionOptions,
          environment: completeEnvironment,
        });
        const response = await guarded(new Request(
          `https://api.example.test${capability.route.replace(/\[[^\]]+\]/gu, 'test-id')}`,
          { method: operation.method },
        ));

        if (operation.drMode === 'fail-closed') {
          expect(response.status, `${capability.id}:${operation.method}`).toBe(503);
          expect(handler, `${capability.id}:${operation.method}`).not.toHaveBeenCalled();
        } else {
          expect(response.status, `${capability.id}:${operation.method}`).toBe(200);
          expect(handler, `${capability.id}:${operation.method}`).toHaveBeenCalledOnce();

          const unavailableProviderHandler = vi.fn(async () => new Response('should-not-run'));
          const unavailableProviderRoute = withNextDrCapability(
            capability.id,
            unavailableProviderHandler,
            {
              ...productionOptions,
              environment: completeEnvironment,
              provider: { id: 'cloudflare-d1-binding', openSession: () => null },
            },
          );
          expect((await unavailableProviderRoute(new Request(
            `https://api.example.test${capability.route.replace(/\[[^\]]+\]/gu, 'test-id')}`,
            { method: operation.method },
          ))).status, `${capability.id}:${operation.method}:provider`).toBe(503);
          expect(unavailableProviderHandler).not.toHaveBeenCalled();
        }
      }

      const executableOperation = capability.operations.find(
        ({ drMode }) => drMode !== 'fail-closed',
      );
      if (!executableOperation) continue;
      for (const secret of capability.requiredSecrets) {
        const handler = vi.fn(async () => new Response('should-not-run'));
        const environment = { ...completeEnvironment, [secret.name]: '' };
        const guarded = withNextDrCapability(capability.id, handler, {
          ...productionOptions,
          environment,
        });
        const response = await guarded(new Request(
          `https://api.example.test${capability.route.replace(/\[[^\]]+\]/gu, 'test-id')}`,
          { method: executableOperation.method },
        ));
        expect(response.status, `${capability.id}:${secret.name}`).toBe(503);
        expect(handler, `${capability.id}:${secret.name}`).not.toHaveBeenCalled();
      }
    }
  });
});
