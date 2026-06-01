/**
 * 早期用户徽章授予脚本（高性能 SQL 版本）
 *
 * 功能：
 * - 为所有 2025 年注册的用户授予 forerunner（先驱者）徽章
 * - 为 2025 年 9 月注册的用户授予 old_exp（老经验）徽章
 *
 * 使用方法：
 * pnpm exec tsx scripts/badge/grant-early-adopters.ts [--dry-run]
 *
 * 参数：
 * --dry-run 或 -d: 试运行模式，只统计不实际授予
 *
 * 示例：
 * pnpm exec tsx scripts/badge/grant-early-adopters.ts           # 正式运行
 * pnpm exec tsx scripts/badge/grant-early-adopters.ts --dry-run # 试运行
 */

import { queryFromD1 } from '@/lib/database/core';

// 徽章配置
const FORERUNNER_BADGE_ID = 'forerunner';  // 先驱者徽章
const OLD_EXP_BADGE_ID = 'old_exp';        // 老经验徽章

// 时间范围配置
const YEAR_2025_START = '2025-01-01 00:00:00';
const YEAR_2025_END = '2025-12-31 23:59:59';
const SEPT_2025_START = '2025-09-01 00:00:00';
const SEPT_2025_END = '2025-09-30 23:59:59';

// 从命令行参数获取配置
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('-d');

console.log('🎖️  早期用户徽章授予脚本（高性能 SQL 版本）');
console.log('='.repeat(60));
console.log(`先驱者徽章 (${FORERUNNER_BADGE_ID}): 2025年注册的用户`);
console.log(`老经验徽章 (${OLD_EXP_BADGE_ID}): 2025年9月注册的用户`);
console.log(`模式: ${dryRun ? '试运行 (不会实际更新数据库)' : '正式运行'}`);
console.log('='.repeat(60));
console.log('');

/**
 * 统计符合条件且未拥有徽章的用户数
 */
async function countEligibleUsers(
  startDate: string,
  endDate: string,
  badgeId: string
): Promise<number> {
  try {
    const result = await queryFromD1(
      `
      SELECT COUNT(DISTINCT u.id) as count
      FROM users u
      WHERE u.created_at >= ? AND u.created_at <= ?
        AND NOT EXISTS (
          SELECT 1 FROM user_badges ub
          WHERE ub.user_id = u.id AND ub.badge_id = ?
        )
      `,
      [startDate, endDate, badgeId]
    ) as any;

    if (result.success && result.result && result.result[0]?.results?.[0]) {
      return result.result[0].results[0].count || 0;
    }
    return 0;
  } catch (error) {
    console.error('统计用户数失败:', error);
    return 0;
  }
}

/**
 * 统计时间范围内注册的总用户数
 */
async function countTotalUsers(
  startDate: string,
  endDate: string
): Promise<number> {
  try {
    const result = await queryFromD1(
      `SELECT COUNT(*) as count FROM users WHERE created_at >= ? AND created_at <= ?`,
      [startDate, endDate]
    ) as any;

    if (result.success && result.result && result.result[0]?.results?.[0]) {
      return result.result[0].results[0].count || 0;
    }
    return 0;
  } catch (error) {
    console.error('统计总用户数失败:', error);
    return 0;
  }
}

/**
 * 统计已拥有徽章的用户数
 */
async function countUsersWithBadge(
  startDate: string,
  endDate: string,
  badgeId: string
): Promise<number> {
  try {
    const result = await queryFromD1(
      `
      SELECT COUNT(DISTINCT u.id) as count
      FROM users u
      INNER JOIN user_badges ub ON u.id = ub.user_id
      WHERE u.created_at >= ? AND u.created_at <= ?
        AND ub.badge_id = ?
      `,
      [startDate, endDate, badgeId]
    ) as any;

    if (result.success && result.result && result.result[0]?.results?.[0]) {
      return result.result[0].results[0].count || 0;
    }
    return 0;
  } catch (error) {
    console.error('统计已拥有徽章用户数失败:', error);
    return 0;
  }
}

/**
 * 高性能批量授予徽章（使用 INSERT SELECT）
 */
async function fastAwardBadges(
  badgeId: string,
  startDate: string,
  endDate: string
): Promise<{ success: boolean; awarded: number; alreadyOwned: number; total: number }> {

  console.log(`  📊 统计符合条件的用户...`);

  // 先统计各项数据
  const totalUsers = await countTotalUsers(startDate, endDate);
  const alreadyOwned = await countUsersWithBadge(startDate, endDate, badgeId);
  const eligibleUsers = await countEligibleUsers(startDate, endDate, badgeId);

  console.log(`  📈 统计结果:`);
  console.log(`     - 时间范围内总用户数: ${totalUsers}`);
  console.log(`     - 已拥有该徽章: ${alreadyOwned}`);
  console.log(`     - 将要授予: ${eligibleUsers}`);

  if (eligibleUsers === 0) {
    console.log(`  ℹ️  没有需要授予徽章的用户`);
    return { success: true, awarded: 0, alreadyOwned, total: totalUsers };
  }

  if (dryRun) {
    console.log(`  [试运行] 将为 ${eligibleUsers} 个用户授予徽章`);
    return { success: true, awarded: eligibleUsers, alreadyOwned, total: totalUsers };
  }

  // 执行批量授予
  console.log(`  🎖️  正在批量授予徽章...`);

  try {
    // 使用 INSERT SELECT 直接在数据库内完成操作
    const sql = `
      INSERT OR IGNORE INTO user_badges (user_id, badge_id)
      SELECT id, ? FROM users
      WHERE created_at >= ? AND created_at <= ?
    `;

    const result = await queryFromD1(sql, [badgeId, startDate, endDate]) as any;

    if (result.success) {
      console.log(`  ✓ 批量授予成功！`);
      return { success: true, awarded: eligibleUsers, alreadyOwned, total: totalUsers };
    } else {
      console.error(`  ✗ 批量授予失败:`, result.error);
      return { success: false, awarded: 0, alreadyOwned, total: totalUsers };
    }
  } catch (error) {
    console.error(`  ✗ 批量授予异常:`, error);
    return { success: false, awarded: 0, alreadyOwned, total: totalUsers };
  }
}

/**
 * 主函数
 */
async function main() {
  try {
    // 1. 授予先驱者徽章（2025 年注册的用户）
    console.log(`🎖️  处理先驱者徽章 (${FORERUNNER_BADGE_ID})`);
    console.log('-'.repeat(60));
    const forerunnerResult = await fastAwardBadges(
      FORERUNNER_BADGE_ID,
      YEAR_2025_START,
      YEAR_2025_END
    );
    console.log('-'.repeat(60));
    console.log('');

    // 2. 授予老经验徽章（2025 年 9 月注册的用户）
    console.log(`🎖️  处理老经验徽章 (${OLD_EXP_BADGE_ID})`);
    console.log('-'.repeat(60));
    const oldExpResult = await fastAwardBadges(
      OLD_EXP_BADGE_ID,
      SEPT_2025_START,
      SEPT_2025_END
    );
    console.log('-'.repeat(60));
    console.log('');

    // 3. 输出统计结果
    console.log('');
    console.log('✨ 执行完成！统计结果：');
    console.log('='.repeat(60));
    console.log(`先驱者徽章 (${FORERUNNER_BADGE_ID}):`);
    console.log(`  - 时间范围用户总数: ${forerunnerResult.total}`);
    console.log(`  - 新授予: ${forerunnerResult.awarded} 个用户`);
    console.log(`  - 已拥有: ${forerunnerResult.alreadyOwned} 个用户`);
    console.log(`  - 状态: ${forerunnerResult.success ? '✓ 成功' : '✗ 失败'}`);
    console.log('');
    console.log(`老经验徽章 (${OLD_EXP_BADGE_ID}):`);
    console.log(`  - 时间范围用户总数: ${oldExpResult.total}`);
    console.log(`  - 新授予: ${oldExpResult.awarded} 个用户`);
    console.log(`  - 已拥有: ${oldExpResult.alreadyOwned} 个用户`);
    console.log(`  - 状态: ${oldExpResult.success ? '✓ 成功' : '✗ 失败'}`);
    console.log('='.repeat(60));

    if (dryRun) {
      console.log('');
      console.log('ℹ️  这是试运行模式，没有实际修改数据库');
      console.log('   使用不带 --dry-run 参数运行以实际授予徽章');
    }

    // 如果有失败的操作，退出码为 1
    if (!forerunnerResult.success || !oldExpResult.success) {
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ 脚本执行失败:', error);
    process.exit(1);
  }
}

// 运行主函数
main().catch((error) => {
  console.error('❌ 未处理的错误:', error);
  process.exit(1);
});
