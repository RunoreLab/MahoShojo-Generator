import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HonoServerConfig } from '#/config';
import { registerHealthRoutes } from '#/health';
import type { HonoAppVariables } from '#/middleware/request-metadata';
import type { RedisService } from '#/redis/runtime';

type D1TransportCase = {
  name: string;
  transport: 'gateway' | 'cloudflare-api';
  expectedUrl: string;
};

const originalEnvironment = {
  gatewayUrl: process.env.D1_GATEWAY_URL,
  gatewaySecret: process.env.D1_GATEWAY_HMAC_SECRET,
  gatewayToken: process.env.D1_GATEWAY_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  databaseId: process.env.D1_DATABASE_ID,
  apiToken: process.env.CLOUDFLARE_API_TOKEN,
};

const config: HonoServerConfig = {
  arenaMultiplayerEnabled: false,
  host: '127.0.0.1',
  port: 8787,
  nodeEnv: 'test',
  redisUrl: null,
  redisKeyPrefix: '',
  redisRequired: false,
  d1Required: true,
  corsOrigins: ['http://localhost:3000'],
  arenaRoomAllowedOrigins: ['http://localhost:3000'],
  authMode: 'hybrid',
};

const redisStub: RedisService = {
  connect: async () => undefined,
  close: async () => undefined,
  getStatus: () => ({ configured: false, connected: false, ready: false, lastError: null }),
  ping: async () => false,
  consumeFixedWindow: async () => null,
};

const transportCases: D1TransportCase[] = [
  {
    name: 'Gateway',
    transport: 'gateway',
    expectedUrl: 'https://gateway.example.test/v1/query',
  },
  {
    name: 'Cloudflare 管理 API',
    transport: 'cloudflare-api',
    expectedUrl: 'https://api.cloudflare.com/client/v4/accounts/account_x/d1/database/db_x/query',
  },
];

const restoreEnvironment = () => {
  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };

  restore('D1_GATEWAY_URL', originalEnvironment.gatewayUrl);
  restore('D1_GATEWAY_HMAC_SECRET', originalEnvironment.gatewaySecret);
  restore('D1_GATEWAY_TOKEN', originalEnvironment.gatewayToken);
  restore('CLOUDFLARE_ACCOUNT_ID', originalEnvironment.accountId);
  restore('D1_DATABASE_ID', originalEnvironment.databaseId);
  restore('CLOUDFLARE_API_TOKEN', originalEnvironment.apiToken);
};

const configureTransport = (transport: D1TransportCase['transport']) => {
  delete process.env.D1_GATEWAY_URL;
  delete process.env.D1_GATEWAY_HMAC_SECRET;
  delete process.env.D1_GATEWAY_TOKEN;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.D1_DATABASE_ID;
  delete process.env.CLOUDFLARE_API_TOKEN;

  if (transport === 'gateway') {
    process.env.D1_GATEWAY_URL = 'https://gateway.example.test';
    process.env.D1_GATEWAY_HMAC_SECRET = 'g'.repeat(32);
    return;
  }

  process.env.CLOUDFLARE_ACCOUNT_ID = 'account_x';
  process.env.D1_DATABASE_ID = 'db_x';
  process.env.CLOUDFLARE_API_TOKEN = 'token_x';
};

const createHealthApp = () => {
  const app = new Hono<{ Variables: HonoAppVariables }>();
  registerHealthRoutes(app, config, redisStub);
  return app;
};

afterEach(() => {
  vi.unstubAllGlobals();
  restoreEnvironment();
});

describe.each(transportCases)('D1 readiness：$name', ({ transport, expectedUrl }) => {
  it('只在 SELECT 1 返回成功结果时 ready', async () => {
    configureTransport(transport);
    let requestedUrl = '';
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return Response.json({
        success: true,
        result: [{ success: true, results: [{ ok: 1 }], meta: {} }],
      });
    }));

    const response = await createHealthApp().request('/health/ready');

    expect(response.status).toBe(200);
    expect(requestedUrl).toBe(expectedUrl);
    expect(await response.json()).toMatchObject({
      ok: true,
      dependencies: {
        d1: { configured: true, required: true, ready: true, transport },
      },
    });
  });

  it.each([
    ['外层 envelope 报告失败', {
      success: false,
      result: [],
      errors: [{ message: 'D1 query failed' }],
    }],
    ['缺少 statement 结果', { success: true, result: [] }],
    ['statement 执行失败', {
      success: true,
      result: [{ success: false, results: [], error: 'statement failed' }],
    }],
    ['SELECT 1 未返回 ok=1', {
      success: true,
      result: [{ success: true, results: [{ ok: 0 }], meta: {} }],
    }],
  ])('%s 时 not ready', async (_reason, payload) => {
    configureTransport(transport);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(payload)));

    const response = await createHealthApp().request('/health/ready');

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      dependencies: {
        d1: { configured: true, required: true, ready: false, transport },
      },
    });
  });
});
