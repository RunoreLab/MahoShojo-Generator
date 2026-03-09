/**
 * 头衔转徽章配置示例脚本
 *
 * 此脚本用于创建示例徽章数据，演示如何将用户头衔转换为徽章
 * 运行此脚本会在 badges 表中插入基础的徽章定义
 */

import { listExistingBadgeIds, upsertBadgeDefinition } from '@/lib/database/badges-maintenance';

interface BadgeDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  textColor: string;
  backgroundColor: string;
  borderColor?: string;
  rarity: number;
  sortOrder: number;
}

/**
 * 基础徽章定义
 * 根据项目需求定义各种头衔对应的徽章
 */
const BADGE_DEFINITIONS: BadgeDefinition[] = [
  {
    id: 'sponsor',
    name: '金主大人',
    description: '感谢金主大人的支持！',
    icon: '{"type":"lucide","name":"Heart"}',
    textColor: '{"type":"solid","value":"#FFFFFF"}',
    backgroundColor: '{"type":"gradient","value":"linear-gradient(135deg, #f093fb, #f5576c)"}',
    borderColor: '{"type":"solid","value":"#E91E63"}',
    rarity: 80,
    sortOrder: 2,
  },
];

/**
 * 检查徽章是否已存在
 */
async function badgeExists(badgeId: string): Promise<boolean> {
  try {
    const ids = await listExistingBadgeIds([badgeId]);
    return ids.includes(badgeId);
  } catch (error) {
    console.error('检查徽章存在性失败:', error);
    return false;
  }
}

/**
 * 插入徽章定义
 */
async function insertBadge(badge: BadgeDefinition): Promise<boolean> {
  try {
    await upsertBadgeDefinition({
      id: badge.id,
      name: badge.name,
      description: badge.description,
      icon: badge.icon,
      textColor: badge.textColor,
      backgroundColor: badge.backgroundColor,
      borderColor: badge.borderColor ?? null,
      rarity: badge.rarity,
      sortOrder: badge.sortOrder,
      isActive: true,
    });
    return true;
  } catch (error) {
    console.error('插入徽章失败:', error);
    return false;
  }
}

/**
 * 更新现有徽章
 */
async function updateBadge(badge: BadgeDefinition): Promise<boolean> {
  try {
    await upsertBadgeDefinition({
      id: badge.id,
      name: badge.name,
      description: badge.description,
      icon: badge.icon,
      textColor: badge.textColor,
      backgroundColor: badge.backgroundColor,
      borderColor: badge.borderColor ?? null,
      rarity: badge.rarity,
      sortOrder: badge.sortOrder,
      isActive: true,
    });
    return true;
  } catch (error) {
    console.error('更新徽章失败:', error);
    return false;
  }
}

async function main() {
  console.log('🏅 徽章定义初始化脚本');
  console.log('');

  console.log(`📋 准备处理 ${BADGE_DEFINITIONS.length} 个徽章定义`);
  console.log('');

  let insertCount = 0;
  let updateCount = 0;
  let errorCount = 0;

  for (const badge of BADGE_DEFINITIONS) {
    const exists = await badgeExists(badge.id);

    if (exists) {
      const success = await updateBadge(badge);
      if (success) {
        console.log(`✅ 更新徽章: ${badge.name} (${badge.id})`);
        updateCount++;
      } else {
        console.log(`❌ 更新徽章失败: ${badge.name} (${badge.id})`);
        errorCount++;
      }
    } else {
      const success = await insertBadge(badge);
      if (success) {
        console.log(`✅ 插入徽章: ${badge.name} (${badge.id})`);
        insertCount++;
      } else {
        console.log(`❌ 插入徽章失败: ${badge.name} (${badge.id})`);
        errorCount++;
      }
    }
  }

  console.log('');
  console.log('━'.repeat(60));
  console.log('📊 处理完成统计：');
  console.log(`✅ 新增: ${insertCount} 个徽章`);
  console.log(`🔄 更新: ${updateCount} 个徽章`);
  console.log(`❌ 失败: ${errorCount} 个徽章`);

  if (errorCount === 0) {
    console.log('');
    console.log('🎉 徽章定义初始化成功！');
    console.log('💡 现在可以运行以下命令转换用户头衔：');
    console.log('   bun run scripts/convert-prefix-to-badges.ts --dry-run');
    console.log('   bun run scripts/convert-prefix-to-badges.ts');
  } else {
    console.log('');
    console.log('⚠️  部分徽章处理失败，请检查错误信息');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ 发生错误:', error);
  process.exit(1);
});
