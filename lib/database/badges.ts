import { queryFromD1 } from './core';
import type { UserBadge, BadgeDefinition, ColorConfig, IconConfig } from '@/types/badge';

/**
 * 解析数据库中的 JSON 字段为类型化对象
 */
function parseJsonField<T>(jsonString: string | null): T | undefined {
  if (!jsonString) return undefined;
  try {
    return JSON.parse(jsonString) as T;
  } catch (e) {
    console.error('Failed to parse JSON field:', jsonString, e);
    return undefined;
  }
}

/**
 * 获取用户所有徽章（包含徽章定义）
 * @param userId 用户ID
 * @returns 用户徽章列表
 */
export async function getUserBadges(userId: number): Promise<UserBadge[]> {
  try {
    const result = await queryFromD1(
      `
      SELECT
        ub.id as ub_id,
        ub.user_id,
        ub.badge_id,
        ub.is_equipped,
        ub.display_order,
        ub.obtained_at,
        b.id as badge_id,
        b.name as badge_name,
        b.description as badge_description,
        b.icon as badge_icon,
        b.text_color,
        b.background_color,
        b.border_color,
        b.rarity,
        b.sort_order,
        b.is_active
      FROM user_badges ub
      JOIN badges b ON ub.badge_id = b.id
      WHERE ub.user_id = ? AND b.is_active = 1
      ORDER BY ub.is_equipped DESC, b.rarity DESC, b.sort_order ASC
      `,
      [userId]
    ) as any;

    if (!result.success || !result.result || !result.result[0]?.results) {
      return [];
    }

    const rows = result.result[0].results;
    return rows.map((row: any) => ({
      id: row.ub_id,
      userId: row.user_id,
      badgeId: row.badge_id,
      isEquipped: !!row.is_equipped,
      displayOrder: row.display_order || 0,
      obtainedAt: row.obtained_at,
      badge: {
        id: row.badge_id,
        name: row.badge_name,
        description: row.badge_description,
        icon: parseJsonField<IconConfig>(row.badge_icon) || { type: 'emoji', value: '🏅' },
        textColor: parseJsonField<ColorConfig>(row.text_color) || { type: 'solid', value: '#000000' },
        backgroundColor: parseJsonField<ColorConfig>(row.background_color) || { type: 'solid', value: '#FFFFFF' },
        borderColor: parseJsonField<ColorConfig>(row.border_color),
        rarity: row.rarity || 0,
        sortOrder: row.sort_order || 0,
        isActive: !!row.is_active
      }
    }));
  } catch (error) {
    console.error('获取用户徽章失败:', error);
    return [];
  }
}

/**
 * 获取用户已佩戴的徽章
 * @param userId 用户ID
 * @returns 已佩戴的徽章列表（最多5个）
 */
export async function getUserEquippedBadges(userId: number): Promise<UserBadge[]> {
  const allBadges = await getUserBadges(userId);
  return allBadges
    .filter(badge => badge.isEquipped)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .slice(0, 5);
}

/**
 * 更新用户佩戴的徽章
 * @param userId 用户ID
 * @param badgeIds 徽章ID数组（按顺序）
 * @returns 是否成功
 */
export async function updateEquippedBadges(
  userId: number,
  badgeIds: string[]
): Promise<boolean> {
  try {
    // 限制最多5个徽章
    const limitedBadgeIds = badgeIds.slice(0, 5);

    // 1. 先取消所有佩戴
    await queryFromD1(
      'UPDATE user_badges SET is_equipped = 0, display_order = 0 WHERE user_id = ?',
      [userId]
    );

    // 2. 设置新的佩戴徽章
    for (let i = 0; i < limitedBadgeIds.length; i++) {
      await queryFromD1(
        `UPDATE user_badges
         SET is_equipped = 1, display_order = ?
         WHERE user_id = ? AND badge_id = ?`,
        [i + 1, userId, limitedBadgeIds[i]]
      );
    }

    return true;
  } catch (error) {
    console.error('更新佩戴徽章失败:', error);
    return false;
  }
}

/**
 * 授予用户徽章
 * @param userId 用户ID
 * @param badgeId 徽章ID
 * @returns 是否成功
 */
export async function grantBadgeToUser(
  userId: number,
  badgeId: string
): Promise<boolean> {
  try {
    await queryFromD1(
      'INSERT OR IGNORE INTO user_badges (user_id, badge_id) VALUES (?, ?)',
      [userId, badgeId]
    );
    return true;
  } catch (error) {
    console.error('授予徽章失败:', error);
    return false;
  }
}

/**
 * 撤销用户徽章
 * @param userId 用户ID
 * @param badgeId 徽章ID
 * @returns 是否成功
 */
export async function revokeBadgeFromUser(
  userId: number,
  badgeId: string
): Promise<boolean> {
  try {
    await queryFromD1(
      'DELETE FROM user_badges WHERE user_id = ? AND badge_id = ?',
      [userId, badgeId]
    );
    return true;
  } catch (error) {
    console.error('撤销徽章失败:', error);
    return false;
  }
}

/**
 * 检查用户是否拥有某个徽章
 * @param userId 用户ID
 * @param badgeId 徽章ID
 * @returns 是否拥有
 */
export async function userHasBadge(
  userId: number,
  badgeId: string
): Promise<boolean> {
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
 * 获取所有可用的徽章定义
 * @returns 徽章定义列表
 */
export async function getAllBadges(): Promise<BadgeDefinition[]> {
  try {
    const result = await queryFromD1(
      `SELECT * FROM badges WHERE is_active = 1 ORDER BY rarity DESC, sort_order ASC`,
      []
    ) as any;

    if (!result.success || !result.result || !result.result[0]?.results) {
      return [];
    }

    const rows = result.result[0].results;
    return rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      icon: parseJsonField<IconConfig>(row.icon) || { type: 'emoji', value: '🏅' },
      textColor: parseJsonField<ColorConfig>(row.text_color) || { type: 'solid', value: '#000000' },
      backgroundColor: parseJsonField<ColorConfig>(row.background_color) || { type: 'solid', value: '#FFFFFF' },
      borderColor: parseJsonField<ColorConfig>(row.border_color),
      rarity: row.rarity || 0,
      sortOrder: row.sort_order || 0,
      isActive: !!row.is_active
    }));
  } catch (error) {
    console.error('获取徽章列表失败:', error);
    return [];
  }
}
