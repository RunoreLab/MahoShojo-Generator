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
});

afterAll(() => {
  mock.restore();
});
