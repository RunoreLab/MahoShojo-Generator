// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { AiProviderCustomSelect } from '../src/ai-provider';

let host: HTMLDivElement;
let root: Root;
const scrollIntoView = vi.fn();
const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
const options = Array.from({ length: 10 }, (_, index) => ({ value: `${index}`, label: `模型 ${index}` }));
const rect = (top: number, height: number) => ({ top, bottom: top + height, height }) as DOMRect;
const trigger = () => host.querySelector<HTMLButtonElement>('[role="combobox"]')!;
const menu = () => host.querySelector<HTMLElement>('.battle-lite-select-menu')!;
const key = async (value: string) => act(async () => {
  trigger().dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
});
const render = async (withActions = false, selected = '8') => act(async () => {
  root.render(<div className="ancestor"><AiProviderCustomSelect
    // 模拟生成进度/可用性更新，以及 Desktop 每次创建的新数组。
    options={options.map(option => ({ ...option }))} value={selected} onChange={() => {}}
    placeholder="选择模型" actions={withActions ? [{ id: 'manage', label: '管理连接' }] : undefined}
  /></div>);
});

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal('CSS', { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '\\$&') });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('battle-lite-select-menu') ? 100 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientTop', 'get').mockReturnValue(2);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('battle-lite-select-menu')) return rect(100, 104);
    const parent = this.closest<HTMLElement>('.battle-lite-select-menu');
    if (!parent) return rect(0, 0);
    const items = [...parent.querySelectorAll('button')];
    const index = items.indexOf(this as HTMLButtonElement);
    return index < 0 ? rect(0, 0) : rect(102 + index * 40 - parent.scrollTop, 40);
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
  else delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  scrollIntoView.mockClear();
});

it.each([false, true])('打开与键盘导航只滚动菜单，父级重渲染/悬停不接管位置（actions=%s）', async withActions => {
  await render(withActions);
  const ancestor = host.querySelector<HTMLElement>('.ancestor')!;
  ancestor.scrollTop = 33;
  await act(async () => trigger().click());
  expect(menu().scrollTop).toBe(260); // 选中项底部恰好落在菜单可视底部，含边框。
  expect(ancestor.scrollTop).toBe(33);
  expect(scrollIntoView).not.toHaveBeenCalled();

  menu().scrollTop = 80; // 用户主动滚动，生成进度更新不能拉回选中模型。
  await render(withActions);
  expect(menu().scrollTop).toBe(80);
  const last = menu().querySelectorAll('button')[9];
  await act(async () => last.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  expect(menu().scrollTop).toBe(80);
  expect(trigger().getAttribute('aria-activedescendant')).toBe(last.id);

  await key('End');
  expect(menu().scrollTop).toBe(withActions ? 340 : 300);
  expect(trigger().getAttribute('aria-activedescendant')).toBe(withActions ? null : last.id);
  await key('Home');
  expect(menu().scrollTop).toBe(0);
  menu().scrollTop = 100;
  await key('Home'); // 即使活动下标未变，显式导航仍恢复可见。
  expect(menu().scrollTop).toBe(0);
  await key('ArrowDown');
  expect(menu().scrollTop).toBe(0);
  expect(ancestor.scrollTop).toBe(33);
  expect(scrollIntoView).not.toHaveBeenCalled();
});

it('模型与动作总数不变但分界变化后，方向键定位当前序列的模型', async () => {
  const view = (withAction: boolean) => <AiProviderCustomSelect
    options={options.slice(0, withAction ? 2 : 3)} value="0" onChange={() => {}} placeholder="选择模型"
    actions={withAction ? [{ id: 'manage', label: '管理连接' }] : []}
  />;
  await act(async () => root.render(view(true)));
  await act(async () => trigger().click());
  await act(async () => root.render(view(false)));
  await key('ArrowDown');
  await key('ArrowDown');
  expect(menu().scrollTop).toBe(20);
  const active = trigger().getAttribute('aria-activedescendant')!;
  expect(document.getElementById(active)?.textContent).toBe('模型 2');
});

it('关闭后恢复焦点禁止浏览器隐式滚动', async () => {
  await render();
  await act(async () => trigger().click());
  const focus = vi.spyOn(trigger(), 'focus');
  await key('Escape');
  // Escape 仅在焦点原本属于此控件时恢复。
  await act(async () => { trigger().focus(); trigger().click(); });
  focus.mockClear();
  await key('Escape');
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
});
