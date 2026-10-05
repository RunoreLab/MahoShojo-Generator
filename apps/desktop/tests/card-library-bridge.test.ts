import { describe, expect, it, vi } from 'vitest';

import { CARD_LIBRARY_REQUEST_COMMAND, requestCardLibraryRoute } from '../src/platform/card-library-bridge';

describe('card library bridge', () => {
  it('透传契约内请求并返回 status+body', async () => {
    const invoke = vi.fn(async () => ({ status: 200, body: { success: true, cards: [] } }));
    const response = await requestCardLibraryRoute(invoke, {
      routeId: 'public-data-cards.query',
      query: { type: 'character', limit: '12' },
    });
    expect(invoke).toHaveBeenCalledWith(CARD_LIBRARY_REQUEST_COMMAND, {
      request: {
        routeId: 'public-data-cards.query',
        query: { type: 'character', limit: '12' },
      },
    });
    expect(response.status).toBe(200);
  });

  it('白名单外 routeId 在发出 IPC 前被拒绝', async () => {
    const invoke = vi.fn();
    await expect(
      requestCardLibraryRoute(invoke, { routeId: 'internal-secret-route' as never }),
    ).rejects.toMatchObject({ name: 'DesktopCloudError', code: 'invalid-request' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('strict 契约拒绝 URL/凭据字段注入', async () => {
    const invoke = vi.fn();
    await expect(
      requestCardLibraryRoute(invoke, {
        routeId: 'data-cards.query',
        path: '/api/admin/users',
      } as never),
    ).rejects.toMatchObject({ code: 'invalid-request' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('native 错误按 code 原样透传（not-authenticated 等）', async () => {
    const invoke = vi.fn(async () => {
      throw { code: 'not-authenticated', message: '该操作需要登录云端账号' };
    });
    await expect(
      requestCardLibraryRoute(invoke, { routeId: 'data-cards.query' }),
    ).rejects.toMatchObject({ name: 'DesktopCloudError', code: 'not-authenticated' });
  });

  it('native 返回非法载荷 → bridge-invalid', async () => {
    const invoke = vi.fn(async () => ({ status: 'ok' }));
    await expect(
      requestCardLibraryRoute(invoke, { routeId: 'tags.query' }),
    ).rejects.toMatchObject({ code: 'bridge-invalid' });
  });
});
