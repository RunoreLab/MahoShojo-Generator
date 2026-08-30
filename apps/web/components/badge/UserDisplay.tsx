import React from 'react';
import UserTitle from '../UserTitle';
import Badge from './Badge';
import type { UserDisplayInfo } from '@/types/badge';

interface UserDisplayProps {
  userInfo: UserDisplayInfo;
  showBadges?: boolean;  // 是否显示徽章
  className?: string;
  usernameClassName?: string;
}

/**
 * 用户展示组件
 * 统一展示用户名、头衔和徽章（最多5个）
 */
export default function UserDisplay({
  userInfo,
  showBadges = true,
  className = '',
  usernameClassName = ''
}: UserDisplayProps) {
  // 按显示顺序排序并限制最多5个徽章
  const sortedBadges = [...userInfo.equippedBadges]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .slice(0, 5);

  return (
    <div className={`inline-flex items-center gap-2 flex-wrap ${className}`}>
      {/* 用户名 */}
      <span className={`font-semibold ${usernameClassName}`}>{userInfo.username}</span>

      {/* 头衔 */}
      {userInfo.prefix && <UserTitle prefix={userInfo.prefix} />}

      {/* 徽章列表 */}
      {showBadges && sortedBadges.length > 0 && (
        <div className="inline-flex items-center gap-1">
          {sortedBadges.map(userBadge => (
            <Badge
              key={userBadge.id}
              badge={userBadge.badge}
              size="sm"
            />
          ))}
        </div>
      )}
    </div>
  );
}
