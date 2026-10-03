// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import backupFixture from '../../../fixtures/desktop-backup.json';
import {
  CREATE_LOCAL_BACKUP_COMMAND,
  EXIT_AFTER_LOCAL_RESTORE_COMMAND,
  LIST_LOCAL_BACKUPS_COMMAND,
  PREPARE_LOCAL_RESTORE_COMMAND,
} from '../src/platform/local-backup-bridge';
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

  it('cancelling the second confirmation makes no restore or exit IPC call', async () => {
    bridge.invoke.mockImplementation(async (command: string) => command === LIST_LOCAL_BACKUPS_COMMAND
      ? { backups: [backupFixture.summary], invalidCount: 0 }
      : undefined);
    await mount();

    await act(async () => { button('使用此备份整体替换本地库').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const restoreTrigger = button('使用此备份整体替换本地库');
    expect(container.querySelector('[role="region"]')?.textContent).toContain('整体替换当前本地库');
    expect(document.activeElement).toBe(button('取消'));
    await act(async () => { button('取消').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(document.activeElement).toBe(restoreTrigger);

    expect(bridge.invoke).not.toHaveBeenCalledWith(PREPARE_LOCAL_RESTORE_COMMAND, expect.anything());
    expect(bridge.invoke).not.toHaveBeenCalledWith(EXIT_AFTER_LOCAL_RESTORE_COMMAND, undefined);
  });

  it('keeps a prepared restore read-only when exit fails and allows retrying exit', async () => {
    let exitAttempts = 0;
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === LIST_LOCAL_BACKUPS_COMMAND) return { backups: [backupFixture.summary], invalidCount: 0 };
      if (command === PREPARE_LOCAL_RESTORE_COMMAND) return {
        restoreId: 'restore-1-2-3',
        backupId: backupFixture.summary.backupId,
        preRestoreBackupId: 'local-library-20261002T040000Z',
      };
      if (command === EXIT_AFTER_LOCAL_RESTORE_COMMAND) {
        exitAttempts += 1;
        if (exitAttempts === 1) throw { code: 'restore-failed', message: 'native detail' };
        return undefined;
      }
      return undefined;
    });
    const router = await mount();

    await act(async () => { button('使用此备份整体替换本地库').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await act(async () => {
      button('确认整体替换并退出').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      // Same render tick must not publish two native restore intents.
      button('确认整体替换并退出').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle();

    expect(bridge.invoke).toHaveBeenCalledWith(PREPARE_LOCAL_RESTORE_COMMAND, {
      request: { backupId: backupFixture.summary.backupId },
    });
    expect(bridge.invoke).toHaveBeenCalledTimes(3); // list, prepare, failed exit
    expect(container.textContent).toContain('恢复前备份为 local-library-20261002T040000Z');
    expect(container.textContent).toContain('无法退出应用');
    expect(button('创建备份').disabled).toBe(true);
    expect(button('导出整库').matches(':disabled')).toBe(true);

    await act(async () => { button('退出应用并继续恢复').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await settle();
    expect(exitAttempts).toBe(2);
    expect(container.textContent).toContain('退出请求已提交');
    expect(button('创建备份').disabled).toBe(true);
    await act(async () => { void router.navigate({ to: '/settings' }); });
    await settle();
    expect(router.state.location.pathname).toBe('/local-library');
  });

  it('locks editing and requests exit when preparation resolves with an invalid response', async () => {
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === LIST_LOCAL_BACKUPS_COMMAND) return { backups: [backupFixture.summary], invalidCount: 0 };
      if (command === PREPARE_LOCAL_RESTORE_COMMAND) return { unexpected: true };
      if (command === EXIT_AFTER_LOCAL_RESTORE_COMMAND) throw { code: 'restore-failed', message: 'private detail' };
      return undefined;
    });
    await mount();
    await act(async () => { button('使用此备份整体替换本地库').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await act(async () => { button('确认整体替换并退出').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await settle();

    expect(container.textContent).toContain('恢复状态无法从请求结果中确认');
    expect(container.textContent).not.toContain('private detail');
    expect(bridge.invoke).toHaveBeenCalledWith(EXIT_AFTER_LOCAL_RESTORE_COMMAND, undefined);
    expect(button('创建备份').disabled).toBe(true);
    expect(button('导出整库').matches(':disabled')).toBe(true);
  });
});
