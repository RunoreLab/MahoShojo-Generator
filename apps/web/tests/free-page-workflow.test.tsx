// @vitest-environment jsdom
import React, { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), copy: vi.fn(), download: vi.fn() }));
vi.mock('@/lib/use-generation-api-intent-latch', () => ({ useGenerationApiIntentLatch: () => ({ tryAcquire: () => ({ dispatch: mocks.dispatch }) }) }));
vi.mock('@/lib/auth', () => ({ authStorage: { getActivityHeaders: async () => ({}), getAuthHeader: async () => null } }));
vi.mock('@/lib/cooldown', () => ({ useProviderModeCooldown: () => ({ isCooldown: false, startCooldown: vi.fn(), remainingTime: 0, otherRemainingTime: 0 }) }));
vi.mock('@/lib/content-safety/client', () => ({ getSensitiveWordRedirectTarget: async () => null }));
vi.mock('@/lib/sensitive-word-filter', () => ({ quickCheck: async (text: string) => ({ hasSensitiveWords: false, filteredText: text }) }));
vi.mock('@/lib/shield-word-filter', () => ({ applyShieldWords: (text: string) => ({ filteredText: text }) }));
vi.mock('@/lib/client/blobUrl', () => ({ downloadBlob: mocks.download }));
vi.mock('@/lib/app-router-adapter', () => ({ useAppRouterAdapter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/ai/ProviderCooldownNotice', () => ({ ProviderCooldownNotice: () => null }));
vi.mock('@/components/Footer', () => ({ default: () => null }));
vi.mock('@/components/AiProviderSelector', () => ({ default: () => <div>供应商适配</div> }));
vi.mock('@/components/ai/AiReasoningPanel', () => ({ default: ({ reasoning }: { reasoning?: { text?: string } | null }) => reasoning?.text ? <div aria-label="思考内容">{reasoning.text}</div> : null }));
vi.mock('@/components/SaveToCloudButton', () => ({ default: ({ data, cardType }: { data: unknown; cardType: string }) => <button data-card-type={cardType} data-card-json={JSON.stringify(data)}>保存到云端</button> }));
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
const selectSchema = async (schemaId: string) => act(async () => { const select = container.querySelector<HTMLSelectElement>('select[aria-label="选择 Schema"]')!; select.value = schemaId; select.dispatchEvent(new Event('change', { bubbles: true })); });
const preview = () => container.querySelector('[data-testid="free-preview"]')!;
const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const markdown = '# 流式标题\n\n保留的流式正文';
const streamResponse = (tail = sse('done', { ok: true })) => new Response([
  sse('reasoning', { source: 'sdk', chunk: '保留的思考内容' }),
  sse('markdown', { chunk: markdown }),
  tail,
].join(''), { headers: { 'content-type': 'text/event-stream' } });
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

it('keeps the completed non-stream result visible when choosing the next generation mode', async () => {
  localStorage.setItem(KEY, JSON.stringify(draft));
  await mount();
  await act(async () => byText('开始生成').click());
  await act(async () => byText('流式').click());
  expect(JSON.parse(localStorage.getItem(KEY)!).generationMode).toBe('stream');
  expect(container.querySelector('[aria-label="生成结果"]')?.textContent).toBe('保留的生成正文');
  expect(byText('保存到云端').getAttribute('data-card-type')).toBe('character');
  expect(mocks.dispatch).toHaveBeenCalledOnce();
});

it.each(['scenario', 'general-scenario'])('keeps a non-stream %s result when selecting the next stream schema', async (schemaId) => {
  localStorage.setItem(KEY, JSON.stringify({ ...draft, schemaId }));
  const card = { title: '已完成的情景', content: '原情景正文', elements: [], extension: { retained: true } };
  mocks.dispatch.mockResolvedValueOnce(Response.json(card));
  await mount();
  await act(async () => byText('开始生成').click());
  const rendered = preview().innerHTML;
  await act(async () => byText('流式').click());
  expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ generationMode: 'stream', schemaId: schemaId === 'scenario' ? 'general' : schemaId });
  await selectSchema('general');
  expect(preview().innerHTML).toBe(rendered);
  expect(byText('保存到云端').getAttribute('data-card-type')).toBe('scenario');
  expect(JSON.parse(byText('保存到云端').getAttribute('data-card-json')!)).toEqual(card);
  expect(mocks.dispatch).toHaveBeenCalledOnce();
});

it.each(['scenario', 'general-scenario', 'magical-girl', 'canshou'])('keeps the completed card renderer and save type when choosing next schema %s', async (schemaId) => {
  localStorage.setItem(KEY, JSON.stringify(draft));
  await mount();
  await act(async () => byText('开始生成').click());
  const savedJson = byText('保存到云端').getAttribute('data-card-json');
  await selectSchema(schemaId);
  expect(JSON.parse(localStorage.getItem(KEY)!).schemaId).toBe(schemaId);
  expect(byText('保存到云端').getAttribute('data-card-type')).toBe('character');
  expect(container.querySelector('[aria-label="生成结果"]')?.textContent).toBe('保留的生成正文');
  expect(byText('保存到云端').getAttribute('data-card-json')).toBe(savedJson);
  await act(async () => byText('下载 JSON').click());
  expect(mocks.download).toHaveBeenCalledWith(expect.any(Blob), '数据卡_角色_角色.json');
  await act(async () => byText('复制到剪贴板').click());
  expect(JSON.parse(mocks.copy.mock.calls.at(-1)![0])).toEqual(JSON.parse(savedJson!));
  expect(mocks.dispatch).toHaveBeenCalledOnce();
});

it.each(['general', 'general-scenario'])('keeps completed %s stream output and reasoning while editing the next schema and mode', async (schemaId) => {
  localStorage.setItem(KEY, JSON.stringify({ ...draft, schemaId, generationMode: 'stream' }));
  mocks.dispatch.mockResolvedValueOnce(streamResponse());
  await mount();
  await act(async () => byText('开始生成').click());
  const rendered = preview().innerHTML;
  const savedJson = byText('保存到云端').getAttribute('data-card-json');
  expect(preview().textContent).toContain('保留的流式正文');
  expect(preview().textContent).toContain('保留的思考内容');
  await selectSchema(schemaId === 'general' ? 'general-scenario' : 'general');
  expect(preview().innerHTML).toBe(rendered);
  await act(async () => byText('非流式').click());
  await selectSchema('magical-girl');
  expect(preview().innerHTML).toBe(rendered);
  expect(byText('保存到云端').getAttribute('data-card-type')).toBe(schemaId === 'general' ? 'character' : 'scenario');
  expect(byText('保存到云端').getAttribute('data-card-json')).toBe(savedJson);
  expect(mocks.dispatch).toHaveBeenCalledOnce();
  expect(mocks.dispatch.mock.calls[0][0]).toBe('/api/generate-free-stream?format=sse');
  expect(JSON.parse(mocks.dispatch.mock.calls[0][1].body).schema).toBe(schemaId);
});

it('binds the next actual generation to its own schema after keeping the previous result visible', async () => {
  localStorage.setItem(KEY, JSON.stringify(draft));
  await mount();
  await act(async () => byText('开始生成').click());
  await selectSchema('scenario');
  expect(container.querySelector('[aria-label="生成结果"]')).not.toBeNull();
  const nextCard = { title: '下一次情景', elements: [], extension: { retained: true } };
  mocks.dispatch.mockResolvedValueOnce(Response.json(nextCard));
  await act(async () => byText('开始生成').click());
  expect(mocks.dispatch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(mocks.dispatch.mock.calls[1][1].body).schema).toBe('scenario');
  expect(preview().textContent).toContain('下一次情景');
  expect(preview().textContent).not.toContain('保留的生成正文');
  expect(byText('保存到云端').getAttribute('data-card-type')).toBe('scenario');
  expect(JSON.parse(byText('保存到云端').getAttribute('data-card-json')!)).toEqual(nextCard);
  await selectSchema('general');
  expect(preview().textContent).toContain('下一次情景');
  expect(byText('保存到云端').getAttribute('data-card-type')).toBe('scenario');
});

it('does not revive an old result after a new request fails', async () => {
  localStorage.setItem(KEY, JSON.stringify(draft));
  await mount();
  await act(async () => byText('开始生成').click());
  await selectSchema('scenario');
  mocks.dispatch.mockResolvedValueOnce(Response.json({ error: '请求失败' }, { status: 500 }));
  await act(async () => byText('开始生成').click());
  expect(container.textContent).toContain('请求失败');
  await selectSchema('general');
  expect(preview().textContent).not.toContain('保留的生成正文');
  expect(byText('保存到云端')).toBeUndefined();
  expect(mocks.dispatch).toHaveBeenCalledTimes(2);
});

it('keeps partial stream output after failure when changing the next mode', async () => {
  localStorage.setItem(KEY, JSON.stringify({ ...draft, generationMode: 'stream' }));
  mocks.dispatch.mockResolvedValueOnce(streamResponse(sse('error', { error: '合成上游失败' })));
  await mount();
  await act(async () => byText('开始生成').click());
  expect(container.textContent).toContain('合成上游失败');
  expect(preview().textContent).toContain('保留的流式正文');
  expect(byText('保存到云端')).toBeUndefined();
  await act(async () => byText('非流式').click());
  await selectSchema('scenario');
  expect(preview().textContent).toContain('保留的流式正文');
  expect(preview().textContent).toContain('保留的思考内容');
  expect(byText('保存到云端')).toBeUndefined();
  expect(mocks.dispatch).toHaveBeenCalledOnce();
});

it('keeps a manually stopped stream card saveable after choosing the next mode', async () => {
  localStorage.setItem(KEY, JSON.stringify({ ...draft, generationMode: 'stream' }));
  mocks.dispatch.mockImplementationOnce((_url: string, options: RequestInit) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(sse('markdown', { chunk: markdown })));
      options.signal!.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true });
    },
  }), { headers: { 'content-type': 'text/event-stream' } }));
  await mount();
  await act(async () => byText('开始生成').click());
  expect(preview().textContent).toContain('保留的流式正文');
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="停止生成"]')!.click());
  expect(container.textContent).toContain('已手动停止生成');
  const savedJson = byText('保存到云端').getAttribute('data-card-json');
  await act(async () => byText('非流式').click());
  await selectSchema('scenario');
  expect(preview().textContent).toContain('保留的流式正文');
  expect(byText('保存到云端').getAttribute('data-card-json')).toBe(savedJson);
  expect(byText('保存到云端').getAttribute('data-card-type')).toBe('character');
  expect(mocks.dispatch).toHaveBeenCalledOnce();
});

it('restores only the draft on remount without treating stored extensions as a generated result', async () => {
  localStorage.setItem(KEY, JSON.stringify({ ...draft, output: { card: { name: '旧扩展结果' } } }));
  await mount();
  await act(async () => byText('开始生成').click());
  await selectSchema('scenario');
  await act(async () => root.render(<div />));
  await mount();
  expect(container.querySelector<HTMLSelectElement>('select[aria-label="选择 Schema"]')?.value).toBe('scenario');
  expect(preview().textContent).not.toContain('保留的生成正文');
  expect(preview().textContent).not.toContain('旧扩展结果');
  expect(byText('保存到云端')).toBeUndefined();
  expect(JSON.parse(localStorage.getItem(KEY)!).output).toEqual({ card: { name: '旧扩展结果' } });
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

let originalCopyExec: PropertyDescriptor | undefined;
beforeEach(() => { originalCopyExec = Object.getOwnPropertyDescriptor(document, 'execCommand'); });
afterEach(() => {
  if (originalCopyExec) Object.defineProperty(document, 'execCommand', originalCopyExec);
  else Reflect.deleteProperty(document, 'execCommand');
});

it.each(['missing', 'rejected'] as const)('Free copies the original scenario after schema changes with %s Clipboard and honest fallback feedback', async (api) => {
  const card = { templateId: '通用情景', title: '原情景', content: '完整正文', signature: 'keep', extension: { kept: true } };
  localStorage.setItem(KEY, JSON.stringify({ ...draft, schemaId: 'general-scenario' }));
  mocks.dispatch.mockResolvedValueOnce(Response.json(card));
  vi.stubGlobal('navigator', { userAgent: navigator.userAgent, clipboard: api === 'missing' ? undefined : { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
  let copied = '';
  const fallback = vi.fn(() => { copied = document.querySelector<HTMLTextAreaElement>('textarea[readonly][style*="position: fixed"]')!.value; return true; });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: fallback });
  await mount(); await act(async () => byText('开始生成').click()); await selectSchema('general');
  await act(async () => byText('复制到剪贴板').click());
  expect(copied).toBe(JSON.stringify(card, null, 2));
  expect(alert).toHaveBeenLastCalledWith('✅ 已复制情景卡 JSON 到剪贴板');
  fallback.mockReturnValueOnce(false);
  await act(async () => byText('复制到剪贴板').click());
  expect(alert).toHaveBeenLastCalledWith('⚠️ 复制失败，请手动选择 JSON 内容后复制。');
  expect(fallback).toHaveBeenCalledTimes(2); expect(mocks.dispatch).toHaveBeenCalledOnce();
  expect(mocks.download).not.toHaveBeenCalled();
});

it.each(['magical-girl', 'canshou'] as const)('keeps a pending %s result copy through unrelated renders but retires an identical replacement', async (schemaId) => {
  const original = { name: '原件', codename: '原件', extension: { retained: true } };
  localStorage.setItem(KEY, JSON.stringify({ ...draft, schemaId }));
  mocks.dispatch.mockImplementation(async () => Response.json(original));
  let fallbackText = '';
  const fallback = vi.fn(() => { fallbackText = document.querySelector<HTMLTextAreaElement>('textarea[readonly][style*="position: fixed"]')!.value; return true; });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: fallback });
  await mount(); await act(async () => byText('开始生成').click());
  const expected = JSON.stringify(JSON.parse(byText('保存到云端').dataset.cardJson!), null, 2);
  expect(JSON.parse(expected).extension).toEqual({ retained: true });
  for (const replace of [false, true]) {
    for (const outcome of ['success', 'failure']) {
      let resolve!: () => void, reject!: (reason: Error) => void;
      const writeText = vi.fn(() => new Promise<void>((yes, no) => { resolve = yes; reject = no; }));
      vi.stubGlobal('navigator', { userAgent: navigator.userAgent, clipboard: { writeText } });
      await act(async () => byText('复制到剪贴板').click());
      expect(writeText).toHaveBeenCalledExactlyOnceWith(expected);
      await edit(`下一次提示词-${replace}-${outcome}`);
      await selectSchema('general');
      expect(JSON.stringify(JSON.parse(byText('保存到云端').dataset.cardJson!), null, 2)).toBe(expected);
      if (replace) {
        await selectSchema(schemaId);
        await act(async () => byText('开始生成').click());
      }
      vi.mocked(alert).mockClear(); fallback.mockClear();
      await act(async () => outcome === 'success' ? resolve() : reject(new Error('late')));
      if (replace) { expect(alert).not.toHaveBeenCalled(); expect(fallback).not.toHaveBeenCalled(); }
      else {
        expect(alert).toHaveBeenLastCalledWith('✅ 已复制角色卡 JSON 到剪贴板');
        expect(fallback).toHaveBeenCalledTimes(outcome === 'failure' ? 1 : 0);
        if (outcome === 'failure') expect(fallbackText).toBe(expected);
      }
    }
  }
});

it('renders the general-scenario result with reversible escaped-newline preview and keeps copy/save payloads original', async () => {
  const card = { templateId: '通用情景', title: '合成情景', content: '# 简报\\n\\n---\\n\\n## 任务\\n记录星轨。', signature: 'keep', extension: { kept: true } };
  localStorage.setItem(KEY, JSON.stringify({ ...draft, schemaId: 'general-scenario' }));
  mocks.dispatch.mockResolvedValueOnce(Response.json(card));
  await mount(); await act(async () => byText('开始生成').click());
  expect(byText('按换行预览').getAttribute('aria-pressed')).toBe('false');
  await act(async () => byText('按换行预览').click());
  expect([...container.querySelectorAll('h3')].some((heading) => heading.textContent === '任务')).toBe(true);
  expect(JSON.parse(byText('保存到云端').dataset.cardJson!)).toEqual(card);
  await act(async () => byText('复制到剪贴板').click());
  expect(mocks.copy).toHaveBeenLastCalledWith(JSON.stringify(card, null, 2));
  await act(async () => byText('恢复原文预览').click());
  expect([...container.querySelectorAll('h3')].some((heading) => heading.textContent === '任务')).toBe(false);
});
