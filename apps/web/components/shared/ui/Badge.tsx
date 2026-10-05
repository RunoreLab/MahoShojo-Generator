'use client';

import type { ReactNode } from 'react';

import clsx from 'clsx';

export type BadgeTone = 'accent' | 'neutral';

const toneClass: Record<BadgeTone, string> = {
  accent: 'border-fuchsia-300 text-fuchsia-900 dark:border-fuchsia-700 dark:text-fuchsia-100',
  neutral: 'border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-300',
};

/** 统一 pill 徽标：状态标签、计数标记等非按钮语义的小型元数据。 */
export function Badge({
  tone = 'accent',
  children,
  className,
}: {
  readonly tone?: BadgeTone;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <span className={clsx('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', toneClass[tone], className)}>
      {children}
    </span>
  );
}

/** 附加在按钮上的计数气泡（如待处理提案数）。 */
export function CountBadge({ count, max = 99 }: { readonly count: number; readonly max?: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden="true"
      className="absolute -right-2 -top-2 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold leading-none text-white ring-2 ring-white dark:ring-gray-900"
    >
      {count > max ? `${max}+` : count}
    </span>
  );
}
