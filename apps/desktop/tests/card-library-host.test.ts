import { describe, expect, it, vi } from 'vitest';

import { createDesktopCardLibraryOnlinePort } from '../src/platform/card-library-host';
import { CARD_LIBRARY_REQUEST_COMMAND } from '../src/platform/card-library-bridge';

const signal = () => new AbortController().signal;

const summaryPage = { success: true as const, cards: [], total: 0, nextOffset: null };

const makeInvoke = (impl: (request: { routeId: string; query?: Record<string, string>; body?: unknown }) => unknown) =>
  vi.fn(async (_command: string, args: { request: { routeId: string; query?: Record<string, string>; body?: unknown } }) => impl(args.request));

describe('createDesktopCardLibraryOnlinePort', () => {
  it('「我的/收藏」摘要分页走对应固定路由并透传查询', async () => {
    const invoke = makeInvoke((request) => {
      expect(request.routeId).toBe('data-cards.query');
      expect(request.query).toMatchObject({ view: 'summary', limit: '12', offset: '0', sortBy: 'created_at' });
      return { status: 200, body: summaryPage };
    });
    const port = createDesktopCardLibraryOnlinePort(invoke);
    const page = await port.fetchSummaryPage('my', { limit: 12, offset: 0, sortBy: 'created_at' }, signal());
    expect(page).toEqual(summaryPage);
    expect(invoke).toHaveBeenCalledWith(CARD_LIBRARY_REQUEST_COMMAND, expect.anything());
  });

  it('favorites 摘要走 favorites.query', async () => {
    const invoke = makeInvoke(() => ({ status: 200, body: summaryPage }));
    const port = createDesktopCardLibraryOnlinePort(invoke);
    await port.fetchSummaryPage('favorites', { limit: 12, offset: 24 }, signal());
    expect(invoke.mock.calls[0]?.[1]).toMatchObject({ request: { routeId: 'favorites.query' } });
  });

  it('非 2xx / success:false 摘要响应抛出业务错误文案', async () => {
    const invoke = makeInvoke(() => ({ status: 403, body: { error: '没有权限' } }));
    const port = createDesktopCardLibraryOnlinePort(invoke);
    await expect(port.fetchSummaryPage('my', { limit: 12, offset: 0 }, signal())).rejects.toThrow('没有权限');
  });

  it('公开列表序列化筛选条件并原样回传 body', async () => {
    const invoke = makeInvoke((request) => {
      expect(request.routeId).toBe('public-data-cards.query');
      expect(request.query).toMatchObject({
        type: 'questionnaire', limit: '12', offset: '0', sortBy: 'likes',
        nativeAllowedOnly: '1', recommendedOnly: '1', tagIds: 't1,t2', tagMatch: 'all',
      });
      return { status: 200, body: { success: true, cards: [{ id: 'c1' }] } };
    });
    const port = createDesktopCardLibraryOnlinePort(invoke);
    const result = await port.fetchPublicCards({
      type: 'questionnaire', limit: 12, offset: 0, sortBy: 'likes',
      tagIds: ['t1', 't2'], tagMatch: 'all', recommendedOnly: true, nativeAllowedOnly: true,
    }, signal());
    expect(result.ok).toBe(true);
    expect((result.data as { cards: unknown[] }).cards).toHaveLength(1);
  });

  it('loadFullCard：列表行已带正文时不发起 IPC', async () => {
    const invoke = makeInvoke(() => ({ status: 200, body: {} }));
    const port = createDesktopCardLibraryOnlinePort(invoke);
    const row = { id: 'c1', data: '{"a":1}' };
    expect(await port.loadFullCard(row, 'public', signal())).toBe(row);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('loadFullCard：缺正文时按 id 拉取并合并，本地/公开语义一致', async () => {
    const invoke = makeInvoke((request) => {
      expect(request).toMatchObject({ routeId: 'public-data-cards.query', query: { id: 'c1' } });
      return { status: 200, body: { success: true, card: { id: 'c1', data: '{"full":true}', extra: 'x' } } };
    });
    const port = createDesktopCardLibraryOnlinePort(invoke);
    const full = await port.loadFullCard({ id: 'c1', name: '行' }, 'public', signal()) as Record<string, unknown>;
    expect(full).toMatchObject({ id: 'c1', name: '行', data: '{"full":true}', extra: 'x' });
  });

  it('loadFullCard：远端无正文时抛出可读错误', async () => {
    const invoke = makeInvoke(() => ({ status: 404, body: { error: '数据卡不存在或无权访问' } }));
    const port = createDesktopCardLibraryOnlinePort(invoke);
    await expect(port.loadFullCard({ id: 'gone' }, 'public', signal())).rejects.toThrow('数据卡不存在或无权访问');
  });

  it('未登录时收藏路由 fail-closed，错误转成可读文案不抛出', async () => {
    const invoke = vi.fn(async () => {
      throw { code: 'not-authenticated', message: '该操作需要登录云端账号' };
    });
    const port = createDesktopCardLibraryOnlinePort(invoke);
    expect(await port.listFavoriteIds()).toEqual({ success: false, favorites: [] });
    expect(await port.addFavorite('c1')).toMatchObject({ success: false });
  });

  it('上传本地记录创建云端私有副本；失败返回错误且不删除本地', async () => {
    const record = {
      id: 'lc-1', schemaVersion: 1, storageLocation: 'local', cardType: 'questionnaire',
      title: '本地问卷', data: { kind: 'magical-girl', questions: [{ id: 'q1', question: 'Q?' }] },
      contentDigest: 'sha256:x', provenance: { kind: 'imported' },
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    } as never;

    const okInvoke = makeInvoke((request) => {
      expect(request.routeId).toBe('data-cards.create');
      expect(request.body).toMatchObject({ type: 'questionnaire', name: '本地问卷', isPublic: 0 });
      return { status: 200, body: { success: true, id: 'cloud-9' } };
    });
    const port = createDesktopCardLibraryOnlinePort(okInvoke);
    expect(await port.uploadLocalRecord!(record)).toEqual({ ok: true });

    const failInvoke = makeInvoke(() => ({ status: 500, body: { error: '服务器繁忙' } }));
    const failPort = createDesktopCardLibraryOnlinePort(failInvoke);
    expect(await failPort.uploadLocalRecord!(record)).toEqual({ ok: false, error: '服务器繁忙' });

    const throwInvoke = vi.fn(async () => { throw { code: 'not-authenticated', message: '该操作需要登录云端账号' }; });
    const throwPort = createDesktopCardLibraryOnlinePort(throwInvoke);
    expect(await throwPort.uploadLocalRecord!(record)).toEqual({ ok: false, error: '需要登录云端账号' });
    // 调用方（CardLibraryModal/调用点）保留本地记录——端口不触碰本地库。
  });

  it('meta/徽章批量查询映射为端口形状，失败静默降级为 null', async () => {
    const invoke = makeInvoke((request) => {
      if (request.routeId === 'data-card-meta-batch.query') {
        return { status: 200, body: { success: true, items: { c1: { metrics: { techScore: 9, techLevel: 'A', isNative: true }, strict: { tier: 'S' } } } } };
      }
      return { status: 200, body: { success: true, items: { '42': [{ id: 'b1' }] } } };
    });
    const port = createDesktopCardLibraryOnlinePort(invoke);
    expect(await port.fetchCardMetaBatch!(['c1'], signal())).toEqual({
      c1: { techScore: 9, techLevel: 'A', strictTier: 'S', isNative: true },
    });
    expect(await port.fetchAuthorBadgesBatch!([42], signal())).toEqual({ 42: [{ id: 'b1' }] });

    const failPort = createDesktopCardLibraryOnlinePort(makeInvoke(() => ({ status: 500, body: {} })));
    expect(await failPort.fetchCardMetaBatch!(['c1'], signal())).toBeNull();
    expect(await failPort.fetchAuthorBadgesBatch!([1], signal())).toBeNull();
  });
});
