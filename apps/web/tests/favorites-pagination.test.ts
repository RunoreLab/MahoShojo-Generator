import { expect, test, vi } from 'vitest';
import handler from '@/app/api/favorites/handler';
import { getUserFavorites, getUserFavoriteIds } from '@/lib/database/favorites';

vi.mock('@/lib/auth/server', () => ({ requireAuthUser: async () => ({ user: { id: 7 } }) }));
vi.mock('@/lib/database/favorites', () => ({
  getUserFavorites: vi.fn(async () => Array.from({ length: 9 }, (_, i) => ({ id: String(i), data: '{}' }))),
  getUserFavoriteIds: vi.fn(async () => ['one', 'two']),
  addFavorite: vi.fn(), removeFavorite: vi.fn(),
}));

test('收藏分页保持类型筛选和私有缓存策略', async () => {
  const response = await handler(new Request('https://example.test/api/favorites?type=character&limit=100&offset=8'));
  expect(getUserFavorites).toHaveBeenCalledWith(7, 'character', { limit: 9, offset: 8 });
  const payload = await response.json();
  expect(payload.favorites).toHaveLength(8);
  expect(payload.nextOffset).toBe(16);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
});

test('仅查询收藏 ID 不读取正文或改变原有响应', async () => {
  const response = await handler(new Request('https://example.test/api/favorites?idsOnly=1'));
  expect(getUserFavorites).not.toHaveBeenCalled();
  expect(getUserFavoriteIds).toHaveBeenCalledWith(7, undefined);
  expect(await response.json()).toEqual({ success: true, favorites: ['one', 'two'] });
});

test('非法 offset 不执行数据库查询', async () => {
  const response = await handler(new Request('https://example.test/api/favorites?offset=-1'));
  expect(response.status).toBe(400);
  expect(getUserFavorites).not.toHaveBeenCalled();
});
