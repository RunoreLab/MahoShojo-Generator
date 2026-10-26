// @vitest-environment jsdom
import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_NOVELAI_SETTINGS } from '@mahoshojo/ai-core/novelai';
import { NovelAISettingsFields, type NovelAISettingsFieldsProps } from '../src/image-generation';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const props = (): NovelAISettingsFieldsProps => ({
  token: '', onTokenChange: vi.fn(), prompt: '', onPromptChange: vi.fn(),
  settings: { ...DEFAULT_NOVELAI_SETTINGS }, onChange: vi.fn(),
  customMode: false, onCustomModeChange: vi.fn(), disabled: false,
  promptOptimizer: <p>宿主优化器</p>,
});
const control = (label: string) => {
  const element = [...container.querySelectorAll('label')].find(node => node.textContent === label)!;
  return document.getElementById(element.htmlFor) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
};
const edit = (label: string, value: string) => act(() => {
  const element = control(label);
  const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
    : element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
});
const button = (text: string) => [...container.querySelectorAll('button')].find(node => node.textContent?.includes(text))!;

it('简单模式保留受控字段、原始输入与可选推荐动作，不隐式改写或请求', () => {
  const value = props(); const recommended = vi.fn();
  act(() => root.render(<NovelAISettingsFields {...value} onUseRecommendedPrompt={recommended} />));
  expect(container.textContent).toContain('简单模式');
  expect(container.querySelector('input[type=number]')).toBeNull();
  expect((control('NovelAI Persistent API Token') as HTMLInputElement).type).toBe('password');
  expect(control('NovelAI Persistent API Token').getAttribute('autocomplete')).toBe('off');
  expect(value.onChange).not.toHaveBeenCalled();
  edit('NovelAI Persistent API Token', ' Bearer test-input ');
  edit('提示词', '  保留手工提示词\n');
  edit('NovelAI Base URL（可选）', 'https://example.test/prefix/');
  edit('模型版本', 'nai-diffusion-5-curated');
  expect(value.onTokenChange).toHaveBeenLastCalledWith(' Bearer test-input ');
  expect(value.onPromptChange).toHaveBeenLastCalledWith('  保留手工提示词\n');
  expect(value.onChange).toHaveBeenNthCalledWith(1, { ...value.settings, baseUrl: 'https://example.test/prefix/' });
  expect(value.onChange).toHaveBeenNthCalledWith(2, { ...value.settings, model: 'nai-diffusion-5-curated' });
  act(() => button('使用推荐提示词').click());
  expect(recommended).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('生成可能消耗账号 Anlas');
  expect(container.textContent).toContain('失败不会自动重试');
});

it('自定义模式保持空数字为 NaN、零值与种子/负面原文，不抢占宿主校验', () => {
  const value = props();
  act(() => root.render(<NovelAISettingsFields {...value} customMode />));
  edit('图片尺寸', '1024x1024');
  expect(value.onChange).toHaveBeenLastCalledWith({ ...value.settings, size: '1024x1024' });
  edit('步数（1–50）', '');
  expect(value.onChange).toHaveBeenLastCalledWith({ ...value.settings, steps: NaN });
  act(() => root.render(<NovelAISettingsFields {...value} settings={{ ...value.settings, steps: NaN, scale: NaN }} customMode />));
  expect(control('步数（1–50）').value).toBe('');
  expect(control('提示词强度（0–10）').value).toBe('');
  edit('提示词强度（0–10）', '0');
  expect(value.onChange).toHaveBeenLastCalledWith({ ...value.settings, steps: NaN, scale: 0 });
  edit('种子（留空随机）', ' 00042 ');
  expect(value.onChange).toHaveBeenLastCalledWith({ ...value.settings, steps: NaN, scale: NaN, seed: ' 00042 ' });
  edit('负面提示词（可选）', '  lowres\n');
  expect(value.onChange).toHaveBeenLastCalledWith({ ...value.settings, steps: NaN, scale: NaN, negativePrompt: '  lowres\n' });
});

it('简单/自定义切换只控制显示，宿主保存的参数重新展开后保留', () => {
  function Host() {
    const [settings, setSettings] = useState({ ...DEFAULT_NOVELAI_SETTINGS });
    const [customMode, setCustomMode] = useState(true);
    return <NovelAISettingsFields {...props()} settings={settings} onChange={setSettings}
      customMode={customMode} onCustomModeChange={setCustomMode} />;
  }
  act(() => root.render(<Host />));
  edit('步数（1–50）', '35');
  edit('种子（留空随机）', '42');
  const toggle = container.querySelector<HTMLInputElement>('input[type=checkbox]')!;
  act(() => toggle.click());
  expect(container.querySelector('input[type=number]')).toBeNull();
  act(() => toggle.click());
  expect(control('步数（1–50）').value).toBe('35');
  expect(control('种子（留空随机）').value).toBe('42');
});

it('优化器仅展开时挂载、重复展开保持状态、收起卸载并清理；禁用态不触发按钮', () => {
  const mount = vi.fn(); const cleanup = vi.fn(); const value = props();
  function Optimizer() {
    useEffect(() => { mount(); return cleanup; }, []);
    return <input aria-label="宿主优化器草稿" defaultValue="" />;
  }
  const render = (disabled = false) => act(() => root.render(<NovelAISettingsFields {...value} disabled={disabled} promptOptimizer={<Optimizer />} />));
  render();
  expect(mount).not.toHaveBeenCalled();
  const toggle = button('LLM 优化提示词');
  act(() => toggle.click());
  expect(mount).toHaveBeenCalledTimes(1);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(document.getElementById(toggle.getAttribute('aria-controls')!)).not.toBeNull();
  const draft = container.querySelector<HTMLInputElement>('[aria-label="宿主优化器草稿"]')!;
  draft.value = '未应用草稿';
  render();
  expect(mount).toHaveBeenCalledTimes(1);
  expect(container.querySelector<HTMLInputElement>('[aria-label="宿主优化器草稿"]')?.value).toBe('未应用草稿');
  act(() => toggle.click());
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[aria-label="宿主优化器草稿"]')).toBeNull();
  render(true);
  expect(container.querySelector('fieldset')?.disabled).toBe(true);
  expect(control('提示词').matches(':disabled')).toBe(true);
  act(() => toggle.click());
  expect(mount).toHaveBeenCalledTimes(1);
  render();
  act(() => toggle.click());
  expect(mount).toHaveBeenCalledTimes(2);
  expect(container.querySelector<HTMLInputElement>('[aria-label="宿主优化器草稿"]')?.value).toBe('');
});

it('多实例的标签、帮助与折叠区域 ID 不冲突', () => {
  act(() => root.render(<><NovelAISettingsFields {...props()} customMode /><NovelAISettingsFields {...props()} customMode /></>));
  const ids = [...container.querySelectorAll('[id]')].map(node => node.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const label of container.querySelectorAll<HTMLLabelElement>('label[for]')) {
    expect(document.getElementById(label.htmlFor)?.getAttribute('aria-label')).toBe(label.textContent);
  }
});
