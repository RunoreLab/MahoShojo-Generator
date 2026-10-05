'use client';

import type { HTMLAttributes } from 'react';

import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * 统一按钮组容器：默认允许换行但由调用方控制分区，主操作不依赖 flex-wrap 碰运气排版。
 * className 中的 flex-wrap/flex-nowrap 等冲突类经 tailwind-merge 正确覆盖。
 */
export function ActionBar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={twMerge(clsx('flex flex-wrap items-center gap-2', className))} {...props} />;
}
