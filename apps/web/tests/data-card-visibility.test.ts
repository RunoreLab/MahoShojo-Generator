import { describe, expect, test } from 'vitest';

import { normalizeOnlineDataCardVisibilityCompat } from '@/lib/data-card-visibility';

describe('online data-card visibility compatibility adapter', () => {
  test.each([-1, 0, 1] as const)('保留正式数字 wire 值 %s', (value) => {
    expect(normalizeOnlineDataCardVisibilityCompat(value)).toBe(value);
  });

  test('只把历史 boolean 转换为正式数字值', () => {
    expect(normalizeOnlineDataCardVisibilityCompat(true)).toBe(1);
    expect(normalizeOnlineDataCardVisibilityCompat(false)).toBe(0);
  });

  test.each([2, -2, 0.5, 1.5, '1', '0', null, undefined])('拒绝契约外输入 %j', (value) => {
    expect(normalizeOnlineDataCardVisibilityCompat(value)).toBeNull();
  });
});
