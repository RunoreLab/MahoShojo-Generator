// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), download: vi.fn(), save: vi.fn(), copy: vi.fn(), navigate: vi.fn() }));
vi.mock('@/lib/use-generation-api-intent-latch', () => ({ useGenerationApiIntentLatch: () => ({ tryAcquire: () => ({ dispatch: mocks.dispatch }) }) }));
vi.mock('@/lib/auth', () => ({ authStorage: { getActivityHeaders: async () => ({}), getAuthHeader: async () => null } }));
vi.mock('@/lib/cooldown', () => ({ useProviderModeCooldown: () => ({ isCooldown: false, startCooldown: vi.fn(), remainingTime: 0, otherRemainingTime: 0 }) }));
vi.mock('@/lib/content-safety/client', () => ({ getSensitiveWordRedirectTarget: async () => null }));
vi.mock('@/lib/app-router-adapter', () => ({ useAppRouterAdapter: () => ({ push: mocks.navigate }) }));
vi.mock('@/components/ai/ProviderCooldownNotice', () => ({ ProviderCooldownNotice: () => null }));
vi.mock('@/components/Footer', () => ({ default: () => null }));
vi.mock('@/components/AiProviderSelector', () => ({ default: () => null }));
vi.mock('@/components/ai/AiReasoningPanel', () => ({ default: () => null }));
vi.mock('@/components/SaveToCloudButton', () => ({ default: ({ data, className, style }: { data: unknown; className?: string; style?: React.CSSProperties }) => <button className={className} style={style} onClick={() => mocks.save(data)}>保存到云端</button> }));
vi.mock('@/lib/client/blobUrl', () => ({ downloadBlob: mocks.download }));

import { ScenarioPage } from '@/components/creation/ScenarioPage';
import { writeScenarioPageDraft } from '@/lib/scenario-page-draft';

let root: Root;
let container: HTMLDivElement;
const general = { templateId: '通用情景', title: '雨夜', content: '完整内容', metadata: { signature: 'retained' } };
const structured = { title: '钟楼', scenario_type: '调查', description: '结构化内容' };
const findButton = (surface: Element, label: string) => [...surface.querySelectorAll('button')].find((button) => button.textContent === label)!;

beforeEach(() => {
  localStorage.clear();
  writeScenarioPageDraft({ answers: { '故事发生的场景是怎样的？': '钟楼' }, scenarioTitleHint: '', fieldsToKeepEmpty: [], isAdvancedVisible: false, selectedLanguage: 'zh-CN', generationMode: 'non-stream', generalScenarioDraft: general, generalScenarioDraftEdited: true });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([{ code: 'zh-CN', name: '中文' }])));
  vi.stubGlobal('alert', vi.fn());
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: mocks.copy.mockResolvedValue(undefined) } });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  mocks.dispatch.mockImplementation(async () => Response.json(structured));
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it('gives save and export the same finite hierarchy as Desktop without changing either result payload', async () => {
  await act(async () => root.render(<ScenarioPage />));
  expect(findButton(container, '生成情景').classList.contains('generate-button')).toBe(true);
  await act(async () => findButton(container, '生成情景').click());
  const output = [...container.querySelectorAll('h2')].find((heading) => heading.textContent === structured.title)!.closest('.card')!;
  const editor = [...container.querySelectorAll('h2')].find((heading) => heading.textContent === '通用情景卡（Markdown）')!.closest('.card')!;
  for (const [surface, data, downloadLabel] of [[output, structured, '下载情景文件'], [editor, general, '下载通用情景卡']] as const) {
    const save = findButton(surface, '保存到云端');
    const download = findButton(surface, downloadLabel);
    const copy = findButton(surface, '复制到剪贴板');
    expect(save.classList.contains('ui-web-generation-action--primary')).toBe(true);
    for (const action of [download, copy]) {
      expect(action.classList.contains('ui-web-generation-action--secondary')).toBe(true);
      expect(action.classList.contains('generate-button')).toBe(false);
    }
    for (const action of [save, download, copy]) expect(action.style.backgroundImage).toBe('');
    await act(async () => { save.click(); download.click(); copy.click(); });
    expect(mocks.save).toHaveBeenLastCalledWith(data);
    expect(mocks.copy).toHaveBeenLastCalledWith(JSON.stringify(data, null, 2));
    expect(surface.querySelector('pre')?.textContent).toBe(JSON.stringify(data, null, 2));
  }
  expect(mocks.dispatch).toHaveBeenCalledOnce();
  expect(mocks.download).toHaveBeenCalledTimes(2);
  expect(editor.querySelector('textarea')?.value).toBe(general.content);
});

it('preserves corrupt Scenario bytes and sets the dirty baseline after preferences restore', async () => {
  const key = 'mahoshojo.scenario.page-draft.v1';
  const corrupt = '{broken-scenario'; localStorage.setItem(key, corrupt);
  localStorage.setItem('mahoshojo.scenario.preferences.v1', JSON.stringify({ generationMode: 'non-stream', selectedLanguage: 'en', scenarioTitleHint: '旧标题', isAdvancedVisible: true, fieldsToKeepEmpty: ['elements.roles'] }));
  await act(async () => root.render(<ScenarioPage />));
  expect(container.textContent).toContain('自动保存暂不可用');
  expect(container.textContent).not.toContain('已自动保存于');
  const initialLeave = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(initialLeave); expect(initialLeave.defaultPrevented).toBe(false);
  const input = container.querySelector('textarea')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '新输入'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  const leave = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(leave); expect(leave.defaultPrevented).toBe(true);
  expect(localStorage.getItem(key)).toBe(corrupt);
  await act(async () => findButton(container, '生成情景').click());
  expect(mocks.dispatch).toHaveBeenCalledOnce();
  expect(localStorage.getItem(key)).toBe(corrupt);
  expect(container.textContent).toContain('tokens');
});


it('protects a fresh memory-only result even when the restored form itself is unchanged', async () => {
  const key = 'mahoshojo.scenario.page-draft.v1';
  localStorage.setItem(key, '{broken-scenario');
  await act(async () => root.render(<ScenarioPage />));
  const initialLeave = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(initialLeave); expect(initialLeave.defaultPrevented).toBe(false);
  await act(async () => findButton(container, '生成情景').click());
  expect(mocks.dispatch).toHaveBeenCalledOnce();
  const leave = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(leave); expect(leave.defaultPrevented).toBe(true);
  expect(localStorage.getItem(key)).toBe('{broken-scenario');
});


it('asks exactly once for an encyclopedia link and honors both responses with a memory-only draft', async () => {
  localStorage.setItem('mahoshojo.scenario.page-draft.v1', '{broken-scenario');
  await act(async () => root.render(<ScenarioPage />));
  const input = container.querySelector('textarea')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '新内容'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const link = container.querySelector<HTMLAnchorElement>('a[href="/encyclopedia/scenario-generator"]')!;
  await act(async () => link.click());
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(mocks.navigate).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  await act(async () => link.click());
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith('/encyclopedia/scenario-generator');
});

it('clears only Scenario inputs and Markdown editor while retaining the generated result', async () => {
  await act(async () => root.render(<ScenarioPage />));
  await act(async () => findButton(container, '生成情景').click());
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await act(async () => findButton(container, '清空本地草稿').click());
  expect(container.querySelector('[aria-label="结构化情景结果"] h2')?.textContent).toBe(structured.title);
  expect(container.querySelector('[aria-label="通用情景卡编辑器"] textarea')).toBeNull();
  expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="故事发生的场景是怎样的？"]')?.value).toBe('');
});

it('clearing in a memory-only Scenario session leaves corrupt original bytes untouched', async () => {
  const key = 'mahoshojo.scenario.page-draft.v1'; const raw = '{broken-scenario'; localStorage.setItem(key, raw);
  await act(async () => root.render(<ScenarioPage />));
  await act(async () => findButton(container, '生成情景').click());
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await act(async () => findButton(container, '清空本地草稿').click());
  expect(localStorage.getItem(key)).toBe(raw);
  expect(container.querySelector('[aria-label="结构化情景结果"] h2')?.textContent).toBe(structured.title);
  expect(container.textContent).toContain('自动保存暂不可用');
  const leave = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(leave); expect(leave.defaultPrevented).toBe(true);
});
