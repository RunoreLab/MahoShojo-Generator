// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FreePageLayout, FreeSchemaFields, FreePromptField, FreeLanguageField, freeSchemaOptionsForMode } from '../src/free/index';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

it('shares input/preview layout without a runtime flag and replaces the empty preview with real output', () => {
  act(() => root.render(<FreePageLayout controls={<textarea defaultValue="保留输入" />} footer={<footer>页脚</footer>} />));
  const preview = container.querySelector('[data-testid="free-preview"]')!;
  expect(preview.textContent).toContain('预览区');
  expect(preview.parentElement?.className).toContain('lg:grid-cols-2');
  expect(preview.parentElement?.parentElement?.className).toContain('lg:!max-w-[1200px]');
  expect(container.querySelector('.container > footer')).not.toBeNull();
  act(() => root.render(<FreePageLayout controls={<textarea defaultValue="保留输入" />} result={<div role="status">部分输出</div>} />));
  expect(preview.textContent).not.toContain('预览区');
  expect(preview.textContent).toContain('部分输出');
  expect(container.querySelector('textarea')?.value).toBe('保留输入');
});

it('renders the effective schema options and delegates selection and guide actions without resetting inputs', () => {
  const change = vi.fn(); const toggle = vi.fn();
  act(() => root.render(<FreeSchemaFields schemaId="general" options={freeSchemaOptionsForMode('stream')} onChange={change} showFieldGuide={false} onToggleFieldGuide={toggle} />));
  const select = container.querySelector('select')!;
  expect([...select.options].map((option) => option.value)).toEqual(['general', 'general-scenario']);
  act(() => { select.value = 'general-scenario'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(change).toHaveBeenCalledWith('general-scenario');
  act(() => container.querySelector('button')!.click());
  expect(toggle).toHaveBeenCalledOnce();
  act(() => root.render(<FreeSchemaFields schemaId="magical-girl" options={freeSchemaOptionsForMode('non-stream')} onChange={change} showFieldGuide onToggleFieldGuide={toggle} disabled />));
  expect(container.querySelector('select')!.options).toHaveLength(5);
  expect(container.querySelector('select')!.disabled).toBe(true);
  expect(container.textContent).toContain('codename');
});

it('keeps long prompt content, host actions and transport-limit explanations visible', () => {
  const prompt = '长提示词'.repeat(5000); const change = vi.fn(); const save = vi.fn();
  act(() => root.render(<FreePromptField value={prompt} onChange={change} actions={<button onClick={save}>保存</button>} hint="本次请求上限" />));
  expect(container.querySelector('textarea')!.value).toBe(prompt);
  expect(container.querySelector('textarea')!.hasAttribute('maxlength')).toBe(false);
  expect(container.textContent).toContain(`字符数：${prompt.length}`);
  expect(container.textContent).toContain('本次请求上限');
  act(() => container.querySelector('button')!.click()); expect(save).toHaveBeenCalledOnce();
  expect(change).not.toHaveBeenCalled();
});

it('keeps language choices controlled and the host-provided fallback intact', () => {
  const change = vi.fn();
  act(() => root.render(<FreeLanguageField value="zh-CN" languages={[{ code: 'zh-CN', name: '中文' }]} expanded onToggle={vi.fn()} onChange={change} />));
  expect(container.querySelector('select')!.value).toBe('zh-CN');
  act(() => root.render(<FreeLanguageField value="zh-CN" languages={[]} expanded={false} onToggle={vi.fn()} onChange={change} />));
  expect(container.querySelector('select')).toBeNull();
  expect(change).not.toHaveBeenCalled();
});
