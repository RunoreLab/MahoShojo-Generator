// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), download: vi.fn(), save: vi.fn(), copy: vi.fn() }));
vi.mock('@/lib/use-generation-api-intent-latch', () => ({ useGenerationApiIntentLatch: () => ({ tryAcquire: () => ({ dispatch: mocks.dispatch }) }) }));
vi.mock('@/lib/auth', () => ({ authStorage: { getActivityHeaders: async () => ({}), getAuthHeader: async () => null } }));
vi.mock('@/lib/cooldown', () => ({ useProviderModeCooldown: () => ({ isCooldown: false, startCooldown: vi.fn(), remainingTime: 0, otherRemainingTime: 0 }) }));
vi.mock('@/lib/content-safety/client', () => ({ getSensitiveWordRedirectTarget: async () => null }));
vi.mock('@/lib/app-router-adapter', () => ({ useAppRouterAdapter: () => ({ push: vi.fn() }) }));
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
