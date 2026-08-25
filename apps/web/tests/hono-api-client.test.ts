import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  authStorage: {
    getAuthHeader: vi.fn(async () => 'Bearer auth-key'),
    getActivityHeaders: vi.fn(async () => ({
      'x-mahoshojo-activity-token': 'activity-token',
      'x-mahoshojo-user-id': '7',
    })),
  },
}));

import {
  generationApiFetch,
  isHonoApiPath,
  resolveGenerationApiUrl,
} from '@/lib/hono-api-client';
import { honoApiConfig } from '@/config/hono-api';
import honoApiRoutes from '../../../config/hono-api-routes.json';

const originalEnabled = honoApiConfig.enabled;

afterEach(() => {
  honoApiConfig.enabled = originalEnabled;
  vi.unstubAllGlobals();
});

describe('Hono API 客户端', () => {
  test('只匹配迁移白名单，且 Tachie 始终不匹配', () => {
    expect(isHonoApiPath('/api/generate-free?format=sse')).toBe(true);
    expect(isHonoApiPath('/api/arena/generate-stream?format=sse')).toBe(true);
    expect(isHonoApiPath('/api/arena/generation-requests/request-1')).toBe(true);
    expect(isHonoApiPath('/api/arena/generations/generation-1/stream?after=8-0')).toBe(true);
    expect(isHonoApiPath('/api/arena/generations/generation-1')).toBe(true);
    expect(isHonoApiPath('/api/arena/generations/generation-1/cancel')).toBe(true);
    expect(isHonoApiPath('/api/me/battle-reports/report-1/regenerate')).toBe(false);
    expect(isHonoApiPath('/api/tachie/generate')).toBe(false);
    expect(isHonoApiPath('/api/me/battle-reports')).toBe(false);
  });

  test('退出 Hono 的 capability 即使开关开启也保持同源 Next 路径', () => {
    honoApiConfig.enabled = true;
    for (const routeId of honoApiRoutes.exitedRouteIds) {
      const path = `/api/${routeId.replace(/\[[^\]]+\]/gu, 'test-id')}`;
      expect(isHonoApiPath(path)).toBe(false);
      expect(resolveGenerationApiUrl(path)).toBe(path);
    }
  });

  test('开关关闭时保持同源相对地址', () => {
    honoApiConfig.enabled = false;
    expect(resolveGenerationApiUrl('/api/generate-free')).toBe('/api/generate-free');
  });

  test('开关开启时将白名单路由切换到 Hono', () => {
    honoApiConfig.enabled = true;
    expect(resolveGenerationApiUrl('/api/generate-free?format=sse')).toBe(
      'https://api.mahoshojo.colanns.me/api/generate-free?format=sse',
    );
    expect(resolveGenerationApiUrl('/api/tachie/generate')).toBe('/api/tachie/generate');
  });

  test('跨域请求携带 authKey 和活跃令牌，但不携带 Cookie', async () => {
    honoApiConfig.enabled = true;
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await generationApiFetch('/api/generate-game-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const [target, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(target).toBe('https://api.mahoshojo.colanns.me/api/generate-game-card');
    expect(target).not.toContain('homura.colanns.me');
    expect(init.credentials).toBe('omit');
    expect(headers.get('Authorization')).toBe('Bearer auth-key');
    expect(headers.get('x-mahoshojo-activity-token')).toBe('activity-token');
    expect(headers.get('x-mahoshojo-user-id')).toBe('7');
  });

  test('退出 capability 使用同源 Next credentials 且继续携带兼容鉴权头', async () => {
    honoApiConfig.enabled = true;
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await generationApiFetch('/api/me/battle-reports/report-1/regenerate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const [target, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(target).toBe('/api/me/battle-reports/report-1/regenerate');
    expect(init.credentials).toBe('same-origin');
    expect(headers.get('Authorization')).toBe('Bearer auth-key');
    expect(headers.get('x-mahoshojo-activity-token')).toBe('activity-token');
    expect(headers.get('x-mahoshojo-user-id')).toBe('7');
  });
});
