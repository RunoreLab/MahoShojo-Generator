// @vitest-environment jsdom
import React, { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), copy: vi.fn() }));
vi.mock('@/lib/use-generation-api-intent-latch', () => ({ useGenerationApiIntentLatch: () => ({ tryAcquire: () => ({ dispatch: mocks.dispatch }) }) }));
vi.mock('@/lib/auth', () => ({ authStorage: { getActivityHeaders: async () => ({}), getAuthHeader: async () => null } }));
vi.mock('@/lib/cooldown', () => ({ useProviderModeCooldown: () => ({ isCooldown: false, startCooldown: vi.fn(), remainingTime: 0, otherRemainingTime: 0 }) }));
vi.mock('@/lib/content-safety/client', () => ({ getSensitiveWordRedirectTarget: async () => null }));
vi.mock('@/lib/app-router-adapter', () => ({ useAppRouterAdapter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/ai/ProviderCooldownNotice', () => ({ ProviderCooldownNotice: () => null }));
vi.mock('@/components/Footer', () => ({ default: () => null }));
vi.mock('@/components/AiProviderSelector', () => ({ default: () => <div>供应商适配</div> }));
vi.mock('@/components/ai/AiReasoningPanel', () => ({ default: () => null }));
vi.mock('@/components/SaveToCloudButton', () => ({ default: () => <button>保存到云端</button> }));
vi.mock('@/components/shared/CharacterPortraitAssetPanel', () => ({ CharacterPortraitAssetPanel: () => null }));
vi.mock('@/components/GeneralCharacterCard', () => ({ default: ({ general }: { general: { content: string } }) => <div aria-label="生成结果">{general.content}</div> }));
import { FreePage } from '@/components/creation/FreePage';

import { createPagePreferencesAdapter, PagePreferencesCard } from '@mahoshojo/ui-web/settings';
import { WEB_FREE_PREFERENCES } from '@/lib/settings/page-preferences';

let root: Root; let container: HTMLDivElement;
const KEY = 'mahoshojo.free-generator.draft.v1';
const draft = { schemaId: 'general', generationMode: 'non-stream', prompt: '恢复的完整提示词', selectedLanguage: 'en', showFieldGuide: true, showLanguageSection: true };
const byText = (label: string) => [...container.querySelectorAll('button')].find((item) => item.textContent === label)!;
const mount = () => act(async () => root.render(<StrictMode><FreePage /></StrictMode>));
const edit = async (text: string) => act(async () => { const input = container.querySelector('textarea[aria-label="提示词"]')!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); });
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([{ code: 'en', name: 'English' }, { code: 'zh-CN', name: '中文' }])));
  vi.stubGlobal('alert', vi.fn());
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: mocks.copy.mockResolvedValue(undefined) } });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  mocks.dispatch.mockResolvedValue(Response.json({ templateId: '通用角色', name: '角色', content: '保留的生成正文' }));
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it('restores before autosave, copies text and clears only input while preserving settings and result', async () => {
  localStorage.setItem(KEY, JSON.stringify(draft));
  await mount();
  expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="提示词"]')?.value).toBe(draft.prompt);
  expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(draft);
  expect(mocks.dispatch).not.toHaveBeenCalled();
  await act(async () => byText('复制提示词').click());
  expect(mocks.copy).toHaveBeenCalledWith(draft.prompt);
  await act(async () => byText('开始生成').click());
  expect(container.textContent).toContain('保留的生成正文');
  await act(async () => byText('清空存档').click());
  expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ ...draft, prompt: '' });
  expect(container.textContent).toContain('保留的生成正文');
  expect(mocks.dispatch).toHaveBeenCalledOnce();
});

it('keeps unreadable stored bytes and permits editing, generation and clear without a recovery gate', async () => {
  const corrupt = '{broken-free'; localStorage.setItem(KEY, corrupt);
  await mount();
  const initialLeave = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(initialLeave); expect(initialLeave.defaultPrevented).toBe(false);
  await edit('新提示词');
  const leave = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(leave); expect(leave.defaultPrevented).toBe(true);
  await act(async () => byText('开始生成').click());
  expect(mocks.dispatch).toHaveBeenCalledOnce();
  await act(async () => byText('清空存档').click());
  expect(localStorage.getItem(KEY)).toBe(corrupt);
  expect(container.textContent).toContain('保留的生成正文');
  const leaveWithResult = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(leaveWithResult); expect(leaveWithResult.defaultPrevented).toBe(true);
});

it('preserves unknown stored fields while current inputs remain authoritative, and clears extensions with the draft', async () => {
  const extended = { ...draft, version: 42, extension: { note: '保留扩展' }, output: { text: '扩展结果' } };
  localStorage.setItem(KEY, JSON.stringify(extended));
  await mount();
  expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(extended);
  await edit('修改后的提示词');
  expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ ...extended, prompt: '修改后的提示词' });
  await act(async () => byText('清空存档').click());
  expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ ...draft, prompt: '' });
});


it('reads and writes the two preferences through the real page and settings card across remounts', async () => {
  const adapter = createPagePreferencesAdapter(WEB_FREE_PREFERENCES);
  const settings = () => act(async () => root.render(<PagePreferencesCard adapter={adapter} />));
  const toggle = (label: string) => container.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${label}"]`)!;
  const pageToggle = (label: string) => [...container.querySelectorAll('button')].find((item) => item.textContent?.startsWith(label))!;
  await settings();
  expect(toggle('默认展开「字段速览」').getAttribute('aria-checked')).toBe('false');
  await act(async () => toggle('默认展开「字段速览」').click());
  await act(async () => toggle('默认展开「生成语言」').click());
  await mount();
  expect(pageToggle('Schema 字段说明').getAttribute('aria-expanded')).toBe('true');
  expect(container.querySelector('select[aria-label="生成语言"]')).not.toBeNull();
  expect(mocks.dispatch).not.toHaveBeenCalled();
  await act(async () => pageToggle('Schema 字段说明').click());
  await act(async () => pageToggle('生成语言').click());
  await settings();
  expect(toggle('默认展开「字段速览」').getAttribute('aria-checked')).toBe('false');
  expect(toggle('默认展开「生成语言」').getAttribute('aria-checked')).toBe('false');
  await act(async () => toggle('默认展开「字段速览」').click());
  await act(async () => pageToggle('重置该页偏好').click());
  await act(async () => pageToggle('确认重置').click());
  await mount();
  expect(pageToggle('Schema 字段说明').getAttribute('aria-expanded')).toBe('false');
  expect(container.querySelector('select[aria-label="生成语言"]')).toBeNull();
  expect(mocks.dispatch).not.toHaveBeenCalled();
});

it('shows the settings error and preserves storage when a preference cannot be written', async () => {
  const adapter = createPagePreferencesAdapter(WEB_FREE_PREFERENCES);
  await act(async () => root.render(<PagePreferencesCard adapter={adapter} />));
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="默认展开「字段速览」"]')!.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('修改未保存');
  expect(localStorage.getItem(WEB_FREE_PREFERENCES.storageKey)).toBeNull();
  write.mockRestore();
});


it('keeps the extension snapshot when clearing the stored draft fails', async () => {
  const extended = { ...draft, extension: { retained: true } };
  localStorage.setItem(KEY, JSON.stringify(extended)); await mount();
  const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
  await act(async () => byText('清空存档').click());
  expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(extended);
  expect(container.textContent).toContain('清空存档失败');
  remove.mockRestore(); await edit('失败后继续编辑');
  expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ ...extended, prompt: '失败后继续编辑' });
});


it('shows protected-source feedback in settings without replacing malformed draft bytes', async () => {
  const raw = '{protected-settings-source'; localStorage.setItem(WEB_FREE_PREFERENCES.storageKey, raw);
  const adapter = createPagePreferencesAdapter(WEB_FREE_PREFERENCES);
  await act(async () => root.render(<PagePreferencesCard adapter={adapter} />));
  expect(container.textContent).toContain('为保护内容暂不可在此修改');
  expect(container.querySelector('[role="switch"]')).toBeNull();
  expect([...container.querySelectorAll('button')].find((item) => item.textContent === '重置该页偏好')?.disabled).toBe(true);
  expect(localStorage.getItem(WEB_FREE_PREFERENCES.storageKey)).toBe(raw);
});
