// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalWebPackageRecordV1 } from '@mahoshojo/local-library/web-package-record';
import { arenaWebPackageFixture } from './fixtures/arena-web-package';
import { WebPackageDiagnosticsPanel } from '../src/features/webpkg/WebPackageDiagnosticsPanel';

const ports = vi.hoisted(() => ({ list: vi.fn(), readArchive: vi.fn(), invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: ports.invoke }));
vi.mock('../src/platform/web-package-bridge', () => ({
  IpcWebPackageRepository: class { list = ports.list; readArchive = ports.readArchive; },
}));
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
let root: Root | null;
let container: HTMLDivElement;
let archive: Uint8Array;
let record: LocalWebPackageRecordV1;
const page = (title = '当前合成包') => ({ items: [{ ...record, title }], nextCursor: null });
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 15)); }); };
const openButton = () => [...container.querySelectorAll('button')].find((button) => button.textContent === '在受限 webview 中打开')!;
const commands = () => ports.invoke.mock.calls.map(([command]) => command);
beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto);
  ({ archive } = await arenaWebPackageFixture());
  record = { id: 'synthetic-record', title: '当前合成包', ref: { id: 'local.desktop-output', version: '1.0.0', digest: `sha256:${'a'.repeat(64)}` } } as LocalWebPackageRecordV1;
});
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  ports.list.mockReset().mockResolvedValue(page());
  ports.readArchive.mockReset().mockResolvedValue(archive);
  ports.invoke.mockReset().mockImplementation(async (command, body, options) => {
    if (command === 'begin_web_package_instance') return { instanceId: 'wpk-7' };
    if (command === 'append_web_package_resource') return { receivedByteLength: Number(options.headers['x-webpkg-offset']) + body.byteLength };
    if (command === 'open_web_package_instance') return { label: 'webpkg-wpk-7' };
    throw new Error(`unexpected IPC ${command}`);
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); container.remove(); });
const mount = async (strict = false) => { await act(async () => root!.render(strict ? <StrictMode><WebPackageDiagnosticsPanel /></StrictMode> : <WebPackageDiagnosticsPanel />)); await flush(); };
const unmount = async () => { await act(async () => root!.unmount()); root = null; };

describe('Web package diagnostics owner lifecycle', () => {
  it('runs the existing real unpack/snapshot/bridge path while mounted', async () => {
    await mount(); await act(async () => openButton().click()); await flush();
    expect(container.textContent).toContain('已在受限 webview 打开（webpkg-wpk-7）');
    expect(commands()[0]).toBe('begin_web_package_instance');
    expect(commands().at(-1)).toBe('open_web_package_instance');
    expect(container.textContent).toContain('已派发的打开仍可能建立窗口');
  });

  it('locks same-tick repeated clicks before any archive read', async () => {
    const read = deferred<Uint8Array>(); ports.readArchive.mockReturnValue(read.promise);
    await mount(); const button = openButton();
    await act(async () => { button.click(); button.click(); });
    expect(ports.readArchive).toHaveBeenCalledTimes(1);
    read.resolve(archive); await flush();
  });

  it('does not begin when archive reading finishes after unmount', async () => {
    const read = deferred<Uint8Array>(); ports.readArchive.mockReturnValue(read.promise);
    await mount(); await act(async () => openButton().click()); await unmount();
    read.resolve(archive); await flush();
    expect(ports.invoke).not.toHaveBeenCalled();
  });

  it('does not append after a late begin response reaches an unmounted diagnostics owner', async () => {
    const begin = deferred<{ instanceId: string }>();
    ports.invoke.mockImplementation(async (command) => command === 'begin_web_package_instance' ? begin.promise : { receivedByteLength: 0, label: 'webpkg-wpk-7' });
    await mount(); await act(async () => openButton().click());
    await vi.waitFor(() => expect(commands()).toEqual(['begin_web_package_instance']));
    await unmount(); begin.resolve({ instanceId: 'wpk-7' }); await flush();
    expect(commands()).toEqual(['begin_web_package_instance']);
  });

  it('releases the synchronous lock after a real failure and only retries on explicit click', async () => {
    ports.readArchive.mockRejectedValueOnce(new Error('合成读取失败'));
    await mount(); await act(async () => openButton().click()); await flush();
    expect(container.textContent).toContain('合成读取失败');
    expect(ports.readArchive).toHaveBeenCalledTimes(1);
    expect(openButton().disabled).toBe(false);
    await act(async () => openButton().click()); await flush();
    expect(ports.readArchive).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('已在受限 webview 打开');
    expect(container.textContent).not.toContain('合成读取失败');
  });

  it('locks refresh in the same tick and disables opens until the current read completes', async () => {
    await mount();
    const next = deferred<ReturnType<typeof page>>(); ports.list.mockReturnValue(next.promise);
    const refresh = [...container.querySelectorAll('button')].find((button) => button.textContent === '刷新列表')!;
    await act(async () => { refresh.click(); refresh.click(); });
    expect(ports.list).toHaveBeenCalledTimes(2);
    expect(openButton().disabled).toBe(true);
    next.resolve(page()); await flush(); expect(openButton().disabled).toBe(false);
  });

  it('does not publish a dispatched open receipt into a later mounted panel or send rollback IPC', async () => {
    const open = deferred<{ label: string }>();
    const normal = ports.invoke.getMockImplementation()!;
    ports.invoke.mockImplementation((command, ...args) => command === 'open_web_package_instance' ? open.promise : normal(command, ...args));
    await mount(); await act(async () => openButton().click());
    await vi.waitFor(() => expect(commands().at(-1)).toBe('open_web_package_instance'));
    await unmount(); root = createRoot(container); await mount();
    open.resolve({ label: 'webpkg-wpk-7' }); await flush();
    expect(container.textContent).not.toContain('已在受限 webview 打开');
    expect(commands().filter((command) => command === 'open_web_package_instance')).toHaveLength(1);
    expect(commands().every((command) => ['begin_web_package_instance', 'append_web_package_resource', 'open_web_package_instance'].includes(command))).toBe(true);
  });

  it('does not let an old StrictMode finally release the new pending list lock', async () => {
    const first = deferred<ReturnType<typeof page>>();
    const second = deferred<ReturnType<typeof page>>();
    ports.list.mockReturnValueOnce(first.promise).mockReturnValue(second.promise);
    await mount(true);
    first.resolve(page('过期列表')); await flush();
    expect(container.textContent).toContain('正在读取本地 Web 包');
    expect(container.textContent).not.toContain('过期列表');
    const refresh = [...container.querySelectorAll('button')].find((button) => button.textContent === '刷新列表')!;
    expect(refresh.disabled).toBe(true);
    await act(async () => refresh.click());
    expect(ports.list).toHaveBeenCalledTimes(2);
    second.resolve(page('当前列表')); await flush();
    expect(container.textContent).toContain('当前列表');
    expect(refresh.disabled).toBe(false);
  });

  it('fences a StrictMode effect generation so the old list cannot replace the current one', async () => {
    const first = deferred<ReturnType<typeof page>>();
    ports.list.mockReturnValueOnce(first.promise).mockResolvedValue(page('新生命周期包'));
    await mount(true);
    expect(container.textContent).toContain('新生命周期包');
    first.resolve(page('旧生命周期包')); await flush();
    expect(container.textContent).not.toContain('旧生命周期包');
    expect(container.textContent).toContain('新生命周期包');
  });
});
