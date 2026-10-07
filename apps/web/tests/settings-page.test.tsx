// @vitest-environment jsdom
/**
 * Web `/settings` 宿主装配与 `/me` 旧深链兼容（D5.1-S1 / DESK-SET-001）。
 *
 * 守三件事：
 *
 * 1. `/settings` 渲染共享分组壳；设备级字段未登录即可见、可改（不依赖账号
 *    查询），账号区按登录态如实分层。
 * 2. `?section=` 深链定位到对应分组锚点——与 Desktop hash-history 下同一语义。
 * 3. `/me?tab=settings` → `/settings?section=account`；`/me?token=<t>` →
 *    `/password-recovery?token=<t>`——服务端在 `/me` 渲染前早截获，
 *    恢复令牌只交给既有 handler（D5.1-S1-r1：不进客户端生命周期）。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { routerMock, redirectMock, authState } = vi.hoisted(() => ({
  routerMock: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() },
  // 与真实 next/navigation `redirect()` 同语义：抛错终止当前渲染。
  redirectMock: vi.fn((url: string): never => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  authState: {
    user: null as { id: number; username: string } | null,
    userBadges: [] as unknown[],
    isAuthenticated: false,
    loading: false,
  },
}));

let searchString = '';

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams(searchString),
  redirect: redirectMock,
}));

vi.mock('@/lib/useAuth', () => ({
  useAuth: () => ({
    user: authState.user,
    userBadges: authState.userBadges,
    isAuthenticated: authState.isAuthenticated,
    loading: authState.loading,
  }),
}));

vi.mock('@/lib/use-generation-api-intent-latch', () => ({
  useGenerationApiIntentLatch: () => ({
    tryAcquire: () => null,
  }),
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  QueryClient: class {},
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/components/Footer', () => ({
  default: () => <div data-testid="footer-stub" />,
}));

// 账号面板在别处已有行为测试；这里只关心装配分层，不重复触发它们的请求链。
vi.mock('@/components/me/AuthMigrationPanel', () => ({
  AuthMigrationPanel: () => <div data-testid="auth-migration-panel" />,
}));
vi.mock('@/components/me/ProfileSettingsPanel', () => ({
  ProfileSettingsPanel: () => <div data-testid="profile-settings-panel" />,
}));
vi.mock('@/components/me/AccountSecurityPanel', () => ({
  AccountSecurityPanel: () => <div data-testid="account-security-panel" />,
}));
vi.mock('@/components/me/BattleReportsPanel', () => ({
  BattleReportsPanel: () => <div data-testid="battle-reports-panel" />,
}));
vi.mock('@/components/me/BattleReportDetailsModal', () => ({
  BattleReportDetailsModal: () => null,
}));
vi.mock('@/components/me/BattleReportCardModal', () => ({
  BattleReportCardModal: () => null,
}));
vi.mock('@/components/me/ProfileCardModal', () => ({
  ProfileCardModal: () => null,
}));
vi.mock('@/components/me/ProfileHeader', () => ({
  ProfileHeader: () => <div data-testid="profile-header" />,
}));

// 路由模块测试只看装配：providers 包装被桩掉，页本体由上面的用例覆盖。
vi.mock('@/components/settings/SettingsRouteProviders', () => ({
  SettingsRouteProviders: () => <div data-testid="settings-route-providers" />,
}));

import { WebSettingsPage } from '@/components/settings/SettingsPage';

let container: HTMLDivElement;
let root: Root;
const scrollIntoView = vi.fn();

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = scrollIntoView;
  searchString = '';
  window.localStorage.clear();
  delete document.documentElement.dataset.motion;
  routerMock.push.mockClear();
  routerMock.replace.mockClear();
  scrollIntoView.mockClear();
  authState.user = null;
  authState.isAuthenticated = false;
  authState.loading = false;
  redirectMock.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = async (element: React.ReactElement) => {
  await act(async () => {
    root.render(element);
  });
};

const click = async (element: Element | null): Promise<void> => {
  expect(element).not.toBeNull();
  await act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

describe('web /settings page', () => {
  it('renders the shared grouped shell; device fields are visible without sign-in', async () => {
    await render(<WebSettingsPage />);

    expect(container.querySelector('[data-testid="settings-page"]')).not.toBeNull();
    for (const group of ['account', 'appearance', 'generation', 'data']) {
      expect(container.querySelector(`#settings-${group}`)).not.toBeNull();
    }
    // 未登录：设备级字段照常可见（不依赖账号），账号区给登录指引而不是空白。
    expect(container.textContent).toContain('减少动态效果');
    expect(container.textContent).toContain('结果自动定位');
    expect(container.textContent).toContain('登录后可管理资料');
    expect(container.querySelector('[data-testid="account-security-panel"]')).toBeNull();
  });

  it('mounts the account panels only for a signed-in session', async () => {
    authState.isAuthenticated = true;
    authState.user = { id: 7, username: 'homura' };
    await render(<WebSettingsPage />);

    expect(container.querySelector('[data-testid="auth-migration-panel"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="profile-settings-panel"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="account-security-panel"]')).not.toBeNull();
  });

  it('reads page preferences from the page-owned key and writes back to it', async () => {
    window.localStorage.setItem(
      'mahoshojo.details.preferences.v1',
      JSON.stringify({ imageSaveMode: 'download', showDetails: true }),
    );
    await render(<WebSettingsPage />);

    expect(container.textContent).toContain('魔法少女生成（/details）');
    const option = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '预览弹窗保存',
    );
    await click(option ?? null);

    const stored = JSON.parse(
      window.localStorage.getItem('mahoshojo.details.preferences.v1') ?? 'null',
    );
    expect(stored).toEqual({ imageSaveMode: 'modal', showDetails: true });
  });

  it('honours ?section= deep links against the shared group anchors', async () => {
    searchString = 'section=generation';
    await render(<WebSettingsPage />);

    expect(container.querySelector('#settings-generation')).not.toBeNull();
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('treats an invalid ?section= as unspecified', async () => {
    searchString = 'section=bogus';
    await render(<WebSettingsPage />);

    expect(container.querySelector('[data-testid="settings-page"]')).not.toBeNull();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('web /me route deep-link interception', () => {
  // 兼容跳在 Server Component 内、渲染 MeRouteProviders 之前完成——
  // 敏感 token 不进入 /me 的客户端生命周期与其同源子请求。
  it('redirects /me?tab=settings to /settings?section=account on the server', async () => {
    const { default: MeRoute } = await import('@/app/me/page');

    await expect(
      MeRoute({ searchParams: Promise.resolve({ tab: 'settings' }) }),
    ).rejects.toThrow('NEXT_REDIRECT:/settings?section=account');
    expect(redirectMock).toHaveBeenCalledTimes(1);
  });

  it('hands /me?token=<t> to the existing password-recovery handler, token preserved', async () => {
    const { default: MeRoute } = await import('@/app/me/page');

    await expect(
      MeRoute({ searchParams: Promise.resolve({ token: 'abc-123.敏感' }) }),
    ).rejects.toThrow(
      `NEXT_REDIRECT:/password-recovery?token=${encodeURIComponent('abc-123.敏感')}`,
    );
  });

  it('prefers the sensitive token handoff over the settings tab compat', async () => {
    const { default: MeRoute } = await import('@/app/me/page');

    await expect(
      MeRoute({
        searchParams: Promise.resolve({ tab: 'settings', token: 'abc' }),
      }),
    ).rejects.toThrow('NEXT_REDIRECT:/password-recovery?token=abc');
    expect(redirectMock).toHaveBeenCalledTimes(1);
  });

  it('plain /me renders the providers wrapper without redirecting', async () => {
    const { default: MeRoute } = await import('@/app/me/page');

    const element = await MeRoute({ searchParams: Promise.resolve({}) });
    expect(redirectMock).not.toHaveBeenCalled();
    const html = renderToStaticMarkup(element);
    expect(html).toContain('data-testid="battle-reports-panel"');
  });
});

describe('web /settings route module', () => {
  it('exports metadata and renders the providers wrapper', async () => {
    const { default: SettingsRoute, metadata } = await import('@/app/settings/page');
    expect(metadata?.title).toContain('设置');
    // Suspense 下的 client 树在静态渲染里同样展开——providers 桩应出现在产物中。
    const html = renderToStaticMarkup(<SettingsRoute />);
    expect(html).toContain('data-testid="settings-route-providers"');
  });
});
