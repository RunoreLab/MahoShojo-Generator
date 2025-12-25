import { describe, expect, test } from 'bun:test';

import { tallyPvpWinnerVotes } from '@/lib/pvp/winner-vote';

describe('pvp: winner-vote', () => {
  test('唯一最高票：选出对应 seat', () => {
    const tally = tallyPvpWinnerVotes({
      eligibleUserIds: [1, 2, 3],
      validSeats: [0, 1],
      votesByUserId: {
        '1': { choice: { kind: 'seat', seat: 0 }, votedAt: '2025-12-23T00:00:01.000Z' },
        '2': { choice: { kind: 'seat', seat: 0 }, votedAt: '2025-12-23T00:00:02.000Z' },
        '3': { choice: { kind: 'seat', seat: 1 }, votedAt: '2025-12-23T00:00:03.000Z' },
      },
    });
    expect(tally.eligibleCount).toBe(3);
    expect(tally.voteCount).toBe(3);
    expect(tally.winnerSeat).toBe(0);
    expect(tally.tied).toBe(false);
    expect(tally.drawCount).toBe(0);
    expect(tally.countsBySeat).toEqual({ '0': 2, '1': 1 });
  });

  test('最高票为平局：winnerSeat 为 null', () => {
    const tally = tallyPvpWinnerVotes({
      eligibleUserIds: [1, 2, 3],
      validSeats: [0, 1],
      votesByUserId: {
        '1': { choice: { kind: 'draw' }, votedAt: '2025-12-23T00:00:01.000Z' },
        '2': { choice: { kind: 'draw' }, votedAt: '2025-12-23T00:00:02.000Z' },
        '3': { choice: { kind: 'seat', seat: 1 }, votedAt: '2025-12-23T00:00:03.000Z' },
      },
    });
    expect(tally.winnerSeat).toBeNull();
    expect(tally.tied).toBe(false);
    expect(tally.drawCount).toBe(2);
  });

  test('平票：视为平局（winnerSeat 为 null）', () => {
    const tally = tallyPvpWinnerVotes({
      eligibleUserIds: [1, 2, 3, 4],
      validSeats: [0, 1],
      votesByUserId: {
        '1': { choice: { kind: 'seat', seat: 0 }, votedAt: '2025-12-23T00:00:01.000Z' },
        '2': { choice: { kind: 'seat', seat: 1 }, votedAt: '2025-12-23T00:00:02.000Z' },
        '3': { choice: { kind: 'seat', seat: 0 }, votedAt: '2025-12-23T00:00:03.000Z' },
        '4': { choice: { kind: 'seat', seat: 1 }, votedAt: '2025-12-23T00:00:04.000Z' },
      },
    });
    expect(tally.winnerSeat).toBeNull();
    expect(tally.tied).toBe(true);
    expect(tally.topCount).toBe(2);
  });

  test('出现无效 seat 或非 eligible 投票：应忽略', () => {
    const tally = tallyPvpWinnerVotes({
      eligibleUserIds: [1, 2],
      validSeats: [0],
      votesByUserId: {
        '1': { choice: { kind: 'seat', seat: 999 }, votedAt: '2025-12-23T00:00:01.000Z' },
        '2': { choice: { kind: 'seat', seat: 0 }, votedAt: '2025-12-23T00:00:02.000Z' },
        '999': { choice: { kind: 'draw' }, votedAt: '2025-12-23T00:00:03.000Z' },
      },
    });
    expect(tally.eligibleCount).toBe(2);
    expect(tally.voteCount).toBe(1);
    expect(tally.winnerSeat).toBe(0);
    expect(tally.drawCount).toBe(0);
    expect(tally.countsBySeat).toEqual({ '0': 1 });
  });
});

