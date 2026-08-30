import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createHostedDrReadinessService,
  type HostedDrReadinessDatabaseProvider,
} from '@mahoshojo/hosted-api/hosted-dr';
import {
  createD1HttpTransport,
  createHttpD1Client,
  D1IndeterminateOutcomeError,
} from '@mahoshojo/hosted-runtime/d1-http-client';
import { createCloudflareD1BindingDatabaseProvider } from '@mahoshojo/hosted-runtime/database-provider';
import { createHonoApp } from '#/app';
import type { HonoServerConfig } from '#/config';
import { registerHealthRoutes } from '#/health';
import type { HonoAppVariables } from '#/middleware/request-metadata';
import {
  RedisRuntime,
  type RedisService,
} from '#/redis/runtime';

const redisClient = vi.hoisted(() => ({
  close: vi.fn(async () => undefined),
  connect: vi.fn(async () => undefined),
  destroy: vi.fn(),
  eval: vi.fn(async () => [1, 60_000]),
  get: vi.fn(async () => null),
  isOpen: true,
  isReady: true,
  on: vi.fn(),
  ping: vi.fn(async () => 'PONG'),
  xRead: vi.fn(async () => null),
}));

const redisBlockingPool = vi.hoisted(() => ({
  connect: vi.fn(async () => undefined),
  destroy: vi.fn(),
  isOpen: true,
  on: vi.fn(),
  ping: vi.fn(async () => 'PONG'),
  xRead: vi.fn(async () => null),
}));

vi.mock('redis', () => ({
  createClient: vi.fn(() => redisClient),
  createClientPool: vi.fn(() => redisBlockingPool),
}));

const config: HonoServerConfig = {
  arenaMultiplayerEnabled: false,
  host: '127.0.0.1',
  port: 8787,
  nodeEnv: 'test',
  redisUrl: null,
  redisKeyPrefix: '',
  redisRequired: false,
  d1Required: false,
  corsOrigins: ['http://localhost:3000'],
  arenaRoomAllowedOrigins: ['http://localhost:3000'],
  authMode: 'hybrid',
};

const createRedisService = (input: {
  configured?: boolean;
  ready?: boolean;
  ping?: boolean;
  consumeFixedWindow?: RedisService['consumeFixedWindow'];
} = {}): RedisService => ({
  connect: async () => undefined,
  close: async () => undefined,
  getStatus: () => ({
    configured: input.configured ?? true,
    connected: input.ready ?? false,
    ready: input.ready ?? false,
    lastError: input.ready === false ? 'REDIS_CONNECTION_ERROR' : null,
  }),
  ping: async () => input.ping ?? false,
  consumeFixedWindow: input.consumeFixedWindow ?? (async () => null),
});

const createReadyBindingProvider = (): HostedDrReadinessDatabaseProvider => {
  const statement = {
    bind: () => statement,
    run: async () => ({ success: true, results: [], meta: {} }),
    all: async () => ({ success: true, results: [{ ok: 1 }], meta: {} }),
  };
  return createCloudflareD1BindingDatabaseProvider(() => ({
    withSession: () => ({
      prepare: () => statement,
      getBookmark: () => 'dr-bookmark-not-public',
    }),
  }));
};

beforeEach(() => {
  redisClient.connect.mockResolvedValue(undefined);
  redisClient.eval.mockResolvedValue([1, 60_000]);
  redisClient.get.mockResolvedValue(null);
  redisClient.ping.mockResolvedValue('PONG');
  redisClient.xRead.mockResolvedValue(null);
  redisClient.isOpen = true;
  redisClient.isReady = true;
  redisBlockingPool.connect.mockResolvedValue(undefined);
  redisBlockingPool.ping.mockResolvedValue('PONG');
  redisBlockingPool.isOpen = true;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('G25E-2 Hosted DR fault matrix: Hono/Redis/Gateway/D1', () => {
  it('G25E2-REDIS-UNAVAILABLE：liveness 保持可用，required health 与 API 限速 fail closed', async () => {
    const redis = createRedisService({ configured: true, ready: false, ping: false });
    const app = createHonoApp({
      ...config,
      redisRequired: true,
    }, redis);

    const live = await app.request('/api/health/live');
    const ready = await app.request('/api/health/ready');
    const api = await app.request('/api/not-existing');

    expect(live.status).toBe(200);
    expect(ready.status).toBe(503);
    expect(await ready.json()).toMatchObject({
      ok: false,
      dependencies: { redis: { configured: true, required: true, ready: false } },
    });
    expect(api.status).toBe(503);
    expect(await api.json()).toEqual({
      error: '限速服务暂时不可用',
      code: 'RATE_LIMIT_UNAVAILABLE',
    });
  });

  it('G25E2-REDIS-EMPTY：实际 RedisRuntime 只返回空 replay state，不把空态当成业务事实', async () => {
    const redis = new RedisRuntime('redis://fault-injection.invalid:6379', true);
    await redis.connect();

    const store = redis.getGenerationReplayStore();
    await expect(store.readState({
      generationId: 'generation-empty-001',
      actorKey: 'user:empty-001',
    })).resolves.toBeNull();
    await expect(redis.ping()).resolves.toBe(true);
    expect(redis.getStatus()).toMatchObject({ configured: true, connected: true, ready: true });

    await redis.close();
    expect(redisClient.destroy).toHaveBeenCalledOnce();
    expect(redisBlockingPool.destroy).toHaveBeenCalledOnce();
  });

  it('G25E2-GATEWAY-UNAVAILABLE：Hono readiness 503，但独立 Cloudflare binding readiness 仍可用', async () => {
    vi.stubEnv('D1_GATEWAY_URL', 'https://gateway.fault-injection.invalid');
    vi.stubEnv('D1_GATEWAY_HMAC_SECRET', 'g'.repeat(32));
    const fetcher = vi.fn(async () => {
      throw new Error('gateway unavailable');
    });
    vi.stubGlobal('fetch', fetcher);

    const hono = new Hono<{ Variables: HonoAppVariables }>();
    registerHealthRoutes(hono, {
      ...config,
      d1Required: true,
    }, createRedisService({ configured: false, ready: false, ping: false }));
    const primaryResponse = await hono.request('/health/ready');

    expect(primaryResponse.status).toBe(503);
    expect(await primaryResponse.json()).toMatchObject({
      ok: false,
      dependencies: {
        d1: { configured: true, required: true, ready: false, transport: 'gateway' },
      },
    });

    const drService = createHostedDrReadinessService({
      placement: 'next-dr',
      provider: createReadyBindingProvider(),
    });
    const drResponse = await drService(new Request('https://dr.test/api/hosted/dr-readiness'));

    expect(drResponse.status).toBe(200);
    expect(await drResponse.json()).toMatchObject({
      ok: true,
      placement: 'next-dr',
      databaseProvider: 'cloudflare-d1-binding',
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('G25E2-D1-UNAVAILABLE：DR provider 缺失时固定 503，D1 write transport unknown 不透明重试', async () => {
    const fallbackFetch = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fallbackFetch);
    const unavailableProvider: HostedDrReadinessDatabaseProvider = {
      id: 'cloudflare-d1-binding',
      openSession: () => null,
    };
    const readiness = createHostedDrReadinessService({
      placement: 'next-dr',
      provider: unavailableProvider,
    });
    const readinessResponse = await readiness(new Request('https://dr.test/api/hosted/dr-readiness'));

    expect(readinessResponse.status).toBe(503);
    expect(await readinessResponse.json()).toEqual({
      ok: false,
      code: 'HOSTED_DR_CAPABILITY_UNAVAILABLE',
      contractVersion: 'g25e1-v1',
    });
    expect(fallbackFetch).not.toHaveBeenCalled();

    const writeFetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const client = createHttpD1Client(createD1HttpTransport({
      kind: 'gateway',
      baseUrl: 'https://gateway.fault-injection.invalid',
      fetch: writeFetch,
    }));

    await expect(client.prepare('UPDATE authoritative_state SET value = ?').bind('x').run())
      .rejects.toBeInstanceOf(D1IndeterminateOutcomeError);
    expect(writeFetch).toHaveBeenCalledOnce();
  });
});
