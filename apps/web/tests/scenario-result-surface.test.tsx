// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), download: vi.fn(), save: vi.fn() }));
vi.mock('@/lib/use-generation-api-intent-latch', () => ({ useGenerationApiIntentLatch: () => ({ tryAcquire: () => ({ dispatch: mocks.dispatch }) }) }));
vi.mock('@/lib/auth', () => ({ authStorage: { getActivityHeaders: async () => ({}), getAuthHeader: async () => null } }));
vi.mock('@/lib/cooldown', () => ({ useProviderModeCooldown: () => ({ isCooldown: false, startCooldown: vi.fn(), remainingTime: 0, otherRemainingTime: 0 }) }));
vi.mock('@/lib/content-safety/client', () => ({ getSensitiveWordRedirectTarget: async () => null }));
vi.mock('@/lib/app-router-adapter', () => ({ useAppRouterAdapter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/ai/ProviderCooldownNotice', () => ({ ProviderCooldownNotice: () => null }));
vi.mock('@/components/Footer', () => ({ default: () => null }));
vi.mock('@/components/AiProviderSelector', () => ({ default: () => null }));
vi.mock('@/components/ai/AiReasoningPanel', () => ({ default: () => null }));
vi.mock('@/components/SaveToCloudButton', () => ({ default: ({ data }: { data: unknown }) => <button onClick={() => mocks.save(data)}>保存到云端</button> }));
vi.mock('@/lib/client/blobUrl', () => ({ downloadBlob: mocks.download }));

import { ScenarioPage } from '@/components/creation/ScenarioPage';
import { writeScenarioPageDraft } from '@/lib/scenario-page-draft';

let root: Root;
let container: HTMLDivElement;
const general = { templateId: '通用情景', title: '编辑中的雨夜', content: '# 雨夜\n\n保持原有内容', metadata: { signature: 'retained' } };
const structured = { title: '钟楼', scenario_type: '调查', description: '保留结构化字段', elements: { scene: { time: '夜晚' } } };

beforeEach(() => {
  localStorage.clear();
  writeScenarioPageDraft({ answers: { '故事发生的场景是怎样的？': '钟楼' }, scenarioTitleHint: '', fieldsToKeepEmpty: [], isAdvancedVisible: false, selectedLanguage: 'zh-CN', generationMode: 'non-stream', generalScenarioDraft: general, generalScenarioDraftEdited: true });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([{ code: 'zh-CN', name: '中文' }])));
  HTMLElement.prototype.scrollIntoView = vi.fn();
  mocks.dispatch.mockImplementation(async () => Response.json(structured));
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it('keeps structured results and the general editor in separate shared surfaces with original actions and data', async () => {
  await act(async () => root.render(<ScenarioPage />));
  const editor = container.querySelector('[aria-label="通用情景卡编辑器"]')!;
  expect(editor.classList.contains('card')).toBe(true);
  expect(editor.querySelector('textarea')?.value).toBe(general.content);
  expect(editor.querySelector('pre')?.textContent).toBe(JSON.stringify(general, null, 2));
  const generate = [...container.querySelectorAll('button')].find((button) => button.textContent === '生成情景')!;
  await act(async () => generate.click());
  const output = container.querySelector('[aria-label="结构化情景结果"]')!;
  expect(output.querySelector('h2')?.textContent).toBe(structured.title);
  expect(output.querySelector('pre')?.textContent).toBe(JSON.stringify(structured, null, 2));
  expect(container.querySelectorAll('[data-testid="scenario-result-surface"]')).toHaveLength(2);
  expect(container.querySelectorAll('.card')).toHaveLength(3);
  for (const surface of [editor, output]) {
    expect(surface.parentElement?.closest('.card')).toBeNull();
    expect(surface.querySelector('.card')).toBeNull();
    const download = [...surface.querySelectorAll('button')].filter((button) => button.textContent?.startsWith('下载'));
    expect(download).toHaveLength(1);
    expect([...surface.querySelectorAll('button')].some((button) => button.textContent === '复制到剪贴板')).toBe(true);
  }
  await act(async () => [...output.querySelectorAll('button')].find((button) => button.textContent === '下载情景文件')!.click());
  expect(mocks.download).toHaveBeenCalledTimes(1);
  expect(mocks.download.mock.calls[0][1]).toBe('情景_钟楼.json');
  await act(async () => [...editor.querySelectorAll('button')].find((button) => button.textContent === '下载通用情景卡')!.click());
  expect(mocks.download).toHaveBeenCalledTimes(2);
  expect(mocks.download.mock.calls[1][1]).toBe('通用情景_编辑中的雨夜.json');
  await act(async () => [...editor.querySelectorAll('button')].find((button) => button.textContent === '保存到云端')!.click());
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith(general);
  expect(editor.querySelector('textarea')?.value).toBe(general.content);
});
