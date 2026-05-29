import { describe, expect, test } from 'vitest';

import { getDeckStatus, getDeckVisibilityValue, isDeckBanned } from '@/lib/deck-status';

describe('deck-status', () => {
  test('兼容 snake_case / camelCase / internal 的可见性字段', () => {
    expect(getDeckStatus({ is_public: 1 }).status).toBe('public');
    expect(getDeckStatus({ isPublic: true }).status).toBe('public');
    expect(getDeckStatus({ _isPublic: 1 }).status).toBe('public');
    expect(getDeckStatus({ is_public: 0 }).status).toBe('private');
    expect(getDeckStatus({ _isPublic: false }).status).toBe('private');
    expect(getDeckStatus({ isPublic: -1 }).status).toBe('banned');
  });

  test('封禁判定与 canonical 数值输出稳定', () => {
    expect(isDeckBanned({ is_public: -1 })).toBe(true);
    expect(isDeckBanned({ isPublic: -1 })).toBe(true);
    expect(isDeckBanned({ _isPublic: -1 })).toBe(true);
    expect(isDeckBanned({ isPublic: 1 })).toBe(false);

    expect(getDeckVisibilityValue({ is_public: -1 })).toBe(-1);
    expect(getDeckVisibilityValue({ isPublic: true })).toBe(1);
    expect(getDeckVisibilityValue({ _isPublic: false })).toBe(0);
    expect(getDeckVisibilityValue({})).toBe(0);
  });
});

