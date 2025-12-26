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

  const baseTextClass = variant === 'light' ? 'text-gray-800' : 'text-gray-100';
  const baseBgClass =
    variant === 'light'
      ? 'bg-white/90 border-black/10 shadow-sm'
      : 'bg-white/10 border-white/15 shadow-sm';

  const username = (user.username || '').trim() || `用户${user.id}`;
  const badges = Array.isArray(userBadges) ? userBadges : [];

  return (
    <div className={['w-full flex justify-center', className].filter(Boolean).join(' ')}>
      <div
        className={[
          'inline-flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full border px-4 py-2 text-xs backdrop-blur-sm',
          baseTextClass,
          baseBgClass,
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
    </div>
  );
}

