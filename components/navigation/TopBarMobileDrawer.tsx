import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';

import type { NavGroupId } from '@/lib/navigation';
import { NAV_GROUPS } from '@/lib/navigation';
import { TopBarUserMenu } from '@/components/navigation/TopBarUserMenu';

interface TopBarMobileDrawerProps {
  isOpen: boolean;
  activeGroupId: NavGroupId | null;
  onClose: () => void;
  onRequestAuth?: () => void;
}

export function TopBarMobileDrawer({
  isOpen,
  activeGroupId,
  onClose,
  onRequestAuth,
}: TopBarMobileDrawerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    const handle = window.requestAnimationFrame(() => panelRef.current?.focus());

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      window.cancelAnimationFrame(handle);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[45] md:hidden" aria-label="移动端导航">
      <button
        type="button"
        aria-label="关闭导航遮罩"
        className="absolute inset-0 bg-slate-950/40"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="移动端导航"
        tabIndex={-1}
        className="absolute right-0 top-0 flex h-full w-[min(22rem,calc(100vw-2rem))] flex-col overflow-y-auto bg-white/95 p-4 shadow-2xl outline-none backdrop-blur dark:bg-slate-950/95"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">MahoShojo</div>
            <div className="text-xs text-gray-500 dark:text-slate-400">移动端导航</div>
          </div>
          <button
            type="button"
            aria-label="关闭导航"
            onClick={onClose}
            className="rounded-full p-2 text-gray-600 hover:bg-gray-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <nav className="mt-5 space-y-5" aria-label="移动端主导航">
          {NAV_GROUPS.map((group) => (
            <section key={group.id} aria-labelledby={`mobile-nav-${group.id}`}>
              <h2
                id={`mobile-nav-${group.id}`}
                className={`text-xs font-semibold uppercase tracking-wide ${
                  activeGroupId === group.id ? 'text-pink-600' : 'text-gray-500 dark:text-slate-400'
                }`}
              >
                {group.label}
              </h2>
              <div className="mt-2 grid gap-1">
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    target={item.isExternal ? '_blank' : undefined}
                    rel={item.isExternal ? 'noopener noreferrer' : undefined}
                    onClick={onClose}
                    className="rounded-xl px-3 py-2 text-sm text-gray-800 hover:bg-pink-50 dark:text-slate-100 dark:hover:bg-slate-800"
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
            </section>
          ))}
        </nav>

        <div className="mt-6 border-t border-gray-200 pt-4 dark:border-slate-800">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
            账户
          </div>
          <TopBarUserMenu variant="mobile" onNavigate={onClose} onRequestAuth={onRequestAuth} />
        </div>
      </div>
    </div>
  );
}
