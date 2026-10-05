import type { MouseEvent } from 'react';

import { readCapability, type CapabilityAvailability, type CapabilitySnapshot } from '../capability/index';
import { NAV_GROUPS, getTopbarCanonicalPathname, type NavItem } from '../navigation';

/**
 * 站内导航回调。
 *
 * 宿主在这里接自己的路由：`next/link` 的 `router.push`、Desktop 的 hash router，或任何别的实现。
 * 共享组件只提供 `<a href>`，因此**不锁定任何 router**——这是 `ADR-desktop-shared-product` §6 对共享导航
 * 的要求，也是 D2.5 能在不预设 TanStack Router 的情况下先落地的条件。
 */
export type NavigateHandler = (href: string, event: MouseEvent<HTMLAnchorElement>) => void;

export interface ProductNavProps {
  /** 当前产品路径。会先经 {@link getTopbarCanonicalPathname} 归一，因此带 query 与尾斜杠都能正确高亮。 */
  readonly pathname: string;
  readonly capabilities: CapabilitySnapshot;
  readonly onNavigate: NavigateHandler;
  /**
   * 站外链接的处理器。
   *
   * 缺省时站外项按 `unavailable="explain"` 渲染并说明原因，而不是渲染一个点了没反应的链接。宿主要用
   * 系统浏览器打开站外站点时必须显式提供它——那需要新的 native 能力，不能由共源组件替宿主决定。
   */
  readonly onNavigateExternal?: NavigateHandler;
  /**
   * 不可用入口的处置方式。
   *
   * `'hide'` 是默认值，因为一个把 18 个入口里 15 个标灰的导航不是导航。`'explain'` 适合已经交付大部分
   * 范围、只想诚实标出未实现项的宿主。无论哪种，都不渲染成可点击但失效的链接（`DESK-PROD-001`）。
   */
  readonly unavailable?: 'hide' | 'explain';
  /** 只渲染这些分组。缺省为全部分组。 */
  readonly groupIds?: readonly string[];
}

const describeUnavailable = (
  availability: CapabilityAvailability,
  isExternal: boolean,
): string => {
  if (isExternal) return '此入口需要在系统浏览器中打开，当前运行时未提供该能力';
  switch (availability.kind) {
    case 'available':
      return '';
    case 'unknown':
      return '当前运行时未声明此入口的可用状态';
    case 'unavailable':
      switch (availability.reason) {
        case 'not-configured':
          return availability.detail ?? '需要先完成配置';
        case 'requires-sign-in':
          return availability.detail ?? '需要登录后使用';
        case 'service-unavailable':
          return availability.detail ?? '服务暂时不可用';
        case 'not-implemented':
          return availability.detail ?? '尚未实现';
        case 'storage-unavailable':
          return availability.detail ?? '本地存储不可用';
      }
  }
};

interface NavEntryProps {
  readonly item: NavItem;
  readonly availability: CapabilityAvailability;
  readonly isActive: boolean;
  readonly reason: string;
  readonly onNavigate: NavigateHandler;
}

const NavEntry = ({ item, availability, isActive, reason, onNavigate }: NavEntryProps) => {
  const sharedClassName = [
    'inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm transition',
    isActive
      ? 'bg-(--app-surface-80) font-medium text-(--app-text)'
      : 'text-(--app-text-muted) hover:bg-(--app-surface-60) hover:text-(--app-text)',
  ].join(' ');

  if (availability.kind !== 'available') {
    return (
      <span
        aria-disabled="true"
        title={reason}
        data-testid={`nav-entry-disabled-${item.href}`}
        className={`${sharedClassName} cursor-not-allowed opacity-60`}
      >
        {item.label}
      </span>
    );
  }

  return (
    <a
      href={item.href}
      title={item.description}
      aria-current={isActive ? 'page' : undefined}
      data-testid={`nav-entry-${item.href}`}
      className={sharedClassName}
      onClick={(event) => onNavigate(item.href, event)}
    >
      {item.label}
    </a>
  );
};

export const ProductNav = ({
  pathname,
  capabilities,
  onNavigate,
  onNavigateExternal,
  unavailable: unavailablePolicy = 'hide',
  groupIds,
}: ProductNavProps) => {
  const canonicalPathname = getTopbarCanonicalPathname(pathname);
  const selectedGroupIds = groupIds === undefined ? null : new Set(groupIds);

  const groups = NAV_GROUPS.filter(
    (group) => selectedGroupIds === null || selectedGroupIds.has(group.id),
  );

  return (
    <nav
      aria-label="产品导航"
      data-testid="product-nav"
      className="border-b border-(--app-border) bg-(--app-surface-70) px-4 py-2 sm:px-6 lg:px-10"
    >
      {groups.map((group) => {
        // `'hide'` 丢掉不可用项，`'explain'` 全部保留并让 NavEntry 说明原因。判据必须是
        // `kind === 'available'` 而不是「非 unknown」——后者会把「宿主没说」与「宿主说不可用」
        // 一起当成可展示，而这两者的文案不同。
        const entries = group.items.filter(
          (item) =>
            unavailablePolicy === 'explain' ||
            readCapability(capabilities, item.href).kind === 'available',
        );
        if (entries.length === 0) return null;

        return (
          <div key={group.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-1">
            <span className="text-xs tracking-wide text-(--app-text-subtle)">{group.label}</span>
            {entries.map((item) => {
              const availability = readCapability(capabilities, item.href);
              const isExternal = item.isExternal === true;
              // 站外项即便在快照里标为 available，没有处理器时也不能点击：宿主没有提供打开方式，
              // 而一个点了没反应的链接比一个说明原因的禁用项更糟。
              const effective: CapabilityAvailability =
                isExternal && onNavigateExternal === undefined
                  ? {
                      kind: 'unavailable',
                      reason: 'not-implemented',
                      detail: describeUnavailable(availability, true),
                    }
                  : availability;

              return (
                <NavEntry
                  key={item.href}
                  item={item}
                  availability={effective}
                  isActive={!isExternal && canonicalPathname === item.href}
                  reason={describeUnavailable(effective, isExternal)}
                  onNavigate={isExternal && onNavigateExternal !== undefined ? onNavigateExternal : onNavigate}
                />
              );
            })}
          </div>
        );
      })}
    </nav>
  );
};