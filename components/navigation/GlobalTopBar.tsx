import { useState } from 'react';
import Link from 'next/link';
import { Menu, Sparkles } from 'lucide-react';

import { getTopbarCoverage, NAV_GROUPS, type NavGroupId } from '@/lib/navigation';
import { useAuth } from '@/lib/useAuth';
import { TopBarMessageButton } from '@/components/navigation/TopBarMessageButton';
import { TopBarMobileDrawer } from '@/components/navigation/TopBarMobileDrawer';
import { TopBarThemeMenu } from '@/components/navigation/TopBarThemeMenu';
import { TopBarUserMenu } from '@/components/navigation/TopBarUserMenu';

interface GlobalTopBarProps {
  pathname: string;
  defaultMobileOpen?: boolean;
}

export function GlobalTopBar({ pathname, defaultMobileOpen = false }: GlobalTopBarProps) {
  const [isMobileOpen, setIsMobileOpen] = useState(defaultMobileOpen);
  const [openGroupId, setOpenGroupId] = useState<NavGroupId | null>(null);
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);
  const { activeGroupId } = getTopbarCoverage(pathname);
  const { isAuthenticated, user } = useAuth();

  return (
    <>
      <header
        className="global-topbar pointer-events-none fixed left-0 right-0 top-0 z-[var(--global-topbar-z-index)] bg-transparent px-3 py-3 sm:px-4 lg:px-6"
        data-active-group={activeGroupId ?? ''}
      >
        <div className="global-topbar-panel pointer-events-auto mx-auto flex min-h-[var(--global-topbar-height)] w-full max-w-screen-2xl items-center gap-3 px-3 backdrop-blur-2xl backdrop-saturate-150 sm:px-4 lg:px-6">
          <Link
            href="/"
            aria-label="返回首页"
            className="global-topbar-logo-link inline-flex min-w-0 items-center gap-2 rounded-full px-2 py-1.5 transition"
          >
            {logoLoadFailed ? null : (
              <img
                src="/favicon.svg"
                alt="MahoShojo"
                width={132}
                height={32}
                onError={() => setLogoLoadFailed(true)}
                className="h-8 w-auto shrink-0"
              />
            )}
            <span
              data-logo-fallback="true"
              className={
                logoLoadFailed
                  ? 'inline-flex min-w-0 items-center gap-2'
                  : 'hidden min-w-0 items-center gap-2'
              }
            >
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-pink-500 via-rose-400 to-sky-400 text-white shadow-sm">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="hidden min-w-0 text-sm font-bold tracking-wide sm:inline">MahoShojo</span>
            </span>
          </Link>

          <nav
            className="hidden items-center gap-1 md:flex"
            aria-label="全站主导航"
            onMouseLeave={() => setOpenGroupId(null)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setOpenGroupId(null);
              }
            }}
          >
            {NAV_GROUPS.map((group) => {
              const active = activeGroupId === group.id;
              const isOpen = openGroupId === group.id;

              return (
                <div
                  key={group.id}
                  className="relative"
                  onMouseEnter={() => setOpenGroupId(group.id)}
                  onFocus={() => setOpenGroupId(group.id)}
                >
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    className={
                      active
                        ? 'h-9 rounded-full bg-pink-600 px-4 text-sm font-semibold text-white shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-200'
                        : 'global-topbar-nav-trigger h-9 rounded-full px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-200'
                    }
                  >
                    {group.label}
                  </button>
                  <div
                    aria-label={`${group.label}导航`}
                    className={`${
                      isOpen ? 'visible opacity-100' : 'invisible opacity-0'
                    } absolute left-0 top-full z-[45] min-w-56 pt-2 transition`}
                  >
                    <div className="global-topbar-dropdown rounded-2xl p-2 shadow-xl backdrop-blur">
                      {group.items.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          target={item.isExternal ? '_blank' : undefined}
                          rel={item.isExternal ? 'noopener noreferrer' : undefined}
                          onClick={() => setOpenGroupId(null)}
                          className="global-topbar-dropdown-link block rounded-xl px-3 py-2 text-sm"
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
                </div>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <TopBarThemeMenu />
            <TopBarMessageButton isAuthenticated={isAuthenticated} userId={user?.id ?? null} />
            <div className="hidden items-center gap-2 md:flex">
              <TopBarUserMenu />
            </div>
            <div className="flex items-center gap-2 md:hidden">
              <button
                type="button"
                aria-label="打开导航菜单"
                aria-expanded={isMobileOpen}
                onClick={() => setIsMobileOpen(true)}
                className="global-topbar-mobile-button inline-flex h-9 w-9 items-center justify-center rounded-full shadow-sm backdrop-blur"
              >
                <Menu className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </header>
      <div className="h-[calc(var(--global-topbar-height)+24px)]" aria-hidden="true" />

      <TopBarMobileDrawer
        isOpen={isMobileOpen}
        activeGroupId={activeGroupId}
        onClose={() => setIsMobileOpen(false)}
      />
    </>
  );
}
