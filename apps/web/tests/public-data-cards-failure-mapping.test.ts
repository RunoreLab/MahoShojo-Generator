import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbAvailable: true,
  listPublicDataCardsWithFilters: vi.fn(async (): Promise<any[]> => []),
  getDataCardByIdWithAuthorAndTags: vi.fn(async (): Promise<any | null> => null),
}));

vi.mock('@/lib/db/drizzle', () => ({
  getDrizzleDbFromRuntime: () => (mocks.dbAvailable ? { __mockDb: true } : null),
}));

vi.mock('@/lib/db/repositories/data-cards-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db/repositories/data-cards-core')>();
  return {
    ...actual,
    listPublicDataCardsWithFilters: mocks.listPublicDataCardsWithFilters,
    getDataCardByIdWithAuthorAndTags: mocks.getDataCardByIdWithAuthorAndTags,
  };
});

vi.mock('@/lib/edge-cache', () => ({
  withEdgeCache: async (_req: Request, _opts: unknown, handler: () => Promise<Response>) => handler(),
}));

import handler from '@/app/api/public-data-cards/handler';

describe('public-data-cards failure mapping', () => {
  beforeEach(() => {
    mocks.dbAvailable = true;
    mocks.listPublicDataCardsWithFilters.mockReset().mockResolvedValue([]);
    mocks.getDataCardByIdWithAuthorAndTags.mockReset().mockResolvedValue(null);
  });

  test('列表仓储 throw → 500，不得伪装成 200 空列表', async () => {
    mocks.listPublicDataCardsWithFilters.mockRejectedValueOnce(new Error('D1 query failed'));

    const response = await handler(new Request('https://example.test/api/public-data-cards?type=character'));
    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload).toMatchObject({ success: false, error: '获取公开数据卡失败' });
    expect(payload.cards).toBeUndefined();
  });

  test('列表 DB binding 不可用 → 503，不得伪装成 200 空列表', async () => {
    mocks.dbAvailable = false;

    const response = await handler(new Request('https://example.test/api/public-data-cards?type=character'));
    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload).toMatchObject({ success: false, error: '数据卡存储暂不可用' });
    expect(payload.cards).toBeUndefined();
    expect(mocks.listPublicDataCardsWithFilters).not.toHaveBeenCalled();
  });

  test('列表查询成功且无结果 → 200 空列表（真实空库）', async () => {
    mocks.listPublicDataCardsWithFilters.mockResolvedValueOnce([]);

    const response = await handler(new Request('https://example.test/api/public-data-cards?type=character'));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({ success: true, cards: [] });
  });

  test('单卡仓储 throw → 500，不得伪装成 404', async () => {
    mocks.getDataCardByIdWithAuthorAndTags.mockRejectedValueOnce(new Error('D1 query failed'));

    const response = await handler(new Request('https://example.test/api/public-data-cards?id=card-1'));
    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload).toMatchObject({ success: false, error: '获取公开数据卡失败' });
    expect(payload.card).toBeUndefined();
  });

  test('单卡 DB binding 不可用 → 503，不得伪装成 404', async () => {
    mocks.dbAvailable = false;

    const response = await handler(new Request('https://example.test/api/public-data-cards?id=card-1'));
    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload).toMatchObject({ success: false, error: '数据卡存储暂不可用' });
    expect(payload.card).toBeUndefined();
    expect(mocks.getDataCardByIdWithAuthorAndTags).not.toHaveBeenCalled();
  });

  test('单卡查询成功且无行 → 404（业务终态）', async () => {
    mocks.getDataCardByIdWithAuthorAndTags.mockResolvedValueOnce(null);

    const response = await handler(new Request('https://example.test/api/public-data-cards?id=card-1'));
    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(payload).toMatchObject({ success: false, error: '数据卡不存在' });
  });

  test('单卡查询成功 → 200', async () => {
    mocks.getDataCardByIdWithAuthorAndTags.mockResolvedValueOnce({
      id: 'card-1',
      type: 'character',
      name: '公开卡',
      tag_ids: 'tag-a,tag-b',
    });

    const response = await handler(new Request('https://example.test/api/public-data-cards?id=card-1'));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.card).toMatchObject({ id: 'card-1', tagIds: ['tag-a', 'tag-b'] });
  });
});
