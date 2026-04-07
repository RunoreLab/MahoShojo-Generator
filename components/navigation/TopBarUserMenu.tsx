import Link from 'next/link';
import { LogOut, UserRound } from 'lucide-react';

import { useAuth } from '@/lib/useAuth';

interface TopBarUserMenuProps {
  variant?: 'desktop' | 'mobile';
  onNavigate?: () => void;
}

const getInitial = (username: string): string => username.trim().slice(0, 1) || 'U';

export function TopBarUserMenu({ variant = 'desktop', onNavigate }: TopBarUserMenuProps) {
  const { user, loading, isAuthenticated, logout } = useAuth();

  if (loading) {
    return (
      <div
        className={
          variant === 'mobile'
            ? 'flex h-11 w-full items-center justify-center rounded-2xl border border-white/50 bg-white/60 px-3 text-sm text-gray-500 shadow-sm backdrop-blur dark:border-slate-600/60 dark:bg-slate-900/60 dark:text-slate-300'
            : 'inline-flex h-9 items-center rounded-full border border-white/50 bg-white/60 px-3 text-sm text-gray-500 shadow-sm backdrop-blur dark:border-slate-600/60 dark:bg-slate-900/60 dark:text-slate-300'
        }
      >
        用户
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <Link
        href="/character-manager"
        onClick={onNavigate}
        className={
          variant === 'mobile'
            ? 'inline-flex h-11 w-full items-center justify-center rounded-2xl bg-pink-600 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-pink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-200'
            : 'inline-flex h-9 items-center rounded-full bg-pink-600 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-pink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-200'
        }
      >
        登录 / 注册
      </Link>
    );
  }

  if (variant === 'mobile') {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-3 rounded-2xl border border-white/60 bg-white/70 px-3 py-3 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/70">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pink-600 text-sm font-bold text-white">
            {getInitial(user.username)}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-gray-900 dark:text-slate-100">
              {user.username}
            </div>
            <div className="text-xs text-gray-500 dark:text-slate-400">账户快捷入口</div>
          </div>
        </div>
        <div className="grid gap-1">
          <Link
            href="/me"
            onClick={onNavigate}
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-gray-700 hover:bg-pink-50 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            <UserRound className="h-4 w-4" aria-hidden="true" />
            个人页
          </Link>
          <Link
            href="/character-manager"
            onClick={onNavigate}
            className="rounded-xl px-3 py-2 text-sm text-gray-700 hover:bg-pink-50 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            角色管理
          </Link>
          <button
            type="button"
            onClick={() => {
              void logout();
              onNavigate?.();
            }}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-gray-700 hover:bg-pink-50 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            退出登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative">
      <button
        type="button"
        className="inline-flex h-9 items-center gap-2 rounded-full border border-white/50 bg-white/70 px-2.5 pr-3 text-sm font-medium text-gray-800 shadow-sm backdrop-blur transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-200 dark:border-slate-600/60 dark:bg-slate-900/70 dark:text-slate-100"
      >
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-pink-600 text-xs font-bold text-white">
          {getInitial(user.username)}
        </span>
        <span className="max-w-24 truncate">{user.username}</span>
      </button>
      <div
        aria-label="用户菜单"
        className="invisible absolute right-0 top-full z-[45] min-w-40 pt-2 opacity-0 transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        <div className="rounded-2xl border border-white/60 bg-white/95 p-2 shadow-xl backdrop-blur dark:border-slate-600/60 dark:bg-slate-950/95">
          <Link
            href="/me"
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-gray-700 hover:bg-pink-50 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            <UserRound className="h-4 w-4" aria-hidden="true" />
            个人页
          </Link>
          <Link
            href="/character-manager"
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-gray-700 hover:bg-pink-50 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            角色管理
          </Link>
          <button
            type="button"
            onClick={() => void logout()}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-gray-700 hover:bg-pink-50 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            退出登录
          </button>
        </div>
      </div>
    </div>
  );
}
