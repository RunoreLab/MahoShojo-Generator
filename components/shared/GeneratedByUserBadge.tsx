import React from 'react';
import { useAuth } from '@/lib/useAuth';
import BadgeIcon from '@/components/badge/BadgeIcon';

type Variant = 'dark' | 'light';

interface GeneratedByUserBadgeProps {
  className?: string;
  variant?: Variant;
  label?: string;
}

export function GeneratedByUserBadge({
  className = '',
  variant = 'dark',
  label = '生成者：',
}: GeneratedByUserBadgeProps) {
  const { user, userBadges, isAuthenticated, loading } = useAuth();

  if (loading || !isAuthenticated || !user) return null;

  const baseTextClass = variant === 'light' ? 'text-gray-700' : 'text-white/85';
  const labelClass = variant === 'light' ? 'text-gray-500' : 'text-white/55';
  const iconClass = variant === 'light' ? 'text-gray-600' : 'text-white/70';

  const username = (user.username || '').trim() || `用户${user.id}`;
  const equippedBadges = (Array.isArray(userBadges) ? userBadges : [])
    .filter((badge) => badge.isEquipped)
    .sort((a, b) => a.displayOrder - b.displayOrder);

  return (
    <div className={['w-full text-center text-xs drop-shadow', baseTextClass, className].filter(Boolean).join(' ')}>
      <div className={['leading-tight', labelClass].filter(Boolean).join(' ')}>{label}</div>
      <div className="mt-0.5 inline-flex flex-wrap items-center justify-center gap-1.5">
        <span className="font-medium text-white/90">{username}</span>
        {equippedBadges.length > 0 && (
          <span className="inline-flex items-center gap-1">
            {equippedBadges.map((userBadge) => {
              const icon = userBadge.badge?.icon;
              if (!icon || icon.type === 'null') return null;
              return (
                <span key={userBadge.id} title={userBadge.badge?.name || '徽章'}>
                  <BadgeIcon icon={icon} size={12} className={iconClass} />
                </span>
              );
            })}
          </span>
        )}
      </div>
    </div>
  );
}

