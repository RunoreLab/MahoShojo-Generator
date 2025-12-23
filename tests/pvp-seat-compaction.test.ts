import { describe, expect, test } from 'bun:test';

import { compactPvpSeats } from '@/lib/pvp/seat-compaction';

describe('pvp: compactPvpSeats', () => {
  test('按当前参与者顺序压缩 seat（消除空洞）', () => {
    const result = compactPvpSeats({
      humans: [
        { userId: 1, seat: 0 },
        { userId: 2, seat: 5 },
      ],
      bots: [{ botId: 'b1', seat: 2 }],
    });
    expect('error' in result).toBe(false);
    if ('error' in result) return;

    expect(result.totalParticipants).toBe(3);
    expect(result.humans).toEqual([
      { userId: 1, seat: 0, newSeat: 0 },
      { userId: 2, seat: 5, newSeat: 2 },
    ]);
    expect(result.bots).toEqual([{ botId: 'b1', seat: 2, newSeat: 1 }]);
  });

  test('存在重复 seat 时返回错误', () => {
    const result = compactPvpSeats({
      humans: [{ userId: 1, seat: 0 }],
      bots: [{ botId: 'b1', seat: 0 }],
    });
    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.error).toContain('座位冲突');
  });

  test('非法 seat 返回错误', () => {
    const result = compactPvpSeats({
      humans: [{ userId: 1, seat: -1 }],
      bots: [],
    });
    expect('error' in result).toBe(true);
  });
});

