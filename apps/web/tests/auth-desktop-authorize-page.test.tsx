import { describe, expect, test, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { DesktopAuthorizeQuery } from '@mahoshojo/contracts/desktop-cloud';

/**
 * 授权页只关心「能不能点授权」，真正的鉴权在服务端 sessionMiddleware。
 * 本测试钉住 UI 状态投影：Legacy（旧版密钥）登录不得显示「授权并返回应用」——
 * grant 端点只认 Better Auth session，显示按钮必然在点击后 401。
 */

let mockAuthSnapshot: {
  isAuthenticated: boolean;
  authSource: 'better-auth-session' | 'legacy-bearer' | null;
  loading: boolean;
  user: { id: number; username: string } | null;
} = {
  isAuthenticated: false,
  authSource: null,
  loading: false,
  user: null,
};

vi.mock('@/lib/useAuth', () => ({
  useAuth: () => ({
    ...mockAuthSnapshot,
    login: vi.fn(async () => ({ success: true })),
    register: vi.fn(async () => ({ success: true })),
  }),
}));

const authModalStates: boolean[] = [];
const authModalPasswordOnly: boolean[] = [];

vi.mock('@/components/CharManager/AuthModal', () => ({
  __esModule: true,
  default: function AuthModalMock({ isOpen, passwordLoginOnly }: { isOpen?: boolean; passwordLoginOnly?: boolean }) {
    authModalStates.push(Boolean(isOpen));
    authModalPasswordOnly.push(Boolean(passwordLoginOnly));
    return isOpen ? <div data-auth-modal="open" /> : null;
  },
}));

const { DesktopAuthorizePage } = await import('@/components/auth/DesktopAuthorizePage');

const validGrant: DesktopAuthorizeQuery = {
  state: 'state-abc',
  code_challenge: 'x'.repeat(43),
  code_challenge_method: 'S256',
  redirect_uri: 'http://127.0.0.1:45231/callback',
};

const renderPage = (grant: DesktopAuthorizeQuery | null = validGrant): string =>
  renderToStaticMarkup(<DesktopAuthorizePage grant={grant} grantPath="/api/auth/native/grant" />);

describe('DesktopAuthorizePage 认证状态区分', () => {
  test('授权参数非法时报错，不渲染任何授权/登录入口', () => {
    const html = renderPage(null);
    expect(html).toContain('授权参数无效或不完整');
    expect(html).not.toContain('授权并返回应用');
  });

  test('加载中只显示检查状态', () => {
    mockAuthSnapshot = { isAuthenticated: false, authSource: null, loading: true, user: null };
    const html = renderPage();
    expect(html).toContain('正在检查登录状态');
    expect(html).not.toContain('授权并返回应用');
  });

  test('未登录时显示登录入口，登录弹层仅允许密码登录', () => {
    mockAuthSnapshot = { isAuthenticated: false, authSource: null, loading: false, user: null };
    authModalStates.length = 0;
    authModalPasswordOnly.length = 0;

    const html = renderPage();
    expect(html).toContain('登录 / 注册');
    expect(html).not.toContain('授权并返回应用');
    // 弹层被渲染且强制 passwordLoginOnly——旧密钥登录不产生 BA session。
    expect(authModalPasswordOnly).toContain(true);
  });

  test('Legacy（旧版密钥）登录不显示授权按钮，而是引导改用账号密码登录', () => {
    mockAuthSnapshot = {
      isAuthenticated: true,
      authSource: 'legacy-bearer',
      loading: false,
      user: { id: 7, username: 'homura' },
    };
    authModalPasswordOnly.length = 0;

    const html = renderPage();
    expect(html).not.toContain('授权并返回应用');
    expect(html).toContain('旧版密钥');
    expect(html).toContain('使用账号密码登录');
    expect(authModalPasswordOnly).toContain(true);
  });

  test('Better Auth 会话显示授权按钮', () => {
    mockAuthSnapshot = {
      isAuthenticated: true,
      authSource: 'better-auth-session',
      loading: false,
      user: { id: 7, username: 'madoka' },
    };

    const html = renderPage();
    expect(html).toContain('授权并返回应用');
    expect(html).toContain('madoka');
    expect(html).not.toContain('使用账号密码登录');
  });
});
