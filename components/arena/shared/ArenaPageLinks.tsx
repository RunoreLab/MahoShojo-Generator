'use client';

import Link from 'next/link';

import { NAV_GROUPS } from '@/lib/navigation';

type ArenaPageLinksProps = {
  variant: 'lite' | 'full';
  className?: string;
};

const wantuArenaLink = NAV_GROUPS
  .flatMap((group) => group.items)
  .find((item) => item.label === '万途竞技场' && item.isExternal);

export function ArenaPageLinks({ variant, className }: ArenaPageLinksProps) {
  if (variant === 'lite') {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/arena" className={className ?? 'battle-lite-link font-semibold'}>
          进入完整版竞技场
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Link href="/battle" className={className ?? 'battle-lite-link font-semibold'}>
        切换到简洁版
      </Link>
      {wantuArenaLink ? (
        <a
          href={wantuArenaLink.href}
          target="_blank"
          rel="noopener noreferrer"
          className={className ?? 'battle-lite-link font-semibold'}
        >
          前往万途竞技场
        </a>
      ) : null}
    </div>
  );
}
