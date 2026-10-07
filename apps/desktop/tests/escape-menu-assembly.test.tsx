// @vitest-environment jsdom
/**
 * Esc 快捷菜单的 Desktop 宿主装配（D5.1-N1，DESK-PARITY-007）。
 *
 * 这组测试守四条边界：
 *
 * 1. **打开条件。** 干净的 Escape（无已注册层、焦点不在文本输入）落到共享
 *    栈最低层的兜底，菜单以模态 dialog 打开、初始焦点在「继续」；当前页
 *    标「当前页」而不是冗余跳转。`desktop.escapeMenu.enabled: false` 时
 *    整条功能退场——兜底不登记，Escape 什么也不发生。
 * 2. **单次单层。** 有更高层（如移动端抽屉）时一次 Escape 只关那一层，
 *    同一个按键事件不会再触发菜单打开。
 * 3. **导航走宿主 Router。** 菜单动作调 `navigateByProductHref`——与顶栏
 *    同一条 TanStack 导航路径，hash-history 与离开守卫语义原样生效；
 *    菜单不开网络请求、不触碰生成会话（invoke 白名单断言）。
 * 4. **装配可摘除。** 菜单是壳上的一块 JSX：撤掉它功能整体消失，
 *    `escape-stack` 与各层注册不受影响（共享栈自身由 ui-web 测试断言）。
 */

import { act } from 'react';
import { RouterProvider } from '@tanstack/react-router';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const REVISION = `sha256:${'0'.repeat(64)}`;

const { invokeMock, defaultInvokeImpl } = vi.hoisted(() => {
  const impl = async (command: string): Promise<unknown> => {
    if (command === 'cloud_cached_account') return null;
    if (command === 'announcements_get_cached') return null;
    if (command === 'desktop_config_read') {
      return {
        path: 'C:\\cfg\\config.json',
        directory: 'C:\\cfg',
        backupPresent: false,
        invalidPresent: false,
        file: { status: 'missing' as const },
      };
    }
    if (command === 'announcements_refresh') {
      return {
        status: 'not-modified',
        snapshot: { fetchedAt: '2026-10-10T00:00:00Z', announcements: [] },
      };
    }
    return undefined;
  };
  return { invokeMock: vi.fn(impl), defaultInvokeImpl: impl };
});

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: invokeMock }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onCloseRequested: async () => () => {} }),
}));

import { createDesktopRouter } from '../src/app/router';
import { resetDesktopAnnouncementsStoreForTests } from '../src/features/announcements/use-desktop-announcements';
import { resetDesktopCloudSessionStoreForTests } from '../src/features/account/use-desktop-cloud-session';
import { resetDesktopConfigStoreForTests } from '../src/features/config/use-desktop-config';
import { resetTopbarAvatarForTests } from '../src/features/account/use-topbar-avatar';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  window.location.hash = '';
  invokeMock.mockClear();
  invokeMock.mockImplementation(defaultInvokeImpl);
  resetDesktopCloudSessionStoreForTests();
  resetTopbarAvatarForTests();
  resetDesktopAnnouncementsStoreForTests();
  resetDesktopConfigStoreForTests();
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

const mount = async () => {
  const router = createDesktopRouter();
  await router.load();
  act(() => {
    root.render(<RouterProvider router={router} />);
  });
  await settle();
  return router;
};

const pressEscape = async (): Promise<void> => {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await settle();
};

const menu = (): HTMLElement | null =>
  document.body.querySelector<HTMLElement>('[data-testid="escape-menu-root"]');

const menuButton = (label: string): HTMLButtonElement | null =>
  [...(menu()?.querySelectorAll('button') ?? [])].find((button) =>
    button.textContent?.includes(label),
  ) ?? null;

describe('desktop escape menu assembly', () => {
  it('opens on a clean Escape as a modal with 继续 focused and the current page marked', async () => {
    await mount();
    expect(menu()).toBeNull();

    await pressEscape();

    const dialog = menu()?.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    // 五个动作齐备：继续 + 四个已交付产品入口。
    for (const label of ['继续', '首页', '本地库', '百科', '设置']) {
      expect(menuButton(label)).not.toBeNull();
    }
    // 初始焦点在「继续」。
    expect(document.activeElement?.textContent).toContain('继续');
    // 当前页（首页）标「当前页」且不可点。
    const current = menuButton('首页');
    expect(current?.disabled).toBe(true);
    expect(current?.getAttribute('aria-current')).toBe('page');
    expect(current?.textContent).toContain('当前页');
  });

  it('closes on its own Escape and consumes no navigation', async () => {
    const router = await mount();
    await pressEscape();
    expect(menu()).not.toBeNull();

    await pressEscape();

    expect(menu()).toBeNull();
    expect(router.state.location.pathname).toBe('/');
  });

  it('routes a menu action through the desktop router — hash history and guards intact', async () => {
    const router = await mount();
    await pressEscape();

    const target = menuButton('设置');
    expect(target).not.toBeNull();
    await act(async () => {
      target!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await settle();

    // 先关菜单再导航：守卫拦截时菜单已退场，不会悬在目标页上。
    expect(menu()).toBeNull();
    expect(router.state.location.pathname).toBe('/settings');
    expect(window.location.hash).toBe('#/settings');
  });

  it('issues no business IPC when opening the menu — navigation only changes the route', async () => {
    const router = await mount();
    // 壳 bootstrap 的本机凭据只读与公告窄通道在挂载期完成；从这里清零，
    // 只统计「菜单打开→点击导航」区间内的命令。
    invokeMock.mockClear();

    await pressEscape();
    expect(menu()).not.toBeNull();
    const target = menuButton('本地库');
    await act(async () => {
      target!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await settle();

    // 菜单零业务副作用：打开与点击不发起生成取消、保存、上传或云端
    // 请求——「本地库」是本地功能页，其页面 IPC（本地库审计/导入命令）
    // 属于页面自身的导航后果而非菜单副作用；菜单本身只允许表现为路由变化。
    expect(router.state.location.pathname).toBe('/local-library');
    const commands = invokeMock.mock.calls.map((call) => call[0] as string);
    expect(commands.some((command) => command.startsWith('cloud_'))).toBe(false);
    expect(commands.some((command) => /cancel|upload|generate|archive_write/.test(command))).toBe(false);
  });

  it('respects desktop.escapeMenu.enabled=false — nothing happens on Escape', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'desktop_config_read') {
        return {
          path: 'C:\\cfg\\config.json',
          directory: 'C:\\cfg',
          backupPresent: false,
          invalidPresent: false,
          file: {
            status: 'ok' as const,
            revision: REVISION,
            content: JSON.stringify({
              version: 1,
              desktop: { escapeMenu: { enabled: false } },
            }),
          },
        };
      }
      return defaultInvokeImpl(command);
    });
    const router = await mount();

    await pressEscape();

    expect(menu()).toBeNull();
    expect(router.state.location.pathname).toBe('/');
  });

  it('a single Escape consumes only the topmost layer — drawer first, menu only on the next press', async () => {
    await mount();

    const drawerTrigger = container.querySelector('button[aria-label="打开导航菜单"]');
    await act(async () => {
      drawerTrigger?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await settle();
    const drawer = () => document.body.querySelector('[role="dialog"][aria-label="移动端导航"]');
    expect(drawer()).not.toBeNull();

    // 抽屉在栈顶：这次 Escape 只关它，同事件不得落到菜单兜底。
    await pressEscape();
    expect(drawer()).toBeNull();
    expect(menu()).toBeNull();

    // 栈空后的下一次 Escape 才轮到菜单。
    await pressEscape();
    expect(menu()).not.toBeNull();
  });

  it('does not open while a text input owns the focused Escape', async () => {
    await mount();

    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    try {
      await act(async () => {
        input.focus();
      });
      await pressEscape();
      expect(menu()).toBeNull();
      expect(document.activeElement).toBe(input);
    } finally {
      input.remove();
    }
  });
});
