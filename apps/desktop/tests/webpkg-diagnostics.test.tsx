// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalWebPackageRecordV1 } from '@mahoshojo/local-library/web-package-record';
import { arenaWebPackageFixture } from './fixtures/arena-web-package';
import { WebPackageDiagnosticsPanel } from '../src/features/webpkg/WebPackageDiagnosticsPanel';

const ports = vi.hoisted(() => ({
  list: vi.fn(), readArchive: vi.fn(), invoke: vi.fn(),
  consentViews: [] as { onAccept: () => void; onCancel: () => void }[],
}));
vi.mock('@mahoshojo/ui-web/arena-report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mahoshojo/ui-web/arena-report')>();
  return { ...actual, WebReportConsentDialogView: (props: import('@mahoshojo/ui-web/arena-report').WebReportConsentDialogViewProps) => {
    ports.consentViews.push(props);
    return <actual.WebReportConsentDialogView {...props} />;
  } };
});
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
const dialog = () => document.querySelector('[role="dialog"]');
const consentButton = (label = '继续使用 Web') => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent === label)!;
const waitForConsent = async () => {
  const deadline = Date.now() + 1_000;
  while (!dialog() && Date.now() < deadline) await flush();
  expect(dialog()).toBeTruthy();
};
const accept = async () => { await waitForConsent(); await act(async () => consentButton().click()); await flush(); };
beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto);
  ({ archive } = await arenaWebPackageFixture());
  record = { id: 'synthetic-record', title: '当前合成包', ref: { id: 'local.desktop-output', version: '1.0.0', digest: `sha256:${'a'.repeat(64)}` } } as LocalWebPackageRecordV1;
});
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  ports.consentViews.length = 0;
  window.localStorage.clear();
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
    await mount(); await act(async () => openButton().click()); await waitForConsent();
    expect(dialog()?.textContent).toContain('本地 json 包');
    expect(dialog()?.textContent).toContain('版本 1.0.0');
    expect(dialog()?.textContent).toContain('按导入原样运行');
    expect(dialog()?.textContent).toContain('不含生成覆盖层');
    expect(dialog()?.textContent).not.toContain('当前合成包');
    expect(dialog()?.querySelector('input')).toBeNull();
    expect(ports.invoke).not.toHaveBeenCalled();
    await accept();
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
    read.resolve(archive); await waitForConsent();
    expect(ports.invoke).not.toHaveBeenCalled();
    const confirm = consentButton();
    await act(async () => { confirm.click(); confirm.click(); }); await flush();
    expect(commands().filter((command) => command === 'begin_web_package_instance')).toHaveLength(1);
    expect(commands().filter((command) => command === 'open_web_package_instance')).toHaveLength(1);
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
    await mount(); await act(async () => openButton().click()); await accept();
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
    await act(async () => openButton().click()); await accept();
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
    await mount(); await act(async () => openButton().click()); await accept();
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

  it('cancels without staging and requires a fresh confirmation for every successful run', async () => {
    window.localStorage.setItem('arena.web-report-consent.v1', 'accepted');
    const read = vi.spyOn(Storage.prototype, 'getItem');
    const write = vi.spyOn(Storage.prototype, 'setItem');
    await mount(); await act(async () => openButton().click()); await waitForConsent();
    await act(async () => consentButton('取消').click()); await flush();
    expect(dialog()).toBeNull();
    expect(ports.invoke).not.toHaveBeenCalled();
    expect(openButton().disabled).toBe(false);
    await act(async () => openButton().click()); await accept();
    expect(commands().filter((command) => command === 'open_web_package_instance')).toHaveLength(1);
    await act(async () => openButton().click()); await waitForConsent();
    expect(commands().filter((command) => command === 'open_web_package_instance')).toHaveLength(1);
    await accept();
    expect(commands().filter((command) => command === 'open_web_package_instance')).toHaveLength(2);
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('does not reuse an accepted confirmation after a staging failure', async () => {
    ports.invoke.mockRejectedValueOnce(new Error('合成暂存失败'));
    await mount(); await act(async () => openButton().click()); await accept();
    expect(container.textContent).toContain('Web Package 实例调用失败（webpkg-failure）');
    expect(container.textContent).not.toContain('合成暂存失败');
    expect(commands()).toEqual(['begin_web_package_instance']);
    expect(openButton().disabled).toBe(false);
    await act(async () => openButton().click()); await waitForConsent();
    expect(commands()).toEqual(['begin_web_package_instance']);
    await accept();
    expect(commands().filter((command) => command === 'begin_web_package_instance')).toHaveLength(2);
    expect(commands().filter((command) => command === 'open_web_package_instance')).toHaveLength(1);
  });

  it('cancels on Escape without dispatching any instance command', async () => {
    await mount(); await act(async () => openButton().click()); await waitForConsent();
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await flush();
    expect(dialog()).toBeNull();
    expect(ports.invoke).not.toHaveBeenCalled();
    expect(openButton().disabled).toBe(false);
  });

  it('locks refresh and other targets during confirmation and rejects callbacks for a cancelled target', async () => {
    ports.list.mockResolvedValue({ items: [record, { ...record, id: 'second-record', title: '第二个包' }], nextCursor: null });
    await mount();
    const opens = [...container.querySelectorAll('button')].filter((button) => button.textContent === '在受限 webview 中打开');
    const refresh = [...container.querySelectorAll('button')].find((button) => button.textContent === '刷新列表')!;
    await act(async () => opens[0]!.click()); await waitForConsent();
    const oldConsent = ports.consentViews.at(-1)!;
    expect(opens.every((button) => button.disabled)).toBe(true);
    expect(refresh.disabled).toBe(true);
    await act(async () => { opens[1]!.click(); refresh.click(); });
    expect(ports.list).toHaveBeenCalledTimes(1);
    expect(ports.readArchive).toHaveBeenCalledTimes(1);
    await act(async () => consentButton('取消').click()); await flush();
    const second = await arenaWebPackageFixture({ version: '2.0.0', mediaType: 'text/html' });
    ports.readArchive.mockResolvedValue(second.archive);
    await act(async () => opens[1]!.click()); await waitForConsent();
    expect(dialog()?.textContent).toContain('本地 html 包');
    expect(dialog()?.textContent).toContain('版本 2.0.0');
    await act(async () => { oldConsent.onAccept(); oldConsent.onCancel(); });
    expect(dialog()?.textContent).toContain('版本 2.0.0');
    expect(ports.invoke).not.toHaveBeenCalled();
    await accept();
    expect(commands().filter((command) => command === 'begin_web_package_instance')).toHaveLength(1);
    expect(ports.invoke.mock.calls.find(([command]) => command === 'begin_web_package_instance')?.[1]).toMatchObject({ request: { title: '本地 html 包' } });
  });

  it('does not begin if the owner unmounts in the same tick as accepting', async () => {
    await mount(); await act(async () => openButton().click()); await waitForConsent();
    await act(async () => {
      consentButton().click();
      root!.unmount(); root = null;
    });
    await flush();
    expect(ports.invoke).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it('invalidates a pending confirmation on unmount without leaking it into a later panel', async () => {
    await mount(); await act(async () => openButton().click()); await waitForConsent();
    const expiredConsent = ports.consentViews.at(-1)!;
    await unmount();
    expect(dialog()).toBeNull();
    await act(async () => expiredConsent.onAccept()); await flush();
    expect(ports.invoke).not.toHaveBeenCalled();
    root = createRoot(container); await mount();
    await act(async () => openButton().click()); await waitForConsent();
    await act(async () => expiredConsent.onAccept());
    expect(ports.invoke).not.toHaveBeenCalled();
    expect(dialog()).toBeTruthy();
    await accept();
    expect(commands().filter((command) => command === 'open_web_package_instance')).toHaveLength(1);
  });

});
