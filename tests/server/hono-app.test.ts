import { describe, expect, it, vi } from 'vitest';
import type { HonoServerConfig } from '@/server/config';
import { createHonoApp, isAllowedOrigin } from '@/server/app';
import type { RedisService } from '@/server/redis/runtime';
import { HonoRuntimeTelemetry } from '@/server/telemetry/runtime';
import honoApiRoutes from '@/config/hono-api-routes.json';

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
          'x-mahoshojo-user-id',
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
