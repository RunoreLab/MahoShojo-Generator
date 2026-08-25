import { describe, expect, test } from 'vitest';

import { canForcePendingAction, computeLastPendingChooseAction, computeLastPendingConfirmAction, computeLastPendingSubmissionAction, computeLastPendingVoteAction } from '@/lib/pvp/pending-action';

describe('pvp: pending-action', () => {
  test('submitting：仅剩 1 人未提交时给出 deadline', () => {
    const pending = computeLastPendingSubmissionAction({
      nowMs: Date.parse('2025-12-22T00:00:20.000Z'),
      phaseFallbackAt: '2025-12-22T00:00:00.000Z',
      players: [{ userId: 1 }, { userId: 2 }],
      submissions: [{ userId: 1, updatedAt: '2025-12-22T00:00:10.000Z' }],
    });

    expect(pending).not.toBeNull();
    if (!pending) return;
    expect(pending.kind).toBe('submit');
    expect(pending.pendingUserId).toBe(2);
    expect(pending.startAt).toBe('2025-12-22T00:00:10.000Z');
    expect(pending.deadlineAt).toBe('2025-12-22T00:00:40.000Z');
    expect(pending.secondsLeft).toBe(20);
    expect(canForcePendingAction(pending, Date.parse('2025-12-22T00:00:39.999Z'))).toBe(false);
    expect(canForcePendingAction(pending, Date.parse('2025-12-22T00:00:40.000Z'))).toBe(true);
  });

  test('submitting：没有任何提交时使用 phaseFallbackAt 作为起点', () => {
    const pending = computeLastPendingSubmissionAction({
      nowMs: Date.parse('2025-12-22T00:00:10.000Z'),
      phaseFallbackAt: '2025-12-22T00:00:00.000Z',
      players: [{ userId: 7 }],
      submissions: [],
    });

    expect(pending).not.toBeNull();
    if (!pending) return;
    expect(pending.startAt).toBe('2025-12-22T00:00:00.000Z');
    expect(pending.deadlineAt).toBe('2025-12-22T00:00:30.000Z');
    expect(pending.secondsLeft).toBe(20);
  });

  test('choosing：忽略非当前玩家的陈旧 choice 行', () => {
    const pending = computeLastPendingChooseAction({
      nowMs: Date.parse('2025-12-22T00:01:10.000Z'),
      phaseFallbackAt: '2025-12-22T00:01:00.000Z',
      players: [{ userId: 1 }, { userId: 2 }],
      choices: [
        { userId: 999, updatedAt: '2025-12-22T00:01:01.000Z' },
        { userId: 1, updatedAt: '2025-12-22T00:01:05.000Z' },
      ],
    });

    expect(pending).not.toBeNull();
    if (!pending) return;
    expect(pending.kind).toBe('choose');
    expect(pending.pendingUserId).toBe(2);
    expect(pending.startAt).toBe('2025-12-22T00:01:05.000Z');
  });

  test('confirm：使用 confirmedAtByUserId 的最大值作为倒计时起点', () => {
    const pending = computeLastPendingConfirmAction({
      nowMs: Date.parse('2025-12-22T00:02:10.000Z'),
      phaseFallbackAt: '2025-12-22T00:02:00.000Z',
      postRoundCreatedAt: '2025-12-22T00:02:00.000Z',
      players: [{ userId: 1 }, { userId: 2 }, { userId: 3 }],
      confirmedUserIds: [1, 2],
      confirmedAtByUserId: {
        '1': '2025-12-22T00:02:03.000Z',
        '2': '2025-12-22T00:02:06.000Z',
      },
    });

    expect(pending).not.toBeNull();
    if (!pending) return;
    expect(pending.kind).toBe('confirm');
    expect(pending.pendingUserId).toBe(3);
    expect(pending.startAt).toBe('2025-12-22T00:02:06.000Z');
    expect(pending.deadlineAt).toBe('2025-12-22T00:02:36.000Z');
    expect(pending.secondsLeft).toBe(26);
  });

  test('voting：仅剩 1 人未投票时给出 deadline', () => {
    const pending = computeLastPendingVoteAction({
      nowMs: Date.parse('2025-12-23T00:00:20.000Z'),
      phaseFallbackAt: '2025-12-23T00:00:00.000Z',
      voteCreatedAt: '2025-12-23T00:00:00.000Z',
      eligibleUserIds: [1, 2],
      votes: [{ userId: 1, votedAt: '2025-12-23T00:00:10.000Z' }],
    });

    expect(pending).not.toBeNull();
    if (!pending) return;
    expect(pending.kind).toBe('vote');
    expect(pending.pendingUserId).toBe(2);
    expect(pending.startAt).toBe('2025-12-23T00:00:10.000Z');
    expect(pending.deadlineAt).toBe('2025-12-23T00:00:40.000Z');
    expect(pending.secondsLeft).toBe(20);
  });
});
