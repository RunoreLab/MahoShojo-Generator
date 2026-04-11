import { Bell } from 'lucide-react';

export function TopBarMessagePlaceholder() {
  return (
    <button
      type="button"
      disabled
      aria-label="消息功能敬请期待"
      title="消息功能敬请期待"
      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/50 bg-white/60 px-3 text-sm font-medium text-gray-500 opacity-80 shadow-sm backdrop-blur transition dark:border-slate-600/60 dark:bg-slate-900/60 dark:text-slate-300"
    >
      <Bell className="h-4 w-4" aria-hidden="true" />
      <span className="hidden lg:inline">消息</span>
      <span className="sr-only">敬请期待</span>
    </button>
  );
}
