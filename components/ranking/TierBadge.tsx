'use client';

import { useMemo } from 'react';

type Props = {
  tier: string;
  className?: string;
};

const baseClassName =
  'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap';

export function TierBadge({ tier, className }: Props) {
  const tierClassName = useMemo(() => {
    switch (tier) {
      case '无牌':
        return 'bg-gray-100 text-gray-700 border-gray-200';
      case '白牌':
        return 'bg-white text-gray-800 border-gray-300';
      case '字牌':
        return 'bg-sky-50 text-sky-800 border-sky-200';
      case '花牌':
        return 'bg-pink-50 text-pink-800 border-pink-200';
      case '权杖':
        return 'bg-gradient-to-r from-amber-200 via-yellow-100 to-amber-50 text-amber-950 border-amber-300 shadow-sm';
      default:
        return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  }, [tier]);

  return <span className={[baseClassName, tierClassName, className].filter(Boolean).join(' ')}>{tier}</span>;
}

