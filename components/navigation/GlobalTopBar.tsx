import { useState } from 'react';
import Link from 'next/link';
import { Menu, Sparkles } from 'lucide-react';

import { getTopbarCoverage, NAV_GROUPS } from '@/lib/navigation';
import { TopBarMessagePlaceholder } from '@/components/navigation/TopBarMessagePlaceholder';
import { TopBarMobileDrawer } from '@/components/navigation/TopBarMobileDrawer';
import { TopBarThemeMenu } from '@/components/navigation/TopBarThemeMenu';
import { TopBarUserMenu } from '@/components/navigation/TopBarUserMenu';

interface GlobalTopBarProps {
  pathname: string;
}

export function GlobalTopBar({ pathname }: GlobalTopBarProps) {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const { activeGroupId } = getTopbarCoverage(pathname);

  return (
    <header
      className="sticky top-0 z-[var(--global-topbar-z-index)] border-b border-white/50 bg-white/75 shadow-sm backdrop-blur-xl dark:border-slate-700/60 dark:bg-slate-950/75"
      style={{ minHeight: 'var(--global-topbar-height)' }}
      data-active-group={activeGroupId ?? ''}
    >
      <div className="mx-auto flex min-h-[var(--global-topbar-height)] w-full max-w-screen-2xl items-center gap-3 px-3 sm:px-4 lg:px-6">
        <Link
          href="/"
          className="inline-flex min-w-0 items-center gap-2 rounded-full px-2 py-1.5 text-gray-900 transition hover:bg-white/70 dark:text-slate-100 dark:hover:bg-slate-900"
        >
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-pink-500 via-rose-400 to-sky-400 text-white shadow-sm">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="hidden min-w-0 text-sm font-bold tracking-wide sm:inline">MahoShojo</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="全站主导航">
          {NAV_GROUPS.map((group) => {
            const active = activeGroupId === group.id;

            return (
              <div key={group.id} className="group relative">
                <button
                  type="button"
                  aria-haspopup="menu"
                  className={
                    active
                      ? 'h-9 rounded-full bg-pink-600 px-4 text-sm font-semibold text-white shadow-sm'
                      : 'h-9 rounded-full px-4 text-sm font-semibold text-gray-700 transition hover:bg-white/75 dark:text-slate-100 dark:hover:bg-slate-900'
                  }
                >
                  {group.label}
                </button>
                <div
                  role="menu"
                  aria-label={`${group.label}导航`}
                  className="invisible absolute left-0 top-full z-[45] mt-2 min-w-56 rounded-2xl border border-white/60 bg-white/95 p-2 opacity-0 shadow-xl backdrop-blur transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 dark:border-slate-600/60 dark:bg-slate-950/95"
                >
                  {group.items.map((item) => (
                    <Link
                      key={item.href}
                      role="menuitem"
                      href={item.href}
                      className="block rounded-xl px-3 py-2 text-sm text-gray-800 hover:bg-pink-50 dark:text-slate-100 dark:hover:bg-slate-800"
                    >
                      <span className="font-medium">{item.label}</span>
                      {item.description ? (
                        <span className="mt-0.5 block text-xs text-gray-500 dark:text-slate-400">
                          {item.description}
                        </span>
                      ) : null}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          <TopBarThemeMenu />
          <TopBarMessagePlaceholder />
          <TopBarUserMenu />
        </div>

        <div className="ml-auto flex items-center gap-2 md:hidden">
          <TopBarThemeMenu />
          <TopBarMessagePlaceholder />
          <button
            type="button"
            aria-label="打开导航菜单"
            aria-expanded={isMobileOpen}
            onClick={() => setIsMobileOpen(true)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/50 bg-white/70 text-gray-800 shadow-sm backdrop-blur dark:border-slate-600/60 dark:bg-slate-900/70 dark:text-slate-100"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <TopBarMobileDrawer
        isOpen={isMobileOpen}
        activeGroupId={activeGroupId}
        onClose={() => setIsMobileOpen(false)}
      />
    </header>
  );
}
