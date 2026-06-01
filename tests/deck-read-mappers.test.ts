import { describe, expect, test } from 'vitest';

import { mapDeckReadRow, mapDeckReadRows } from '@/lib/deck-read-mappers';

describe('deck-read-mappers', () => {
  test('mapDeckReadRow 支持 snake_case 输入并输出 canonical camelCase', () => {
    const mapped = mapDeckReadRow({
      id: 'deck-1',
      user_id: 12,
      username: 'alice',
      name: '测试卡组',
      description: 'desc',
      is_public: 1,
      like_count: 5,
      favorite_count: 3,
      card_count: 9,
      created_at: '2026-02-01T00:00:00.000Z',
      updated_at: '2026-02-02T00:00:00.000Z',
      favorited_at: '2026-02-03T00:00:00.000Z',
    });

    expect(mapped).toEqual({
      id: 'deck-1',
      userId: 12,
      username: 'alice',
      name: '测试卡组',
      description: 'desc',
      isPublic: 1,
      likeCount: 5,
      favoriteCount: 3,
      cardCount: 9,
      createdAt: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-02-02T00:00:00.000Z',
      favoritedAt: '2026-02-03T00:00:00.000Z',
    });
    expect('is_public' in mapped).toBe(false);
    expect('like_count' in mapped).toBe(false);
    expect('card_count' in mapped).toBe(false);
  });

  test('mapDeckReadRow 支持 camelCase 输入并兼容布尔可见性', () => {
    const mapped = mapDeckReadRow({
      id: 'deck-2',
      userId: '20',
      name: 'Deck 2',
      description: '',
      isPublic: true,
      likeCount: '10',
      favoriteCount: '2',
      cardCount: '7',
      createdAt: '2026-03-01T00:00:00.000Z',
    });

    expect(mapped).toEqual({
      id: 'deck-2',
      userId: 20,
      name: 'Deck 2',
      description: null,
      isPublic: 1,
      likeCount: 10,
      favoriteCount: 2,
      cardCount: 7,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: null,
    });
  });

  test('mapDeckReadRows 在非数组输入时返回空数组', () => {
    expect(mapDeckReadRows(null)).toEqual([]);
    expect(mapDeckReadRows({})).toEqual([]);
  });
});

