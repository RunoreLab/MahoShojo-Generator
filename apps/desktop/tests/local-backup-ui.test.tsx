// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import backupFixture from '../../../fixtures/desktop-backup.json';
import { CREATE_LOCAL_BACKUP_COMMAND, LIST_LOCAL_BACKUPS_COMMAND } from '../src/platform/local-backup-bridge';
import { createDesktopRouter } from '../src/app/router';

const native = vi.hoisted(() => ({ listen: vi.fn() }));
const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
const host = vi.hoisted(() => ({
  probeStorage: vi.fn(async () => null),
  runExport: vi.fn(),
  pickArchiveBytes: vi.fn(),
  inspectArchive: vi.fn(),
  applyArchive: vi.fn(),
  describeError: () => '归档失败',
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: bridge.invoke }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: native.listen }) }));
vi.mock('../src/platform/desktop-archive-host', () => ({
  createDesktopArchiveHost: () => host,
  DESKTOP_LIBRARY_ARCHIVE_LIMITS: { fileBytes: 1024 },
}));

let root: Root;
let container: HTMLDivElement;
let close: (event: { preventDefault: () => void }) => void;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 120)); });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === LIST_LOCAL_BACKUPS_COMMAND) return { backups: [], invalidCount: 0 };
    return backupFixture.summary;
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  native.listen.mockImplementation(async (handler) => { close = handler; return vi.fn(); });
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const mount = async () => {
  window.location.hash = '#/local-library';
  const router = createDesktopRouter();
  await router.load();
  await act(async () => { root.render(<StrictMode><RouterProvider router={router} /></StrictMode>); });
  await settle();
  return router;
};
const button = (label: string) => [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(label))!;

describe('local backup page integration', () => {
  it('serializes backup and archive actions and protects navigation/native close while backup is pending', async () => {
    let finish!: (value: unknown) => void;
    bridge.invoke.mockImplementation((command: string) => {
      if (command === LIST_LOCAL_BACKUPS_COMMAND) return Promise.resolve({ backups: [], invalidCount: 0 });
      if (command === CREATE_LOCAL_BACKUP_COMMAND) return new Promise((resolve) => { finish = resolve; });
      return Promise.resolve(undefined);
    });
    const router = await mount();
    const prevented = vi.fn();

    await act(async () => {
      button('创建备份').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      // 同一轮同步派发，证明互斥由同步 lock 保证，而非等待按钮重新渲染。
      button('导出整库').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      close({ preventDefault: prevented });
      void router.navigate({ to: '/settings' });
    });
    await settle();

    expect(bridge.invoke).toHaveBeenCalledWith(CREATE_LOCAL_BACKUP_COMMAND, undefined);
    expect(host.runExport).not.toHaveBeenCalled();
    expect(prevented).toHaveBeenCalledOnce();
    expect(router.state.location.pathname).toBe('/local-library');
    expect(container.textContent).toContain('本地库维护操作仍在进行');

    await act(async () => { finish(backupFixture.summary); });
    expect(container.textContent).toContain(backupFixture.summary.absolutePath);
    close({ preventDefault: prevented });
    expect(prevented).toHaveBeenCalledOnce();
    await act(async () => { await router.navigate({ to: '/settings' }); });
    expect(router.state.location.pathname).toBe('/settings');
  });

  it('rejects a backup while an archive action owns the operation lock', async () => {
    let finish!: (value: unknown) => void;
    host.runExport.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await mount();

    await act(async () => {
      button('导出整库').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      button('创建备份').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(host.runExport).toHaveBeenCalledOnce();
    expect(bridge.invoke).not.toHaveBeenCalledWith(CREATE_LOCAL_BACKUP_COMMAND, undefined);
    await act(async () => { finish({ location: 'archive.zip', byteLength: 1, entryCount: 1 }); });
  });
});
