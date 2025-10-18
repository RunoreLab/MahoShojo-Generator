#!/usr/bin/env bun

import { queryFromD1 } from '@/lib/database/core';
import { grantBadgeToUser, userHasBadge } from '@/lib/database/badges';
import { increaseUserSlotCount } from '@/lib/database/users';

interface EligibleUser {
  user_id: number;
  username: string;
  qualified_cards: number;
}

async function findEligibleUsers(): Promise<EligibleUser[]> {
  const sql = `
    SELECT dc.user_id, u.username, COUNT(dc.id) AS qualified_cards
    FROM data_cards dc
    JOIN users u ON u.id = dc.user_id
    WHERE dc.is_public = 1
      AND dc.review_status = 'approved'
      AND dc.like_count >= 3
      AND dc.usage_count >= 20
    GROUP BY dc.user_id, u.username
  `;

  const queryResult = await queryFromD1(sql, []);
  const result = queryResult as { success?: boolean; result?: Array<{ results?: any[] }> };

  if (!result.success || !result.result || !result.result[0]?.results) {
    return [];
  }

  return result.result[0].results.map((row: any) => ({
    user_id: row.user_id,
    username: row.username,
    qualified_cards: row.qualified_cards
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
  const badgeId = 'excellent_reporter';
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
      const alreadyHasBadge = await userHasBadge(user.user_id, badgeId);
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
            `[dry-run] 用户 ${user.username} (ID: ${user.user_id}) 将被授予徽章，槽位 ${beforeSlot} -> ${beforeSlot + 128}`
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

      const granted = await grantBadgeToUser(user.user_id, badgeId);
      if (!granted) {
        summary.errors += 1;
        console.error(`授予用户 ${user.username} (ID: ${user.user_id}) 徽章失败，已跳过槽位增加`);
        continue;
      }

      summary.badgeGranted += 1;

      const increased = await increaseUserSlotCount(user.user_id, 128);
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

  console.log(`开始授予 excellent_reporter 徽章并增加槽位...${dryRun ? ' (dry-run 模式)' : ''}`);

  try {
    const eligibleUsers = await findEligibleUsers();
    console.log(`共找到 ${eligibleUsers.length} 位符合条件的用户。`);

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
