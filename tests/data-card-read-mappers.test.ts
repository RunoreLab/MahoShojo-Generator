import { describe, expect, test } from 'bun:test';

import {
  isPublicVisibility,
  mapPublicDataCardRowToBattleSelectionPayload,
  mapPublicDataCardRowToDetailsCard,
  normalizePublicVisibilityValue,
} from '@/lib/data-card-read-mappers';

describe('data-card read mappers', () => {
  test('mapPublicDataCardRowToDetailsCard 支持 snake_case 输入并输出 canonical camelCase', () => {
    const mapped = mapPublicDataCardRowToDetailsCard(
      {
        id: 'card-snake',
        name: '蛇形字段卡',
        description: 'desc',
        type: 'scenario',
        data: '{"title":"A"}',
        is_public: 1,
        usage_count: 7,
        like_count: 5,
        favorite_count: 3,
        username: 'alice',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
      },
      { id: 'fallback-id', name: 'fallback-name', author: 'fallback-author' },
    );

    expect(mapped).toEqual({
      id: 'card-snake',
      name: '蛇形字段卡',
      description: 'desc',
      type: 'scenario',
      data: JSON.stringify({ title: 'A' }, null, 2),
      isPublic: true,
      usageCount: 7,
      likeCount: 5,
      favoriteCount: 3,
      author: 'alice',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    expect('is_public' in mapped).toBe(false);
    expect('created_at' in mapped).toBe(false);
  });

  test('mapPublicDataCardRowToDetailsCard 支持 camelCase 输入并兼容字符串计数', () => {
    const mapped = mapPublicDataCardRowToDetailsCard(
      {
        id: 'card-camel',
        name: 'Camel Card',
        description: '',
        type: 'questionnaire',
        data: { id: 'q1', questions: [] },
        isPublic: true,
        usageCount: '12',
        likeCount: '8',
        favoriteCount: '2',
        author: 'bob',
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-02T00:00:00.000Z',
      },
      { id: 'fallback-id', name: 'fallback-name', author: 'fallback-author' },
    );

    expect(mapped.type).toBe('questionnaire');
    expect(mapped.isPublic).toBe(true);
    expect(mapped.usageCount).toBe(12);
    expect(mapped.likeCount).toBe(8);
    expect(mapped.favoriteCount).toBe(2);
    expect(mapped.author).toBe('bob');
  });

  test('mapPublicDataCardRowToBattleSelectionPayload 支持 snake/camel 双输入并输出统一 metadata', () => {
    const snakePayload = mapPublicDataCardRowToBattleSelectionPayload({
      id: 'snake-id',
      name: 'snake-name',
      description: 'desc',
      data: '{"codename":"A"}',
      is_public: 1,
      updated_at: '2026-01-02T00:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
      username: 'alice',
      like_count: 10,
      favorite_count: 20,
      usage_count: 30,
    });
    expect(snakePayload._cardId).toBe('snake-id');
    expect(snakePayload._isPublic).toBe(1);
    expect(snakePayload._author).toBe('alice');
    expect(snakePayload._likeCount).toBe(10);
    expect(snakePayload.codename).toBe('A');

    const camelPayload = mapPublicDataCardRowToBattleSelectionPayload({
      id: 'camel-id',
      name: 'camel-name',
      description: 'desc',
      dataJson: '{"name":"B"}',
      isPublic: true,
      updatedAt: '2026-02-02T00:00:00.000Z',
      createdAt: '2026-02-01T00:00:00.000Z',
      author: 'bob',
      likeCount: '11',
      favoriteCount: '22',
      usageCount: '33',
    });
    expect(camelPayload._cardId).toBe('camel-id');
    expect(camelPayload._isPublic).toBe(true);
    expect(camelPayload._author).toBe('bob');
    expect(camelPayload._usageCount).toBe(33);
    expect(camelPayload.name).toBe('B');
  });

  test('visibility helper 在 -1/0/1 与 boolean 上语义稳定', () => {
    const hidden = normalizePublicVisibilityValue({ is_public: -1 });
    const privateValue = normalizePublicVisibilityValue({ is_public: 0 });
    const publicValue = normalizePublicVisibilityValue({ is_public: 1 });
    const boolPublic = normalizePublicVisibilityValue({ isPublic: true });

    expect(hidden).toBe(-1);
    expect(privateValue).toBe(0);
    expect(publicValue).toBe(1);
    expect(boolPublic).toBe(true);

    expect(isPublicVisibility(hidden)).toBe(false);
    expect(isPublicVisibility(privateValue)).toBe(false);
    expect(isPublicVisibility(publicValue)).toBe(true);
    expect(isPublicVisibility(boolPublic)).toBe(true);
  });

  test('data 为空或不合法时抛出统一错误', () => {
    expect(() => mapPublicDataCardRowToDetailsCard({ id: 'x', data: '' }, { id: 'f', name: 'f', author: 'f' })).toThrow(
      '数据卡内容为空或格式不受支持。',
    );
    expect(() => mapPublicDataCardRowToBattleSelectionPayload({ id: 'x', data: '[]' })).toThrow(
      '数据卡内容为空或格式不受支持。',
    );
  });
});
