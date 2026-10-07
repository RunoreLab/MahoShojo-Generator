import { X } from 'lucide-react';

import { NAV_GROUPS, type NavGroupId } from '../navigation';
import { readCapability, type CapabilitySnapshot } from '../capability/index';
import { useBaseModalAccessibility } from '../modal/BaseModal';

import {
  describeUnavailableReason,
  topBarEntryAvailability,
  type TopBarAccountState,
  type TopBarNavigate,
  type TopBarResolveInternalHref,
  type TopBarUnavailablePolicy,
} from './topbar-contract';
import { TopBarUserMenu } from './TopBarUserMenu';

interface TopBarMobileDrawerProps {
  isOpen: boolean;
  activeGroupId: NavGroupId | null;
  capabilities: CapabilitySnapshot;
  onNavigate: TopBarNavigate;
  resolveInternalHref?: TopBarResolveInternalHref;
  onNavigateExternal?: TopBarNavigate;
  onClose: () => void;
  account: TopBarAccountState;
  onRequestAuth: () => void;
  onSignOut: () => void;
  unavailable?: TopBarUnavailablePolicy;
}

/**
 * 顶栏移动端抽屉（自 `apps/web` 上移，`role="dialog"` / Escape / 初始聚焦语义保留）。
 *
 * 键盘与焦点口径与 `BaseModal` 同源（`useBaseModalAccessibility`，DESK-PARITY-007
 * 修复项）：Escape 经共享层级栈只消费抽屉这一层，Tab 被圈在面板内，关闭后焦点
 * 归还打开它的触发元素。不挂 `initialFocusRef` → 聚焦落到面板自身，与既有
 * rAF 聚焦面板的行为一致。
 *
 * 导航项按宿主 CapabilitySnapshot 与 `unavailable` 策略过滤/禁用——Desktop 未交付
 * 或需系统浏览器的入口诚实降级，绝不渲染可点击死链。
 */
export function TopBarMobileDrawer({
  isOpen,
  activeGroupId,
  capabilities,
  onNavigate,
  resolveInternalHref,
  onNavigateExternal,
  onClose,
  account,
  onRequestAuth,
  onSignOut,
  unavailable = 'hide',
}: TopBarMobileDrawerProps) {
  const { dialogRef: panelRef } = useBaseModalAccessibility({ isOpen, onClose });

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
          {NAV_GROUPS.map((group) => {
            const items = group.items
              .map((item) => ({
                ...item,
                availability: topBarEntryAvailability(
                  readCapability(capabilities, item.href),
                  item.isExternal,
                  onNavigateExternal !== undefined,
                ),
              }))
              .filter(
                (item) => unavailable === 'explain' || item.availability.kind === 'available',
              );
            if (items.length === 0) return null;
            return (
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
                  {items.map((item) => {
                    if (item.availability.kind !== 'available') {
                      return (
                        <span
                          key={item.href}
                          aria-disabled="true"
                          title={describeUnavailableReason(item.availability, item.isExternal === true)}
                          className="cursor-not-allowed rounded-xl px-3 py-2 text-sm text-gray-400 dark:text-slate-500"
                        >
                          <span className="font-medium">{item.label}</span>
                          {item.description ? (
                            <span className="mt-0.5 block text-xs text-gray-400 dark:text-slate-500">
                              {item.description}
                            </span>
                          ) : null}
                        </span>
                      );
                    }
                    return (
                      <a
                        key={item.href}
                        href={item.isExternal ? item.href : (resolveInternalHref?.(item.href) ?? item.href)}
                        target={item.isExternal ? '_blank' : undefined}
                        rel={item.isExternal ? 'noopener noreferrer' : undefined}
                        onClick={(event) => {
                          if (item.isExternal) {
                            onNavigateExternal?.(item.href, event);
                          } else {
                            onNavigate(item.href, event);
                          }
                          onClose();
                        }}
                        className="rounded-xl px-3 py-2 text-sm text-gray-800 hover:bg-pink-50 dark:text-slate-100 dark:hover:bg-slate-800"
                      >
                        <span className="font-medium">{item.label}</span>
                        {item.description ? (
                          <span className="mt-0.5 block text-xs text-gray-500 dark:text-slate-400">
                            {item.description}
                          </span>
                        ) : null}
                      </a>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </nav>

        <div className="mt-6 border-t border-gray-200 pt-4 dark:border-slate-800">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
            账户
          </div>
          <TopBarUserMenu
            account={account}
            capabilities={capabilities}
            onNavigate={onNavigate}
            resolveInternalHref={resolveInternalHref}
            onRequestAuth={onRequestAuth}
            onSignOut={onSignOut}
            unavailable={unavailable}
            variant="mobile"
            onNavigateItem={onClose}
          />
        </div>
      </div>
    </div>
  );
}
