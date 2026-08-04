import { describe, expect, test } from 'vitest';
import { formatSelectedDataCardJson } from '@/lib/card-forge/source-card';

describe('formatSelectedDataCardJson', () => {
  test('removes battle transport metadata while preserving card content', () => {
    const result = formatSelectedDataCardJson({
      templateId: '魔法少女/角色',
      codename: '蔷薇荆棘',
      _cardId: 'card-1',
      _cardName: '蔷薇荆棘',
      _cardType: 'character',
      _author: '作者',
      nested: { _updatedAt: 'ignored', value: 1 },
    });

    expect(JSON.parse(result)).toEqual({
      templateId: '魔法少女/角色',
      codename: '蔷薇荆棘',
      nested: { value: 1 },
    });
  });
});
