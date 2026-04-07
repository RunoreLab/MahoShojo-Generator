import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

let authState = {
  user: null as null | { id: number; username: string; prefix?: string | null },
  userBadges: [],
  loading: false,
  isAuthenticated: false,
  logout: async () => undefined,
};

mock.module('next/link', () => ({
  default: function LinkMock({
    children,
    href,
    ...props
  }: {
    children?: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
}));

mock.module('@/lib/useAuth', () => ({
  useAuth: () => authState,
}));

describe('topbar leaf components', () => {
  beforeEach(() => {
    authState = {
      user: null,
      userBadges: [],
      loading: false,
      isAuthenticated: false,
      logout: async () => undefined,
    };
  });

  test('message placeholder is disabled and does not render unread data', async () => {
    const { TopBarMessagePlaceholder } = await import('@/components/navigation/TopBarMessagePlaceholder');
    const html = renderToStaticMarkup(<TopBarMessagePlaceholder />);

    expect(html).toContain('消息');
    expect(html).toContain('敬请期待');
    expect(html).toContain('disabled');
    expect(html).not.toContain('未读');
  });

  test('theme menu renders the existing color mode options', async () => {
    const { TopBarThemeMenu } = await import('@/components/navigation/TopBarThemeMenu');
    const html = renderToStaticMarkup(<TopBarThemeMenu />);

    expect(html).toContain('外观');
    expect(html).toContain('跟随系统');
    expect(html).toContain('浅色');
    expect(html).toContain('深色');
  });

  test('logged out user menu points to character manager login entry', async () => {
    const { TopBarUserMenu } = await import('@/components/navigation/TopBarUserMenu');
    const html = renderToStaticMarkup(<TopBarUserMenu />);

    expect(html).toContain('登录 / 注册');
    expect(html).toContain('href="/character-manager"');
  });

  test('logged in user menu renders user actions', async () => {
    authState = {
      ...authState,
      user: { id: 7, username: '小圆' },
      isAuthenticated: true,
    };
    const { TopBarUserMenu } = await import('@/components/navigation/TopBarUserMenu');
    const html = renderToStaticMarkup(<TopBarUserMenu />);

    expect(html).toContain('小圆');
    expect(html).toContain('个人页');
    expect(html).toContain('角色管理');
    expect(html).toContain('退出登录');
  });

  test('mobile user menu expands actions inline for touch navigation', async () => {
    authState = {
      ...authState,
      user: { id: 7, username: '小圆' },
      isAuthenticated: true,
    };
    const { TopBarUserMenu } = await import('@/components/navigation/TopBarUserMenu');
    const html = renderToStaticMarkup(
      <TopBarUserMenu variant="mobile" onNavigate={() => undefined} />,
    );

    expect(html).toContain('小圆');
    expect(html).toContain('账户快捷入口');
    expect(html).toContain('个人页');
    expect(html).toContain('角色管理');
    expect(html).toContain('退出登录');
    expect(html).not.toContain('aria-haspopup="menu"');
  });
});

describe('GlobalTopBar', () => {
  beforeEach(() => {
    authState = {
      user: null,
      userBadges: [],
      loading: false,
      isAuthenticated: false,
      logout: async () => undefined,
    };
  });

  test('renders logo, grouped nav, theme, messages, and user entry', async () => {
    const { GlobalTopBar } = await import('@/components/navigation/GlobalTopBar');
    const html = renderToStaticMarkup(<GlobalTopBar pathname="/battle" />);

    expect(html).toContain('MahoShojo');
    expect(html).toContain('src="/logo.svg"');
    expect(html).toContain('data-logo-fallback="true"');
    expect(html).toContain('data-logo-fallback="true" class="hidden');
    expect(html).toContain('href="/"');
    expect(html).toContain('创作');
    expect(html).toContain('竞技');
    expect(html).toContain('角色');
    expect(html).toContain('百科');
    expect(html).toContain('简洁竞技场');
    expect(html).toContain('完整竞技场');
    expect(html).toContain('外观');
    expect(html).toContain('消息');
    expect(html).toContain('登录 / 注册');
  });

  test('marks only covered active group while keeping non-covered targets as links', async () => {
    const { GlobalTopBar } = await import('@/components/navigation/GlobalTopBar');
    const html = renderToStaticMarkup(<GlobalTopBar pathname="/creator" />);

    expect(html).toContain('data-active-group="creative"');
    expect(html).toContain('href="/ranking"');
    expect(html).toContain('href="/encyclopedia"');
    expect(html).toContain('href="/name"');
  });

  test('mobile drawer markup contains grouped navigation and close controls', async () => {
    const { TopBarMobileDrawer } = await import('@/components/navigation/TopBarMobileDrawer');
    const html = renderToStaticMarkup(
      <TopBarMobileDrawer isOpen={true} activeGroupId="battle" onClose={() => undefined} />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('移动端导航');
    expect(html).toContain('关闭导航');
    expect(html).toContain('创作');
    expect(html).toContain('竞技');
    expect(html).toContain('排行榜');
    expect(html).toContain('登录 / 注册');
  });

  test('topbar navigation exposes accessible labels without unsupported menu roles', async () => {
    const { GlobalTopBar } = await import('@/components/navigation/GlobalTopBar');
    const html = renderToStaticMarkup(<GlobalTopBar pathname="/arena" />);

    expect(html).toContain('aria-label="返回首页"');
    expect(html).toContain('aria-label="全站主导航"');
    expect(html).toContain('aria-label="外观设置"');
    expect(html).toContain('aria-label="消息功能敬请期待"');
    expect(html).toContain('aria-label="打开导航菜单"');
    expect(html).not.toContain('role="menu"');
    expect(html).not.toContain('aria-haspopup="menu"');
  });

  test('renders one shared theme menu instance across breakpoints', async () => {
    const { GlobalTopBar } = await import('@/components/navigation/GlobalTopBar');
    const html = renderToStaticMarkup(<GlobalTopBar pathname="/arena" />);

    expect(html.match(/aria-label="外观设置"/g)?.length ?? 0).toBe(1);
  });
});

afterAll(() => {
  mock.restore();
});
