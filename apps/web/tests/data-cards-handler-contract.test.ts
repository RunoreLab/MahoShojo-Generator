import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserDataCards: vi.fn(async () => [] as Array<{ id: string }>),
  createDataCardWithAuthor: vi.fn(async () => ({ success: true, id: 'card-created' })),
  getDataCardById: vi.fn(async () => ({
    id: 'card-existing',
    user_id: 7,
    type: 'character',
    name: '旧名称',
    description: '',
    data: '{}',
    is_public: 0,
    review_status: 'pending',
  })),
  updateDataCard: vi.fn(async () => true),
}));

vi.mock('@/lib/auth/server', () => ({
  requireAuthUser: async () => ({
    user: {
      id: 7,
      username: 'alice',
      is_admin: 0,
      is_review_exempt: 0,
    },
    source: 'better-auth-session',
  }),
}));

vi.mock('@/lib/db/drizzle', () => ({
  getDrizzleDbFromRuntime: () => null,
}));

vi.mock('@/lib/database/data-cards', () => ({
  createDataCardWithAuthor: mocks.createDataCardWithAuthor,
  getUserDataCards: mocks.getUserDataCards,
  updateDataCard: mocks.updateDataCard,
  deleteDataCard: vi.fn(async () => true),
  pruneUserRecycleBin: vi.fn(async () => undefined),
  upsertDataCardUpdate: vi.fn(async () => true),
  getDataCardById: mocks.getDataCardById,
  getUserUsedSlots: vi.fn(async () => 0),
  updateDataCardContentByIdAndUser: vi.fn(async () => true),
}));

vi.mock('@/lib/database/users', () => ({
  getUserDataCardCapacity: vi.fn(async () => 20),
}));

vi.mock('@/lib/sensitive-word-filter', () => ({
  quickCheck: vi.fn(async () => ({ hasSensitiveWords: false })),
}));

import handler from '@/app/api/data-cards/handler';

describe('api/data-cards metadata contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('GET 限制单页正文数量并返回下一页，不公开缓存私有卡片', async () => {
    mocks.getUserDataCards.mockResolvedValueOnce(Array.from({ length: 9 }, (_, i) => ({ id: String(i) })));
    const response = await handler(new Request('https://example.test/api/data-cards?limit=999&offset=8'));
    expect(mocks.getUserDataCards).toHaveBeenCalledWith(7, undefined, undefined, { limit: 9, offset: 8 });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const payload = await response.json();
    expect(payload.cards).toHaveLength(8);
    expect(payload.nextOffset).toBe(16);
  });

  test.each(['limit=0', 'offset=-1', 'limit=no', 'offset=1.5'])('GET 拒绝非法分页 %s', async (query) => {
    const response = await handler(new Request(`https://example.test/api/data-cards?${query}`));
    expect(response.status).toBe(400);
    expect(mocks.getUserDataCards).not.toHaveBeenCalled();
  });

  test.each([2, -2, 0.5, 1.5, '1'])('POST 拒绝契约外可见性值 %j', async (isPublic) => {
    const response = await handler(new Request('https://example.test/api/data-cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'character',
        name: '测试卡',
        data: {},
        isPublic,
      }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: '无效的数据卡可见性' });
    expect(mocks.createDataCardWithAuthor).not.toHaveBeenCalled();
  });

  test.each([2, -2, 0.5, 1.5, '0'])('PUT 拒绝契约外可见性值 %j', async (isPublic) => {
    const response = await handler(new Request('https://example.test/api/data-cards', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'card-existing', isPublic }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: '无效的数据卡可见性' });
    expect(mocks.updateDataCard).not.toHaveBeenCalled();
  });
});
