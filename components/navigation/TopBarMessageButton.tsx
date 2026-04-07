import Link from 'next/link';
import { Bell } from 'lucide-react';

import { useTopBarMessages } from '@/components/navigation/useTopBarMessages';

export function TopBarMessageButton({ isAuthenticated, userId }: { isAuthenticated: boolean; userId: number | null }) {
  const { unreadTotal, loading } = useTopBarMessages(userId, isAuthenticated);
  const displayUnread = unreadTotal > 99 ? '99+' : String(unreadTotal);

  return (
    <Link
      href="/messages"
      aria-label="消息中心"
      title="消息中心"
      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/50 bg-white/70 px-3 text-sm font-medium text-gray-700 shadow-sm backdrop-blur transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-200 dark:border-slate-600/60 dark:bg-slate-900/70 dark:text-slate-100"
    >
      <Bell className="h-4 w-4" aria-hidden="true" />
      <span className="hidden lg:inline">消息</span>
      {isAuthenticated && unreadTotal > 0 ? (
        <>
          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-pink-600 px-1.5 text-[11px] font-semibold leading-5 text-white">
            {displayUnread}
          </span>
          <span className="sr-only">{`${unreadTotal} 条未读`}</span>
        </>
      ) : null}
      {isAuthenticated && loading && unreadTotal === 0 ? (
        <span className="inline-flex h-2 w-2 rounded-full bg-pink-400" aria-hidden="true" />
      ) : null}
    </Link>
  );
}
