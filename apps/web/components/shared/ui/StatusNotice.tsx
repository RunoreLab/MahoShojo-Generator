'use client';

import type { ReactNode } from 'react';

import clsx from 'clsx';

export type StatusNoticeTone = 'info' | 'attention' | 'danger' | 'success';

const toneClass: Record<StatusNoticeTone, string> = {
  info: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-100',
  attention: 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100',
  danger: 'border-red-300 bg-red-50 text-red-950 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100',
  success: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100',
};

export type StatusNoticeProps = {
  readonly tone?: StatusNoticeTone;
  /** 默认 danger 走 assertive alert，其余为 polite status。 */
  readonly role?: 'status' | 'alert';
  /** 加粗导语：先说发生了什么/该怎么办。 */
  readonly title?: ReactNode;
  readonly children?: ReactNode;
  /** 底部动作区（按钮组由 ActionBar 承担）。 */
  readonly actions?: ReactNode;
  readonly className?: string;
  /** 紧凑内联样式（默认 false）。 */
  readonly compact?: boolean;
  /** 无障碍测试锚点。 */
  readonly testId?: string;
};

/**
 * 统一状态提示块：错误等级结构化（tone 决定视觉），不由 Emoji、
 * 字符串前缀或错误代码决定样式；错误代码等细节不应进入一级文案。
 */
export function StatusNotice({
  tone = 'info',
  role,
  title,
  children,
  actions,
  className,
  compact = false,
  testId,
}: StatusNoticeProps) {
  return (
    <div
      role={role ?? (tone === 'danger' ? 'alert' : 'status')}
      aria-live={role === 'alert' || tone === 'danger' ? 'assertive' : 'polite'}
      data-notice-tone={tone}
      {...(testId ? { 'data-testid': testId } : {})}
      className={clsx(
        'rounded-lg border text-sm',
        compact ? 'p-2' : 'p-3',
        toneClass[tone],
        className,
      )}
    >
      {title ? <p className="font-medium">{title}</p> : null}
      {children ? <div className={title ? 'mt-1' : undefined}>{children}</div> : null}
      {actions ? <div className="mt-2">{actions}</div> : null}
    </div>
  );
}

/** 行内礼貌 live region：用于“房间已连接”等轻量状态播报。 */
export function StatusLine({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className={clsx('min-h-6 text-sm text-gray-700 dark:text-gray-200', className)}>
      {children}
    </div>
  );
}
