// @vitest-environment jsdom
/** Real Desktop route/shared views/session/B1 adapter; simulated IPC and loopback fixture, not OS/Tauri acceptance. */
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiExecutionRequest } from '@mahoshojo/contracts/ai-execution';
import type { AiStreamEvent } from '@mahoshojo/ai-core/stream-events';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import { ARENA_DRAFT_KEY, createInitialArenaDraft, type ArenaDraft } from '../src/features/arena/session';
import { DESKTOP_AI_CONFIG_STORAGE_KEY } from '../src/features/ai-config/desktop-ai-config-store';
import { getDesktopAiConfigStore, resetDesktopAiConfigStoreForTests } from '../src/features/ai-config/use-desktop-ai-config';
import { createDesktopRouter } from '../src/app/router';
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), download: vi.fn(), profile: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, isTauri: () => true, Channel: class { onmessage?: (value: unknown) => void; } }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: mocks.listen }) }));
vi.mock('../src/platform/download-text-file', () => ({ downloadTextFile: mocks.download }));
vi.mock('../src/platform/provider-profile-bridge', () => ({ listProviderProfileIds: async () => ['loopback'], getProviderProfile: mocks.profile }));
let root: Root, container: HTMLDivElement, server: Server, endpoint: string;
let activeCloseHandles = 0;
let markdownSuffix = '';
let docs: Map<string, LocalCardRecordV1>, received: AiExecutionRequest[], hold: boolean, release: (() => void) | undefined, failSave: boolean, eof: boolean;
const nativeFetch = globalThis.fetch;
const text = '甲与乙共同守护车站。';
const rendered = (stream: boolean) => stream ? `# 车站重逢\n\n${text}${markdownSuffix}\n<!-- MAHOSHOJO_ARENA_META {"version":1,"report":{"headline":"车站重逢","winner":"甲"},"impacts":[{"characterName":"甲","impact":"学会信任","currentStateSummary":"安心"}]} -->`
  : JSON.stringify({ headline: '车站重逢', article: { body: text + markdownSuffix, analysis: '彼此扶持' }, officialReport: { winner: '甲', conclusion: '合作' }, impacts: [{ characterName: '甲', impact: '学会信任', currentStateSummary: '安心' }] });
beforeAll(async () => {
  server = createServer((req, res) => { let body = ''; req.on('data', (part) => { body += part; }); req.on('end', () => {
    const request = JSON.parse(body) as AiExecutionRequest; received.push(request);
    const stream = request.messages.length === 1;
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ text: rendered(stream), reasoning: '独立的推理' }));
  }); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/chat/completions`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
const button = (text: string, scope: ParentNode = document) => [...scope.querySelectorAll('button')].find((entry) => entry.textContent?.trim() === text)!;
const settle = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); }); };
const click = async (text: string, scope?: ParentNode) => { expect(button(text, scope), text).toBeTruthy(); await act(async () => button(text, scope).click()); await settle(); };
const change = async (selector: string, value: string) => {
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!; expect(input, selector).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
};
const mount = async () => { const router = createDesktopRouter(); await router.load(); await act(async () => root.render(<StrictMode><RouterProvider router={router} /></StrictMode>));
  await vi.waitFor(() => expect(container.textContent).toContain('生成战报')); await settle(); return router; };
const draft = (mode: ArenaDraft['battleMode'], output: ArenaDraft['generationMode']): ArenaDraft => ({ ...createInitialArenaDraft(), battleMode: mode, generationMode: output,
  combatants: ['甲', '乙'].map((name) => ({ type: 'general-character', data: { templateId: '通用角色', name, content: '完整设定', signature: 'old-source-signature' }, isValid: false, isPreset: false, filename: name })),
  scenario: { content: mode === 'scenario' ? { templateId: '通用情景', title: '车站', content: '雨中重逢' } : null, fileName: null },
  settings: { ...createInitialArenaDraft().settings, writeNarrativeHistory: true },
});
const saveDraft = (value: ArenaDraft) => window.localStorage.setItem(ARENA_DRAFT_KEY, JSON.stringify({ version: 1, draft: value }));
const calls = () => mocks.invoke.mock.calls.filter(([cmd]) => ['stream_direct_ai', 'stream_target_ai', 'hosted_ai_request', 'stream_hosted_ai'].includes(cmd));
const scopeClose = () => { const args = mocks.listen.mock.calls.at(-1)!; const event = { preventDefault: vi.fn() }; args[0](event); return event; };
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); localStorage.clear(); received = []; docs = new Map(); hold = false; failSave = false; eof = false; release = undefined; activeCloseHandles = 0; markdownSuffix = '';
  localStorage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, JSON.stringify({ version: 2, selection: { executionPreference: 'client', clientConnectionId: 'loopback' }, hiddenPresetIds: [] }));
  resetDesktopAiConfigStoreForTests();
  mocks.profile.mockResolvedValue({ id: 'loopback', name: 'Loopback', adapter: 'openai-compatible', baseUrl: endpoint.replace('/chat/completions', ''), modelId: 'fixture-model' });
  mocks.listen.mockImplementation(async () => { activeCloseHandles += 1; return vi.fn(() => { activeCloseHandles -= 1; }); }); mocks.download.mockResolvedValue(undefined);
  mocks.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'list_local_cards') { const request = args!.request as { cardTypes: string[] }; return { documents: [...docs.values()].filter((card) => !request.cardTypes.length || request.cardTypes.includes(card.cardType)).map((card) => JSON.stringify(card)) }; }
    if (command === 'get_local_card') return docs.has(args!.id as string) ? JSON.stringify(docs.get(args!.id as string)) : null;
    if (command === 'save_local_card') { if (failSave) throw new Error('disk-failed'); const request = args!.request as { document: string; writeMode: string }; expect(request.writeMode).toBe('insert-if-absent'); const card = JSON.parse(request.document) as LocalCardRecordV1; const alreadyPresent = docs.has(card.id); if (!alreadyPresent) docs.set(card.id, card); return { id: card.id, alreadyPresent }; }
    if (command === 'stream_target_ai' || command === 'stream_direct_ai') {
      const request = args!.request as AiExecutionRequest; const channel = args!.onEvent as { onmessage(event: AiStreamEvent): void };
      const response = await nativeFetch(endpoint, { method: 'POST', body: JSON.stringify(request) }); const output = await response.json() as { text: string; reasoning: string };
      const identity = { requestId: request.requestId, contractVersion: 1 as const, mode: request.mode };
      channel.onmessage({ ...identity, sequence: 0, type: 'started' }); channel.onmessage({ ...identity, sequence: 1, type: 'reasoning-delta', delta: output.reasoning }); channel.onmessage({ ...identity, sequence: 2, type: 'text-delta', delta: output.text });
      if (hold) await new Promise<void>((resolve) => { release = resolve; });
      if (!eof) channel.onmessage({ ...identity, sequence: 3, type: 'result', result: { ...identity, status: 'completed', output, finishReason: 'stop' } }); return;
    }
    if (command === 'public_read_cache_query') return { status: 'ready', total: 1, bodyCount: 1, entries: [{ card: { id: 'cached-1', name: '缓存角色', type: 'character', description: '完整公开副本', is_public: 1, updated_at: '2026-10-01T00:00:00Z' }, hasBody: true, lastSuccessAt: '2026-10-01T00:00:00Z', summaryUpdatedAt: '2026-10-01T00:00:00Z', bodyUpdatedAt: '2026-10-01T00:00:00Z' }] };
    if (command === 'public_read_cache_card') return { status: 'ready', availability: 'full', entry: { card: { id: 'cached-1', name: '缓存角色', type: 'character', is_public: 1, data: JSON.stringify({ templateId: '通用角色', name: '缓存角色', content: '缓存完整原文', signature: 'unverified-source' }) }, bodyUpdatedAt: '2026-10-01T00:00:00Z', lastSuccessAt: '2026-10-01T00:00:00Z' } };
    if (command === 'has_provider_secret') return true;
    if (command === 'cloud_card_library_request') return { status: 200, body: { success: true, cards: [], tags: [], total: 0 } };
    return undefined;
  });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); if (url.startsWith('http://127.0.0.1:')) return nativeFetch(input, init);
    if (url === '/languages.json') return new Response(JSON.stringify([{ code: 'zh-CN', name: '简体中文' }]));
    if (url.startsWith('/presets/') || url.startsWith('/scenario-presets/')) return new Response(readFileSync(resolve(process.cwd(), '../../content', url.slice(1)), 'utf8'));
    throw new Error('unexpected network');
  }));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); HTMLElement.prototype.scrollIntoView = vi.fn(); vi.spyOn(window, 'confirm').mockReturnValue(false);
  HTMLDialogElement.prototype.showModal = function () { this.open = true; }; HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.location.hash = '#/battle'; container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); release?.(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Desktop /battle journey against loopback fixture', () => {
  it.each(['classic', 'kizuna', 'daily', 'scenario'] as const)('%s × structured/Markdown route → execution → result → save → local-library reopen', async (mode) => {
    for (const output of ['non-stream', 'stream'] as const) {
      saveDraft(draft(mode, output)); const router = await mount(); await click('恢复草稿');
      await click('生成战报'); await vi.waitFor(() => expect(container.textContent).toContain('生成完成。'));
      expect(received.at(-1)!.requestKind).toBe('arena'); expect(JSON.parse(received.at(-1)!.arenaInputJson!).mode).toBe(mode);
      expect(docs.size).toBe(0); expect(container.querySelector('[aria-label="战报结果"]')?.textContent).toContain(text);
      await click('另存战后角色副本'); await click('保存叙事历史到本地库'); expect(docs.size).toBe(3);
      await click('完整导出 JSON'); expect(JSON.parse(mocks.download.mock.calls.at(-1)![1]).result.rawText).toContain('车站重逢');
      await act(async () => router.navigate({ to: '/local-library' })); await settle(); expect(window.location.hash).toContain('/local-library');
      await act(async () => router.navigate({ to: '/battle' })); await settle(); await click('恢复草稿'); await click('引用本地叙事历史');
      await vi.waitFor(() => expect(document.body.textContent).toContain('车站重逢')); expect(calls()).toHaveLength(output === 'stream' ? 2 : 1);
      await act(async () => root.unmount()); root = createRoot(container); docs.clear();
    }
  });
  it.each(['non-stream', 'stream'] as const)('%s result links use the existing confirmation boundary, never native href fallback', async (output) => {
    markdownSuffix = '\n\n[外部说明](https://example.test/report)\n\n[邮件目标](mailto:test@example.test)';
    saveDraft(draft('daily', output)); await mount(); await click('恢复草稿'); await click('生成战报'); await vi.waitFor(() => expect(container.textContent).toContain('生成完成。'));
    const link = [...document.querySelectorAll('a')].find((item) => item.textContent === '外部说明')!; expect(link).toBeTruthy(); expect(link.hasAttribute('href')).toBe(false);
    await act(async () => link.click()); await settle(); expect(document.body.textContent).toContain('打开外部链接？');
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'open_external_url')).toBe(false);
    await click('在系统浏览器打开'); expect(mocks.invoke).toHaveBeenCalledWith('open_external_url', { url: 'https://example.test/report' });
    const mail = [...document.querySelectorAll('a')].find((item) => item.textContent === '邮件目标')!; expect(mail.hasAttribute('href')).toBe(false);
    await act(async () => mail.click()); await settle(); await click('在系统浏览器打开');
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'open_external_url')).toHaveLength(1); expect(document.body.textContent).toContain('该链接不是合法的网页地址');
  });
  it('preset target uses the explicit target channel with no Hosted or profile fallback', async () => {
    localStorage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, JSON.stringify({ version: 5, selection: { executionPreference: 'client', clientTarget: { kind: 'preset', providerId: 'deepseek' }, serverTarget: { kind: 'system' } }, hiddenPresetIds: [], presetsByProviderId: { deepseek: { selectedModelId: 'deepseek-chat', generationOverrides: {} } } }));
    saveDraft(draft('daily', 'stream')); await mount(); await click('恢复草稿'); await click('生成战报'); await vi.waitFor(() => expect(container.textContent).toContain('生成完成。'));
    expect(calls()).toHaveLength(1); expect(calls()[0]![0]).toBe('stream_target_ai'); expect(calls()[0]![1]).toMatchObject({ target: { kind: 'preset', providerId: 'deepseek' } });
  });
  it('loads bundled character/scenario presets and uploads materials through the shared controls', async () => {
    await mount(); const firstPreset = document.querySelector<HTMLButtonElement>('[aria-label="选择预设角色：翠雀"]')!;
    expect(firstPreset).toBeTruthy(); await act(async () => firstPreset.click()); await settle();
    expect(localStorage.getItem(ARENA_DRAFT_KEY), container.textContent ?? '').not.toBeNull(); let stored = JSON.parse(localStorage.getItem(ARENA_DRAFT_KEY)!); expect(stored.draft.combatants[0].filename).toBe('M01_centaurea.json');
    const scenarioMode = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === '📜情景模式')!;
    expect(scenarioMode).toBeTruthy(); await act(async () => scenarioMode.click()); await settle();
    await act(async () => [...document.querySelectorAll('button')].find((item) => item.textContent?.startsWith('推荐预设情景'))!.click()); await settle();
    const scenarioPreset = document.querySelector<HTMLButtonElement>('[aria-label*="谨遵女王之意"]')!;
    expect(scenarioPreset).toBeTruthy(); await act(async () => scenarioPreset.click()); await settle();
    stored = JSON.parse(localStorage.getItem(ARENA_DRAFT_KEY)!); expect(stored.draft.scenario.content.title).toContain('女王');
    const file = new File(['{"name":"背景","content":"完整素材"}'], 'material.json', { type: 'application/json' }); Object.defineProperty(file, 'text', { value: async () => '{"name":"背景","content":"完整素材"}' });
    await act(async () => [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('📎 素材注入'))!.click()); await settle();
    const input = document.querySelector<HTMLInputElement>('#arena-material-upload')!; Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true }))); await settle();
    stored = JSON.parse(localStorage.getItem(ARENA_DRAFT_KEY)!); expect(stored.draft.materials[0].content).toEqual({ name: '背景', content: '完整素材' });
    expect(calls()).toHaveLength(0);
  });
  it('selects real local and offline public-cache bodies without claiming online authority', async () => {
    const source: LocalCardRecordV1 = { id: 'lc_0123456789abcdef0123456789abcdef', schemaVersion: 1, storageLocation: 'local', cardType: 'character', title: '本地角色', data: { templateId: '通用角色', name: '本地角色', content: '原卡原文', signature: 'source-only' }, contentDigest: `sha256:${'a'.repeat(64)}`, provenance: { kind: 'unsigned', execution: 'imported' }, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }; docs.set(source.id, source);
    await mount(); const section = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('📚 角色库'))!; await act(async () => section.click()); await settle();
    await click('选择本地 / 公开角色'); await vi.waitFor(() => expect(document.body.textContent).toContain('本地角色')); await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="选择本地角色"]')!.click());
    await settle(); expect(JSON.parse(localStorage.getItem(ARENA_DRAFT_KEY)!).draft.combatants[0].data.content).toBe('原卡原文'); expect(docs.get(source.id)).toEqual(source);
    await click('选择本地 / 公开角色'); const publicTab = [...document.querySelectorAll('button')].find((item) => item.textContent?.startsWith('公开'))!;
    expect(publicTab).toBeTruthy(); await act(async () => publicTab.click()); await settle(); await click('已缓存'); await vi.waitFor(() => expect(document.body.textContent).toContain('缓存角色')); await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="选择缓存角色"]')!.click()); await settle();
    const stored = JSON.parse(localStorage.getItem(ARENA_DRAFT_KEY)!); expect(stored.draft.combatants).toHaveLength(2); expect(stored.draft.combatants[1]).toMatchObject({ isValid: false, isPreset: false, data: { name: '缓存角色', content: '缓存完整原文' } });
    expect(stored.draft.combatants[1]).not.toHaveProperty('sourceDataCardId'); expect(calls()).toHaveLength(0); expect(docs.size).toBe(1);
  });
  it('fails closed if the native close guard cannot register', async () => {
    mocks.listen.mockRejectedValue(new Error('native unavailable')); saveDraft(draft('daily', 'stream')); await mount(); await click('恢复草稿');
    expect(container.textContent).toContain('窗口关闭保护初始化失败'); expect(button('生成战报').disabled).toBe(true); expect(calls()).toHaveLength(0);
    const provider = document.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!;
    expect(provider.matches(':disabled')).toBe(true); await act(async () => provider.click());
    expect([...document.querySelectorAll('button')].some((item) => item.textContent?.includes('新建自定义连接'))).toBe(false);
    expect(mocks.invoke.mock.calls.some(([command]) => ['save_provider_profile', 'set_provider_secret'].includes(command))).toBe(false);
  });
  it('server choice keeps inputs editable and never silently executes Direct', async () => {
    localStorage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, JSON.stringify({ version: 2, selection: { executionPreference: 'server', clientConnectionId: 'loopback' }, hiddenPresetIds: [] }));
    saveDraft(draft('daily', 'stream')); await mount(); await click('恢复草稿');
    expect(container.textContent).toContain('服务器生成暂不可用'); expect(button('生成战报').disabled).toBe(true);
    expect(document.querySelector<HTMLInputElement>('#arena-story-guidance')?.disabled).toBe(false); expect(calls()).toHaveLength(0);
  });
  it('missing configuration leaves shared inputs editable and connection edits join the single close guard', async () => {
    mocks.profile.mockResolvedValue(null); await mount();
    expect(button('生成战报').disabled).toBe(true); expect(document.querySelector<HTMLInputElement>('#arena-story-guidance')?.disabled).toBe(false);
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!; expect(trigger).toBeTruthy();
    await act(async () => trigger.click()); await settle();
    await act(async () => [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('新建自定义连接'))!.click()); await settle();
    const editor = [...document.querySelectorAll('h3')].find((item) => item.textContent === '新建连接')!.closest('div')!;
    const input = editor.querySelector<HTMLInputElement>('input')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '未保存连接'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { expect(scopeClose().preventDefault).toHaveBeenCalledOnce(); }); expect(activeCloseHandles).toBe(1);
    vi.mocked(window.confirm).mockReturnValue(true); await click('取消', editor);
    await act(async () => { expect(scopeClose().preventDefault).not.toHaveBeenCalled(); }); expect(calls()).toHaveLength(0);
  });
  it('real shared paste/roster/team fields work; uncommitted paste joins the single close guard', async () => {
    await mount(); await click('展开角色粘贴区域（手机端推荐）');
    const area = document.querySelector<HTMLTextAreaElement>('textarea'); expect(area).toBeTruthy(); await change('textarea', JSON.stringify({ templateId: '通用角色', name: '粘贴角色', content: '新角色' }));
    await act(async () => { expect(scopeClose().preventDefault).toHaveBeenCalledOnce(); }); expect(activeCloseHandles).toBe(1);
    const importButton = [...document.querySelectorAll('button')].find((item) => /从文本添加角色/.test(item.textContent ?? ''));
    expect(importButton).toBeTruthy(); await act(async () => importButton!.click()); await settle(); expect(container.textContent).toContain('粘贴角色');
    expect(JSON.parse(localStorage.getItem(ARENA_DRAFT_KEY)!).draft.combatants).toHaveLength(1);
    await change('textarea', JSON.stringify({ templateId: '通用角色', name: '另一角色', content: '另一设定' }));
    await act(async () => [...document.querySelectorAll('button')].find((item) => /从文本添加角色/.test(item.textContent ?? ''))!.click()); await settle();
    await click('+ 新建分队'); await change('[aria-label="分队名称"]', '先遣队');
    await act(async () => { expect(scopeClose().preventDefault).toHaveBeenCalledOnce(); }); expect(activeCloseHandles).toBe(1);
    await act(async () => document.querySelector<HTMLInputElement>('[aria-label="分队名称"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await act(async () => { expect(scopeClose().preventDefault).not.toHaveBeenCalled(); });
    for (const value of ['0', '1']) { const select = document.querySelector<HTMLSelectElement>('select[title="把角色加入/转移到该分队"]')!;
      await act(async () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); }); }
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="下移 先遣队内 粘贴角色"]')!.click()); await settle();
    await click('生成战报'); await vi.waitFor(() => expect(container.textContent).toContain('生成完成。'));
    const request = JSON.parse(received.at(-1)!.arenaInputJson!); expect(request.teams).toEqual({ 1: ['另一角色', '粘贴角色'] }); expect(request.teamNames).toEqual({ 1: '先遣队' });
    expect(request.combatants.map((item: { data: { name: string }; teamId: number }) => [item.data.name, item.teamId])).toEqual([['另一角色', 1], ['粘贴角色', 1]]);

  });
  it('reports shared compatibility warnings only after a current-scope import succeeds', async () => {
    await mount(); await click('展开角色粘贴区域（手机端推荐）'); await change('textarea', JSON.stringify({ name: '兼容旧卡' }));
    await act(async () => [...document.querySelectorAll('button')].find((item) => /从文本添加角色/.test(item.textContent ?? ''))!.click()); await settle();
    expect(container.textContent).toContain('格式不完全规范'); expect(JSON.parse(localStorage.getItem(ARENA_DRAFT_KEY)!).draft.combatants[0].isValid).toBe(false);
    await act(async () => getDesktopAiConfigStore().selectExecutionLocation('server')); await settle(); expect(container.textContent).not.toContain('格式不完全规范');
  });
  it('dirty shared AI connection fields join the same single close guard and clear on discard', async () => {
    await mount(); const trigger = document.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!;
    await act(async () => trigger.click()); await settle();
    await act(async () => [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('新建自定义连接'))!.click()); await settle();
    const editor = [...document.querySelectorAll('h3')].find((item) => item.textContent === '新建连接')!.closest('div')!;
    const field = editor.querySelector<HTMLInputElement>('input.input-field')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, '未提交'); field.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(activeCloseHandles).toBe(1); await act(async () => { expect(scopeClose().preventDefault).toHaveBeenCalledOnce(); });
    await click('取消', editor); expect(document.body.textContent).toContain('新建连接');
    vi.mocked(window.confirm).mockReturnValue(true); await click('取消', editor); await act(async () => { expect(scopeClose().preventDefault).not.toHaveBeenCalled(); });
  });
  it('repeat click dispatches once; native-close cancel refusal and late packet leave zero writes', async () => {
    hold = true; saveDraft(draft('daily', 'stream')); await mount(); await click('恢复草稿');
    await act(async () => { button('生成战报').click(); button('生成战报').click(); });
    await vi.waitFor(() => expect(release).toBeTypeOf('function')); expect(calls()).toHaveLength(1); expect(scopeClose().preventDefault).toHaveBeenCalledOnce();
    await click('取消生成'); release!(); await settle(); await vi.waitFor(() => expect(container.textContent).toContain('生成已取消'));
    expect(docs.size).toBe(0); expect(button('另存战后角色副本')).toBeUndefined(); expect(container.textContent).toContain(text);
  });
  it('EOF/failure and disk failure retain full export; retry stores once without replay', async () => {
    saveDraft(draft('daily', 'stream')); await mount(); await click('恢复草稿'); eof = true; await click('生成战报');
    await vi.waitFor(() => expect(container.textContent).toContain('生成连接或流协议失败')); expect(docs.size).toBe(0); await click('完整导出 JSON');
    expect(JSON.parse(mocks.download.mock.calls.at(-1)![1]).result.rawText).toContain(text);
    eof = false; vi.mocked(window.confirm).mockReturnValue(true); await click('生成战报'); await vi.waitFor(() => expect(container.textContent).toContain('生成完成。'));
    failSave = true; await click('保存叙事历史到本地库'); expect(container.textContent).toContain('完整原文仍在内存');
    failSave = false; await click('保存叙事历史到本地库'); await click('保存叙事历史到本地库'); expect(docs.size).toBe(1); expect(calls()).toHaveLength(2);
  });
  it('locks target edits during a pending response, then switching never replays cancelled generation', async () => {
    hold = true; saveDraft(draft('daily', 'stream')); await mount(); await click('恢复草稿'); await click('生成战报'); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    // Settings UI itself locks edits during generation; test the external store replacement boundary.
    expect(() => getDesktopAiConfigStore().selectExecutionLocation('server')).toThrow('生成期间');
    await click('取消生成'); release!(); await settle();
    await act(async () => { getDesktopAiConfigStore().selectExecutionLocation('server'); }); await settle(); expect(button('另存战后角色副本')).toBeUndefined(); expect(docs.size).toBe(0);
  });
});
