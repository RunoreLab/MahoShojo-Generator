import { useState } from 'react';
import { Menu, Sparkles } from 'lucide-react';

import { getTopbarCoverage, NAV_GROUPS } from '../navigation';
import { readCapability, type CapabilitySnapshot } from '../capability/index';

import {
  describeUnavailableReason,
  topBarEntryAvailability,
  TOPBAR_HOME_HREF,
  TOPBAR_MESSAGES_HREF,
  TOPBAR_SETTINGS_HREF,
  type TopBarAccountState,
  type TopBarMessagesSummary,
  type TopBarNavigate,
  type TopBarResolveInternalHref,
  type TopBarUnavailablePolicy,
} from './topbar-contract';
import { TopBarMessageButton } from './TopBarMessageButton';
import { TopBarMobileDrawer } from './TopBarMobileDrawer';
import { TopBarSettingsButton } from './TopBarSettingsButton';
import { TopBarThemeMenu } from './TopBarThemeMenu';
import { TopBarUserMenu } from './TopBarUserMenu';

export interface ProductTopBarProps {
  /**
   * 宿主提供的当前规范化路径——只驱动导航组高亮；由宿主注入而非组件自取是
   * `DESK-ONLINE-008` 的硬约束：Web 从 Next Router 取，Desktop 从 TanStack
   * Router 取，共享组件不引入任一方 router，也绝不读 Web 启动 bootstrap。
   */
  pathname: string;
  /**
   * 宿主路由事实的能力快照——顶栏把 NAV_GROUPS、消息中心与账号入口全部经它
   * 表达为"可点 / 禁用带原因 / 隐藏"，绝不渲染可点击死链。
   */
  capabilities: CapabilitySnapshot;
  /** 站内导航接管：Web 用 Next Router，Desktop 用 TanStack（各自 `preventDefault`）。 */
  onNavigate: TopBarNavigate;
  /** 渲染站内 `<a href>` 时把产品路径解析成运行时 href（Desktop hash history 传 `#` 前缀）。 */
  resolveInternalHref?: TopBarResolveInternalHref;
  /**
   * 站外入口接管。缺省时站外项按"需系统浏览器"禁用——这是 Desktop 在接入
   * 系统浏览器前的诚实降级路径。
   */
  onNavigateExternal?: TopBarNavigate;
  /** 不可用入口处置：`'hide'` 隐藏、`'explain'` 置灰保留（默认 hide）。 */
  unavailable?: TopBarUnavailablePolicy;
  /** 品牌 logo 资源路径；加载失败时降级渲染 Sparkles + 名称（结构自 GlobalTopBar 保留）。 */
  logoSrc: string;
  logoAlt?: string;
  /** 宿主已验证身份的只读投影——`unknown` 是"未验证"，渲染中性"账号"占位而非登录 CTA。 */
  account: TopBarAccountState;
  /** 点击账号区域（含"登录/注册"）——宿主决定是打开登录框还是先验证再登录。 */
  onRequestAuth: () => void;
  onSignOut: () => void;
  /** 消息中心摘要（仅宿主已登录且已查询时注入；缺省=入口在但无角标）。 */
  messages?: TopBarMessagesSummary;
  /** 移动端抽屉初始展开（仅测试与首屏直开场景使用）。 */
  defaultMobileOpen?: boolean;
}

/**
 * 共源产品顶栏（`DESK-ONLINE-008` / `DESK-ONLINE-014`）。
 *
 * Web `GlobalTopBar` 的展示/交互内核上移后的唯一产品实现：logo、分组导航、主题、
 * 消息、账号、移动端抽屉的 DOM 结构、aria 与文案在两宿主间逐字同源。宿主差异
 * 只剩 props：路由接管、账号投影、消息摘要、能力快照与站外入口。
 */
export function ProductTopBar({
  pathname,
  capabilities,
  onNavigate,
  resolveInternalHref,
  onNavigateExternal,
  unavailable = 'hide',
  logoSrc,
  logoAlt = 'MahoShojo',
  account,
  onRequestAuth,
  onSignOut,
  messages,
  defaultMobileOpen = false,
}: ProductTopBarProps) {
  const [isMobileOpen, setIsMobileOpen] = useState(defaultMobileOpen);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);
  const { activeGroupId } = getTopbarCoverage(pathname);
  const hasExternalHandler = onNavigateExternal !== undefined;

  return (
    <>
      <header
        className="global-topbar pointer-events-none relative z-[var(--global-topbar-z-index)] bg-transparent px-3 py-3 sm:px-4 lg:px-6"
        data-active-group={activeGroupId ?? ''}
      >
        <div className="global-topbar-panel pointer-events-auto mx-auto flex min-h-[var(--global-topbar-height)] w-full max-w-screen-2xl items-center gap-3 px-3 backdrop-blur-2xl backdrop-saturate-150 sm:px-4 lg:px-6">
          <a
            href={resolveInternalHref?.(TOPBAR_HOME_HREF) ?? TOPBAR_HOME_HREF}
            onClick={(event) => onNavigate(TOPBAR_HOME_HREF, event)}
            aria-label="返回首页"
            className="global-topbar-logo-link inline-flex min-w-0 items-center gap-2 rounded-full px-2 py-1.5 transition"
          >
            {logoLoadFailed ? null : (
              <img
                src={logoSrc}
                alt={logoAlt}
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
          </a>

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
              const items = group.items
                .map((item) => ({
                  ...item,
                  availability: topBarEntryAvailability(
                    readCapability(capabilities, item.href),
                    item.isExternal,
                    hasExternalHandler,
                  ),
                }))
                .filter(
                  (item) => unavailable === 'explain' || item.availability.kind === 'available',
                );
              if (items.length === 0) return null;

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
                      {items.map((item) => {
                        if (item.availability.kind !== 'available') {
                          return (
                            <span
                              key={item.href}
                              aria-disabled="true"
                              title={describeUnavailableReason(item.availability, item.isExternal === true)}
                              className="block cursor-not-allowed rounded-xl px-3 py-2 text-sm text-gray-400 dark:text-slate-500"
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
                              setOpenGroupId(null);
                            }}
                            className="global-topbar-dropdown-link block rounded-xl px-3 py-2 text-sm"
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
                  </div>
                </div>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <TopBarThemeMenu />
            <TopBarSettingsButton
              availability={readCapability(capabilities, TOPBAR_SETTINGS_HREF)}
              onNavigate={onNavigate}
              resolveInternalHref={resolveInternalHref}
              unavailable={unavailable}
            />
            <TopBarMessageButton
              availability={readCapability(capabilities, TOPBAR_MESSAGES_HREF)}
              summary={messages}
              onNavigate={onNavigate}
              resolveInternalHref={resolveInternalHref}
              unavailable={unavailable}
            />
            <div className="hidden items-center gap-2 md:flex">
              <TopBarUserMenu
                account={account}
                capabilities={capabilities}
                onNavigate={onNavigate}
                resolveInternalHref={resolveInternalHref}
                onRequestAuth={onRequestAuth}
                onSignOut={onSignOut}
                unavailable={unavailable}
                variant="desktop"
              />
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

      <TopBarMobileDrawer
        isOpen={isMobileOpen}
        activeGroupId={activeGroupId}
        capabilities={capabilities}
        onNavigate={onNavigate}
        resolveInternalHref={resolveInternalHref}
        onNavigateExternal={onNavigateExternal}
        onClose={() => setIsMobileOpen(false)}
        account={account}
        onRequestAuth={onRequestAuth}
        onSignOut={onSignOut}
        unavailable={unavailable}
      />
    </>
  );
}
