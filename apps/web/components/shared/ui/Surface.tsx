'use client';

import type { ElementType, HTMLAttributes } from 'react';

import clsx from 'clsx';

export type SurfaceTone = 'plain' | 'accent';

const toneClass: Record<SurfaceTone, string> = {
  plain: 'rounded-xl border border-gray-200 bg-white/80 dark:border-gray-700 dark:bg-gray-900/70',
  accent: 'rounded-xl border border-fuchsia-200 bg-fuchsia-50/70 dark:border-fuchsia-900 dark:bg-fuchsia-950/20',
};

export const surfaceClassName = (tone: SurfaceTone = 'plain', className?: string): string => (
  clsx(toneClass[tone], className)
);

/** 统一面板容器：边框/表面/圆角唯一来源，padding 与布局由调用方决定。 */
export function Surface({
  as = 'div',
  tone = 'plain',
  className,
  ...props
}: { as?: ElementType; tone?: SurfaceTone } & HTMLAttributes<HTMLElement>) {
  const Component = as;
  return <Component className={surfaceClassName(tone, className)} {...props} />;
}
