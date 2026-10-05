import { afterAll, beforeEach, describe, expect, vi, test } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * Web 顶栏适配器测试：`GlobalTopBar` 现在只把 Web 宿主事实注入共享
 * `ProductTopBar`（Next Router、useAuth、消息/头像 hooks、AuthModal）。
 * 展示结构与语义在 `packages/ui-web/tests/topbar.test.tsx` 闭合；
 * 这里守住的是**注入映射**——账号投影、消息摘要、站外能力与 AuthModal 接线。
 */

let authState = {
  user: null as null | { id: number; username: string; prefix?: string | null },
  userBadges: [],
  loading: false,
  isAuthenticated: false,
  logout: async () => undefined,
};

let topBarProfileState = {
  avatarDataUrl: null as string | null,
};

let topBarMessagesState = {
  unreadTotal: 0,
  hasCrowdReviewPending: false,
  loading: false,
  error: null as string | null,
  refresh: async () => undefined,
};

const routerPushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

vi.mock('@/lib/useAuth', () => ({
  useAuth: () => authState,
}));

vi.mock('@/components/navigation/useTopBarProfile', () => ({
  useTopBarProfile: () => topBarProfileState,
}));

vi.mock('@/components/navigation/useTopBarMessages', () => ({
  useTopBarMessages: () => topBarMessagesState,
}));

vi.mock('@/components/CharManager/AuthModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => (
    <div data-auth-modal="true" data-auth-modal-open={String(isOpen)} />
  ),
}));

vi.mock('@/components/UserTitle', () => ({
  default: () => <span data-user-title="true" />,
}));

describe('GlobalTopBar adapter', () => {
  beforeEach(() => {
    authState = {
      user: null,
      userBadges: [],
      loading: false,
      isAuthenticated: false,
      logout: async () => undefined,
    };
    topBarProfileState = { avatarDataUrl: null };
    topBarMessagesState = {
      unreadTotal: 0,
      hasCrowdReviewPending: false,
      loading: false,
      error: null,
      refresh: async () => undefined,
    };
  });

  test('renders logo, grouped nav, theme, messages and the signed-out CTA', async () => {
    const { GlobalTopBar } = await import('@/components/navigation/GlobalTopBar');
    const html = renderToStaticMarkup(<GlobalTopBar pathname="/battle" />);

    expect(html).toContain('MahoShojo');
    expect(html).toContain('src="/favicon.svg"');
    expect(html).toContain('data-logo-fallback="true"');
    expect(html).toContain('href="/"');
    for (const label of ['创作', '竞技', '角色', '百科', '简洁竞技场', '完整竞技场']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('外观');
    expect(html).toContain('消息');
    expect(html).toContain('href="/messages"');
    expect(html).toContain('登录 / 注册');
    // 共享 DOM 由 `<a>` 渲染：不再出现 next/link 的 prefetch 行为。
    expect(html).not.toContain('data-prefetch');
  });

  test('marks only the covered active group while keeping other entries as links', async () => {
    const { GlobalTopBar } = await import('@/components/navigation/GlobalTopBar');
    const html = renderToStaticMarkup(<GlobalTopBar pathname="/creator" />);

    expect(html).toContain('data-active-group="creative"');
    expect(html).toContain('href="/ranking"');
    expect(html).toContain('href="/encyclopedia"');
    expect(html).toContain('href="/name"');
  });

  test('keeps external entries openable on Web via the native new-tab path', async () => {
    const { GlobalTopBar } = await import('@/components/navigation/GlobalTopBar');
    const html = renderToStaticMarkup(<GlobalTopBar pathname="/" />);

    expect(html).toContain('href="https://wantu-waystation.pages.dev/"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  test('maps the signed-in projection with avatar, title slot and account links', async () => {
    authState = {
      ...authState,
      user: { id: 7, username: '小圆' },
      isAuthenticated: true,
    };
    topBarProfileState = { avatarDataUrl: 'data:image/webp;base64,topbar-avatar' };
    const { GlobalTopBar } = await import('@/components/navigation/GlobalTopBar');
    const html = renderToStaticMarkup(<GlobalTopBar pathname="/" />);

    expect(html).toContain('小圆');
    expect(html).toContain('src="data:image/webp;base64,topbar-avatar"');
    expect(html).toContain('alt="小圆的头像"');
    expect(html).toContain('data-user-title="true"');
    expect(html).toContain('个人页');
    expect(html).toContain('角色管理');
    expect(html).toContain('退出登录');
    expect(html).toContain('href="/me"');
    expect(html).toContain('href="/character-manager"');
  });

  test('maps the loading projection to the neutral user chip', async () => {
    authState = { ...authState, loading: true };
    const { GlobalTopBar } = await import('@/components/navigation/GlobalTopBar');
    const html = renderToStaticMarkup(<GlobalTopBar pathname="/" />);

    expect(html).toContain('用户');
    expect(html).not.toContain('登录 / 注册');
  });

  test('injects the unread badge only while authenticated', async () => {
    topBarMessagesState = { ...topBarMessagesState, unreadTotal: 5 };
    const { GlobalTopBar } = await import('@/components/navigation/GlobalTopBar');

    const signedOutHtml = renderToStaticMarkup(<GlobalTopBar pathname="/" />);
    expect(signedOutHtml).not.toContain('5 条未读');

    authState = {
      ...authState,
      user: { id: 7, username: '小圆' },
      isAuthenticated: true,
    };
    const signedInHtml = renderToStaticMarkup(<GlobalTopBar pathname="/" />);
    expect(signedInHtml).toContain('5 条未读');
  });

  test('keeps the shared accessible labels and renders no unsupported menu roles', async () => {
    const { GlobalTopBar } = await import('@/components/navigation/GlobalTopBar');
    const html = renderToStaticMarkup(<GlobalTopBar pathname="/arena" />);

    for (const label of ['返回首页', '全站主导航', '外观设置', '消息中心', '打开导航菜单']) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    expect(html).not.toContain('role="menu"');
    expect(html).not.toContain('aria-haspopup="menu"');
  });

  test('renders exactly one theme menu and one message entry across breakpoints', async () => {
    const { GlobalTopBar } = await import('@/components/navigation/GlobalTopBar');
    const html = renderToStaticMarkup(<GlobalTopBar pathname="/arena" />);

    expect(html.match(/aria-label="外观设置"/g)?.length ?? 0).toBe(1);
    expect(html.match(/aria-label="消息中心"/g)?.length ?? 0).toBe(1);
  });

  test('renders the mobile drawer after the header', async () => {
    const { GlobalTopBar } = await import('@/components/navigation/GlobalTopBar');
    const html = renderToStaticMarkup(<GlobalTopBar pathname="/arena" defaultMobileOpen={true} />);

    const headerEnd = html.indexOf('</header>');
    const drawerDialog = html.indexOf('role="dialog"');

    expect(headerEnd).toBeGreaterThan(-1);
    expect(drawerDialog).toBeGreaterThan(headerEnd);
    expect(html).toContain('移动端导航');
    expect(html).toContain('关闭导航');
  });

  test('mounts the host-owned AuthModal closed until auth is requested', async () => {
    const { GlobalTopBar } = await import('@/components/navigation/GlobalTopBar');
    const html = renderToStaticMarkup(<GlobalTopBar pathname="/" />);

    expect(html).toContain('data-auth-modal="true"');
    expect(html).toContain('data-auth-modal-open="false"');
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});
