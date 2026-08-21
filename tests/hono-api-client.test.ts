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

const originalEnabled = honoApiConfig.enabled;

afterEach(() => {
  honoApiConfig.enabled = originalEnabled;
  vi.unstubAllGlobals();
});

describe('Hono API 客户端', () => {
  test('只匹配迁移白名单，且 Tachie 始终不匹配', () => {
    expect(isHonoApiPath('/api/generate-free?format=sse')).toBe(true);
    expect(isHonoApiPath('/api/me/battle-reports/report-1/regenerate')).toBe(true);
    expect(isHonoApiPath('/api/tachie/generate')).toBe(false);
    expect(isHonoApiPath('/api/me/battle-reports')).toBe(false);
  });

  test('开关关闭时保持同源相对地址', () => {
    honoApiConfig.enabled = false;
    expect(resolveGenerationApiUrl('/api/generate-free')).toBe('/api/generate-free');
  });

  test('开关开启时将白名单路由切换到 Hono', () => {
    honoApiConfig.enabled = true;
    expect(resolveGenerationApiUrl('/api/generate-free?format=sse')).toBe(
      'https://homura.colanns.me/api/generate-free?format=sse',
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
    expect(target).toBe('https://homura.colanns.me/api/generate-game-card');
    expect(init.credentials).toBe('omit');
    expect(headers.get('Authorization')).toBe('Bearer auth-key');
    expect(headers.get('x-mahoshojo-activity-token')).toBe('activity-token');
    expect(headers.get('x-mahoshojo-user-id')).toBe('7');
  });
});
