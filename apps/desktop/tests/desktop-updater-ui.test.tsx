// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DesktopUpdateCard } from '../src/features/updater/DesktopUpdateCard';
import { ThirdPartyNoticesCard } from '../src/features/updater/ThirdPartyNoticesCard';
import { hasBusyOperations, registerBusyOperation } from '../src/app/busy-operations';
import { DesktopUpdateError, type DesktopUpdateProgress, type DesktopUpdaterClient } from '../src/platform/desktop-updater';

vi.mock('@tanstack/react-router', () => ({ useBlocker: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }));
const settings = vi.hoisted(() => ({ saving: false }));
vi.mock('../src/features/config/use-desktop-config', () => ({ getDesktopConfigStore: () => ({ getSnapshot: () => settings }) }));

let root: Root;
let container: HTMLDivElement;
let client: DesktopUpdaterClient;
const releases: Array<() => void> = [];
beforeEach(() => {
  settings.saving = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  client = {
    check: vi.fn(async () => ({ currentVersion: '0.1.0', available: { version: '0.1.1', notes: '修复问题' } })),
    install: vi.fn(async () => {}), cancel: vi.fn(async () => true),
  };
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  releases.splice(0).forEach(release => release());
  vi.unstubAllGlobals();
  expect(hasBusyOperations()).toBe(false);
});
const button = (name: string) => [...document.querySelectorAll('button')].find(node => node.textContent === name)!;
const click = async (name: string) => { await act(async () => { button(name).click(); }); };
const mount = async () => { await act(async () => { root.render(<StrictMode><DesktopUpdateCard client={client} /></StrictMode>); }); };
const checkAndConfirm = async () => { await click('检查更新'); await click('下载并安装'); };

it('checks only on demand and requires an explicit save confirmation before installation', async () => {
  await mount();
  expect(client.check).not.toHaveBeenCalled();
  await checkAndConfirm();
  expect(document.querySelector('[role=dialog]')?.textContent).toContain('请先保存当前作品');
  expect(client.install).not.toHaveBeenCalled();
  await click('暂不安装');
  expect(document.querySelector('[role=dialog]')).toBeNull();
  await click('下载并安装');
  await click('已保存，开始更新');
  expect(client.install).toHaveBeenCalledWith('0.1.1', expect.any(Function));
  expect(container.textContent).toContain('安装程序已启动');
});

it('rechecks mounted operation guards when the user confirms, and permits retry once idle', async () => {
  await mount();
  await checkAndConfirm();
  let busy = true;
  releases.push(registerBusyOperation(() => busy));
  await click('已保存，开始更新');
  expect(client.install).not.toHaveBeenCalled();
  expect(container.textContent).toContain('仍有生成、保存或维护操作');
  busy = false;
  await click('下载并安装');
  await click('已保存，开始更新');
  expect(client.install).toHaveBeenCalledOnce();
});

it('holds the leave guard through download, cancellation and the native terminal result', async () => {
  let reject!: (reason: unknown) => void;
  let progress!: (event: DesktopUpdateProgress) => void;
  client.install = vi.fn((_version, onProgress) => {
    progress = onProgress;
    return new Promise((_resolve, fail) => { reject = fail; });
  });
  await mount();
  await checkAndConfirm();
  await click('已保存，开始更新');
  expect(hasBusyOperations()).toBe(true);
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  await act(async () => { progress({ phase: 'downloading', downloadedBytes: 1024, totalBytes: 2048 }); });
  expect(document.querySelector('[role=dialog] progress')?.getAttribute('value')).toBe('1024');
  await click('取消下载');
  expect(client.cancel).toHaveBeenCalledOnce();
  expect(hasBusyOperations()).toBe(true);
  await act(async () => { reject(new DesktopUpdateError('cancelled', 'cancelled')); });
  expect(hasBusyOperations()).toBe(false);
  expect(container.textContent).toContain('已取消下载，当前版本保持不变');
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(button('下载并安装')).toBeDefined();
  await click('检查更新');
  expect(client.check).toHaveBeenCalledTimes(2);
});

it('waits for an existing configuration save before starting the update', async () => {
  await mount();
  await checkAndConfirm();
  settings.saving = true;
  await click('已保存，开始更新');
  expect(client.install).not.toHaveBeenCalled();
  expect(container.textContent).toContain('仍有生成、保存或维护操作');
  settings.saving = false;
  await click('下载并安装');
  await click('已保存，开始更新');
  expect(client.install).toHaveBeenCalledOnce();
});

it('removes cancel after installation starts and shows retryable errors', async () => {
  let reject!: (reason: unknown) => void;
  client.install = vi.fn((_version, onProgress) => {
    onProgress({ phase: 'installing', downloadedBytes: 200, totalBytes: 200 });
    return new Promise((_resolve, fail) => { reject = fail; });
  });
  await mount();
  await checkAndConfirm();
  await click('已保存，开始更新');
  expect(button('取消下载')).toBeUndefined();
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(document.querySelector('[role=dialog]')?.textContent).toContain('正在启动安装程序');
  await act(async () => { reject(new DesktopUpdateError('install-failed', '安装程序启动失败')); });
  expect(container.textContent).toContain('安装程序启动失败');
  expect(button('下载并安装').disabled).toBe(false);
});

it('does not turn a failed check into an up-to-date message', async () => {
  client.check = vi.fn(async () => { throw new DesktopUpdateError('check-failed', '网络连接失败'); });
  await mount();
  await click('检查更新');
  expect(container.textContent).toContain('网络连接失败');
  expect(container.textContent).not.toContain('当前已是最新版本');
  expect(button('检查更新').disabled).toBe(false);
});

it('loads local license text only after expansion and renders it as text', async () => {
  const fetcher = vi.fn(async () => new Response('MIT\n<script>not executable</script>', { headers: { 'content-type': 'text/plain' } }));
  vi.stubGlobal('fetch', fetcher);
  await act(async () => { root.render(<ThirdPartyNoticesCard />); });
  expect(fetcher).not.toHaveBeenCalled();
  await act(async () => {
    const details = container.querySelector('details')!;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
  });
  expect(fetcher).toHaveBeenCalledWith('/THIRD_PARTY_NOTICES.txt');
  expect(container.querySelector('pre')?.textContent).toContain('<script>not executable</script>');
  expect(container.querySelector('script')).toBeNull();
});
