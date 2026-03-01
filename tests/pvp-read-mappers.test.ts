import { describe, expect, test } from 'bun:test';

import {
  buildDefaultPvpUserSummary,
  computePvpWinRate,
  mapPvpMatchPlayerRow,
  mapPvpMatchRow,
  mapPvpUserSummaryRow,
} from '@/lib/pvp/read-mappers';

describe('pvp read mappers', () => {
  test('mapPvpUserSummaryRow 支持 snake_case 输入并输出 canonical camelCase', () => {
    const mapped = mapPvpUserSummaryRow({
      user_id: 12,
      completed_matches: 20,
      wins: 9,
      losses: 7,
      draws: 4,
      aborted_matches: 1,
      last_played_at: '2026-03-01T10:00:00.000Z',
    });

    expect(mapped).toEqual({
      userId: 12,
      completedMatches: 20,
      wins: 9,
      losses: 7,
      draws: 4,
      abortedMatches: 1,
      lastPlayedAt: '2026-03-01T10:00:00.000Z',
    });
    expect('user_id' in mapped).toBe(false);
    expect('completed_matches' in mapped).toBe(false);
  });

  test('mapPvpUserSummaryRow 支持 camelCase 输入并兜底默认值', () => {
    const mapped = mapPvpUserSummaryRow({
      userId: '8',
      wins: '3',
      losses: 2,
      draws: 1,
    });

    expect(mapped).toEqual({
      userId: 8,
      completedMatches: 0,
      wins: 3,
      losses: 2,
      draws: 1,
      abortedMatches: 0,
      lastPlayedAt: null,
    });
  });

  test('computePvpWinRate 与默认摘要语义稳定', () => {
    const fallback = buildDefaultPvpUserSummary(99);
    expect(fallback.userId).toBe(99);
    expect(computePvpWinRate(fallback)).toBe(0);
    expect(computePvpWinRate({ wins: 3, losses: 1, draws: 0 })).toBe(75);
  });

  test('mapPvpMatchRow 支持 snake_case 输入并输出 canonical camelCase', () => {
    const mapped = mapPvpMatchRow({
      id: 'm-1',
      room_id: 'room-1',
      status: 'completed',
      started_at: '2026-03-01T00:00:00.000Z',
      ended_at: '2026-03-01T00:10:00.000Z',
      winner_user_id: 10,
    });

    expect(mapped).toEqual({
      id: 'm-1',
      roomId: 'room-1',
      status: 'completed',
      startedAt: '2026-03-01T00:00:00.000Z',
      endedAt: '2026-03-01T00:10:00.000Z',
      winnerUserId: 10,
    });
    expect('room_id' in mapped).toBe(false);
    expect('winner_user_id' in mapped).toBe(false);
  });

  test('mapPvpMatchPlayerRow 支持 snake/camel 双输入并输出 canonical camelCase', () => {
    const snakeMapped = mapPvpMatchPlayerRow({
      match_id: 'm-2',
      user_id: 11,
      seat: 2,
      username: 'alice',
      user_prefix: 'VIP',
    });
    expect(snakeMapped).toEqual({
      matchId: 'm-2',
      userId: 11,
      seat: 2,
      username: 'alice',
      prefix: 'VIP',
    });

    const camelMapped = mapPvpMatchPlayerRow({
      matchId: 'm-3',
      userId: 7,
      seat: '1',
      username: '',
      prefix: '',
    });
    expect(camelMapped).toEqual({
      matchId: 'm-3',
      userId: 7,
      seat: 1,
      username: null,
      prefix: null,
    });
  });
});
