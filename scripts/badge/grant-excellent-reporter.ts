#!/usr/bin/env bun

import { queryFromD1 } from '@/lib/database/core';
import { grantBadgeToUser, userHasBadge } from '@/lib/database/badges';
import { increaseUserSlotCount } from '@/lib/database/users';
import { getReporterTierByBadgeId } from './reporter-rules';

const EXCELLENT_REPORTER_TIER = getReporterTierByBadgeId('excellent_reporter');
if (!EXCELLENT_REPORTER_TIER) {
  throw new Error('缺少优秀记者档位配置：excellent_reporter');
}

interface EligibleUser {
  user_id: number;
  username: string;
  public_cards: number;
  total_likes: number;
  total_favorites: number;
  total_usage: number;
}

async function countUsersWithPublicApprovedCards(): Promise<number> {
  const sql = `
    SELECT COUNT(DISTINCT user_id) AS count
    FROM data_cards
    WHERE is_public = 1
      AND review_status = 'approved'
  `;

  const queryResult = await queryFromD1(sql, []);
  const result = queryResult as { success?: boolean; result?: Array<{ results?: any[] }> };
  if (!result.success || !result.result?.[0]?.results?.length) return 0;

  return Number(result.result[0].results[0].count ?? 0) || 0;
}

async function findEligibleUsers(): Promise<EligibleUser[]> {
  const sql = `
    SELECT
      dc.user_id,
      u.username,
      COUNT(dc.id) AS public_cards,
      SUM(dc.like_count) AS total_likes,
      SUM(dc.favorite_count) AS total_favorites,
      SUM(dc.usage_count) AS total_usage
    FROM data_cards dc
    JOIN users u ON u.id = dc.user_id
    WHERE dc.is_public = 1
      AND dc.review_status = 'approved'
    GROUP BY dc.user_id, u.username
    HAVING SUM(dc.like_count) >= ?
      AND SUM(dc.favorite_count) >= ?
      AND SUM(dc.usage_count) >= ?
  `;

  const queryResult = await queryFromD1(sql, [
    EXCELLENT_REPORTER_TIER.minTotalLikes,
    EXCELLENT_REPORTER_TIER.minTotalFavorites,
    EXCELLENT_REPORTER_TIER.minTotalUsage,
  ]);
  const result = queryResult as { success?: boolean; result?: Array<{ results?: any[] }> };

  if (!result.success || !result.result || !result.result[0]?.results) {
    return [];
  }

  return result.result[0].results.map((row: any) => ({
    user_id: row.user_id,
    username: row.username,
    public_cards: Number(row.public_cards ?? 0) || 0,
    total_likes: Number(row.total_likes ?? 0) || 0,
    total_favorites: Number(row.total_favorites ?? 0) || 0,
    total_usage: Number(row.total_usage ?? 0) || 0,
  }));
}

async function getUserSlotCount(userId: number): Promise<number> {
  const queryResult = await queryFromD1('SELECT slot_count FROM users WHERE id = ?', [userId]);
  const result = queryResult as { success?: boolean; result?: Array<{ results?: Array<{ slot_count?: number | null }> }> };
  if (!result.success || !result.result || !result.result[0]?.results?.length) {
    return 0;
  }
  const value = result.result[0].results[0].slot_count;
  return typeof value === 'number' && !Number.isNaN(value) ? value : 0;
}

async function processUsers(users: EligibleUser[], dryRun: boolean) {
  const summary = {
    totalUsers: users.length,
    badgeGranted: 0,
    slotIncreased: 0,
    skipped: 0,
    errors: 0,
    dryRun
  };

  for (const user of users) {
    try {
      const alreadyHasBadge = await userHasBadge(user.user_id, EXCELLENT_REPORTER_TIER.badgeId);
      const beforeSlot = await getUserSlotCount(user.user_id);

      if (dryRun) {
        if (alreadyHasBadge) {
          summary.skipped += 1;
          console.log(
            `[dry-run] 用户 ${user.username} (ID: ${user.user_id}) 已拥有徽章，跳过授予和槽位增加`
          );
        } else {
          summary.badgeGranted += 1;
          summary.slotIncreased += 1;
          console.log(
            `[dry-run] 用户 ${user.username} (ID: ${user.user_id}) 将被授予徽章，槽位 ${beforeSlot} -> ${beforeSlot + EXCELLENT_REPORTER_TIER.slotIncrement}`
          );
        }
        continue;
      }

      if (alreadyHasBadge) {
        summary.skipped += 1;
        console.log(
          `用户 ${user.username} (ID: ${user.user_id}) 已拥有徽章，跳过授予和槽位变更`
        );
        continue;
      }

      const granted = await grantBadgeToUser(user.user_id, EXCELLENT_REPORTER_TIER.badgeId);
      if (!granted) {
        summary.errors += 1;
        console.error(`授予用户 ${user.username} (ID: ${user.user_id}) 徽章失败，已跳过槽位增加`);
        continue;
      }

      summary.badgeGranted += 1;

      const increased = await increaseUserSlotCount(user.user_id, EXCELLENT_REPORTER_TIER.slotIncrement);
      if (increased) {
        summary.slotIncreased += 1;
        const afterSlot = await getUserSlotCount(user.user_id);
        console.log(
          `用户 ${user.username} (ID: ${user.user_id}) 已处理：授予徽章，槽位 ${beforeSlot} -> ${afterSlot}`
        );
      } else {
        summary.errors += 1;
        console.error(`用户 ${user.username} (ID: ${user.user_id}) 槽位增加失败`);
      }
    } catch (error) {
      summary.errors += 1;
      console.error(`处理用户 ${user.username} (ID: ${user.user_id}) 时出错:`, error);
    }
  }

  return summary;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  console.log(
    `开始授予 ${EXCELLENT_REPORTER_TIER.badgeId} 徽章并增加槽位...${dryRun ? ' (dry-run 模式)' : ''}`
  );
  console.log(
    `规则：累计获赞 ≥${EXCELLENT_REPORTER_TIER.minTotalLikes}，累计被收藏 ≥${EXCELLENT_REPORTER_TIER.minTotalFavorites}，累计使用量 ≥${EXCELLENT_REPORTER_TIER.minTotalUsage}（仅统计公开且通过审查的数据卡）`
  );
  console.log(`奖励：授予徽章 + 槽位 +${EXCELLENT_REPORTER_TIER.slotIncrement}`);

  try {
    const totalPublicUsers = await countUsersWithPublicApprovedCards();
    const eligibleUsers = await findEligibleUsers();
    const ratio = totalPublicUsers > 0 ? eligibleUsers.length / totalPublicUsers : 0;
    console.log(`公开且通过审查的发卡用户：${totalPublicUsers}`);
    console.log(`本轮符合优秀记者条件的用户：${eligibleUsers.length}（占比 ${(ratio * 100).toFixed(1)}%）`);

    if (eligibleUsers.length === 0) {
      console.log('没有符合条件的用户，脚本结束。');
      return;
    }

    const summary = await processUsers(eligibleUsers, dryRun);

    console.log('处理完成。');
    console.table(summary);

    if (dryRun) {
      console.log('Dry-run 模式：未对数据库进行任何修改。');
    }
  } catch (error) {
    console.error('脚本执行失败:', error);
    process.exit(1);
  }
}

main();
