// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArenaWebPackageSection, type ArenaWebPackageSectionModel, type ArenaWebPackageViewHost } from '../src/arena';

let container: HTMLDivElement;
let root: Root;
const digest = `sha256:${'a'.repeat(64)}`;
const local = { digest, title: '本地测试包', kind: 'local' as const, ref: { id: 'test.local', version: '1.0.0', digest }, summary: 'test.local@1.0.0' };
const makeModel = (): ArenaWebPackageSectionModel => ({
  active: true, disabled: false, selected: local, presets: [], library: [local],
  importFeedback: null, downloadError: null, libraryError: null,
  importing: false, busyDigest: null, downloadingDigest: null, saveImportedToLibrary: false,
  capabilities: { importLocal: true, downloadPreset: true, remove: true, replace: true, manageLibrary: true },
  actions: { select: vi.fn(), remove: vi.fn(), downloadPreset: vi.fn(async () => {}), downloadFromLibrary: vi.fn(async () => {}), importFile: vi.fn(async () => {}), removeFromLibrary: vi.fn(async () => {}), setSaveImportedToLibrary: vi.fn(), reloadLibrary: vi.fn() },
});
const button = (label: string) => [...document.querySelectorAll('button')].reverse().find((item) => item.textContent?.trim() === label)!;
const byLabel = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const render = async (model: ArenaWebPackageSectionModel, host?: ArenaWebPackageViewHost) => {
  await act(async () => root.render(<ArenaWebPackageSection model={model} host={host} />));
};
const click = async (target: HTMLElement) => { expect(target).toBeTruthy(); await act(async () => target.click()); };
const openLocal = async () => { await click(document.querySelector('[data-testid="arena-web-package-open-picker"]')!); await click([...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) => tab.textContent?.includes('本地库'))!); };
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('shared controlled Web package selector', () => {
  it('has no implicit scan, storage preference, navigation or import, and defaults to current-page copy', async () => {
    const model = makeModel();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    await render(model);
    await openLocal();
    expect(document.body.textContent).toContain('当前页面接下来导入');
    expect(document.body.textContent).not.toContain('清除站点数据');
    expect(document.querySelector('a,img,iframe')).toBeNull();
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
    for (const action of Object.values(model.actions)) expect(action).not.toHaveBeenCalled();
    await click(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    expect(model.actions.setSaveImportedToLibrary).toHaveBeenCalledWith(true);
    expect(storage).not.toHaveBeenCalled();
  });

  it('separates removing the selection, confirmed deletion and read-only export', async () => {
    const model = makeModel();
    await render(model);
    await click(button('移除选择'));
    expect(model.actions.remove).toHaveBeenCalledOnce();
    expect(model.actions.removeFromLibrary).not.toHaveBeenCalled();
    await openLocal();
    await click(byLabel('下载 Web 包 ZIP：本地测试包'));
    expect(model.actions.downloadFromLibrary).toHaveBeenCalledWith(digest);
    await click(byLabel('从本地库删除：本地测试包'));
    expect(model.actions.removeFromLibrary).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('历史战报正文保留');
    await click(button('取消'));
    expect(model.actions.removeFromLibrary).not.toHaveBeenCalled();
    await click(byLabel('从本地库删除：本地测试包'));
    await click(button('删除'));
    expect(model.actions.removeFromLibrary).toHaveBeenCalledWith(digest);
  });

  it('preserves cancelled/failed removal and prevents repeated pending calls or stale modal close', async () => {
    const model = makeModel();
    let settle!: (outcome: 'cancelled' | 'failed' | void) => void;
    const remove = vi.fn(() => new Promise<void | 'cancelled' | 'failed'>((resolve) => { settle = resolve; }));
    await render({ ...model, actions: { ...model.actions, removeFromLibrary: remove } });
    await openLocal();
    await click(byLabel('从本地库删除：本地测试包'));
    await click(button('删除'));
    await click(button('删除'));
    expect(remove).toHaveBeenCalledOnce();
    await act(async () => settle('cancelled'));
    expect(button('删除')).toBeTruthy();
    await click(button('删除'));
    await act(async () => settle('failed'));
    expect(button('删除')).toBeTruthy();
    await click(button('删除'));
    await click(button('取消'));
    await click(byLabel('从本地库删除：本地测试包'));
    await act(async () => settle());
    expect(button('删除')).toBeTruthy();
  });

  it('keeps library failures distinct from empty state and host copy/slots controlled', async () => {
    const model = makeModel();
    await render({ ...model, library: [], selected: null, libraryError: '磁盘不可读' }, {
      copy: { libraryReadErrorHint: '磁盘不可读，请检查本机权限后重试。' },
      libraryStatus: <span>本机独立包库</span>,
      renderHelpLink: (label) => <button type="button">{label}</button>,
    });
    await openLocal();
    expect(document.body.textContent).toContain('本地库暂时读不出来');
    expect(document.body.textContent).not.toContain('还没有本地 Web 包');
    expect(document.body.textContent).toContain('本机独立包库');
    expect(document.body.textContent).not.toContain('浏览器是否允许');
    await click(button('重新读取本地库'));
    expect(model.actions.reloadLibrary).toHaveBeenCalledOnce();
  });

  it('blocks an already-open deletion when the host becomes busy, and does not restore dialogs after leaving Web format', async () => {
    const model = makeModel();
    await render(model);
    await openLocal();
    await click(byLabel('从本地库删除：本地测试包'));
    await render({ ...model, disabled: true });
    expect(button('删除').disabled).toBe(true);
    await click(button('删除'));
    expect(model.actions.removeFromLibrary).not.toHaveBeenCalled();
    await render({ ...model, active: false });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await render(model);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('keeps readonly details/export available while selection and import are disabled', async () => {
    const model = makeModel();
    await render({ ...model, disabled: true });
    await openLocal();
    expect(byLabel('取消选择 Web 包：本地测试包').disabled).toBe(true);
    expect(byLabel('从本地库删除：本地测试包').disabled).toBe(true);
    expect(document.querySelector<HTMLInputElement>('[data-testid="web-package-import-input"]')?.disabled).toBe(true);
    await click(byLabel('下载 Web 包 ZIP：本地测试包'));
    expect(model.actions.downloadFromLibrary).toHaveBeenCalledOnce();
    await click(byLabel('查看 Web 包详情：本地测试包'));
    expect(document.body.textContent).toContain('内容摘要');
    expect(document.body.textContent).toContain(digest);
  });
});
