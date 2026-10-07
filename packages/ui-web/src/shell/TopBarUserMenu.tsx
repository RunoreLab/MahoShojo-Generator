import { useRef, useState, type ReactNode } from 'react';
import { IdCard, LogOut, UserRound } from 'lucide-react';

import { readCapability, type CapabilitySnapshot } from '../capability/index';
import { useEscapeLayer } from '../modal/escape-stack';

import {
  describeUnavailableReason,
  TOPBAR_ACCOUNT_LINK_HREFS,
  type TopBarAccountState,
  type TopBarNavigate,
  type TopBarResolveInternalHref,
  type TopBarUnavailablePolicy,
} from './topbar-contract';

const [PROFILE_HREF, CHAR_MANAGER_HREF] = TOPBAR_ACCOUNT_LINK_HREFS;

interface TopBarUserMenuProps {
  /** 宿主已验证身份的只读投影；`unknown` 是"宿主尚未验证"，不冒称已登出。 */
  account: TopBarAccountState;
  /** 账号入口的能力快照（个人页/角色管理）；与产品导航同源同策略。 */
  capabilities: CapabilitySnapshot;
  onNavigate: TopBarNavigate;
  /** 渲染 `<a href>` 时把产品路径解析成运行时 href（Desktop hash history 传 `#` 前缀）。 */
  resolveInternalHref?: TopBarResolveInternalHref;
  /** 点击登录/账号区域——宿主决定"打开登录框"还是"先验证已保存身份再登录"。 */
  onRequestAuth: () => void;
  onSignOut: () => void;
  unavailable?: TopBarUnavailablePolicy;
  variant?: 'desktop' | 'mobile';
  /** 菜单项被点击后触发（宿主用来关闭移动抽屉）。 */
  onNavigateItem?: () => void;
}

const getInitial = (username: string): string => username.trim().slice(0, 1) || 'U';

function TopBarAvatar({
  avatarDataUrl,
  username,
  size,
}: {
  avatarDataUrl: string | null;
  username: string;
  size: 'desktop' | 'mobile';
}) {
  const sizeClassName = size === 'mobile' ? 'h-9 w-9 text-sm' : 'h-6 w-6 text-xs';

  return (
    <span
      className={`inline-flex ${sizeClassName} shrink-0 items-center justify-center overflow-hidden rounded-full bg-pink-600 font-bold text-white`}
    >
      {avatarDataUrl ? (
        <img src={avatarDataUrl} alt={`${username}的头像`} className="h-full w-full object-cover" />
      ) : (
        getInitial(username)
      )}
    </span>
  );
}

/** 无当前身份的占位状态（`unknown`/`loading`/`authenticating`/`unreachable`），复用 loading chip 的既有样式。 */
const PENDING_CHIP_BASE =
  'border border-white/50 bg-white/60 text-sm text-gray-500 shadow-sm backdrop-blur dark:border-slate-600/60 dark:bg-slate-900/60 dark:text-slate-300';
const PENDING_CHIP_DESKTOP = `inline-flex h-9 items-center justify-center rounded-full px-3 ${PENDING_CHIP_BASE}`;
const PENDING_CHIP_MOBILE = `flex h-11 w-full items-center justify-center rounded-2xl px-3 ${PENDING_CHIP_BASE}`;

/**
 * 顶栏账号菜单（自 `apps/web` 上移，桌面/移动两变体的 DOM 逐字保留）。
 *
 * 核心变化是输入：Web 的 `useAuth()` + `useTopBarProfile()` 收敛成宿主注入的
 * `TopBarAccountState`。`unknown` 渲染中性"账号"占位而非"登录/注册"——已保存身份
 * 不冒称未验证（DESK-ONLINE-008）；账号入口经能力快照过滤，Desktop 未交付的
 * `/me` 自动隐藏而不是变成死链。
 */
export function TopBarUserMenu({
  account,
  capabilities,
  onNavigate,
  resolveInternalHref,
  onRequestAuth,
  onSignOut,
  unavailable = 'hide',
  variant = 'desktop',
  onNavigateItem,
}: TopBarUserMenuProps) {
  const isMobile = variant === 'mobile';

  const accountLinks = [
    { href: PROFILE_HREF, label: '个人页', icon: <UserRound className="h-4 w-4" aria-hidden="true" /> },
    { href: CHAR_MANAGER_HREF, label: '角色管理', icon: <IdCard className="h-4 w-4" aria-hidden="true" /> },
  ]
    .map((entry) => ({ ...entry, availability: readCapability(capabilities, entry.href) }))
    .filter((entry) => unavailable === 'explain' || entry.availability.kind === 'available');

  const linkClassName = isMobile
    ? 'flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-gray-700 hover:bg-pink-50 dark:text-slate-100 dark:hover:bg-slate-800'
    : 'flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-gray-700 hover:bg-pink-50 dark:text-slate-100 dark:hover:bg-slate-800';

  const renderAccountLink = (entry: (typeof accountLinks)[number]) => {
    if (entry.availability.kind !== 'available') {
      return (
        <span
          key={entry.href}
          aria-disabled="true"
          title={describeUnavailableReason(entry.availability, false)}
          className={`${linkClassName} cursor-not-allowed opacity-50`}
        >
          {entry.icon}
          {entry.label}
        </span>
      );
    }
    return (
      <a
        key={entry.href}
        href={resolveInternalHref?.(entry.href) ?? entry.href}
        onClick={(event) => {
          onNavigate(entry.href, event);
          onNavigateItem?.();
        }}
        className={linkClassName}
      >
        {entry.icon}
        {entry.label}
      </a>
    );
  };

  const renderSignOut = () => (
    <button
      type="button"
      onClick={() => {
        onSignOut();
        onNavigateItem?.();
      }}
      className={`${linkClassName} w-full text-left`}
    >
      <LogOut className="h-4 w-4" aria-hidden="true" />
      退出登录
    </button>
  );

  const renderPending = () => {
    const config =
      account.kind === 'authenticating'
        ? { label: '登录中…', title: undefined, clickable: false }
        : account.kind === 'unreachable'
          ? { label: '服务不可用', title: '项目服务暂不可达，点击重试', clickable: true }
          : account.kind === 'loading'
            ? { label: '用户', title: undefined, clickable: false }
            : { label: '账号', title: '账号状态未验证，点击查看', clickable: true };
    const className = `${isMobile ? PENDING_CHIP_MOBILE : PENDING_CHIP_DESKTOP} ${
      config.clickable ? 'transition hover:bg-white/90 dark:hover:bg-slate-900/80' : ''
    }`;
    return (
      <button
        type="button"
        onClick={config.clickable ? onRequestAuth : undefined}
        disabled={!config.clickable}
        title={config.title}
        className={className}
      >
        {config.label}
      </button>
    );
  };

  const signedIn = account.kind === 'signed-in' ? account : null;
  const shownName = signedIn ? (signedIn.displayName ?? signedIn.username) : null;

  if (!signedIn) {
    if (account.kind === 'signed-out' || account.kind === 'expired') {
      return (
        <button
          type="button"
          onClick={() => {
            onRequestAuth();
            onNavigateItem?.();
          }}
          title={account.kind === 'expired' ? '会话已过期，请重新登录' : undefined}
          className={
            isMobile
              ? 'inline-flex h-11 w-full items-center justify-center rounded-2xl bg-pink-600 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-pink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-200'
              : 'inline-flex h-9 items-center rounded-full bg-pink-600 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-pink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-200'
          }
        >
          登录 / 注册
        </button>
      );
    }
    return renderPending();
  }

  if (isMobile) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-3 rounded-2xl border border-white/60 bg-white/70 px-3 py-3 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/70">
          <TopBarAvatar avatarDataUrl={signedIn.avatarDataUrl ?? null} username={shownName ?? 'U'} size="mobile" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-gray-900 dark:text-slate-100">
              {shownName}
            </div>
            <div className="text-xs text-gray-500 dark:text-slate-400">账户快捷入口</div>
          </div>
        </div>
        <div className="grid gap-1">
          {accountLinks.map((entry) => renderAccountLink(entry))}
          {renderSignOut()}
        </div>
      </div>
    );
  }

  return (
    <DesktopUserMenuDropdown
      trigger={
        <TopBarAvatar avatarDataUrl={signedIn.avatarDataUrl ?? null} username={shownName ?? 'U'} size="desktop" />
      }
      shownName={shownName ?? 'U'}
      title={signedIn.title}
    >
      {accountLinks.map((entry) => renderAccountLink(entry))}
      {renderSignOut()}
    </DesktopUserMenuDropdown>
  );
}

/**
 * 桌面变体的下拉容器：hover/focus 展开语义与原 CSS `group-hover`/`group-focus-within`
 * 等价，但展开态收进 state——Escape 需要能主动收起这一层并把焦点还给触发按钮
 * （DESK-PARITY-007）。
 */
function DesktopUserMenuDropdown({
  trigger,
  shownName,
  title,
  children,
}: {
  trigger: ReactNode;
  shownName: string;
  title?: ReactNode;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  useEscapeLayer({
    active: open,
    onEscape: () => {
      setOpen(false);
      if (rootRef.current?.contains(document.activeElement)) {
        triggerRef.current?.focus();
      }
      return true;
    },
  });

  return (
    <div
      ref={rootRef}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!rootRef.current?.contains(document.activeElement)) setOpen(false);
      }}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        className="inline-flex h-9 items-center gap-2 rounded-full border border-white/50 bg-white/70 px-2.5 pr-3 text-sm font-medium text-gray-800 shadow-sm backdrop-blur transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-200 dark:border-slate-600/60 dark:bg-slate-900/70 dark:text-slate-100"
      >
        {trigger}
        <span className="max-w-24 truncate">{shownName}</span>
        {title}
      </button>
      <div
        aria-label="用户菜单"
        className={`${open ? 'visible opacity-100' : 'invisible opacity-0'} absolute right-0 top-full z-[45] min-w-40 pt-2 transition`}
      >
        <div className="rounded-2xl border border-white/60 bg-white/95 p-2 shadow-xl backdrop-blur dark:border-slate-600/60 dark:bg-slate-950/95">
          {children}
        </div>
      </div>
    </div>
  );
}
