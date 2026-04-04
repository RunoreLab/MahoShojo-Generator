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
        <Link href="/arena" className={className ?? 'text-blue-600 hover:underline font-semibold'}>
          进入完整版竞技场
        </Link>
        <Link href="/challenge" className={className ?? 'text-blue-600 hover:underline font-semibold'}>
          进入挑战模式
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Link href="/battle" className={className ?? 'text-blue-600 hover:underline font-semibold'}>
        切换到简洁版
      </Link>
      <Link href="/challenge" className={className ?? 'text-blue-600 hover:underline font-semibold'}>
        进入挑战模式
      </Link>
    </div>
  );
}
