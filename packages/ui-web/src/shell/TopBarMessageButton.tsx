import { Bell } from 'lucide-react';

import type { CapabilityAvailability } from '../capability/index';

import {
  describeUnavailableReason,
  TOPBAR_MESSAGES_HREF,
  type TopBarNavigate,
} from './topbar-contract';

interface TopBarMessageButtonProps {
  /** 宿主对 `/messages` 的能力快照；`available` 才渲染真实链接。 */
  availability: CapabilityAvailability;
  /**
   * 宿主已查询的未读摘要（仅已登录且有数据时注入）。
   * 缺省 = "入口在但宿主没有消息数据"：渲染无角标入口，绝不伪造未读数——
   * Web 在未登录时不传，Desktop 在消息查询接入前也不传。
   */
  summary?: { readonly unreadTotal: number; readonly hasCrowdReviewPending: boolean };
  onNavigate: TopBarNavigate;
  /** 不可用处置：`'hide'` 整个隐藏、`'explain'` 置灰保留并说明原因（与导航入口同策略）。 */
  unavailable?: 'hide' | 'explain';
}

/**
 * 顶栏消息中心入口（自 `apps/web` 上移，DOM/文案逐字保留）。
 *
 * 与 Web 版唯一差别是数据来源：`useTopBarMessages` 变成宿主注入的 `summary`；
 * 路由未交付时按能力快照渲染禁用入口而非死链。
 */
export function TopBarMessageButton({ availability, summary, onNavigate, unavailable = 'hide' }: TopBarMessageButtonProps) {
  const linkClassName =
    'inline-flex h-9 items-center gap-1.5 rounded-full border border-white/50 bg-white/70 px-3 text-sm font-medium text-gray-700 shadow-sm backdrop-blur transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-200 dark:border-slate-600/60 dark:bg-slate-900/70 dark:text-slate-100';

  if (availability.kind !== 'available') {
    if (unavailable === 'hide') return null;
    return (
      <span
        aria-disabled="true"
        title={describeUnavailableReason(availability, false)}
        className={`${linkClassName} cursor-not-allowed opacity-50`}
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        <span className="hidden lg:inline">消息</span>
      </span>
    );
  }

  const unreadTotal = summary?.unreadTotal ?? 0;
  const hasCrowdReviewPending = summary?.hasCrowdReviewPending ?? false;
  const displayUnread = unreadTotal > 99 ? '99+' : String(unreadTotal);

  return (
    <a
      href={TOPBAR_MESSAGES_HREF}
      onClick={(event) => onNavigate(TOPBAR_MESSAGES_HREF, event)}
      aria-label="消息中心"
      title="消息中心"
      className={linkClassName}
    >
      <Bell className="h-4 w-4" aria-hidden="true" />
      <span className="hidden lg:inline">消息</span>
      {unreadTotal > 0 ? (
        <>
          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-pink-600 px-1.5 text-[11px] font-semibold leading-5 text-white">
            {displayUnread}
          </span>
          <span className="sr-only">{`${unreadTotal} 条未读`}</span>
        </>
      ) : null}
      {unreadTotal === 0 && hasCrowdReviewPending ? (
        <span className="inline-flex h-2 w-2 rounded-full bg-pink-400" aria-hidden="true" />
      ) : null}
    </a>
  );
}
