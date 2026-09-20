import { describe, expect, vi, test } from 'vitest';

import { authStorage, dataCardApi, favoritesApi } from '@/lib/auth';

describe('dataCardApi.getCardsDetailed', () => {
  test.each(['cards', 'favorites'] as const)('%s 顺序读取分页，保留全部正文', async (key) => {
    const offsets: string[] = [];
    vi.spyOn(authStorage, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input), 'https://example.test');
      const offset = url.searchParams.get('offset')!;
      offsets.push(offset);
      const row = { id: offset, data: '{"正文":"保留"}' };
      return Response.json({ success: true, [key]: [row], nextOffset: offset === '0' ? 1 : null });
    });
    const result = key === 'cards' ? await dataCardApi.getCardsDetailed() : await favoritesApi.getFavorites();
    expect(result).toMatchObject({ success: true, [key]: [
      { id: '0', data: '{"正文":"保留"}' }, { id: '1', data: '{"正文":"保留"}' },
    ] });
    expect(offsets).toEqual(['0', '1']);
  });

  test('分页中途失败不返回成功的部分卡片', async () => {
    vi.spyOn(authStorage, 'fetch')
      .mockResolvedValueOnce(Response.json({ success: true, cards: [{ id: 'first' }], nextOffset: 1 }))
      .mockResolvedValueOnce(Response.json({ error: '暂时不可用' }, { status: 503 }));
    expect(await dataCardApi.getCardsDetailed()).toMatchObject({ success: false, cards: [], status: 503 });
  });

  test('拒绝不前进的分页游标，避免无限请求', async () => {
    const fetchSpy = vi.spyOn(authStorage, 'fetch').mockResolvedValue(Response.json({
      success: true, cards: [{ id: 'first' }], nextOffset: 0,
    }));
    expect(await dataCardApi.getCardsDetailed()).toMatchObject({ success: false, cards: [] });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test('在非 200 响应时透传错误信息而不是伪装为空列表', async () => {
    const originalFetch = authStorage.fetch;

    try {
      (authStorage as typeof authStorage & { fetch: typeof authStorage.fetch }).fetch = vi.fn(async () => {
        return new Response(JSON.stringify({ error: '未授权' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const getCardsDetailed = (dataCardApi as typeof dataCardApi & {
        getCardsDetailed?: (search?: string, sortBy?: 'likes' | 'usage' | 'favorites' | 'created_at') => Promise<unknown>;
      }).getCardsDetailed;

      expect(typeof getCardsDetailed).toBe('function');
      if (typeof getCardsDetailed !== 'function') return;

      const result = await getCardsDetailed();
      expect(result).toMatchObject({
        success: false,
        status: 401,
        error: '未授权',
        cards: [],
      });
    } finally {
      (authStorage as typeof authStorage & { fetch: typeof authStorage.fetch }).fetch = originalFetch;
    }
  });

  test('在成功响应时返回 cards 与 success=true', async () => {
    const originalFetch = authStorage.fetch;

    try {
      (authStorage as typeof authStorage & { fetch: typeof authStorage.fetch }).fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            success: true,
            cards: [{ id: 'card-1', type: 'character', name: '测试角色' }],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      });

      const getCardsDetailed = (dataCardApi as typeof dataCardApi & {
        getCardsDetailed?: (search?: string, sortBy?: 'likes' | 'usage' | 'favorites' | 'created_at') => Promise<unknown>;
      }).getCardsDetailed;

      expect(typeof getCardsDetailed).toBe('function');
      if (typeof getCardsDetailed !== 'function') return;

      const result = await getCardsDetailed();
      expect(result).toMatchObject({
        success: true,
        cards: [{ id: 'card-1', type: 'character', name: '测试角色' }],
      });
    } finally {
      (authStorage as typeof authStorage & { fetch: typeof authStorage.fetch }).fetch = originalFetch;
    }
  });

  test('repairQuestionnaireType 使用受控恢复接口并透传结果', async () => {
    const originalFetch = authStorage.fetch;

    try {
      (authStorage as typeof authStorage & { fetch: typeof authStorage.fetch }).fetch = vi.fn(async (input, init) => {
        expect(input).toBe('/api/data-cards/repair-questionnaire-type');
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({ id: 'legacy-card' });
        return new Response(JSON.stringify({ success: true, repaired: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const result = await dataCardApi.repairQuestionnaireType('legacy-card');

      expect(result).toEqual({ success: true, repaired: true });
    } finally {
      (authStorage as typeof authStorage & { fetch: typeof authStorage.fetch }).fetch = originalFetch;
    }
  });
});
