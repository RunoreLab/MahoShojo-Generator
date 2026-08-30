#!/usr/bin/env -S pnpm exec tsx

/**
 * 记者档位徽章发放脚本（含高级档位）
 *
 * 默认仅建议 dry-run 预览；若需要实际写入，请去掉 --dry-run。
 *
 * 使用：
 * - pnpm exec tsx scripts/badge/grant-reporter-tiers.ts --dry-run
 * - pnpm exec tsx scripts/badge/grant-reporter-tiers.ts
 *
 * 可选参数：
 * - --max-tier=<badgeId> 仅发放到指定档位（包含该档位）。例如：--max-tier=excellent_reporter
 */

import {
  countUsersWithPublicApprovedCards as countUsersWithPublicApprovedCardsFromRepo,
  listUsersWithPublicApprovedCardTotals,
} from '@/lib/database/badges-granting';
import { grantBadgeToUser, userHasBadge } from '@/lib/database/badges';
import { increaseUserSlotCount } from '@/lib/database/users';
import { REPORTER_TIERS } from './reporter-rules';

type UserTotalsRow = {
  userId: number;
  username: string;
  publicCards: number;
  totalLikes: number;
  totalFavorites: number;
  totalUsage: number;
};

function parseMaxTierArg(args: string[]): string | null {
  const flag = args.find((arg) => arg.startsWith('--max-tier='));
  if (!flag) return null;
  const [, value] = flag.split('=', 2);
  return value?.trim() ? value.trim() : null;
}

function getEffectiveTiers(maxTierBadgeId: string | null) {
  if (!maxTierBadgeId) return REPORTER_TIERS;
  const idx = REPORTER_TIERS.findIndex((t) => t.badgeId === maxTierBadgeId);
  if (idx < 0) {
    throw new Error(`未知的 --max-tier：${maxTierBadgeId}`);
  }
  return REPORTER_TIERS.slice(0, idx + 1);
}

function isUserQualifiedForTier(user: UserTotalsRow, tier: (typeof REPORTER_TIERS)[number]): boolean {
  return (
    user.totalLikes >= tier.minTotalLikes &&
    user.totalFavorites >= tier.minTotalFavorites &&
    user.totalUsage >= tier.minTotalUsage
  );
}

async function countUsersWithPublicApprovedCards(): Promise<number> {
  return countUsersWithPublicApprovedCardsFromRepo();
}

async function loadUserTotals(): Promise<UserTotalsRow[]> {
  const rows = await listUsersWithPublicApprovedCardTotals();
  return rows.map((row) => ({
    userId: row.userId,
    username: row.username,
    publicCards: row.publicCards,
    totalLikes: row.totalLikes,
    totalFavorites: row.totalFavorites,
    totalUsage: row.totalUsage,
  }));
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const maxTier = parseMaxTierArg(args);
  const tiers = getEffectiveTiers(maxTier);

  console.log('📰 记者档位徽章发放');
  console.log(`模式: ${dryRun ? 'dry-run（仅预览）' : '执行（写入数据库）'}`);
  console.log(`档位: ${tiers.map((t) => t.badgeId).join(' → ')}`);
  console.log('');

  const totalPublicUsers = await countUsersWithPublicApprovedCards();
  const users = await loadUserTotals();

  console.log(`公开且通过审查的发卡用户：${totalPublicUsers}`);
  console.log(`可参与计算的用户：${users.length}`);
  console.log('');

  const summary = {
    totalUsers: users.length,
    tiers: Object.fromEntries(tiers.map((t) => [t.badgeId, { qualified: 0, granted: 0, skippedHasBadge: 0 }])) as Record<
      string,
      { qualified: number; granted: number; skippedHasBadge: number }
    >,
    slotIncreased: 0,
    errors: 0,
    dryRun,
  };

  for (const user of users) {
    for (const tier of tiers) {
      if (!isUserQualifiedForTier(user, tier)) continue;

      summary.tiers[tier.badgeId].qualified += 1;

      try {
        const alreadyHas = await userHasBadge(user.userId, tier.badgeId);
        if (alreadyHas) {
          summary.tiers[tier.badgeId].skippedHasBadge += 1;
          continue;
        }

        if (dryRun) {
          summary.tiers[tier.badgeId].granted += 1;
          summary.slotIncreased += 1;
          console.log(
            `[dry-run] 用户 ${user.username} (ID: ${user.userId}) 将授予 ${tier.badgeId}，并增加槽位 +${tier.slotIncrement}`
          );
          continue;
        }

        const granted = await grantBadgeToUser(user.userId, tier.badgeId);
        if (!granted) {
          summary.errors += 1;
          console.error(`❌ 用户 ${user.username} (ID: ${user.userId}) 授予 ${tier.badgeId} 失败`);
          continue;
        }

        summary.tiers[tier.badgeId].granted += 1;
        const increased = await increaseUserSlotCount(user.userId, tier.slotIncrement);
        if (increased) {
          summary.slotIncreased += 1;
        } else {
          summary.errors += 1;
          console.error(`❌ 用户 ${user.username} (ID: ${user.userId}) 槽位增加失败（${tier.badgeId}）`);
        }
      } catch (error) {
        summary.errors += 1;
        console.error(`❌ 处理用户 ${user.username} (ID: ${user.userId}) 档位 ${tier.badgeId} 时出错:`, error);
      }
    }
  }

  console.log('');
  console.log('━'.repeat(60));
  console.log('📊 发放统计');
  console.table(summary);

  if (dryRun) {
    console.log('Dry-run 模式：未对数据库进行任何修改。');
  }
}

main();

