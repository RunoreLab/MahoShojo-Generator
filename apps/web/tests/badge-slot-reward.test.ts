import { describe, expect, test, vi } from 'vitest';
import { grantBadgeWithSlotReward } from '@/lib/rewards/badge-slot-reward';

const input = { userId: 7, badgeId: 'excellent_reporter', slotIncrement: 128 };

describe('grantBadgeWithSlotReward', () => {
  test('既有徽章不重复增加槽位', async () => {
    const increaseSlots = vi.fn(async () => true);
    const result = await grantBadgeWithSlotReward(input, {
      tryGrantBadge: async () => 'already-exists',
      increaseSlots,
    });
    expect(result.status).toBe('already-granted');
    expect(increaseSlots).not.toHaveBeenCalled();
  });

  test('新授予且槽位增加成功', async () => {
    const tryRevokeBadge = vi.fn(async () => true);
    const result = await grantBadgeWithSlotReward(input, {
      tryGrantBadge: async () => 'granted',
      increaseSlots: async () => true,
      tryRevokeBadge,
    });
    expect(result.status).toBe('granted');
    expect(tryRevokeBadge).not.toHaveBeenCalled();
  });

  test('确定性槽位失败时撤销本次徽章', async () => {
    const result = await grantBadgeWithSlotReward(input, {
      tryGrantBadge: async () => 'granted',
      increaseSlots: async () => false,
      tryRevokeBadge: async () => true,
    });
    expect(result.status).toBe('slot-failed-rolled-back');
  });

  test('补偿撤销失败时明确报告', async () => {
    const result = await grantBadgeWithSlotReward(input, {
      tryGrantBadge: async () => 'granted',
      increaseSlots: async () => false,
      tryRevokeBadge: async () => false,
    });
    expect(result.status).toBe('slot-failed-rollback-failed');
  });

  test('槽位写入抛错时不自动撤销徽章', async () => {
    const tryRevokeBadge = vi.fn(async () => true);
    const result = await grantBadgeWithSlotReward(input, {
      tryGrantBadge: async () => 'granted',
      increaseSlots: async () => { throw new Error('indeterminate'); },
      tryRevokeBadge,
    });
    expect(result.status).toBe('slot-outcome-unknown');
    expect(tryRevokeBadge).not.toHaveBeenCalled();
  });

  test('授予失败时不触碰槽位', async () => {
    const increaseSlots = vi.fn(async () => true);
    const result = await grantBadgeWithSlotReward(input, {
      tryGrantBadge: async () => 'failed',
      increaseSlots,
    });
    expect(result.status).toBe('grant-failed');
    expect(increaseSlots).not.toHaveBeenCalled();
  });
});
