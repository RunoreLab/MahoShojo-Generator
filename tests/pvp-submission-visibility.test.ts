import { describe, expect, test } from 'bun:test';

import { canViewOtherSubmissions } from '@/lib/pvp/submission-visibility';

describe('pvp: canViewOtherSubmissions', () => {
  test('提交阶段强制隐藏（即使 showAllSubmissions=true）', () => {
    expect(canViewOtherSubmissions('submitting', true)).toBe(false);
  });

  test('非提交阶段按规则决定', () => {
    expect(canViewOtherSubmissions('choosing', true)).toBe(true);
    expect(canViewOtherSubmissions('choosing', false)).toBe(false);
  });
});

