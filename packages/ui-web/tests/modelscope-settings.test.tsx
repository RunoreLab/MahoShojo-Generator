// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MODELSCOPE_SIZE_OPTIONS } from '@mahoshojo/ai-core/modelscope';
import { ModelScopeSettingsFields } from '../src/image-generation';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

it('保留五档尺寸与原标签，受控选择只通知宿主且拒绝非法值', () => {
  const change = vi.fn();
  act(() => root.render(<ModelScopeSettingsFields size="1328x1328" onSizeChange={change} />));
  const select = container.querySelector('select')!;
  expect(Array.from(select.options, (option) => ({ value: option.value, label: option.text }))).toEqual(MODELSCOPE_SIZE_OPTIONS);
  expect(select.value).toBe('1328x1328');
  expect(container.querySelector('input')).toBeNull();
  expect(change).not.toHaveBeenCalled();
  act(() => { select.value = '928x1664'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(change).toHaveBeenCalledExactlyOnceWith('928x1664');
  act(() => { select.value = 'invalid'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(change).toHaveBeenCalledTimes(1);
  act(() => root.render(<ModelScopeSettingsFields size="1472x1104" onSizeChange={change} />));
  expect(select.value).toBe('1472x1104');
});

it('可选模型保留空白输入原文，重复挂载的 label 与 ID 不串联且能禁用', () => {
  const change = vi.fn(); const sizeChange = vi.fn();
  const render = (disabled = false) => <><ModelScopeSettingsFields compact size="1328x1328" onSizeChange={sizeChange}
    model={{ value: '', onChange: change }} disabled={disabled} />
    <ModelScopeSettingsFields size="1664x928" onSizeChange={sizeChange} /></>;
  act(() => root.render(render()));
  const ids = Array.from(container.querySelectorAll('[id]'), (element) => element.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const label of container.querySelectorAll('label')) expect(label.control?.id).toBe(label.htmlFor);
  const input = container.querySelector('input')!;
  expect(input.value).toBe('');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '  custom/model  ');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(change).toHaveBeenCalledExactlyOnceWith('  custom/model  ');
  expect(sizeChange).not.toHaveBeenCalled();
  act(() => root.render(render(true)));
  expect(input.disabled).toBe(true);
  expect(container.querySelector('select')!.disabled).toBe(true);
  expect(container.querySelectorAll('select')[1].disabled).toBe(false);
});
