import { describe, expect, it } from 'bun:test';

import { buildBotUsername } from '@/lib/pvp/bot/names';
import { computeDefaultCardWeight, getBotStrategyById } from '@/lib/pvp/bot/strategies';
import type { BotCandidateCard } from '@/lib/pvp/bot/types';

describe('pvp bot: names', () => {
  it('adds suffix when needed', () => {
    expect(buildBotUsername('弧盐', 0)).toBe('弧盐');
    expect(buildBotUsername('弧盐', 1)).toBe('弧盐#2');
    expect(buildBotUsername('弧盐', 2)).toBe('弧盐#3');
  });
});

describe('pvp bot: default weight', () => {
  it('uses base weight when no stats', () => {
    const card: BotCandidateCard = {
      snapshotId: 's1',
      snapshotName: 'A',
      snapshotDataJson: '{}',
      ref: null,
      dataCardStats: null,
      ownerUserId: 1,
      ownerIsBot: false,
      ownerWinRate: null,
    };
    expect(computeDefaultCardWeight(card)).toBe(1);
  });

  it('caps weight at 3x base', () => {
    const card: BotCandidateCard = {
      snapshotId: 's1',
      snapshotName: 'A',
      snapshotDataJson: '{}',
      ref: { kind: 'data_card', id: 'c1', updatedAt: null },
      dataCardStats: { id: 'c1', isPublic: true, usageCount: 10_000, likeCount: 10_000, favoriteCount: 10_000 },
      ownerUserId: 1,
      ownerIsBot: false,
      ownerWinRate: null,
    };
    expect(computeDefaultCardWeight(card)).toBeLessThanOrEqual(3);
    expect(computeDefaultCardWeight(card)).toBeGreaterThanOrEqual(1);
  });
});

describe('pvp bot: copycat', () => {
  it('picks highest-winrate human owner in hand', () => {
    const copycat = getBotStrategyById('copycat');
    const cards: BotCandidateCard[] = [
      {
        snapshotId: 's1',
        snapshotName: 'X',
        snapshotDataJson: '{}',
        ref: null,
        dataCardStats: null,
        ownerUserId: 101,
        ownerIsBot: false,
        ownerWinRate: 0.2,
      },
      {
        snapshotId: 's2',
        snapshotName: 'Y',
        snapshotDataJson: '{}',
        ref: null,
        dataCardStats: null,
        ownerUserId: 102,
        ownerIsBot: false,
        ownerWinRate: 0.8,
      },
      {
        snapshotId: 's3',
        snapshotName: 'Z',
        snapshotDataJson: '{}',
        ref: null,
        dataCardStats: null,
        ownerUserId: 201,
        ownerIsBot: true,
        ownerWinRate: 1,
      },
    ];

    const picked = copycat.pickSnapshotId(cards, () => 0);
    expect(picked).toBe('s2');
  });
});

