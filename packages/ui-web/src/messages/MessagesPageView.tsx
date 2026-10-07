import type { ReactNode } from 'react';

import type { MessageFilter, MessagePreviewDto, MessageSummaryDto } from '@mahoshojo/contracts/messages';

import { CrowdReviewPromptCard } from './CrowdReviewPromptCard';
import { MessageCard } from './MessageCard';
import { MessageFilters } from './MessageFilters';
import type { MessageLinkHandlers } from './message-ui';

/**
 * 消息中心页面骨架（自 `apps/web` MessagesPage 上移，DOM/文案逐字保留）。
 *
 * 它是纯视图：传入已经按当前 viewer 归一好的可见字段（`visible*`），不
 * 知道数据从哪来——Web 的 fetch 控制器与 Desktop 的窄通道控制器各自
 * 负责取数、竞态与已读分发。
 *
 * `anonymousCta` 是匿名态 CTA 插槽：宿主自己决定它是什么——Web 是跳
 * 登录入口的链接，Desktop 是唤起系统浏览器授权流的按钮。
 */
export function MessagesPageView({
  isAuthenticated,
  appliedFilter,
  messages,
  nextCursor,
  loading,
  summary,
  error,
  emptyStateCopy,
  anonymousCta,
  onFilterChange,
  onMarkAllRead,
  onMarkRead,
  onLoadMore,
  onNavigate,
  onNavigateExternal,
  resolveInternalHref,
}: {
  readonly isAuthenticated: boolean;
  readonly appliedFilter: MessageFilter;
  readonly messages: readonly MessagePreviewDto[];
  readonly nextCursor: string | null;
  readonly loading: boolean;
  readonly summary: MessageSummaryDto | null;
  readonly error?: string | null | undefined;
  readonly emptyStateCopy: string;
  /** 匿名态 CTA 插槽；宿主提供跳转链接或授权按钮，缺省不渲染。 */
  readonly anonymousCta?: ReactNode;
  readonly onFilterChange: (filter: MessageFilter) => void;
  readonly onMarkAllRead: () => void;
  readonly onMarkRead: (id: string) => void;
  readonly onLoadMore: () => void;
} & MessageLinkHandlers) {
  const emptyDescription = isAuthenticated
    ? '这里会显示全站通知与定向消息。'
    : '登录后可查看定向通知；当前仅显示公开的全站通知。';

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(244,114,182,0.18),_transparent_38%),linear-gradient(180deg,_#fff8fb_0%,_#f8fafc_42%,_#eef2ff_100%)] px-4 pb-8 pt-4 text-gray-900 dark:bg-[radial-gradient(circle_at_top,_rgba(244,114,182,0.12),_transparent_32%),linear-gradient(180deg,_#020617_0%,_#111827_48%,_#0f172a_100%)] dark:text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <section className="rounded-[32px] border border-white/70 bg-white/85 p-6 shadow-xl backdrop-blur dark:border-slate-700/70 dark:bg-slate-950/75">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-pink-600 dark:text-pink-300">Messages</p>
              <h1 className="mt-2 text-3xl font-bold">消息中心</h1>
              <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-slate-300">{emptyDescription}</p>
            </div>
            {isAuthenticated && summary ? (
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-2xl bg-pink-50 px-4 py-3 dark:bg-pink-500/10">
                  <div className="text-xs text-gray-500 dark:text-slate-400">未读</div>
                  <div className="text-xl font-semibold">{summary.unreadTotal}</div>
                </div>
                <div className="rounded-2xl bg-white/70 px-4 py-3 dark:bg-slate-900/80">
                  <div className="text-xs text-gray-500 dark:text-slate-400">全站</div>
                  <div className="text-xl font-semibold">{summary.siteUnread}</div>
                </div>
                <div className="rounded-2xl bg-white/70 px-4 py-3 dark:bg-slate-900/80">
                  <div className="text-xs text-gray-500 dark:text-slate-400">定向</div>
                  <div className="text-xl font-semibold">{summary.directUnread}</div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <MessageFilters
              activeFilter={appliedFilter}
              isAuthenticated={isAuthenticated}
              onChange={onFilterChange}
            />
            {isAuthenticated ? (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="inline-flex rounded-full border border-pink-200 bg-pink-50 px-4 py-2 text-sm font-semibold text-pink-700 dark:border-pink-400/40 dark:bg-pink-500/10 dark:text-pink-200"
              >
                全部已读
              </button>
            ) : (
              anonymousCta
            )}
          </div>
        </section>

        {error ? (
          <section className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-200">
            {error}
          </section>
        ) : null}

        {summary?.crowdReviewPrompt ? (
          <CrowdReviewPromptCard
            prompt={summary.crowdReviewPrompt}
            onNavigate={onNavigate}
            onNavigateExternal={onNavigateExternal}
            resolveInternalHref={resolveInternalHref}
          />
        ) : null}

        <section className="grid gap-4">
          {messages.map((message) => (
            <MessageCard
              key={message.id}
              message={message}
              canMarkRead={message.scope === 'user' && message.isRead === false}
              onMarkRead={() => onMarkRead(message.id)}
              onNavigate={onNavigate}
              onNavigateExternal={onNavigateExternal}
              resolveInternalHref={resolveInternalHref}
            />
          ))}

          {!loading && messages.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-white/70 bg-white/70 px-6 py-10 text-center text-sm text-gray-500 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-400">
              {emptyStateCopy}
            </div>
          ) : null}

          {nextCursor ? (
            <button
              type="button"
              onClick={onLoadMore}
              className="mx-auto inline-flex rounded-full border border-gray-300 bg-white/80 px-5 py-2.5 text-sm font-semibold text-gray-700 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200"
            >
              加载更多
            </button>
          ) : null}
        </section>
      </div>
    </main>
  );
}
