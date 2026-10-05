import { tryGrantBadgeToUser, tryRevokeBadgeFromUser, type TryGrantBadgeResult } from '@/lib/database/badges';
import { increaseUserSlotCountStrict } from '@/lib/database/users';

export type BadgeSlotRewardResult =
  | { status: 'already-granted' }
  | { status: 'granted' }
  | { status: 'grant-failed' }
  | { status: 'slot-failed-rolled-back' }
  | { status: 'slot-failed-rollback-failed' }
  | { status: 'slot-outcome-unknown'; error: unknown };

type BadgeSlotRewardDeps = {
  tryGrantBadge?: (userId: number, badgeId: string) => Promise<TryGrantBadgeResult>;
  increaseSlots?: (userId: number, increaseBy: number) => Promise<boolean>;
  tryRevokeBadge?: (userId: number, badgeId: string) => Promise<boolean>;
};

export async function grantBadgeWithSlotReward(
  input: { userId: number; badgeId: string; slotIncrement: number },
  deps: BadgeSlotRewardDeps = {},
): Promise<BadgeSlotRewardResult> {
  const tryGrant = deps.tryGrantBadge ?? tryGrantBadgeToUser;
  const increaseSlots = deps.increaseSlots ?? increaseUserSlotCountStrict;
  const tryRevoke = deps.tryRevokeBadge ?? tryRevokeBadgeFromUser;

  const grantResult = await tryGrant(input.userId, input.badgeId);
  if (grantResult === 'already-exists') return { status: 'already-granted' };
  if (grantResult !== 'granted') return { status: 'grant-failed' };

  let increased: boolean;
  try {
    increased = await increaseSlots(input.userId, input.slotIncrement);
  } catch (error) {
    // 写入结果不明确时保留徽章，避免槽位可能已到账却被补偿撤销。
    return { status: 'slot-outcome-unknown', error };
  }
  if (increased) return { status: 'granted' };

  try {
    const rolledBack = await tryRevoke(input.userId, input.badgeId);
    return { status: rolledBack ? 'slot-failed-rolled-back' : 'slot-failed-rollback-failed' };
  } catch {
    return { status: 'slot-failed-rollback-failed' };
  }
}
