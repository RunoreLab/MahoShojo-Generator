import { describe, expect, test } from 'bun:test';
import { createGrantExcellentReporterRunner } from '@/lib/automation/badges/grant-excellent-reporter';
import { createGrantSponsorRunner } from '@/lib/automation/badges/grant-sponsor';

const silentLogger = {
  log: () => undefined,
  error: () => undefined,
};

describe('automation badge jobs', () => {
  test('excellent reporter 任务应在 dry-run 下汇总候选并跳过已持有徽章用户', async () => {
    const runner = createGrantExcellentReporterRunner({
      countUsersWithPublicApprovedCards: async () => 10,
      listEligibleReporterUsers: async () => [
        {
          userId: 1,
          username: 'alice',
          publicCards: 2,
          totalLikes: 6,
          totalFavorites: 4,
          totalUsage: 40,
        },
        {
          userId: 2,
          username: 'bob',
          publicCards: 3,
          totalLikes: 8,
          totalFavorites: 5,
          totalUsage: 70,
        },
      ],
      getUserSlotCountById: async (userId) => (userId === 1 ? 32 : 64),
      userHasBadge: async (userId) => userId === 2,
      grantBadgeToUser: async () => {
        throw new Error('dry-run 下不应真正授予徽章');
      },
      increaseUserSlotCount: async () => {
        throw new Error('dry-run 下不应真正增加槽位');
      },
    });

    const result = await runner({
      dryRun: true,
      logger: silentLogger,
    });

    expect(result.summary.totalPublicUsers).toBe(10);
    expect(result.summary.eligibleUsers).toBe(2);
    expect(result.summary.badgeGranted).toBe(1);
    expect(result.summary.slotIncreased).toBe(1);
    expect(result.summary.skipped).toBe(1);
    expect(result.summary.errors).toBe(0);
    expect(result.summary.dryRun).toBeTrue();
  });

  test('sponsor 任务应合并候选来源并跳过已持有徽章用户', async () => {
    const grantedUserIds: number[] = [];
    const runner = createGrantSponsorRunner({
      listSponsorSlotCandidates: async () => [
        { userId: 1, username: 'alice', slotCount: 16 },
        { userId: 2, username: 'bob', slotCount: 32 },
      ],
      listSponsorExcellentCandidates: async () => [
        { userId: 2, username: 'bob', slotCount: 128, publicCards: 4 },
        { userId: 3, username: 'carol', slotCount: 256, publicCards: 8 },
      ],
      userHasBadge: async (userId) => userId === 1,
      grantBadgeToUser: async (userId) => {
        grantedUserIds.push(userId);
        return true;
      },
    });

    const result = await runner({
      dryRun: false,
      logger: silentLogger,
    });

    expect(result.summary.totalCandidates).toBe(3);
    expect(result.summary.slotOnly).toBe(1);
    expect(result.summary.bothSources).toBe(1);
    expect(result.summary.excellentOnly).toBe(1);
    expect(result.summary.skippedHasBadge).toBe(1);
    expect(result.summary.badgeGranted).toBe(2);
    expect(result.summary.errors).toBe(0);
    expect(grantedUserIds).toEqual([2, 3]);
  });
});
