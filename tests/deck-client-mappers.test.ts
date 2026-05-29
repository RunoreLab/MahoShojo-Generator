import { describe, expect, test } from 'vitest';

import { mapDeckDetailPayload, mapDeckListPayload } from '@/lib/deck-client-mappers';

describe('deck-client-mappers', () => {
  test('mapDeckListPayload 支持对象形态与 snake_case 卡组字段', () => {
    const mapped = mapDeckListPayload({
      decks: [
        {
          id: 'deck-1',
          user_id: 12,
          name: '测试卡组',
          description: 'desc',
          is_public: 1,
          like_count: 5,
          favorite_count: 3,
          card_count: 9,
        },
      ],
      capacity: '20',
      deck_count: '7',
    });

    expect(mapped).toEqual({
      decks: [
        {
          id: 'deck-1',
          userId: 12,
          name: '测试卡组',
          description: 'desc',
          isPublic: 1,
          likeCount: 5,
          favoriteCount: 3,
          cardCount: 9,
          createdAt: null,
          updatedAt: null,
        },
      ],
      capacity: 20,
      deckCount: 7,
    });
  });

  test('mapDeckListPayload 支持直接数组并返回 canonical decks', () => {
    const mapped = mapDeckListPayload([
      {
        id: 'deck-2',
        userId: 10,
        name: 'Deck2',
        isPublic: true,
      },
    ]);

    expect(mapped).toEqual({
      decks: [
        {
          id: 'deck-2',
          userId: 10,
          name: 'Deck2',
          description: null,
          isPublic: 1,
          likeCount: 0,
          favoriteCount: 0,
          cardCount: 0,
          createdAt: null,
          updatedAt: null,
        },
      ],
    });
  });

  test('mapDeckDetailPayload 返回 canonical deck 并兜底 cards', () => {
    const mapped = mapDeckDetailPayload({
      deck: {
        id: 'deck-3',
        user_id: 33,
        name: 'Deck3',
        is_public: 0,
      },
      cards: null,
    });

    expect(mapped).toEqual({
      deck: {
        id: 'deck-3',
        userId: 33,
        name: 'Deck3',
        description: null,
        isPublic: 0,
        likeCount: 0,
        favoriteCount: 0,
        cardCount: 0,
        createdAt: null,
        updatedAt: null,
      },
      cards: [],
    });
  });

  test('mapDeckDetailPayload 在 deck 缺失时返回 null', () => {
    expect(mapDeckDetailPayload({ cards: [] })).toBeNull();
    expect(mapDeckDetailPayload(null)).toBeNull();
  });
});
