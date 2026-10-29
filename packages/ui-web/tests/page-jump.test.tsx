// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PageJump } from '../src/pagination';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
const input = () => container.querySelector('input')!;
const button = () => container.querySelector('button')!;
const type = (value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
  input().dispatchEvent(new Event('input', { bubbles: true }));
});
const enter = (isComposing = false) => act(() => input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing })));

it('草稿不查询，按钮或 Enter 确认仅提交目标页；回车不提交外层表单', () => {
  const change = vi.fn(); const submit = vi.fn();
  act(() => root.render(<form onSubmit={submit}><PageJump currentPage={1} totalPages={10000} onPageChange={change} /></form>));
  type('9999'); expect(change).not.toHaveBeenCalled();
  act(() => button().click()); expect(change.mock.calls).toEqual([[9999]]);
  change.mockClear(); type('10000'); enter(true); expect(change).not.toHaveBeenCalled();
  enter(); expect(change.mock.calls).toEqual([[10000]]); expect(submit).not.toHaveBeenCalled();
});

it.each(['', '0', '-1', '1.5', '1e2', 'abc', '101', '9007199254740992', '2 0'])('拒绝无效页码 %s', value => {
  const change = vi.fn();
  act(() => root.render(<PageJump currentPage={1} totalPages={100} onPageChange={change} />));
  type(value); expect(button().disabled).toBe(true);
  enter(); act(() => button().click()); expect(change).not.toHaveBeenCalled();
});

it('当前页不重复查询，外部翻页与总数收缩清除旧草稿；加载中禁止跳转', () => {
  const change = vi.fn();
  const render = (page: number, total = 100, disabled = false) => act(() => root.render(<PageJump currentPage={page} totalPages={total} onPageChange={change} disabled={disabled} />));
  render(1); expect(button().disabled).toBe(true);
  type('88'); render(2); expect(input().value).toBe('2');
  render(1); expect(input().value).toBe('1');
  type('88'); render(1, 5); expect(input().value).toBe('1');
  render(1, 100); expect(input().value).toBe('1');
  type('3'); render(1, 100, true); expect(input().disabled).toBe(true); expect(button().disabled).toBe(true);
  enter(); expect(change).not.toHaveBeenCalled();
  render(1, 1); expect(container.childElementCount).toBe(0);
});

it('多列表标签独立，并关联可访问的页码范围说明', () => {
  act(() => root.render(<><PageJump label="角色分页跳转" currentPage={1} totalPages={100} onPageChange={vi.fn()} /><PageJump label="情景分页跳转" currentPage={2} totalPages={10} onPageChange={vi.fn()} /></>));
  const inputs = [...container.querySelectorAll('input')];
  expect(new Set(inputs.map(node => node.id)).size).toBe(2);
  for (const node of inputs) {
    expect(container.querySelector(`label[for="${node.id}"]`)?.textContent).toBe('前往');
    expect(document.getElementById(node.getAttribute('aria-describedby')!)?.textContent).toContain('整数页码');
  }
});
