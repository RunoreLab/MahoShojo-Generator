// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NarrativeHistoryPicker } from '../src/narrative-history';

let root: Root;
let container: HTMLDivElement;
const entries = [
  { id: 'legacy-id', title: '先发生', content: 'first', createdAt: '2020-01-01', updatedAt: '2020-01-01', extension: { future: true } },
  { id: 'next', title: '后发生', content: 'second', createdAt: '2021-01-01', updatedAt: '2021-01-01' },
];
let props: ComponentProps<typeof NarrativeHistoryPicker>;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  props = { isOpen: true, entries, lastUpdatedAt: '2021-01-01', sort: 'updated_desc', onSort: vi.fn(),
    formatDateTime: (v) => `DATE:${v}`, sourceHint: '本机历史来源', readStatus: 'ready', onClose: vi.fn(), onConfirm: vi.fn() };
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
const render = async () => { await act(async () => root.render(<NarrativeHistoryPicker {...props} />)); };
const button = (text: string) => [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes(text))!;
const click = async (text: string) => { await act(async () => button(text).click()); };
it('展示按更新时间、提交按提示词顺序，保留原对象和扩展字段', async () => {
  await render();
  const rows = [...document.body.querySelectorAll('button')].filter(b => b.querySelector('input'));
  expect(rows.map(b => b.textContent)).toEqual([expect.stringContaining('后发生'), expect.stringContaining('先发生')]);
  await click('全选'); await click('使用选中');
  expect(props.onConfirm).toHaveBeenCalledWith(entries);
  expect(vi.mocked(props.onConfirm).mock.calls[0][0][0]).toBe(entries[0]);
  expect(document.body.textContent).toContain('DATE:2021-01-01');
});
it('排序只通知宿主，缺失 ID 不会制造记录，清空仅改变选择', async () => {
  props.initialSelectedIds = ['gone', 'legacy-id']; await render();
  await act(async () => { const s = document.querySelector('select')!; s.value = 'created_asc'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(props.onSort).toHaveBeenCalledWith('created_asc');
  await click('使用选中'); expect(props.onConfirm).toHaveBeenCalledWith([entries[0]]);
  await click('全不选'); await click('不使用'); expect(props.onConfirm).toHaveBeenLastCalledWith([]);
  expect(entries).toHaveLength(2);
});
it.each(['loading', 'error'] as const)('%s 不冒充空历史且不能确认/改变排序', async (status) => {
  props.readStatus = status; props.entries = []; await render();
  expect(document.body.querySelector(status === 'error' ? '[role="alert"]' : '[role="status"]')).not.toBeNull();
  expect(document.body.textContent).not.toContain('没有匹配');
  expect(button('不使用').disabled).toBe(true); await click('不使用'); expect(props.onConfirm).not.toHaveBeenCalled();
  expect(document.querySelector('fieldset')?.disabled).toBe(true);
});
it('真正空历史可明确选择不使用；关闭/重开恢复宿主所选而非旧临时选择', async () => {
  props.entries = []; await render(); expect(document.body.textContent).toContain('没有匹配');
  await click('不使用'); expect(props.onConfirm).toHaveBeenCalledWith([]);
  props.entries = entries; await render(); await click('全选');
  props.isOpen = false; await render(); props.isOpen = true; props.initialSelectedIds = ['next']; await render();
  await click('使用选中'); expect(props.onConfirm).toHaveBeenLastCalledWith([entries[1]]);
});
it('共享模态语义支持 Escape，并恢复原滚动锁', async () => {
  document.body.style.overflow = 'auto'; await render();
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toContain('选择竞技场');
  expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭对话框');
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(props.onClose).toHaveBeenCalledTimes(1);
  props.isOpen = false; await render(); expect(document.body.style.overflow).toBe('auto');
  document.body.style.overflow = '';
});
