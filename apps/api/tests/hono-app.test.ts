import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HonoServerConfig } from '#/config';
import { createHonoApp, isAllowedOrigin } from '#/app';
import type { RedisService } from '#/redis/runtime';
import { HonoRuntimeTelemetry } from '#/telemetry/runtime';

const honoApiRoutes = JSON.parse(readFileSync(
  path.resolve(import.meta.dirname, '..', '..', '..', 'config', 'hono-api-routes.json'),
  'utf8',
)) as { exitedRouteIds: string[] };

const config: HonoServerConfig = {
  host: '127.0.0.1',
  port: 8787,
  nodeEnv: 'test',
  redisUrl: null,
  redisRequired: false,
  d1Required: false,
  corsOrigins: ['http://localhost:3000'],
  authMode: 'hybrid',
};

const createRedisStub = (): RedisService => ({
  connect: async () => undefined,
  close: async () => undefined,
  getStatus: () => ({ configured: false, connected: false, ready: false, lastError: null }),
  ping: async () => false,
  consumeFixedWindow: async () => null,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Hono server app', () => {
  it('安全匹配 HTTPS 子域通配符', () => {
    const allowedOrigins = ['https://*.colanns.me'];

    expect(isAllowedOrigin('https://mahoshojo.colanns.me', allowedOrigins)).toBe(
      'https://mahoshojo.colanns.me',
    );
    expect(isAllowedOrigin('https://preview.dev.colanns.me', allowedOrigins)).toBe(
      'https://preview.dev.colanns.me',
    );
    expect(isAllowedOrigin('https://colanns.me', allowedOrigins)).toBe('');
    expect(isAllowedOrigin('http://mahoshojo.colanns.me', allowedOrigins)).toBe('');
    expect(isAllowedOrigin('https://evilcolanns.me', allowedOrigins)).toBe('');
    expect(isAllowedOrigin('https://colanns.me.evil.example', allowedOrigins)).toBe('');
  });

  it('提供存活和就绪探针', async () => {
    const app = createHonoApp(config, createRedisStub());

    const liveResponse = await app.request('/health/live');
    expect(liveResponse.status).toBe(200);
    expect(await liveResponse.json()).toMatchObject({
      ok: true,
      service: 'mahoshojo-hono',
      runtime: 'node',
    });

    const readyResponse = await app.request('/health/ready');
    expect(readyResponse.status).toBe(200);
    expect(await readyResponse.json()).toMatchObject({
      ok: true,
      dependencies: {
        redis: { configured: false, required: false, ready: false },
        d1: { configured: false, required: false, ready: false, transport: 'none' },
      },
    });
  });

  it('telemetry 日志 transport 失败不改变 health/readiness', async () => {
    const telemetry = new HonoRuntimeTelemetry({
      logger: () => {
        throw new Error('telemetry sink unavailable');
      },
      errorLogger: vi.fn(),
    });
    telemetry.emitSnapshot();
    const app = createHonoApp(config, createRedisStub(), telemetry);

    const [liveResponse, readyResponse] = await Promise.all([
      app.request('/health/live'),
      app.request('/health/ready'),
    ]);
    expect(liveResponse.status).toBe(200);
    expect(readyResponse.status).toBe(200);
  });

  it('为响应添加运行时和请求 ID 标识', async () => {
    const app = createHonoApp(config, createRedisStub());
    const response = await app.request('/health/live', {
      headers: { 'x-request-id': 'test-request-id' },
    });

    expect(response.headers.get('x-request-id')).toBe('test-request-id');
    expect(response.headers.get('x-backend-runtime')).toBe('hono-node');
  });

  it('在 Redis 拒绝时返回统一 429', async () => {
    const redis = createRedisStub();
    redis.consumeFixedWindow = async () => ({
      allowed: false,
      limit: 600,
      remaining: 0,
      retryAfterSeconds: 12,
    });
    const app = createHonoApp(config, redis);
    const response = await app.request('/api/not-existing');

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('12');
    expect(await response.json()).toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 12 });
  });

  it('Redis 命令异常且非必需时按文档降级放行', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const redis = createRedisStub();
    redis.consumeFixedWindow = async () => {
      throw new Error('redis-url-secret-canary');
    };
    const app = createHonoApp(config, redis);

    const response = await app.request('/api/not-existing');

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'NOT_FOUND' });
    expect(errorSpy).toHaveBeenCalledWith('[hono][redis] 限速命令失败', {
      namespace: 'api',
      errorClass: 'command_failed',
    });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('redis-url-secret-canary');
  });

  it('Redis 命令异常且为必需依赖时稳定返回 503', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const redis = createRedisStub();
    redis.consumeFixedWindow = async () => {
      throw new Error('redis connection dropped');
    };
    const app = createHonoApp({ ...config, redisRequired: true }, redis);

    const response = await app.request('/api/not-existing');

    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('1');
    expect(await response.json()).toEqual({
      error: '限速服务暂时不可用',
      code: 'RATE_LIMIT_UNAVAILABLE',
    });
  });

  it('全局异常响应与日志不投影 path 或原始 Error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const redis = createRedisStub();
    redis.consumeFixedWindow = async () => ({
      get allowed(): boolean {
        throw new Error('hono-error-provider-url-secret-canary');
      },
      limit: 600,
      remaining: 599,
      retryAfterSeconds: 60,
    });
    const app = createHonoApp(config, redis);

    const response = await app.request('/api/path-secret-canary', {
      headers: { 'x-request-id': 'safe-request-id' },
    });
    const payload = await response.json();
    const serialized = JSON.stringify({ payload, logs: errorSpy.mock.calls });

    expect(response.status).toBe(500);
    expect(payload).toEqual({
      error: 'Internal server error',
      code: 'INTERNAL_SERVER_ERROR',
      requestId: 'safe-request-id',
    });
    expect(errorSpy).toHaveBeenCalledWith('[hono][error] 未处理异常', {
      requestId: 'safe-request-id',
      method: 'GET',
      errorClass: 'unhandled',
    });
    expect(serialized).not.toMatch(/path-secret-canary|provider-url-secret-canary/u);
  });

  it('Redis 必需但不可用时 health alias 仍表达 liveness 与 readiness', async () => {
    const redis = createRedisStub();
    redis.consumeFixedWindow = vi.fn(async () => null);
    const app = createHonoApp({ ...config, redisRequired: true }, redis);

    const liveResponse = await app.request('/api/health/live');
    expect(liveResponse.status).toBe(200);
    expect(await liveResponse.json()).toMatchObject({
      ok: true,
      service: 'mahoshojo-hono',
      runtime: 'node',
    });

    const readyResponse = await app.request('/api/health/ready');
    expect(readyResponse.status).toBe(503);
    expect(await readyResponse.json()).toMatchObject({
      ok: false,
      dependencies: {
        redis: { configured: false, required: true, ready: false },
      },
    });
    expect(redis.consumeFixedWindow).not.toHaveBeenCalled();
  });

  it('全局 API 限速按客户端 IP 计数', async () => {
    const redis = createRedisStub();
    let capturedIdentity: string | null = null;
    redis.consumeFixedWindow = async (input) => {
      capturedIdentity = input.identity;
      return {
        allowed: true,
        limit: input.limit,
        remaining: input.limit - 1,
        retryAfterSeconds: input.windowSeconds,
      };
    };
    const app = createHonoApp(config, redis);

    const response = await app.request('/api/not-existing', {
      headers: { 'cf-connecting-ip': '203.0.113.7' },
    });

    expect(response.status).toBe(404);
    expect(capturedIdentity).toBe('203.0.113.7');
    expect(response.headers.get('x-ratelimit-limit')).toBe('600');
    expect(response.headers.get('x-ratelimit-remaining')).toBe('599');
  });

  it('允许前端携带鉴权、活跃令牌和 AI 元数据请求头跨域请求', async () => {
    const app = createHonoApp({
      ...config,
      corsOrigins: ['https://*.colanns.me'],
    }, createRedisStub());
    const response = await app.request('/api/generate-free', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://mahoshojo.colanns.me',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': [
          'authorization',
          'content-type',
          'x-mahoshojo-activity-token',
          'x-mahoshojo-ai-meta',
          'x-mahoshojo-generation-actor-token',
          'x-mahoshojo-user-id',
          'last-event-id',
        ].join(', '),
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://mahoshojo.colanns.me');
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization');
    expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      'x-mahoshojo-activity-token',
    );
    expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      'x-mahoshojo-ai-meta',
    );
    expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      'x-mahoshojo-generation-actor-token',
    );
    expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      'last-event-id',
    );
  });

  it('不暴露未迁移 API 和 WebSocket 路径', async () => {
    const app = createHonoApp(config, createRedisStub());
    const [unmigratedApiResponse, webSocketResponse] = await Promise.all([
      app.request('/api/verify-origin', { method: 'POST' }),
      app.request('/ws'),
    ]);

    expect(unmigratedApiResponse.status).toBe(404);
    expect(webSocketResponse.status).toBe(404);
  });

  it('对已退出 capability 全部返回 Hono 404 而不进入 Next handler', async () => {
    const app = createHonoApp(config, createRedisStub());

    for (const routeId of honoApiRoutes.exitedRouteIds) {
      const path = `/api/${routeId.replace(/\[[^\]]+\]/gu, 'test-id')}`;
      const response = await app.request(path, { method: 'POST' });
      expect(response.status).toBe(404);
      expect(response.headers.get('x-backend-runtime')).toBe('hono-node');
      expect(await response.json()).toEqual({
        error: 'Not found',
        code: 'NOT_FOUND',
      });
    }
  });
});
