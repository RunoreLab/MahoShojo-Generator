import { describe, expect, test } from 'vitest';
import * as presets from '@/app/api/get-presets/route';
import * as scenarios from '@/app/api/get-scenario-presets/route';

describe('公开预设列表缓存', () => {
  test.each([presets, scenarios])('只缓存静态 GET，不缓存非法方法响应', async (route) => {
    expect(route.dynamic).toBe('force-static');
    const response = await route.GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=3600');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.json()).toBeInstanceOf(Array);
    expect(route.HEAD().status).toBe(405);
    expect(route.HEAD().headers.get('cache-control')).toBeNull();
    // 显式声明 POST/PUT 等会让 Next 放弃静态生成，交给框架默认 405。
    expect(route).not.toHaveProperty('POST');
  });
});
