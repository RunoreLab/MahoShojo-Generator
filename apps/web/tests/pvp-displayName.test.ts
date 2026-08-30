import { describe, expect, it } from 'vitest';

import { formatPvpDisplayName } from '@/lib/pvp/displayName';

describe('formatPvpDisplayName', () => {
  it('优先使用用户名，并去除首尾空白', () => {
    expect(formatPvpDisplayName({ userId: 1, username: '  未坠之夜  ' })).toBe('未坠之夜');
  });

  it('当用户名为空时回退到用户ID', () => {
    expect(formatPvpDisplayName({ userId: 42, username: '   ' })).toBe('用户42');
  });

  it('当用户名与用户ID都不可用时回退为未知玩家', () => {
    expect(formatPvpDisplayName({ userId: NaN, username: null })).toBe('未知玩家');
  });

  it('机器人玩家追加后缀', () => {
    expect(formatPvpDisplayName({ userId: 7, username: 'Bot', isBot: true })).toBe('Bot（机器人）');
  });
});

