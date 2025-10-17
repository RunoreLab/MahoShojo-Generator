/**
 * 用户头衔转徽章脚本
 *
 * 将用户原有的 prefix 头衔转换为对应的徽章，并插入数据库中
 *
 * 使用方法：
 * bun run scripts/convert-prefix-to-badges.ts [--dry-run]
 *
 * 选项：
 * --dry-run: 只显示转换预览，不实际执行数据库操作
 *
 * 注意：此脚本需要先在 badges 表中定义对应的徽章才能正常工作
 */

import { queryFromD1 } from '../lib/database/core';

interface User {
  id: number;
  username: string;
  prefix: string | null;
}

interface Badge {
  id: string;
  name: string;
  description: string;
  icon: any;
  textColor: any;
  backgroundColor: any;
  borderColor: any;
  rarity: number;
  sortOrder: number;
  isActive: boolean;
}

/**
 * 头衔到徽章的映射配置
 * 根据实际的头衔内容配置对应的徽章ID
 */
const PREFIX_TO_BADGE_MAP: Record<string, string> = {
  '创始人': 'founder',
  '金主': 'sponsor',
  '管理员': 'admin',
  '优秀记者': 'excellent_reporter',
  '最尊重雪绒': 'respect_xuerong',
  '群宝可梦大师': 'pokemon_master',
  '兄弟！不要乱搞了！': 'brother_calm_down',
  '无聊': 'bored',
  '魔法主厨': 'magic_chef'
};

/**
 * 解析用户头衔前缀字符串，提取头衔名称
 * 支持新旧格式的头衔字符串
 */
function parseTitleFromPrefix(prefix: string): string | null {
  if (!prefix || typeof prefix !== 'string') {
    return null;
  }

  let title = '';

  // 1. 新格式（用 | 分割）
  if (prefix.includes('|')) {
    const parts = prefix.split('|').map(p => p.trim());
    if (parts.length >= 2) {
      title = parts[1]; // 第二部分是头衔名称
    }
  }
  // 2. 旧格式（用 , 分割）
  else if (prefix.includes(',')) {
    const parts = prefix.split(',').map(p => p.trim());
    if (parts.length >= 1) {
      title = parts[0]; // 第一部分是头衔名称
    }
  }
  // 3. 纯文本格式
  else {
    title = prefix;
  }

  return title || null;
}

/**
 * 根据头衔名称获取对应的徽章ID
 */
function getBadgeIdByTitle(title: string): string | null {
  // 直接匹配
  if (PREFIX_TO_BADGE_MAP[title]) {
    return PREFIX_TO_BADGE_MAP[title];
  }

  // 模糊匹配
  for (const [key, badgeId] of Object.entries(PREFIX_TO_BADGE_MAP)) {
    if (title.includes(key) || key.includes(title)) {
      return badgeId;
    }
  }

  return null;
}

/**
 * 获取所有有头衔的用户
 */
async function getAllUsersWithPrefix(): Promise<User[]> {
  try {
    const result = await queryFromD1(
      'SELECT id, username, prefix FROM users WHERE prefix IS NOT NULL AND prefix != ""',
      []
    ) as any;

    if (result.success && result.result && result.result[0]?.results) {
      return result.result[0].results;
    }
    return [];
  } catch (error) {
    console.error('获取用户头衔失败:', error);
    return [];
  }
}

/**
 * 获取所有可用的徽章
 */
async function getAllAvailableBadges(): Promise<Badge[]> {
  try {
    const result = await queryFromD1(
      'SELECT id, name, description, icon, text_color, background_color, border_color, rarity, sort_order, is_active FROM badges WHERE is_active = 1',
      []
    ) as any;

    if (result.success && result.result && result.result[0]?.results) {
      return result.result[0].results;
    }
    return [];
  } catch (error) {
    console.error('获取徽章列表失败:', error);
    return [];
  }
}

/**
 * 检查用户是否已拥有某个徽章
 */
async function userHasBadge(userId: number, badgeId: string): Promise<boolean> {
  try {
    const result = await queryFromD1(
      'SELECT COUNT(*) as count FROM user_badges WHERE user_id = ? AND badge_id = ?',
      [userId, badgeId]
    ) as any;

    if (result.success && result.result && result.result[0]?.results?.length > 0) {
      return result.result[0].results[0].count > 0;
    }
    return false;
  } catch (error) {
    console.error('检查徽章拥有状态失败:', error);
    return false;
  }
}

/**
 * 授予徽章给用户
 */
async function grantBadgeToUser(userId: number, badgeId: string, displayOrder: number = 0): Promise<boolean> {
  try {
    const result = await queryFromD1(
      'INSERT OR IGNORE INTO user_badges (user_id, badge_id, is_equipped, display_order) VALUES (?, ?, 1, ?)',
      [userId, badgeId, displayOrder]
    ) as any;

    return result.success;
  } catch (error) {
    console.error('授予徽章失败:', error);
    return false;
  }
}

/**
 * 生成转换预览
 */
async function generateConversionPreview(): Promise<void> {
  console.log('🔍 开始生成转换预览...\n');

  const users = await getAllUsersWithPrefix();
  const badges = await getAllAvailableBadges();

  if (users.length === 0) {
    console.log('ℹ️  没有找到有头衔的用户');
    return;
  }

  console.log(`📊 找到 ${users.length} 个有头衔的用户`);
  console.log(`🏅 找到 ${badges.length} 个可用徽章`);
  console.log('\n转换预览：');
  console.log('━'.repeat(80));

  let conversionCount = 0;
  let skipCount = 0;

  for (const user of users) {
    const title = parseTitleFromPrefix(user.prefix!);
    if (!title) {
      console.log(`❌ 用户 ${user.username} (${user.id}): 无法解析头衔 "${user.prefix}"`);
      skipCount++;
      continue;
    }

    const badgeId = getBadgeIdByTitle(title);
    if (!badgeId) {
      console.log(`❌ 用户 ${user.username} (${user.id}): 头衔 "${title}" 没有对应的徽章`);
      skipCount++;
      continue;
    }

    const badge = badges.find(b => b.id === badgeId);
    if (!badge) {
      console.log(`❌ 用户 ${user.username} (${user.id}): 徽章 "${badgeId}" 不存在或未激活`);
      skipCount++;
      continue;
    }

    const alreadyHasBadge = await userHasBadge(user.id, badgeId);
    if (alreadyHasBadge) {
      console.log(`⚠️  用户 ${user.username} (${user.id}): 已拥有徽章 "${badge.name}" (${badgeId})`);
      skipCount++;
      continue;
    }

    console.log(`✅ 用户 ${user.username} (${user.id}): "${title}" → "${badge.name}" (${badgeId})`);
    conversionCount++;
  }

  console.log('━'.repeat(80));
  console.log(`📈 预计转换: ${conversionCount} 个用户`);
  console.log(`⏭️  跳过: ${skipCount} 个用户`);
}

/**
 * 执行转换操作
 */
async function executeConversion(): Promise<void> {
  console.log('🚀 开始执行转换操作...\n');

  const users = await getAllUsersWithPrefix();
  const badges = await getAllAvailableBadges();

  if (users.length === 0) {
    console.log('ℹ️  没有找到有头衔的用户');
    return;
  }

  console.log(`📊 找到 ${users.length} 个有头衔的用户`);
  console.log(`🏅 找到 ${badges.length} 个可用徽章`);
  console.log('\n开始转换：');
  console.log('━'.repeat(80));

  let successCount = 0;
  let failCount = 0;
  let skipCount = 0;

  for (const user of users) {
    const title = parseTitleFromPrefix(user.prefix!);
    if (!title) {
      console.log(`❌ 用户 ${user.username} (${user.id}): 无法解析头衔 "${user.prefix}"`);
      failCount++;
      continue;
    }

    const badgeId = getBadgeIdByTitle(title);
    if (!badgeId) {
      console.log(`❌ 用户 ${user.username} (${user.id}): 头衔 "${title}" 没有对应的徽章`);
      failCount++;
      continue;
    }

    const badge = badges.find(b => b.id === badgeId);
    if (!badge) {
      console.log(`❌ 用户 ${user.username} (${user.id}): 徽章 "${badgeId}" 不存在或未激活`);
      failCount++;
      continue;
    }

    const alreadyHasBadge = await userHasBadge(user.id, badgeId);
    if (alreadyHasBadge) {
      console.log(`⚠️  用户 ${user.username} (${user.id}): 已拥有徽章 "${badge.name}" (${badgeId})`);
      skipCount++;
      continue;
    }

    const success = await grantBadgeToUser(user.id, badgeId, successCount + 1);
    if (success) {
      console.log(`✅ 用户 ${user.username} (${user.id}): 成功授予徽章 "${badge.name}" (${badgeId})`);
      successCount++;
    } else {
      console.log(`❌ 用户 ${user.username} (${user.id}): 授予徽章失败`);
      failCount++;
    }
  }

  console.log('━'.repeat(80));
  console.log(`🎉 转换完成！`);
  console.log(`✅ 成功: ${successCount} 个用户`);
  console.log(`❌ 失败: ${failCount} 个用户`);
  console.log(`⏭️  跳过: ${skipCount} 个用户`);

  if (successCount > 0) {
    console.log('\n💡 提示：建议在转换完成后检查用户的徽章佩戴情况');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');

  console.log('🔧 用户头衔转徽章工具');
  console.log(`📋 模式: ${isDryRun ? '预览模式（不会执行实际操作）' : '执行模式'}`);
  console.log('');

  if (isDryRun) {
    await generateConversionPreview();
  } else {
    console.log('⚠️  即将开始转换操作，建议先使用 --dry-run 参数预览结果');
    console.log('确认继续？(y/N)');

    // 在实际环境中，这里可以添加用户确认逻辑
    // 为了自动化执行，我们直接继续
    console.log('开始执行转换...\n');
    await executeConversion();
  }
}

main().catch(error => {
  console.error('❌ 发生错误:', error);
  process.exit(1);
});