import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseProvider } from '@mahoshojo/hosted-runtime/database-provider';
import hostedDrManifest from '../../../config/hosted-dr-capabilities.json';
import routeInventory from '../../../config/hono-api-routes.json';
import { withNextDrCapability } from '@/lib/hosted-dr/capability-guard';

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
  environment: {} as Record<string, string | undefined>,
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
});
