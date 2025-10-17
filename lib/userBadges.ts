/**
 * 用户徽章相关工具函数
 */

import { authStorage } from './auth';
import type { UserBadge } from '@/types/badge';

/**
 * 获取当前用户的徽章数据
 * @returns 用户徽章数组，如果未登录或获取失败返回空数组
 */
export async function getUserBadges(): Promise<UserBadge[]> {
  try {
    const authHeader = await authStorage.getAuthHeader();
    if (!authHeader) {
      return [];
    }

    const response = await fetch('/api/badges/user', {
      headers: { 'Authorization': authHeader }
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        return data.badges;
      }
    }
    return [];
  } catch (error) {
    console.error('获取用户徽章失败:', error);
    return [];
  }
}

/**
 * 获取当前用户已佩戴的徽章
 * @returns 已佩戴的徽章数组，按显示顺序排序
 */
export async function getUserEquippedBadges(): Promise<UserBadge[]> {
  const allBadges = await getUserBadges();
  return allBadges
    .filter(badge => badge.isEquipped)
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

/**
 * 更新用户佩戴的徽章
 * @param badgeIds 徽章ID数组（按顺序）
 * @returns 是否成功
 */
export async function updateUserEquippedBadges(badgeIds: string[]): Promise<boolean> {
  try {
    const authHeader = await authStorage.getAuthHeader();
    if (!authHeader) {
      return false;
    }

    const response = await fetch('/api/badges/equip', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      },
      body: JSON.stringify({ badgeIds })
    });

    return response.ok;
  } catch (error) {
    console.error('更新佩戴徽章失败:', error);
    return false;
  }
}