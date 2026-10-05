// @vitest-environment jsdom
/**
 * D5.0e-r1：`DesktopCardLibraryLink` 的锚点语义回归。
 *
 * 早前实现对所有点击 `preventDefault` + `router.navigate`，把 Ctrl/Cmd/Shift/Alt、
 * 中键与 `target=_blank` 也吞成了 router 内导航——Web 的 `next/link` 不会这样做。
 * 这里用最小 routeTree + memory history 断言「只有无修饰主键点击被接管」。
 */

import { act } from 'react';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DesktopCardLibraryLink } from '../src/platform/card-library-host';

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

const mount = async (linkProps: Record<string, unknown> = {}) => {
  const rootRoute = createRootRoute({
    component: () => (
      <DesktopCardLibraryLink href="/target" {...linkProps}>
        目标链接
      </DesktopCardLibraryLink>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => null }),
      createRoute({ getParentRoute: () => rootRoute, path: '/target', component: () => null }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    defaultPreload: false,
  });
  await router.load();
  act(() => root.render(<RouterProvider router={router} />));
  await act(async () => { await Promise.resolve(); });
  return router;
};

const clickLink = async (eventInit: MouseEventInit = {}): Promise<MouseEvent> => {
  const anchor = container.querySelector('a')!;
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...eventInit });
  await act(async () => {
    anchor.dispatchEvent(event);
    await Promise.resolve();
  });
  return event;
};

describe('DesktopCardLibraryLink 点击语义', () => {
  it('无修饰主键点击执行 router 内导航', async () => {
    const router = await mount();
    const event = await clickLink();
    expect(event.defaultPrevented).toBe(true);
    expect(router.state.location.pathname).toBe('/target');
  });

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Cmd/Meta', { metaKey: true }],
    ['Shift', { shiftKey: true }],
    ['Alt', { altKey: true }],
  ])('%s+点击保留原生锚点语义，不触发导航', async (_label, init) => {
    const router = await mount();
    const event = await clickLink(init);
    expect(event.defaultPrevented).toBe(false);
    expect(router.state.location.pathname).toBe('/');
  });

  it('中键/右键等非主键点击不触发导航', async () => {
    const router = await mount();
    for (const button of [1, 2]) {
      const event = await clickLink({ button });
      expect(event.defaultPrevented).toBe(false);
      expect(router.state.location.pathname).toBe('/');
    }
  });

  it('target=_blank 不被拦截为 router 内导航', async () => {
    const router = await mount({ target: '_blank', rel: 'noopener noreferrer' });
    const event = await clickLink();
    expect(event.defaultPrevented).toBe(false);
    expect(router.state.location.pathname).toBe('/');
  });

  it('宿主 onClick 已 preventDefault 时不再接管', async () => {
    const onClick = vi.fn((event: { preventDefault(): void }) => event.preventDefault());
    const router = await mount({ onClick });
    const event = await clickLink();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(router.state.location.pathname).toBe('/');
  });
});
