// @vitest-environment jsdom
/**
 * 共源顶栏的 Desktop 宿主接线（D5.0d）。
 *
 * 这组测试守三条边界：
 *
 * 1. **冷启动零请求。** 顶栏挂在壳上的每一帧都属于本地旅程——`DESK-PROD-004` 与
 *    `DESK-ONLINE-012` 要求不自动探测项目服务，因此挂载后 `invoke` 一次都不能被
 *    调用；账号区投影的是 `idle → 'unknown'` 的中性占位。
 * 2. **能力快照即真相。** 未交付入口（`/battle`、`/messages`、站外链接、个人页
 *    `/me`）在 `hide` 策略下不渲染——尤其 `/messages` 必须整条消失，而不是挂着
 *    一个伪造未读数的铃铛。
 * 3. **账号动作走原生桥。** 点击账号区经 `requestAuth → cloud_auth_status →
 *    cloud_login_begin/await` 完成授权往返；投影到顶栏的只有契约快照（active 显示
 *    用户名），unreachable 如实显示「服务不可用」而不是已登出。
 */

import { act } from 'react';
import { RouterProvider } from '@tanstack/react-router';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock, defaultInvokeImpl } = vi.hoisted(() => {
  const impl = async (command: string): Promise<unknown> => {
    if (command === 'cloud_auth_status') return { state: 'signed-out' as const };
    if (command === 'cloud_login_begin') {
      return { flowId: 'flow-1', authorizeUrl: 'https://example.test/auth/desktop?state=s' };
    }
    if (command === 'cloud_login_await') {
      return {
        status: 'signed-in',
        account: { userId: 7, username: 'homura', displayName: 'homura' },
        sessionExpiresAt: '2026-10-12T00:00:00.000Z',
      };
    }
    return undefined;
  };
  return { invokeMock: vi.fn(impl), defaultInvokeImpl: impl };
});

// 懒加载页面会实例化 useLeaveGuard：缺 `isTauri` 时渲染抛错、根 CatchBoundary
// 整树替换，topbar 会消失——jsdom 不是 Tauri，返回 false 即走纯 Web 路径。
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: invokeMock }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onCloseRequested: async () => () => {} }),
}));

// 顶栏依赖 lazy 路由的页面内容不影响壳断言；直接复用真实路由树，让「已交付入口可点
// 且真的导航」与路由事实保持同一来源。
import { createDesktopRouter } from '../src/app/router';
import { resetDesktopCloudSessionStoreForTests } from '../src/features/account/use-desktop-cloud-session';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // 路由导航会调用 scrollTo；jsdom 不实现它，与 router-history 测试同一处理。
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  window.location.hash = '';
  // mockClear 只清调用记录不清实现：前一个用例 mockImplementation 的桩会渗进本用例。
  // 每条用例都先恢复默认桥行为，让「哪条命令返回什么」只由本用例决定。
  invokeMock.mockClear();
  invokeMock.mockImplementation(defaultInvokeImpl);
  resetDesktopCloudSessionStoreForTests();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const settle = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
};

/**
 * back/forward 专属等待：jsdom 的 `popstate` 派发在宏任务里，量级约 100ms
 * （`desktop-router-history.test.tsx` 的实测口径）。20ms 的 `settle` 会让
 * traversal 断言落在事件之前，看起来像「高亮没跟上」的假象。
 */
const settleTraversal = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    await Promise.resolve();
  });
};

const mount = async () => {
  const router = createDesktopRouter();
  await router.load();
  act(() => {
    root.render(<RouterProvider router={router} />);
  });
  await settle();
  return router;
};

const click = async (element: Element | null): Promise<void> => {
  expect(element).not.toBeNull();
  await act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await settle();
};

const accountButton = (): HTMLButtonElement | null =>
  [...container.querySelectorAll<HTMLButtonElement>('.global-topbar button')].find(
    (button) => ['账号', '登录 / 注册', '登录中…', '服务不可用'].includes(button.textContent ?? ''),
  ) ?? null;

describe('desktop shared topbar', () => {
  it('mounts the shared chrome with zero IPC — the account slot is the neutral placeholder', async () => {
    await mount();

    // DESK-PROD-004 / DESK-ONLINE-012：壳挂载期间一条 IPC 都不能有。账号区渲染的
    // 是「未验证」占位而不是「已登出」——已保存身份不冒称未验证（DESK-ONLINE-008）。
    expect(invokeMock).not.toHaveBeenCalled();
    expect(container.querySelector('header.global-topbar')).not.toBeNull();
    expect(accountButton()?.textContent).toBe('账号');
    // 冷启动也绝不能有消息角标——Desktop 不注入消息摘要。
    expect(container.textContent).not.toContain('条未读');
  });

  it('renders only delivered entries: /messages, /me and external sites are absent, not dead links', async () => {
    await mount();

    const hrefs = [...container.querySelectorAll('header.global-topbar a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs).toContain('/');
    expect(hrefs).toContain('/character-manager');
    expect(hrefs).toContain('/encyclopedia');
    expect(hrefs).toContain('/local-library');
    // hide 策略：未交付入口整条消失——铃铛连同伪造未读的可能一起不存在。
    expect(hrefs).not.toContain('/messages');
    expect(hrefs).not.toContain('/me');
    expect(hrefs).not.toContain('/battle');
    expect(hrefs.every((href) => !href?.startsWith('http'))).toBe(true);
  });

  it('routes internal clicks through the desktop router instead of reloading', async () => {
    const router = await mount();

    await click(container.querySelector('header.global-topbar a[href="/character-manager"]'));
    expect(router.state.location.pathname).toBe('/character-manager');
    // hash history：产品路径在 # 之后（`router.ts` 的选型理由）。
    expect(window.location.hash).toBe('#/character-manager');
  });

  it('keeps the topbar active group in sync across navigation and traversal', async () => {
    const router = await mount();
    const activeGroup = () =>
      container.querySelector('header.global-topbar')?.getAttribute('data-active-group');

    // `router.state.location` 始终最新但不是响应式——旧的读法让 active
    // group 停在壳上次渲染时的值（D5.0d-r1）。这里断言的是 DOM 而不是
    // router 状态：导航、前进、后退三个方向都必须同步高亮。
    expect(activeGroup()).toBe('');

    await click(container.querySelector('header.global-topbar a[href="/character-manager"]'));
    expect(activeGroup()).toBe('character');

    await act(async () => {
      await router.navigate({ to: '/encyclopedia' });
    });
    await settle();
    expect(activeGroup()).toBe('knowledge');

    // 用本用例自己产生的两条栈记录做 traversal——jsdom session history
    // 跨用例共享，从更早条目 pop 回来的路径不可预测（router-history 测试
    // 记录了同一限制）。
    await act(async () => {
      router.history.back();
    });
    await settleTraversal();
    expect(router.state.location.pathname).toBe('/character-manager');
    expect(activeGroup()).toBe('character');

    await act(async () => {
      router.history.forward();
    });
    await settleTraversal();
    expect(router.state.location.pathname).toBe('/encyclopedia');
    expect(activeGroup()).toBe('knowledge');
  });

  it('does not cancel a topbar-initiated login when the settings panel unmounts', async () => {
    // 授权 flow 是进程级会话（顶栏与设置页共享同一条）：离开设置页只卸载
    // 面板，不得取消顶栏发起的全局登录——D5.0d-r1 修复的 ownership 边界。
    let releaseAwait: ((outcome: unknown) => void) | null = null;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'cloud_auth_status') return { state: 'signed-out' as const };
      if (command === 'cloud_login_begin') {
        return { flowId: 'flow-1', authorizeUrl: 'https://example.test/auth/desktop?state=s' };
      }
      if (command === 'cloud_login_await') {
        return new Promise((resolve) => {
          releaseAwait = resolve;
        });
      }
      return undefined;
    });
    const router = await mount();

    // 进入设置页挂载 AccountPanel（它自己会 refresh 一次），再从顶栏发起授权。
    await act(async () => {
      await router.navigate({ to: '/settings' });
    });
    await settle();
    expect(container.querySelector('[data-testid="account-panel"]')).not.toBeNull();

    await click(accountButton());
    expect(accountButton()?.textContent).toBe('登录中…');

    // 离开设置页：面板卸载，但授权 flow 不属于面板——不得发出取消命令。
    await act(async () => {
      await router.navigate({ to: '/' });
    });
    await settle();
    expect(container.querySelector('[data-testid="account-panel"]')).toBeNull();
    expect(
      invokeMock.mock.calls.some((call) => call[0] === 'cloud_login_cancel'),
    ).toBe(false);
    expect(accountButton()?.textContent).toBe('登录中…');

    // 收尾：释放在途 await，让 flow 走到 cancelled 终态，不给下一个用例留挂起 IPC。
    releaseAwait?.({ status: 'cancelled' });
    await settle();
  });

  it('clicking the account slot verifies identity then completes the native login round trip', async () => {
    await mount();

    await click(accountButton());

    // 点击 → status → begin → await → signed-in：整条链路都是用户这一次点按的后果。
    expect(invokeMock.mock.calls.map((call) => call[0])).toEqual([
      'cloud_auth_status',
      'cloud_login_begin',
      'cloud_login_await',
    ]);
    // 顶栏投影到 active：显示用户名，且出现「退出登录」入口（菜单 DOM 常挂在 hover
    // group 里，不需要先悬停就能断言）。
    expect(container.querySelector('header.global-topbar')?.textContent).toContain('homura');
    expect(container.textContent).toContain('退出登录');
    // 已登录后账号入口按能力快照渲染：角色管理可点，个人页未交付则不出现。
    const menuHrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(menuHrefs).toContain('/character-manager');
    expect(menuHrefs).not.toContain('/me');
  });

  it('shows 服务不可用 when the bridge reports unreachable — never signed-out', async () => {
    invokeMock.mockImplementation(async (command: string) =>
      command === 'cloud_auth_status' ? { state: 'unreachable' as const } : undefined,
    );
    await mount();

    await click(accountButton());

    // unreachable 是「本地凭据仍在、服务不可达」——契约要求它绝不能被投影成已注销。
    expect(accountButton()?.textContent).toBe('服务不可用');
    expect(container.textContent).not.toContain('登录 / 注册');
    // 再点一次是一次重试：又读一次 status，而不是空转。
    await click(accountButton());
    expect(invokeMock.mock.calls.filter((call) => call[0] === 'cloud_auth_status')).toHaveLength(2);
  });

  it('sign-out from the user menu clears back to the signed-out CTA', async () => {
    await mount();
    await click(accountButton());
    expect(container.querySelector('header.global-topbar')?.textContent).toContain('homura');

    invokeMock.mockImplementation(async (command: string) =>
      command === 'cloud_sign_out' ? { revoked: true } : undefined,
    );
    const signOutButton = [...container.querySelectorAll('header.global-topbar button')].find(
      (button) => button.textContent === '退出登录',
    );
    await click(signOutButton ?? null);

    expect(invokeMock.mock.calls.map((call) => call[0])).toContain('cloud_sign_out');
    expect(accountButton()?.textContent).toBe('登录 / 注册');
  });

  it('keeps the mobile drawer outside the header and closes it with Escape', async () => {
    await mount();

    const drawer = () => container.querySelector('[role="dialog"]');
    expect(drawer()).toBeNull();

    const menuButton = container.querySelector('button[aria-label="打开导航菜单"]');
    await click(menuButton);
    expect(drawer()).not.toBeNull();
    // 抽屉渲染在 header 之外（portal 语义）：header 内部找不到它。
    expect(container.querySelector('header.global-topbar [role="dialog"]')).toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await settle();
    expect(drawer()).toBeNull();
  });
});
