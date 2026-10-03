// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesktopRouter } from '../src/app/router';

const native = vi.hoisted(() => ({ listen: vi.fn() }));
const host = vi.hoisted(() => ({
  probeStorage: vi.fn(async () => null),
  runExport: vi.fn(),
  pickArchiveBytes: vi.fn(),
  inspectArchive: vi.fn(),
  applyArchive: vi.fn(),
  describeError: () => '归档失败',
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: native.listen }) }));
vi.mock('../src/platform/desktop-archive-host', () => ({
  createDesktopArchiveHost: () => host,
  DESKTOP_LIBRARY_ARCHIVE_LIMITS: { fileBytes: 1024 },
}));

let root: Root;
let container: HTMLDivElement;
let close: (event: { preventDefault: () => void }) => void;
let release: ReturnType<typeof vi.fn>;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 120)); });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  window.location.hash = '#/local-library';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  release = vi.fn();
  native.listen.mockImplementation(async (handler) => { close = handler; return release; });
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const mount = async (strict = false) => {
  const router = createDesktopRouter();
  await router.load();
  await act(async () => {
    root.render(strict ? <StrictMode><RouterProvider router={router} /></StrictMode> : <RouterProvider router={router} />);
  });
  await settle();
  return router;
};
const exportButton = () => [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('导出整库'))!;

describe('真实归档页面的离开保护（native API mock，仍需真机验收）', () => {
  it('同 tick 开始导出即阻止路径/query、刷新与窗口关闭，完成后恢复', async () => {
    let finish!: (value: unknown) => void;
    host.runExport.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const router = await mount();
    expect(container.querySelector('fieldset')?.disabled).toBe(false);
    const prevented = vi.fn();
    await act(async () => {
      exportButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
      // 刻意不等 React 重渲染：守卫必须读取 controller 当前状态。
      close({ preventDefault: prevented });
      void router.navigate({ to: '/settings' });
    });
    await settle();
    expect(prevented).toHaveBeenCalledOnce();
    expect(router.state.location.pathname).toBe('/local-library');
    expect(container.textContent).toContain('归档操作仍在进行');
    await act(async () => { void router.navigate({ to: '/local-library', search: { filter: 'changed' } }); });
    await settle();
    expect(router.state.location.search).toEqual({});
    expect(window.location.hash).toBe('#/local-library');
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    await act(async () => { finish({ location: 'archive.zip', byteLength: 1, entryCount: 1 }); });
    close({ preventDefault: prevented });
    expect(prevented).toHaveBeenCalledOnce();
    const idleUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(idleUnload);
    expect(idleUnload.defaultPrevented).toBe(false);
    await act(async () => { await router.navigate({ to: '/settings' }); });
    await settle();
    expect(router.state.location.pathname).toBe('/settings');
    expect(release).toHaveBeenCalledOnce();
  });

  it('注册完成前禁用操作，卸载后晚到的 listener 会释放', async () => {
    let finish!: (release: () => void) => void;
    native.listen.mockImplementation((handler) => {
      close = handler;
      return new Promise((resolve) => { finish = resolve; });
    });
    const router = await mount();
    expect(container.querySelector('fieldset')?.disabled).toBe(true);
    await act(async () => { await router.navigate({ to: '/' }); });
    await settle();
    const prevented = vi.fn();
    close({ preventDefault: prevented });
    // Tauri 每个 listener 独立执行默认 destroy：过期 listener 不能放行关闭。
    expect(prevented).toHaveBeenCalledOnce();
    await act(async () => { finish(release); });
    expect(release).toHaveBeenCalledOnce();
  });

  it('选择导入文件期间也阻止关闭，取消文件选择后恢复', async () => {
    let cancel!: (value: null) => void;
    host.pickArchiveBytes.mockImplementation(() => new Promise((resolve) => { cancel = resolve; }));
    await mount();
    const pick = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('选择归档文件'))!;
    const prevented = vi.fn();
    await act(async () => {
      pick.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      close({ preventDefault: prevented });
    });
    expect(prevented).toHaveBeenCalledOnce();
    await act(async () => { cancel(null); });
    close({ preventDefault: prevented });
    expect(prevented).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain('归档操作仍在进行');
  });

  it('注册失败会解释不可用原因并允许离开页面', async () => {
    native.listen.mockRejectedValue(new Error('permission denied'));
    const router = await mount();
    expect(container.querySelector('fieldset')?.disabled).toBe(true);
    expect(container.textContent).toContain('窗口关闭保护初始化失败');
    await act(async () => { await router.navigate({ to: '/' }); });
    await settle();
    expect(router.state.location.pathname).toBe('/');
  });

  it('导出失败后展示错误并解锁导航与窗口关闭', async () => {
    let fail!: (error: Error) => void;
    host.runExport.mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; }));
    const router = await mount();
    const prevented = vi.fn();
    await act(async () => {
      exportButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
      close({ preventDefault: prevented });
    });
    expect(prevented).toHaveBeenCalledOnce();
    await act(async () => { fail(new Error('disk failure')); });
    expect(container.textContent).toContain('归档失败');
    expect(container.textContent).not.toContain('归档操作仍在进行');
    close({ preventDefault: prevented });
    expect(prevented).toHaveBeenCalledOnce();
    await act(async () => { await router.navigate({ to: '/' }); });
    await settle();
    expect(router.state.location.pathname).toBe('/');
    expect(release).toHaveBeenCalledOnce();
  });

  it('StrictMode 的旧 listener 不会绕过新 listener，两个异步 handle 均释放', async () => {
    const registrations: {
      handler: typeof close;
      resolve: (unlisten: () => void) => void;
      unlisten: ReturnType<typeof vi.fn>;
    }[] = [];
    native.listen.mockImplementation((handler: typeof close) => new Promise<() => void>((resolve) => {
      registrations.push({ handler, resolve, unlisten: vi.fn() });
    }));
    let finish!: (value: unknown) => void;
    host.runExport.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const router = await mount(true);
    expect(registrations).toHaveLength(2);
    const [stale, active] = registrations;
    expect(container.querySelector('fieldset')?.disabled).toBe(true);
    // 让新注册先完成，旧注册晚到，复现 StrictMode 的真实竞争顺序。
    await act(async () => { active.resolve(active.unlisten); });
    expect(container.querySelector('fieldset')?.disabled).toBe(false);
    const stalePrevented = vi.fn();
    const activePrevented = vi.fn();
    await act(async () => {
      exportButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
      stale.handler({ preventDefault: stalePrevented });
      active.handler({ preventDefault: activePrevented });
    });
    expect(stalePrevented).toHaveBeenCalledOnce();
    expect(activePrevented).toHaveBeenCalledOnce();
    await act(async () => { stale.resolve(stale.unlisten); });
    expect(stale.unlisten).toHaveBeenCalledOnce();
    expect(active.unlisten).not.toHaveBeenCalled();
    await act(async () => { finish({ location: 'archive.zip', byteLength: 1, entryCount: 1 }); });
    active.handler({ preventDefault: activePrevented });
    expect(activePrevented).toHaveBeenCalledOnce();
    await act(async () => { await router.navigate({ to: '/' }); });
    await settle();
    expect(active.unlisten).toHaveBeenCalledOnce();
    expect(stale.unlisten).toHaveBeenCalledOnce();
  });
});
