// @vitest-environment jsdom
/**
 * 共源 `ProductTopBar` 的宿主无关行为断言（DESK-ONLINE-008 / DESK-ONLINE-014）。
 *
 * 这里的 fixture 故意写成"最小宿主"：capability 快照、账号投影、导航回调全部以
 * props 注入——它同时是 Web 与 Desktop 两个宿主适配器的**行为规格**，而不是
 * 其中任意一个的快照。
 */
import { act, type MouseEvent, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AVAILABLE, unavailable, type CapabilitySnapshot } from '../src/capability/index';
import { NAV_GROUPS } from '../src/navigation';
import { ProductTopBar, type ProductTopBarProps } from '../src/shell/ProductTopBar';
import { TOPBAR_MESSAGES_HREF, TOPBAR_PRODUCT_HREFS, type TopBarAccountState } from '../src/shell/topbar-contract';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (node: ReactNode): void => {
  act(() => root.render(node));
};

const ALL_AVAILABLE: CapabilitySnapshot = Object.fromEntries(
  [
    ...TOPBAR_PRODUCT_HREFS,
    ...NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href)),
  ].map((href) => [href, AVAILABLE]),
);

const EXTERNAL_HREF = 'https://wantu-waystation.pages.dev/';

const baseProps = (overrides: Partial<ProductTopBarProps> = {}): ProductTopBarProps => ({
  pathname: '/',
  capabilities: ALL_AVAILABLE,
  onNavigate: () => {},
  logoSrc: '/favicon.svg',
  account: { kind: 'signed-out' },
  onRequestAuth: () => {},
  onSignOut: () => {},
  ...overrides,
});

const renderTopBar = (overrides: Partial<ProductTopBarProps> = {}) => {
  render(<ProductTopBar {...baseProps(overrides)} />);
};

const click = (element: Element | null): void => {
  act(() => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

describe('ProductTopBar', () => {
  it('renders logo, grouped nav, theme, message entry and signed-out CTA', () => {
    renderTopBar();

    const header = container.querySelector('header');
    expect(header).not.toBeNull();
    expect(header?.querySelector('img[src="/favicon.svg"]')).not.toBeNull();
    expect(header?.querySelector('[data-logo-fallback="true"]')).not.toBeNull();
    expect(header?.querySelector('a[href="/"]')).not.toBeNull();
    for (const label of ['创作', '竞技', '角色', '百科', '外观', '消息']) {
      expect(header?.textContent).toContain(label);
    }
    expect(header?.querySelector('a[href="/messages"]')).not.toBeNull();
    expect(header?.textContent).toContain('登录 / 注册');
  });

  it('marks the active group on the header via the shared coverage resolver', () => {
    renderTopBar({ pathname: '/creator' });
    expect(container.querySelector('header')?.getAttribute('data-active-group')).toBe('creative');
    renderTopBar({ pathname: '/arena' });
    expect(container.querySelector('header')?.getAttribute('data-active-group')).toBe('battle');
  });

  it('exposes the same accessible labels both hosts rely on, without menu roles', () => {
    renderTopBar({ pathname: '/arena' });
    const html = container.innerHTML;

    for (const label of ['返回首页', '全站主导航', '外观设置', '消息中心', '打开导航菜单']) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    expect(html).not.toContain('role="menu"');
    expect(html).not.toContain('aria-haspopup="menu"');
  });

  it('routes internal clicks to the host handler instead of navigating itself', () => {
    const onNavigate = vi.fn((_href: string, event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
    });
    renderTopBar({ onNavigate });

    click(container.querySelector('a[href="/battle"]'));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate.mock.calls[0]?.[0]).toBe('/battle');

    click(container.querySelector('a[href="/"]'));
    expect(onNavigate).toHaveBeenCalledTimes(2);
    expect(onNavigate.mock.calls[1]?.[0]).toBe('/');
  });

  it('hides undeclared entries by default instead of rendering dead links', () => {
    // 能力快照缺键 = 宿主没声明 = `unknown`。hide 策略下不能出现可点死链（DESK-PROD-001）。
    renderTopBar({ capabilities: {} });

    const header = container.querySelector('header');
    expect(header?.querySelector('a[href="/battle"]')).toBeNull();
    expect(header?.querySelector('a[href="/messages"]')).toBeNull();
    // 顶栏 chrome 本身仍在：logo、外观与账号区照常渲染。
    expect(header?.querySelector('a[href="/"]')).not.toBeNull();
    expect(header?.textContent).toContain('外观');
    expect(header?.textContent).toContain('登录 / 注册');
  });

  it('keeps unavailable entries visible with a concrete reason under the explain policy', () => {
    renderTopBar({
      capabilities: {
        ...ALL_AVAILABLE,
        '/ranking': unavailable('requires-sign-in'),
      },
      unavailable: 'explain',
    });

    const disabled = [...container.querySelectorAll('[aria-disabled="true"]')].find(
      (element) => element.querySelector('.font-medium')?.textContent === '排行榜',
    );
    expect(disabled).not.toBeUndefined();
    expect(disabled?.tagName).not.toBe('A');
    expect(disabled?.getAttribute('title')).toBe('需要登录后使用');
    expect(container.querySelector('a[href="/ranking"]')).toBeNull();
  });

  it('refuses external entries unless the host provides a way to open them', () => {
    renderTopBar();
    expect(container.querySelector(`a[href="${EXTERNAL_HREF}"]`)).toBeNull();

    const onNavigateExternal = vi.fn();
    renderTopBar({ onNavigateExternal });
    const anchor = container.querySelector(`a[href="${EXTERNAL_HREF}"]`);
    expect(anchor).not.toBeNull();
    click(anchor);
    expect(onNavigateExternal).toHaveBeenCalledTimes(1);
    expect(onNavigateExternal.mock.calls[0]?.[0]).toBe(EXTERNAL_HREF);
  });

  it('renders a neutral account chip while the host has not verified identity', () => {
    // DESK-ONLINE-008：已保存身份不冒称未验证——unknown 渲染"账号"而非"登录 / 注册"。
    const onRequestAuth = vi.fn();
    renderTopBar({ account: { kind: 'unknown' }, onRequestAuth });

    const header = container.querySelector('header');
    expect(header?.textContent).toContain('账号');
    expect(header?.textContent).not.toContain('登录 / 注册');

    click([...header!.querySelectorAll('button')].find((el) => el.textContent === '账号') ?? null);
    expect(onRequestAuth).toHaveBeenCalledTimes(1);
  });

  it('maps the signed-out and expired projections to the auth CTA', () => {
    const onRequestAuth = vi.fn();
    for (const kind of ['signed-out', 'expired'] as const) {
      renderTopBar({ account: { kind }, onRequestAuth });
      const button = [...container.querySelectorAll('header button')].find((el) =>
        el.textContent?.includes('登录 / 注册'),
      );
      expect(button).not.toBeUndefined();
      if (kind === 'expired') {
        expect(button?.getAttribute('title')).toBe('会话已过期，请重新登录');
      }
      click(button ?? null);
    }
    expect(onRequestAuth).toHaveBeenCalledTimes(2);
  });

  it('renders pending, authenticating and unreachable projections without a fake CTA', () => {
    for (const [account, label] of [
      [{ kind: 'loading' }, '用户'],
      [{ kind: 'authenticating' }, '登录中…'],
      [{ kind: 'unreachable' }, '服务不可用'],
    ] as Array<[TopBarAccountState, string]>) {
      renderTopBar({ account });
      const header = container.querySelector('header');
      expect(header?.textContent).toContain(label);
      expect(header?.textContent).not.toContain('登录 / 注册');
    }
  });

  it('renders the signed-in identity, account links and sign-out action', () => {
    const onSignOut = vi.fn();
    const onNavigate = vi.fn((_href: string, event: MouseEvent<HTMLAnchorElement>) =>
      event.preventDefault(),
    );
    renderTopBar({
      account: {
        kind: 'signed-in',
        username: 'madoka',
        displayName: '小圆',
        avatarDataUrl: 'data:image/webp;base64,topbar-avatar',
        title: <span data-testid="account-title" />,
      },
      onNavigate,
      onSignOut,
    });

    const header = container.querySelector('header');
    expect(header?.textContent).toContain('小圆');
    expect(header?.textContent).toContain('个人页');
    expect(header?.textContent).toContain('角色管理');
    expect(header?.textContent).toContain('退出登录');
    expect(header?.querySelector('img[src="data:image/webp;base64,topbar-avatar"]')).not.toBeNull();
    expect(header?.querySelector('[data-testid="account-title"]')).not.toBeNull();

    click(container.querySelector('a[href="/character-manager"]'));
    expect(onNavigate.mock.calls.at(-1)?.[0]).toBe('/character-manager');

    click([...header!.querySelectorAll('button')].find((el) => el.textContent === '退出登录') ?? null);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('prefers displayName over username when the host provides both', () => {
    renderTopBar({
      account: { kind: 'signed-in', username: 'madoka', displayName: '小圆' },
    });
    expect(container.querySelector('header')?.textContent).toContain('小圆');
    renderTopBar({
      account: { kind: 'signed-in', username: 'madoka' },
    });
    expect(container.querySelector('header')?.textContent).toContain('madoka');
  });

  it('filters the account dropdown by the same capability rules as product nav', () => {
    // Desktop 尚未交付 /me：账号菜单自动只留 角色管理 + 退出登录，而不是渲染死链。
    renderTopBar({
      account: { kind: 'signed-in', username: 'madoka' },
      capabilities: { ...ALL_AVAILABLE, '/me': unavailable('not-implemented') },
    });

    const header = container.querySelector('header');
    expect(header?.textContent).not.toContain('个人页');
    expect(header?.textContent).toContain('角色管理');
    expect(header?.textContent).toContain('退出登录');
  });

  it('renders the unread badge only when the host injects a summary', () => {
    renderTopBar();
    expect(container.querySelector('header')?.textContent).not.toContain('条未读');

    renderTopBar({ messages: { unreadTotal: 5, hasCrowdReviewPending: false } });
    expect(container.querySelector('header')?.textContent).toContain('5 条未读');
  });

  it('disables the message entry instead of linking to an undelivered route', () => {
    renderTopBar({
      capabilities: { ...ALL_AVAILABLE, [TOPBAR_MESSAGES_HREF]: unavailable('not-implemented') },
      unavailable: 'explain',
    });
    expect(container.querySelector('header a[href="/messages"]')).toBeNull();

    renderTopBar({
      capabilities: { ...ALL_AVAILABLE, [TOPBAR_MESSAGES_HREF]: unavailable('not-implemented') },
    });
    // hide 策略：整个入口隐藏而不是占位。
    expect(container.querySelector('header')?.textContent).not.toContain('消息');
  });

  it('renders the mobile drawer after the header and closes it on Escape', () => {
    renderTopBar({ defaultMobileOpen: true });
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();

    const html = container.innerHTML;
    expect(html.indexOf('</header>')).toBeGreaterThan(-1);
    expect(html.indexOf('role="dialog"')).toBeGreaterThan(html.indexOf('</header>'));

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows only delivered groups inside the mobile drawer under the hide policy', () => {
    renderTopBar({ defaultMobileOpen: true, capabilities: {} });
    const drawer = container.querySelector('[role="dialog"]');
    expect(drawer).not.toBeNull();
    expect(drawer?.querySelector('a[href="/battle"]')).toBeNull();
    // 账户区仍在——未验证身份在抽屉里同样渲染中性"账号"而非假 CTA。
    renderTopBar({ defaultMobileOpen: true, capabilities: {}, account: { kind: 'unknown' } });
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('账号');
    expect(container.querySelector('[role="dialog"]')?.textContent).not.toContain('登录 / 注册');
  });
});
