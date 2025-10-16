/**
 * 优秀记者奖励脚本
 *
 * 功能：
 * - 查找发表过公开且通过审查的数据卡，并且点赞量 >= minLikes，下载量 >= minDownloads 的用户
 * - 将这些用户的头衔设置为 '优秀记者,#fff9fd,#ff0073'
 * - 将这些用户的数据卡槽位在原来的基础上增加 slotIncrement
 *
 * 使用方法：
 * bun run scripts/award-excellent-reporters.ts [minLikes] [minDownloads] [slotIncrement]
 *
 * 或使用 npm script:
 * npm run award-reporters [minLikes] [minDownloads] [slotIncrement]
 *
 * 示例：
 * bun run scripts/award-excellent-reporters.ts 3 20 128
 * npm run award-reporters 3 20 128
 */

import { queryFromD1 } from '../lib/database/core';

// 默认参数
const DEFAULT_MIN_LIKES = 3;
const DEFAULT_MIN_DOWNLOADS = 20;
const DEFAULT_SLOT_INCREMENT = 128;
const EXCELLENT_REPORTER_PREFIX = '优秀记者,#fff9fd,#ff0073';

// 从命令行参数获取配置，如果没有提供则使用默认值
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('-d');
const filteredArgs = args.filter(arg => arg !== '--dry-run' && arg !== '-d');

const minLikes = parseInt(filteredArgs[0]) || DEFAULT_MIN_LIKES;
const minDownloads = parseInt(filteredArgs[1]) || DEFAULT_MIN_DOWNLOADS;
const slotIncrement = parseInt(filteredArgs[2]) || DEFAULT_SLOT_INCREMENT;

console.log('🎖️  优秀记者奖励脚本');
console.log('='.repeat(50));
console.log(`最小点赞数: ${minLikes}`);
console.log(`最小下载量: ${minDownloads}`);
console.log(`槽位增加量: ${slotIncrement}`);
console.log(`头衔: ${EXCELLENT_REPORTER_PREFIX}`);
console.log(`模式: ${dryRun ? '试运行 (不会实际更新数据库)' : '正式运行'}`);
console.log('='.repeat(50));
console.log('');

interface EligibleUser {
  user_id: number;
  username: string;
  current_prefix: string | null;
  current_slot_count: number | null;
  card_count: number;
  total_likes: number;
  total_downloads: number;
}

/**
 * 查找符合条件的用户
 * 条件：至少有一张公开且通过审查的数据卡，并且点赞数 >= minLikes，下载量 >= minDownloads
 */
async function findEligibleUsers(): Promise<EligibleUser[]> {
  try {
    console.log('🔍 正在查找符合条件的用户...\n');

    // 查询符合条件的用户
    // 条件：至少有一张公开且通过审查的数据卡，点赞数 >= minLikes，下载量 >= minDownloads
    const sql = `
      SELECT
        u.id as user_id,
        u.username,
        u.prefix as current_prefix,
        u.slot_count as current_slot_count,
        COUNT(DISTINCT dc.id) as card_count,
        SUM(dc.like_count) as total_likes,
        SUM(dc.usage_count) as total_downloads
      FROM users u
      INNER JOIN data_cards dc ON u.id = dc.user_id
      WHERE dc.is_public = 1
        AND dc.review_status = 'approved'
        AND dc.like_count >= ?
        AND dc.usage_count >= ?
      GROUP BY u.id, u.username, u.prefix, u.slot_count
    `;

    const result = await queryFromD1(sql, [minLikes, minDownloads]) as any;

    if (result.success && result.result && result.result[0]?.results) {
      return result.result[0].results as EligibleUser[];
    }

    return [];
  } catch (error) {
    console.error('❌ 查找用户失败:', error);
    throw error;
  }
}

/**
 * 更新用户的头衔和槽位
 */
async function updateUser(userId: number, currentSlotCount: number | null): Promise<boolean> {
  try {
    // 计算新的槽位数量
    // 如果当前槽位为 null 或 0，则设置为 slotIncrement
    // 否则在当前基础上增加 slotIncrement
    const newSlotCount = (currentSlotCount && currentSlotCount > 0)
      ? currentSlotCount + slotIncrement
      : slotIncrement;

    const sql = `
      UPDATE users
      SET prefix = ?,
          slot_count = ?
      WHERE id = ?
    `;

    const result = await queryFromD1(sql, [
      EXCELLENT_REPORTER_PREFIX,
      newSlotCount,
      userId
    ]) as any;

    return result.success && result.result && result.result[0]?.meta?.changes > 0;
  } catch (error) {
    console.error(`❌ 更新用户 ${userId} 失败:`, error);
    return false;
  }
}

/**
 * 主函数
 */
async function main() {
  try {
    // 1. 查找符合条件的用户
    const eligibleUsers = await findEligibleUsers();

    if (eligibleUsers.length === 0) {
      console.log('✅ 没有找到符合条件的用户。');
      return;
    }

    console.log(`✅ 找到 ${eligibleUsers.length} 位符合条件的用户：\n`);

    // 显示用户信息
    eligibleUsers.forEach((user, index) => {
      console.log(`${index + 1}. 用户ID: ${user.user_id}`);
      console.log(`   用户名: ${user.username}`);
      console.log(`   当前头衔: ${user.current_prefix || '(无)'}`);
      console.log(`   当前槽位: ${user.current_slot_count || 0}`);
      console.log(`   符合条件的卡片数: ${user.card_count}`);
      console.log(`   总点赞数: ${user.total_likes}`);
      console.log(`   总下载量: ${user.total_downloads}`);
      console.log('');
    });

    // 2. 更新用户信息
    if (dryRun) {
      console.log('⚠️  试运行模式：不会实际更新数据库\n');
    } else {
      console.log('🔄 开始更新用户信息...\n');
    }

    let successCount = 0;
    let failCount = 0;

    for (const user of eligibleUsers) {
      const newSlotCount = (user.current_slot_count && user.current_slot_count > 0)
        ? user.current_slot_count + slotIncrement
        : slotIncrement;

      console.log(`${dryRun ? '[试运行] ' : ''}正在更新用户 ${user.username} (ID: ${user.user_id})...`);
      console.log(`  槽位: ${user.current_slot_count || 0} → ${newSlotCount}`);

      if (dryRun) {
        console.log(`  ⚠️  试运行模式：跳过实际更新`);
        successCount++;
      } else {
        const success = await updateUser(user.user_id, user.current_slot_count);

        if (success) {
          console.log(`  ✅ 更新成功`);
          successCount++;
        } else {
          console.log(`  ❌ 更新失败`);
          failCount++;
        }
      }
      console.log('');
    }

    // 3. 显示统计信息
    console.log('='.repeat(50));
    console.log('📊 更新统计：');
    console.log(`总用户数: ${eligibleUsers.length}`);
    console.log(`成功: ${successCount}`);
    console.log(`失败: ${failCount}`);
    console.log('='.repeat(50));

    if (successCount > 0) {
      console.log('');
      if (dryRun) {
        console.log('⚠️  这是试运行结果。要实际更新数据库，请不带 --dry-run 参数重新运行脚本。');
      } else {
        console.log('🎉 已成功为优秀记者授予奖励！');
      }
    }

  } catch (error) {
    console.error('❌ 脚本执行失败:', error);
    process.exit(1);
  }
}

// 执行主函数
main();

/*
使用说明：

1. 试运行模式（推荐先运行查看结果）：
   bun run scripts/award-excellent-reporters.ts --dry-run
   bun run scripts/award-excellent-reporters.ts 3 20 128 --dry-run

2. 正式运行（会实际更新数据库）：
   bun run scripts/award-excellent-reporters.ts
   bun run scripts/award-excellent-reporters.ts 3 20 128

3. 使用 npm script：
   npm run award-reporters -- --dry-run
   npm run award-reporters -- 3 20 128 --dry-run
   npm run award-reporters

参数说明：
- 第1个参数：最小点赞数（默认：3）
- 第2个参数：最小下载量（默认：20）
- 第3个参数：槽位增加量（默认：128）
- --dry-run 或 -d：试运行模式，不会实际更新数据库

注意事项：
- 脚本会查找至少有一张公开且通过审查的数据卡，并且该卡的点赞数 >= minLikes，下载量 >= minDownloads 的用户
- 符合条件的用户将获得头衔"优秀记者,#fff9fd,#ff0073"，并增加数据卡槽位
- 建议先使用 --dry-run 参数进行测试，确认无误后再正式运行
*/
