import Link from 'next/link';

import {
  formatMessageTime,
  getMessagePriorityClassName,
  getMessagePriorityLabel,
  getMessageScopeLabel,
} from '@/components/messages/messageUi';
import type { MessagePreviewDto } from '@/lib/messages/types';

export function MessageCard({
  message,
  canMarkRead = false,
  onMarkRead,
}: {
  message: MessagePreviewDto;
  canMarkRead?: boolean;
  onMarkRead?: (() => void) | undefined;
}) {
  const unread = message.isRead === false;

  return (
    <article
      className={`rounded-3xl border bg-white/90 p-5 shadow-sm backdrop-blur dark:bg-slate-950/85 ${
        unread ? 'border-pink-300 dark:border-pink-500/40' : 'border-white/60 dark:border-slate-700/70'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getMessagePriorityClassName(message.priority)}`}>
          {getMessageScopeLabel(message.scope)}
        </span>
        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getMessagePriorityClassName(message.priority)}`}>
          {getMessagePriorityLabel(message.priority)}
        </span>
        <span className="text-xs text-gray-500 dark:text-slate-400">{formatMessageTime(message.createdAt)}</span>
        {unread ? (
          <span className="inline-flex rounded-full bg-pink-600 px-2.5 py-1 text-xs font-semibold text-white">未读</span>
        ) : null}
      </div>

      <h2 className="mt-3 text-base font-semibold text-gray-900 dark:text-slate-100">{message.title}</h2>
      <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-slate-300">{message.body}</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {message.actionUrl ? (
          <Link
            href={message.actionUrl}
            className="inline-flex rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
          >
            查看详情
          </Link>
        ) : null}
        {canMarkRead && unread ? (
          <button
            type="button"
            onClick={onMarkRead}
            className="inline-flex rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-pink-300 hover:text-pink-700 dark:border-slate-700 dark:text-slate-200 dark:hover:border-pink-400 dark:hover:text-pink-200"
          >
            标记已读
          </button>
        ) : null}
      </div>
    </article>
  );
}
