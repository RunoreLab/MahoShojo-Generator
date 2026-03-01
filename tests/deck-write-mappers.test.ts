import { describe, expect, test } from 'bun:test';

import { normalizeDeckVisibilityInput } from '@/lib/deck-write-mappers';

describe('deck-write-mappers', () => {
  test('normalizeDeckVisibilityInput 兼容 number/string/boolean 输入', () => {
    expect(normalizeDeckVisibilityInput(1)).toBe(1);
    expect(normalizeDeckVisibilityInput('1')).toBe(1);
    expect(normalizeDeckVisibilityInput(true)).toBe(1);

    expect(normalizeDeckVisibilityInput(0)).toBe(0);
    expect(normalizeDeckVisibilityInput('0')).toBe(0);
    expect(normalizeDeckVisibilityInput(false)).toBe(0);
  });

  test('normalizeDeckVisibilityInput 在默认配置下不允许 -1', () => {
    expect(normalizeDeckVisibilityInput(-1)).toBe(0);
    expect(normalizeDeckVisibilityInput('-1')).toBe(0);
  });

  test('normalizeDeckVisibilityInput 在 allowBanned=true 时保留 -1', () => {
    expect(normalizeDeckVisibilityInput(-1, { allowBanned: true })).toBe(-1);
    expect(normalizeDeckVisibilityInput('-1', { allowBanned: true })).toBe(-1);
  });
});
