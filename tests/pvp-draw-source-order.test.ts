import { describe, expect, test } from 'bun:test';

import { getPvpFallbackDrawOrder } from '@/lib/pvp/drawSource';

describe('pvp draw source order', () => {
  test('preset/public 单一来源固定', () => {
    expect(getPvpFallbackDrawOrder('preset', () => 0.9)).toEqual(['preset']);
    expect(getPvpFallbackDrawOrder('public', () => 0.1)).toEqual(['public']);
  });

  test('preset+public 会随机决定优先级', () => {
    expect(getPvpFallbackDrawOrder('preset+public', () => 0.49)).toEqual(['preset', 'public']);
    expect(getPvpFallbackDrawOrder('preset+public', () => 0.5)).toEqual(['public', 'preset']);
    expect(getPvpFallbackDrawOrder('preset+public', () => 0.99)).toEqual(['public', 'preset']);
  });
});

