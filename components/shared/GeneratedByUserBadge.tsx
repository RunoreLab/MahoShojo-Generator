import React from 'react';
import { useAuth } from '@/lib/useAuth';
import Badge from '@/components/badge/Badge';

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
  const usernameClass = variant === 'light' ? 'text-gray-800' : 'text-white/90';

  const username = (user.username || '').trim() || `用户${user.id}`;
  const equippedBadges = (Array.isArray(userBadges) ? userBadges : [])
    .filter((badge) => badge.isEquipped)
    .sort((a, b) => a.displayOrder - b.displayOrder);

  return (
    <div className={['w-full text-center text-xs drop-shadow', baseTextClass, className].filter(Boolean).join(' ')}>
      <div className={['leading-tight', labelClass].filter(Boolean).join(' ')}>{label}</div>
      <div className="mt-1 inline-flex flex-wrap items-center justify-center gap-1.5">
        <span className={['font-medium', usernameClass].filter(Boolean).join(' ')}>{username}</span>
      </div>
      {equippedBadges.length > 0 && (
        <div className="mt-2 inline-flex max-w-full flex-wrap items-center justify-center gap-1.5">
          {equippedBadges.map((userBadge) => (
            <Badge key={userBadge.id} badge={userBadge.badge} size="sm" className="opacity-95" />
          ))}
        </div>
      )}
    </div>
  );
}

