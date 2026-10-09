// @vitest-environment jsdom
import { act, useEffect, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TavernPage } from '@/components/tavern/TavernPage';

type PanelKind = 'import' | 'export';
const lifecycle = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn() }));

// Keep the real page, hero, and shared tabs/panels. Only costly host operations
// are replaced: local draft state and busy propagation remain real React flows.
function TestPanel({ kind, onBusyChange }: { kind: PanelKind; onBusyChange?: (busy: boolean) => void }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    lifecycle.mount(kind);
    return () => { lifecycle.unmount(kind); };
  }, [kind]);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => () => { onBusyChange?.(false); }, [onBusyChange]);
  return <section data-host-panel={kind}>
    <input aria-label={`${kind} 草稿`} value={draft} onChange={(event) => setDraft(event.target.value)} />
    <button type="button" onClick={() => setBusy(true)}>{kind} 开始忙碌</button>
    <button type="button" onClick={() => setBusy(false)}>{kind} 结束忙碌</button>
  </section>;
}

vi.mock('@/components/tavern/TavernImportPanel', () => ({
  TavernImportPanel: (props: { onBusyChange?: (busy: boolean) => void }) => <TestPanel kind="import" {...props} />,
}));
vi.mock('@/components/tavern/TavernExportPanel', () => ({
  TavernExportPanel: (props: { onBusyChange?: (busy: boolean) => void }) => <TestPanel kind="export" {...props} />,
}));
vi.mock('@/components/Footer', () => ({ default: () => <footer>测试页脚</footer> }));
vi.mock('next/link', () => ({ default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a> }));

let root: Root;
let container: HTMLDivElement;
let mounted: boolean;
const tab = (kind: PanelKind) => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((element) => element.textContent === (kind === 'import' ? '导入' : '导出'))!;
const panel = (kind: PanelKind) => document.getElementById(tab(kind).getAttribute('aria-controls')!)!;
const input = (kind: PanelKind) => container.querySelector<HTMLInputElement>(`[aria-label="${kind} 草稿"]`)!;
async function choose(kind: PanelKind) { await act(async () => tab(kind).click()); }
async function changeDraft(kind: PanelKind, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(kind), value);
    input(kind).dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function changeBusy(kind: PanelKind, busy: boolean) {
  const label = `${kind} ${busy ? '开始' : '结束'}忙碌`;
  const button = [...panel(kind).querySelectorAll('button')].find((element) => element.textContent === label)!;
  await act(async () => button.click());
}
function assertLinkedPanel(kind: PanelKind, selected: boolean) {
  expect(tab(kind).getAttribute('aria-selected')).toBe(String(selected));
  expect(tab(kind).getAttribute('aria-controls')).toBe(panel(kind).id);
  expect(panel(kind).getAttribute('aria-labelledby')).toBe(tab(kind).id);
  expect(panel(kind).getAttribute('role')).toBe('tabpanel');
  expect(panel(kind).hidden).toBe(!selected);
  expect(getComputedStyle(panel(kind)).display === 'none').toBe(!selected);
}

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mounted = true;
  act(() => root.render(<TavernPage />));
});
afterEach(() => {
  if (mounted) act(() => root.unmount());
  container.remove();
});

describe('Web TavernPage 的真实共享 tab 生命周期接线', () => {
  it('初始只挂载导入，两个 tab 与 panel 都保持双向 ARIA 关联', () => {
    expect(lifecycle.mount.mock.calls).toEqual([['import']]);
    expect(input('import')).not.toBeNull();
    expect(input('export')).toBeNull();
    expect(panel('export').childElementCount).toBe(0);
    assertLinkedPanel('import', true);
    assertLinkedPanel('export', false);
    expect(tab('import').tabIndex).toBe(0);
    expect(tab('export').tabIndex).toBe(-1);
  });

  it('首次访问导出才挂载；来回切换保留两侧本页草稿且不重复挂卸载', async () => {
    await changeDraft('import', '导入侧草稿');
    await choose('export');
    expect(lifecycle.mount.mock.calls).toEqual([['import'], ['export']]);
    await changeDraft('export', '未下载的导出编辑');
    await choose('import');
    assertLinkedPanel('import', true); assertLinkedPanel('export', false);
    expect(input('import').value).toBe('导入侧草稿');
    expect(input('export').value).toBe('未下载的导出编辑');
    await choose('export');
    assertLinkedPanel('import', false); assertLinkedPanel('export', true);
    expect(input('export').value).toBe('未下载的导出编辑');
    expect(lifecycle.mount).toHaveBeenCalledTimes(2);
    expect(lifecycle.unmount).not.toHaveBeenCalled();
  });

  it.each<PanelKind>(['import', 'export'])('%s 的 busy 回调禁用 tab，结束后恢复切换', async (kind) => {
    await choose(kind);
    const next: PanelKind = kind === 'import' ? 'export' : 'import';
    await changeBusy(kind, true);
    expect(tab('import').disabled).toBe(true); expect(tab('export').disabled).toBe(true);
    await choose(next);
    assertLinkedPanel(kind, true); assertLinkedPanel(next, false);
    await act(async () => tab(kind).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    assertLinkedPanel(kind, true);
    await changeBusy(kind, false);
    expect(tab('import').disabled).toBe(false); expect(tab('export').disabled).toBe(false);
    await choose(next);
    assertLinkedPanel(kind, false); assertLinkedPanel(next, true);
  });

  it('键盘切换沿用真实 shared tabs 的焦点及 lazy panel 接线', async () => {
    await act(async () => {
      tab('import').focus();
      tab('import').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    assertLinkedPanel('export', true);
    expect(document.activeElement).toBe(tab('export'));
    expect(lifecycle.mount.mock.calls).toEqual([['import'], ['export']]);
    await act(async () => tab('export').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
    assertLinkedPanel('import', true);
    expect(document.activeElement).toBe(tab('import'));
  });

  it('页面卸载清理已访问的双方，重新进入不会复用已销毁的页面草稿', async () => {
    await choose('export'); await changeDraft('export', '只在本页保留'); await changeBusy('export', true);
    act(() => root.unmount()); mounted = false;
    expect(lifecycle.unmount.mock.calls.map(([kind]) => kind).sort()).toEqual(['export', 'import']);
    expect(container.childElementCount).toBe(0);
    root = createRoot(container); mounted = true;
    act(() => root.render(<TavernPage />));
    assertLinkedPanel('import', true);
    expect(tab('export').disabled).toBe(false);
    expect(input('export')).toBeNull();
    await choose('export');
    expect(input('export').value).toBe('');
  });
});
