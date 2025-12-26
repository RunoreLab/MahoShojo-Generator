import React from 'react';
import { UserWithTitle } from '@/components/UserTitle';
import { useAuth } from '@/lib/useAuth';

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

  const baseTextClass = variant === 'light' ? 'text-gray-700' : 'text-gray-100';
  const baseBgClass =
    variant === 'light'
      ? 'bg-white/85 border-gray-200'
      : 'bg-black/30 border-white/15';

  const username = (user.username || '').trim() || `用户${user.id}`;
  const badges = Array.isArray(userBadges) ? userBadges : [];

  return (
    <div
      className={[
        'inline-flex items-center gap-2 rounded-lg border px-3 py-1 text-xs',
        baseTextClass,
        baseBgClass,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="opacity-80">{label}</span>
      <UserWithTitle
        username={username}
        prefix={user.prefix}
        badges={badges}
        showBadges={true}
        usernameClassName="font-semibold"
      />
    </div>
  );
}

