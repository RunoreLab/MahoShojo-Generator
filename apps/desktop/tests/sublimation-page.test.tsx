// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiExecutionRequest } from '@mahoshojo/contracts/ai-execution';
import type { AiStreamEvent } from '@mahoshojo/ai-core/stream-events';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import { createInitialSublimationDraft, SUBLIMATION_DRAFT_KEY } from '../src/features/sublimation/session';
import { DESKTOP_AI_CONFIG_STORAGE_KEY } from '../src/features/ai-config/desktop-ai-config-store';
import { resetDesktopAiConfigStoreForTests } from '../src/features/ai-config/use-desktop-ai-config';
import { createDesktopRouter } from '../src/app/router';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), download: vi.fn(), listen: vi.fn(), profiles: vi.fn(), copy: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, isTauri: () => true, Channel: class { onmessage?: (value: unknown) => void; } }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: mocks.listen }) }));
vi.mock('../src/platform/download-text-file', () => ({ downloadTextFile: mocks.download }));
vi.mock('../src/platform/provider-profile-bridge', () => ({ listProviderProfileIds: async () => ['local'], getProviderProfile: mocks.profiles }));

const source = { templateId: '通用角色', name: '雨灯', content: '# 雨灯\n\n守候旧钟楼', signature: 'source-signature', customExtension: { retained: true, _nested: 'kept' }, _cardName: 'source-extension-name', _author: { original: true } };
const generated = { templateId: '通用角色', name: '雨灯新生', content: '# 雨灯新生\n\n守护归来的人', signature: 'server-signature' };
const directResult = JSON.stringify({ updatedCharacterData: { name: generated.name, content: generated.content }, sublimationEvent: { title: '重逢', impact: '守护归来的人' } });
const record = (id: string, cardType: 'character' | 'history', data: Record<string, unknown>): LocalCardRecordV1 => ({ id, schemaVersion: 1, storageLocation: 'local', cardType, title: cardType === 'character' ? '原始雨灯' : '本地故事', data, contentDigest: `sha256:${'a'.repeat(64)}`, provenance: { kind: 'unsigned', execution: 'imported' }, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' });
const sourceRecord = record('lc_0123456789abcdef0123456789abcdef', 'character', source);
const historyRecord = record('lc_1123456789abcdef0123456789abcdef', 'history', { templateId: 'narrative-history', version: 1, updatedAt: '2026-10-01T00:00:00Z', entries: [{ id: 'story-1', title: '钟楼重逢', content: '与失散伙伴重逢。', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }] });
let root: Root;
let container: HTMLDivElement;
let documents: Map<string, LocalCardRecordV1>;
let outputMode: 'non-stream' | 'stream';
let hold: boolean;
let release: (() => void) | undefined;
let failHistory: boolean;
let failSave: boolean;
let uncertain: boolean;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
const button = (text: string, scope: ParentNode = document) => [...scope.querySelectorAll('button')].find((item) => item.textContent?.trim() === text)!;
const click = async (text: string, scope?: ParentNode) => { const found = button(text, scope); expect(found, text).toBeTruthy(); await act(async () => found.click()); await settle(); };
const change = async (selector: string, value: string) => {
  const element = container.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector)!;
  await act(async () => { const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
};
const generationCalls = () => mocks.invoke.mock.calls.filter(([command]) => ['stream_direct_ai', 'stream_target_ai', 'stream_hosted_ai', 'hosted_ai_request'].includes(command));
const stored = () => JSON.parse(window.localStorage.getItem(SUBLIMATION_DRAFT_KEY)!);
const writeDraft = (extra: Record<string, unknown> = {}) => window.localStorage.setItem(SUBLIMATION_DRAFT_KEY, JSON.stringify({ version: 1, ...createInitialSublimationDraft(), ...extra }));
const preference = (location: string) => window.localStorage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, JSON.stringify({ version: 2, selection: { executionPreference: location, clientConnectionId: 'local' }, hiddenPresetIds: [] }));
const mount = async () => { const router = createDesktopRouter(); await router.load(); await act(async () => root.render(<StrictMode><RouterProvider router={router} /></StrictMode>)); await settle(); return router; };
const remount = async () => { await act(async () => root.unmount()); root = createRoot(container); await mount(); };

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); window.localStorage.clear(); outputMode = 'non-stream'; hold = false; release = undefined; failHistory = false; failSave = false; uncertain = false;
  documents = new Map([[sourceRecord.id, structuredClone(sourceRecord)], [historyRecord.id, structuredClone(historyRecord)]]);
  preference('client'); resetDesktopAiConfigStoreForTests();
  mocks.profiles.mockResolvedValue({ id: 'local', name: '本地模型', adapter: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', modelId: 'model' });
  mocks.listen.mockImplementation(async () => vi.fn()); mocks.copy.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: mocks.copy } });
  mocks.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'list_local_cards') {
      const query = args!.request as { cardTypes: string[] };
      if (query.cardTypes.includes('history') && failHistory) throw new Error('disk unavailable');
      return { documents: [...documents.values()].filter((value) => !query.cardTypes.length || query.cardTypes.includes(value.cardType)).map((value) => JSON.stringify(value)) };
    }
    if (command === 'get_local_card') return documents.has(args!.id as string) ? JSON.stringify(documents.get(args!.id as string)) : null;
    if (command === 'save_local_card') {
      if (failSave) throw new Error('disk unavailable');
      const request = args!.request as { document: string; writeMode: string }; const card = JSON.parse(request.document) as LocalCardRecordV1;
      expect(request.writeMode).toBe('insert-if-absent');
      const alreadyPresent = documents.has(card.id); if (!alreadyPresent) documents.set(card.id, card);
      return { id: card.id, alreadyPresent };
    }
    if (command === 'cloud_card_library_request') {
      const request = args!.request as { routeId: string; query?: { id?: string } };
      if (request.routeId === 'public-data-cards.query') {
        const row = { id: 'public-1', name: '公共雨灯', type: 'character', description: '公开设定副本', is_public: 1, username: 'author', updated_at: '2026-10-01T00:00:00Z', like_count: 0, favorite_count: 0, usage_count: 0 };
        return { status: 200, body: request.query?.id ? { success: true, card: { ...row, data: JSON.stringify(source) } } : { success: true, cards: [row], total: 1 } };
      }
      return { status: 200, body: { success: true, tags: [], favorites: [], badges: [] } };
    }
    if (command === 'hosted_ai_request') { if (uncertain) throw new Error('connection lost'); return { status: 200, body: { data: { sublimatedData: generated, unchangedFields: [], targetTemplate: 'general' }, aiMeta: null } }; }
    if (command === 'stream_hosted_ai') {
      const channel = args!.onEvent as { onmessage: (value: unknown) => void };
      channel.onmessage({ event: 'markdown', data: { chunk: generated.content } });
      if (hold) await new Promise<void>((resolve) => { release = resolve; });
      channel.onmessage({ event: 'done', data: { ok: true } }); return;
    }
    if (command === 'stream_target_ai' || command === 'stream_direct_ai') {
      const request = args!.request as AiExecutionRequest; const channel = args!.onEvent as { onmessage: (value: AiStreamEvent) => void };
      const identity = { contractVersion: 1 as const, requestId: request.requestId, mode: request.mode }; const text = outputMode === 'stream' ? generated.content : directResult;
      channel.onmessage({ type: 'started', ...identity, sequence: 0 }); channel.onmessage({ type: 'text-delta', ...identity, sequence: 1, delta: text });
      if (hold) await new Promise<void>((resolve) => { release = resolve; });
      channel.onmessage({ type: 'result', ...identity, sequence: 2, result: { ...identity, status: 'completed', output: { text }, finishReason: 'stop' } }); return;
    }
    return undefined;
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ code: 'zh-CN', name: '简体中文' }] })));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); HTMLElement.prototype.scrollIntoView = vi.fn(); vi.spyOn(window, 'confirm').mockReturnValue(false);
  HTMLDialogElement.prototype.showModal = function () { this.open = true; }; HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.location.hash = '#/sublimation'; container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); release?.(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Desktop Sublimation real page/session/executor with fake IPC (not native acceptance)', () => {
  it('loads JSON/history, generates, previews, saves a new card, exports and copies without touching the source', async () => {
    await mount(); expect(container.querySelector('[data-testid="page-sublimation"]')).toBeTruthy();
    await change('#source-json', JSON.stringify(source)); await click('从文本加载设定');
    await change('#sublimation-story-guidance', '接受伙伴帮助'); await change('#narrative-history', '手写经历');
    await click('从本地叙事历史选择'); await click('全选（筛选结果）');
    const confirm = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('使用选中'))!;
    expect(confirm).toBeTruthy(); await act(async () => confirm.click()); await settle(); expect(stored().selectedHistoryReference).toContain('与失散伙伴重逢');
    await click('▶ 高级选项：自定义升华范围'); await click('仅心灵成长'); await click('开始升华'); expect(generationCalls()).toHaveLength(1);
    const request = generationCalls()[0]![1]!.request as AiExecutionRequest;
    expect(request.messages.map((message) => message.content).join('\n')).toContain('手写经历'); expect(request.messages.map((message) => message.content).join('\n')).toContain('与失散伙伴重逢'); expect(stored().fieldsToPreserve).toEqual(['name']);
    const result = container.querySelector('[aria-label="升华结果"]')!; expect(result).toBeTruthy(); expect(container.querySelector('.container > .card')!.contains(result)).toBe(false); expect(result.textContent).toContain('未签名（非原生卡）');
    await click('保存到本地卡库'); expect(container.textContent).toContain('已保存到本地卡库');
    const saved = [...documents.values()].find((item) => item.id !== sourceRecord.id && item.cardType === 'character')!;
    expect(saved).toBeTruthy(); expect(saved.data).not.toHaveProperty('signature'); expect(saved.provenance).toMatchObject({ kind: 'unsigned', execution: 'direct-local' });
    expect(documents.get(sourceRecord.id)).toEqual(sourceRecord); expect(documents.get(historyRecord.id)).toEqual(historyRecord);
    await click('💾 下载设定文件'); expect(mocks.download.mock.calls[0]![1]).toBe(JSON.stringify(saved.data, null, 2)); await click('复制到剪贴板'); expect(mocks.copy).toHaveBeenCalledWith(JSON.stringify(saved.data, null, 2));
  });
  it.each(['client', 'server'] as const)('%s stream previews, cancels and restores retained raw text without replay', async (location) => {
    preference(location); writeDraft({ originalData: source, targetTemplate: 'general', generationMode: 'stream' }); outputMode = 'stream'; hold = true;
    await mount(); await click('开始升华'); expect(generationCalls()).toHaveLength(1); expect(container.querySelector('[aria-label="流式正文预览"]')?.textContent).toContain('守护归来的人'); expect(container.querySelector('[aria-label="升华结果"]')).toBeNull();
    await click('取消生成'); await act(async () => release?.()); await settle(); expect(stored().output.phase).toBe('cancelled'); expect(stored().output.rawText).toContain('守护归来的人'); expect(generationCalls()).toHaveLength(1); expect(container.querySelector('[aria-label="流式正文预览"]')).toBeNull();
    await remount(); expect(generationCalls()).toHaveLength(1); expect(container.textContent).toContain('守护归来的人'); expect(container.querySelector('[aria-label="流式正文预览"]')).toBeNull();
  });
  it.each(['client', 'server'] as const)('%s stream completes unsigned and only explicit save writes IPC', async (location) => {
    preference(location); writeDraft({ originalData: source, targetTemplate: 'general', generationMode: 'stream' }); outputMode = 'stream';
    await mount(); await click('开始升华'); expect(container.querySelector('[aria-label="升华结果"]')?.textContent).toContain('未签名（非原生卡）'); expect(documents.size).toBe(2);
    await click('保存到本地卡库'); expect(documents.size).toBe(3); expect([...documents.values()].at(-1)?.data).toMatchObject({ templateId: '通用角色', content: generated.content });
  });
  it('server JSON is official only for the live response; unsaved overwrite is confirmed and restored signature is unverified', async () => {
    preference('server'); writeDraft({ originalData: source }); await mount(); await click('开始升华'); expect(generationCalls()[0]![0]).toBe('hosted_ai_request'); expect(container.querySelector('[aria-label="升华结果"]')?.textContent).toContain('官方签名（服务器生成）');
    await click('重新升华'); expect(generationCalls()).toHaveLength(1); expect(container.querySelector('dialog')?.open).toBe(true); await click('取消', container.querySelector('dialog')!);
    await remount(); expect(container.querySelector('[aria-label="升华结果"]')?.textContent).toContain('含签名字段（本机未验证）'); expect(generationCalls()).toHaveLength(1);
  });
  it('history and save errors preserve the snapshot, draft and result for retry', async () => {
    writeDraft({ originalData: source, selectedHistoryReference: '既有引用快照' }); failHistory = true;
    await mount(); await click('从本地叙事历史选择'); expect(document.body.textContent).toContain('叙事历史读取失败');
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="关闭对话框"]')!.click()); await settle(); expect(stored().selectedHistoryReference).toBe('既有引用快照');
    await click('开始升华'); failSave = true; await click('保存到本地卡库'); expect(container.querySelector('[aria-label="升华结果"]')).toBeTruthy(); expect(stored().output.card).toBeTruthy(); expect(documents.size).toBe(2);
    failSave = false; await click('保存到本地卡库'); expect(documents.size).toBe(3);
  });
  it('uncertain server outcome requires explicit new-call confirmation without auto-replay', async () => {
    preference('server'); writeDraft({ originalData: source }); uncertain = true; await mount(); await click('开始升华'); expect(stored().output.phase).toBe('uncertain');
    await click('重新升华'); expect(generationCalls()).toHaveLength(1); expect(container.querySelector('dialog')?.textContent).toContain('重复调用与费用'); uncertain = false; await click('确定重新升华'); expect(generationCalls()).toHaveLength(2); expect(container.querySelector('[aria-label="升华结果"]')).toBeTruthy();
  });
  it.each(['local', 'public'] as const)('selects a %s library card through the shared real picker and never mutates or generates on import', async (kind) => {
    await mount(); await click('从本地 / 公共卡库选择');
    if (kind === 'public') {
      const publicTab = [...document.querySelectorAll('button')].find((item) => item.textContent?.startsWith('公开'))!;
      expect(publicTab).toBeTruthy(); await act(async () => publicTab.click()); await settle();
    }
    const label = kind === 'local' ? '选择原始雨灯' : '选择公共雨灯';
    const entry = document.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
    expect(entry, document.body.textContent ?? '').toBeTruthy(); await act(async () => entry.click()); await settle();
    expect(stored().originalData).toEqual(source); expect(generationCalls()).toHaveLength(0); expect(documents.get(sourceRecord.id)).toEqual(sourceRecord);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'save_local_card')).toHaveLength(0);
    if (kind === 'public') expect(mocks.invoke.mock.calls.some(([command, args]) => command === 'cloud_card_library_request' && args?.request.query?.id === 'public-1')).toBe(true);
    await click('开始升华'); await click('保存到本地卡库'); expect(documents.size).toBe(3); expect(documents.get(sourceRecord.id)).toEqual(sourceRecord);
  });
  it('accepts non-canonical JSON without stripping unknown source fields and resets preservation on cross-template selection', async () => {
    await mount(); const unknown = { arbitrary: { setting: '完整未知设定', nested: [1, 2] }, plugin: { untouched: true } };
    await change('#source-json', JSON.stringify(unknown)); await click('从文本加载设定');
    expect(stored().originalData).toEqual(unknown); expect(stored().targetTemplate).toBe('general'); expect(generationCalls()).toHaveLength(0);
    await click('▶ 高级选项：自定义升华范围'); await click('仅心灵成长'); expect(stored().fieldsToPreserve).toEqual(['name']);
    await change('#sublimation-target', 'canshou'); expect(stored().fieldsToPreserve).toEqual([]); expect(stored().originalData).toEqual(unknown);
  });
  it('blocks generation while a file is reading, and a late file result cannot overwrite a disposed page', async () => {
    writeDraft({ originalData: source }); await mount(); const before = window.localStorage.getItem(SUBLIMATION_DRAFT_KEY);
    let finish!: (text: string) => void; const file = new File(['{}'], 'new.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: () => new Promise<string>((resolve) => { finish = resolve; }) });
    const input = container.querySelector<HTMLInputElement>('#character-upload')!; Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true }))); await settle();
    expect(button('开始升华').disabled).toBe(true); expect(button('清除草稿').disabled).toBe(true); expect(generationCalls()).toHaveLength(0);
    await act(async () => root.unmount()); root = createRoot(container); await act(async () => finish(JSON.stringify(generated))); await settle();
    expect(window.localStorage.getItem(SUBLIMATION_DRAFT_KEY)).toBe(before); expect(generationCalls()).toHaveLength(0);
  });
  it('keeps unsaved draft input and beforeunload protection on storage failure, then retries without regenerating', async () => {
    writeDraft({ originalData: source }); await mount(); const save = Storage.prototype.setItem;
    const blockedStorage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) { if (key === SUBLIMATION_DRAFT_KEY) throw new Error('quota'); return save.call(this, key, value); });
    await change('#sublimation-story-guidance', '不能丢失的成长引导'); expect(container.textContent).toContain('草稿保存不可用');
    const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true); expect(container.querySelector<HTMLInputElement>('#sublimation-story-guidance')?.value).toBe('不能丢失的成长引导');
    blockedStorage.mockRestore(); await click('重试保存草稿'); expect(stored().userGuidance).toBe('不能丢失的成长引导'); expect(generationCalls()).toHaveLength(0);
  });
  it('a double click dispatches once and keeps all controls frozen until terminal output', async () => {
    writeDraft({ originalData: source, generationMode: 'stream' }); outputMode = 'stream'; hold = true; await mount();
    const start = button('开始升华'); await act(async () => { start.click(); start.click(); }); await settle(); expect(generationCalls()).toHaveLength(1);
    expect(container.querySelector<HTMLInputElement>('#sublimation-story-guidance')!.matches(':disabled')).toBe(true);
    const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    await act(async () => release?.()); await settle(); expect(generationCalls()).toHaveLength(1); expect(container.querySelector('[aria-label="升华结果"]')).toBeTruthy();
  });

});
