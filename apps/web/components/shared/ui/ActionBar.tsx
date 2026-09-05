'use client';

import type { HTMLAttributes } from 'react';

import clsx from 'clsx';

/** 统一按钮组容器：允许换行但由调用方控制分区，主操作不依赖 flex-wrap 碰运气排版。 */
export function ActionBar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx('flex flex-wrap items-center gap-2', className)} {...props} />;
}
