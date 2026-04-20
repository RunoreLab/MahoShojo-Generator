'use client';

import Link from 'next/link';

type ArenaPageLinksProps = {
  variant: 'lite' | 'full';
  className?: string;
};

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
    </div>
  );
}
