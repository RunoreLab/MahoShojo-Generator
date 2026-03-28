'use client';

import Link from 'next/link';

type ArenaPageLinksProps = {
  variant: 'lite' | 'full';
  className?: string;
};

export function ArenaPageLinks({ variant, className }: ArenaPageLinksProps) {
  if (variant === 'lite') {
    return (
      <Link href="/arena" className={className ?? 'text-blue-600 hover:underline font-semibold'}>
        进入完整版竞技场
      </Link>
    );
  }

  return (
    <Link href="/battle" className={className ?? 'text-blue-600 hover:underline font-semibold'}>
      切换到简洁版
    </Link>
  );
}
