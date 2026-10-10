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
import { builtinWebPackageSource, BUILTIN_WEB_PACKAGE_PRESETS, packWebPackageZip, unpackWebPackageZip } from '@mahoshojo/web-package';
import type { LocalWebPackageRecordV1 } from '@mahoshojo/local-library/web-package-record';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import { ADVANCED_ARENA_DRAFT_KEY, ARENA_DRAFT_KEY, createInitialArenaDraft, type ArenaDraft } from '../src/features/arena/session';
import { DESKTOP_AI_CONFIG_STORAGE_KEY } from '../src/features/ai-config/desktop-ai-config-store';
import { getDesktopAiConfigStore, resetDesktopAiConfigStoreForTests } from '../src/features/ai-config/use-desktop-ai-config';
import { arenaWebPackageFixture, wrappedArenaWebPackageFile } from './fixtures/arena-web-package';
import { createDesktopRouter } from '../src/app/router';
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), download: vi.fn(), downloadBinary: vi.fn(), profile: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, isTauri: () => true, Channel: class { onmessage?: (value: unknown) => void; } }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: mocks.listen }) }));
vi.mock('../src/platform/download-text-file', () => ({ downloadTextFile: mocks.download, downloadBinaryFile: mocks.downloadBinary }));
vi.mock('../src/platform/provider-profile-bridge', () => ({ listProviderProfileIds: async () => ['loopback'], getProviderProfile: mocks.profile }));
let root: Root, container: HTMLDivElement, server: Server, endpoint: string;
let activeCloseHandles = 0;
let markdownSuffix = '';
let webTextOverride: string | null = null;
let packageDocs: Map<string, LocalWebPackageRecordV1>, packageBytes: Map<string, Uint8Array>;
let docs: Map<string, LocalCardRecordV1>, received: AiExecutionRequest[], hold: boolean, release: (() => void) | undefined, failSave: boolean, eof: boolean;
const nativeFetch = globalThis.fetch;
const text = '甲与乙共同守护车站。';
const webHtml = '<!doctype html><html><head><title>本地网页</title></head><body><script>globalThis.webShouldNotRun=true</script><img src="https://untrusted.invalid/tracker.png"/>甲乙的网页故事</body></html>';
const webTrailer = '<!-- MAHOSHOJO_ARENA_META {"version":1,"report":{"headline":"网页重逢","winner":"甲"},"impacts":[{"characterName":"甲","impact":"建立信任"}]} -->';
const rendered = (stream: boolean) => stream ? `# 车站重逢\n\n${text}${markdownSuffix}\n<!-- MAHOSHOJO_ARENA_META {"version":1,"report":{"headline":"车站重逢","winner":"甲"},"impacts":[{"characterName":"甲","impact":"学会信任","currentStateSummary":"安心"}]} -->`
  : JSON.stringify({ headline: '车站重逢', article: { body: text + markdownSuffix, analysis: '彼此扶持' }, officialReport: { winner: '甲', conclusion: '合作' }, impacts: [{ characterName: '甲', impact: '学会信任', currentStateSummary: '安心' }] });
beforeAll(async () => {
  server = createServer((req, res) => { let body = ''; req.on('data', (part) => { body += part; }); req.on('end', () => {
    const request = JSON.parse(body) as AiExecutionRequest; received.push(request);
    const stream = request.messages.length === 1;
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ text: JSON.parse(request.arenaInputJson!).reportFormat === 'web' ? webTextOverride ?? `${webHtml}\n${webTrailer}` : rendered(stream), reasoning: '独立的推理' }));
  }); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/chat/completions`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
const button = (text: string, scope: ParentNode = document) => [...scope.querySelectorAll('button')].find((entry) => entry.textContent?.trim() === text)!;
const settle = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); }); };
const click = async (text: string, scope?: ParentNode) => { expect(button(text, scope), text).toBeTruthy(); await act(async () => button(text, scope).click()); await settle(); };
const openGenerationOptions = async () => {
  const section = [...document.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].find((item) => item.textContent?.includes('⚡ 生成方式'));
  if (section?.getAttribute('aria-expanded') === 'false') { await act(async () => section.click()); await settle(); }
};
const change = async (selector: string, value: string) => {
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!; expect(input, selector).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
};
const mount = async () => { const router = createDesktopRouter(); await router.load(); await act(async () => root.render(<StrictMode><RouterProvider router={router} /></StrictMode>));
  await vi.waitFor(() => expect(container.textContent).toContain('生成战报')); await settle(); return router; };
const uploadWebZip = async (file: File) => {
  const picker = document.querySelector<HTMLInputElement>('input[type="file"][accept*="zip"]')!; expect(picker).toBeTruthy(); Object.defineProperty(picker, 'files', { configurable: true, value: [file] });
  await act(async () => picker.dispatchEvent(new Event('change', { bubbles: true }))); await settle();
};
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
  vi.clearAllMocks(); localStorage.clear(); received = []; docs = new Map(); hold = false; failSave = false; eof = false; release = undefined; activeCloseHandles = 0; markdownSuffix = ''; webTextOverride = null; packageDocs = new Map(); packageBytes = new Map();
  localStorage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, JSON.stringify({ version: 2, selection: { executionPreference: 'client', clientConnectionId: 'loopback' }, hiddenPresetIds: [] }));
  resetDesktopAiConfigStoreForTests();
  mocks.profile.mockResolvedValue({ id: 'loopback', name: 'Loopback', adapter: 'openai-compatible', baseUrl: endpoint.replace('/chat/completions', ''), modelId: 'fixture-model' });
  mocks.listen.mockImplementation(async () => { activeCloseHandles += 1; return vi.fn(() => { activeCloseHandles -= 1; }); }); mocks.download.mockResolvedValue(undefined);
  mocks.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'list_local_cards') { const request = args!.request as { cardTypes: string[] }; return { documents: [...docs.values()].filter((card) => !request.cardTypes.length || request.cardTypes.includes(card.cardType)).map((card) => JSON.stringify(card)) }; }
    if (command === 'get_local_card') return docs.has(args!.id as string) ? JSON.stringify(docs.get(args!.id as string)) : null;
    if (command === 'save_local_card') { if (failSave) throw new Error('disk-failed'); const request = args!.request as { document: string; writeMode: string }; expect(request.writeMode).toBe('insert-if-absent'); const card = JSON.parse(request.document) as LocalCardRecordV1; const alreadyPresent = docs.has(card.id); if (!alreadyPresent) docs.set(card.id, card); return { id: card.id, alreadyPresent }; }
    if (command === 'list_web_packages') return { documents: [...packageDocs.values()].filter((record) => !record.deletedAt).map((record) => JSON.stringify(record)) };
    if (command === 'get_web_package') return packageDocs.has(args!.id as string) ? JSON.stringify(packageDocs.get(args!.id as string)) : null;
    if (command === 'read_web_package_archive') { const bytes = packageBytes.get(args!.contentDigest as string); if (!bytes) throw { code: 'blob-not-found', message: 'missing' }; return bytes.slice().buffer; }
    if (command === 'save_web_package') {
      if (failSave) throw new Error('disk-failed');
      const request = args!.request as { document: string; archive: { b64: string; len: number } };
      const record = JSON.parse(request.document) as LocalWebPackageRecordV1;
      const bytes = Uint8Array.from(atob(request.archive.b64), (char) => char.charCodeAt(0)); expect(bytes.byteLength).toBe(request.archive.len);
      packageDocs.set(record.id, record); packageBytes.set(record.ref.digest, bytes); return { id: record.id, blobOutcome: 'stored', alreadyPresent: false };
    }
    if (command === 'delete_web_package' || command === 'restore_web_package') { const request = args!.request as { document: string }; const record = JSON.parse(request.document) as LocalWebPackageRecordV1; packageDocs.set(record.id, record); return; }
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
    if (url.startsWith('/presets/') || url.startsWith('/scenario-presets/') || url.startsWith('/questionnaires/')) return new Response(readFileSync(resolve(process.cwd(), '../../content', url.slice(1)), 'utf8'));
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
  it('server non-stream is selectable without dispatching or falling back to Direct', async () => {
    localStorage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, JSON.stringify({ version: 2, selection: { executionPreference: 'server', clientConnectionId: 'loopback' }, hiddenPresetIds: [] }));
    saveDraft(draft('daily', 'non-stream')); await mount(); await click('恢复草稿');
    expect(container.textContent).toContain('官方服务器生成'); expect(button('生成战报').disabled).toBe(false);
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
  it.each(['classic', 'kizuna', 'daily', 'scenario'] as const)('advanced /arena %s completes both outputs with an independent draft', async (mode) => {
    const battleOriginal = JSON.stringify({ version: 1, draft: { ...draft('daily', 'stream'), customStoryLength: '独立简洁稿' } }); localStorage.setItem(ARENA_DRAFT_KEY, battleOriginal);
    for (const output of ['non-stream', 'stream'] as const) {
      localStorage.setItem(ADVANCED_ARENA_DRAFT_KEY, JSON.stringify({ version: 1, draft: { ...draft(mode, output), selectedQuestionnaires: [{ source: 'upload', selectionId: 'lore', questionnaire: { id: 'lore', title: '岛屿设定', kind: 'magical-girl', questions: [], loreMarkdown: '星海岛屿' } }] } }));
      window.location.hash = '#/arena'; const router = await mount(); await click('恢复草稿'); expect(container.textContent).toContain('桌面高级单次');
      await click('生成战报'); await vi.waitFor(() => expect(container.textContent).toContain('生成完成。'));
      expect(JSON.parse(received.at(-1)!.arenaInputJson!)).toMatchObject({ mode, questionnaires: [{ loreMarkdown: '星海岛屿' }] });
      await click('保存叙事历史到本地库'); expect([...docs.values()].some((item) => item.cardType === 'history')).toBe(true);
      await act(async () => router.navigate({ to: '/local-library' })); await settle(); expect(window.location.hash).toContain('/local-library'); expect(localStorage.getItem(ARENA_DRAFT_KEY)).toBe(battleOriginal);
      await act(async () => root.unmount()); root = createRoot(container); docs.clear();
    }
  });
  it('advanced real Lore/auxiliary/history controls freeze an edited source-aware request', async () => {
    window.location.hash = '#/arena'; localStorage.setItem(ADVANCED_ARENA_DRAFT_KEY, JSON.stringify({ version: 1, draft: draft('scenario', 'stream') }));
    await mount(); await click('恢复草稿'); await click('粘贴 JSON'); await change('textarea[placeholder*="问卷 JSON"]', JSON.stringify({ id: 'lore', title: '岛屿', kind: 'magical-girl', questions: [], loreMarkdown: '星海岛屿', adjudicationEvents: [{ type: 'binary', description: 'Lore不得执行', probability: 100 }] })); await click('导入');
    await act(async () => [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('辅助情景（可选）'))!.click()); await settle();
    await click('展开辅助情景粘贴区域'); await change('textarea[placeholder*="辅助情景"]', JSON.stringify({ templateId: '通用情景', title: '暗潮', content: '潮水上涨', adjudicationEvents: [{ id: 'aux-event', type: 'binary', description: '辅助判定', probability: 100 }] }));
    await act(async () => [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('日常模式'))!.click()); await settle();
    expect(JSON.parse(localStorage.getItem(ADVANCED_ARENA_DRAFT_KEY)!).draft.battleMode).toBe('scenario'); expect(document.querySelector<HTMLTextAreaElement>('textarea[placeholder*="辅助情景"]')?.value).toContain('潮水上涨');
    await click('从文本添加辅助情景');
    expect(JSON.parse(localStorage.getItem(ADVANCED_ARENA_DRAFT_KEY)!).draft.adjudicationEvents).toMatchObject([{ description: '辅助判定' }]);
    await click('查看 / 编辑活动叙事历史'); await click('新建条目'); await change('[aria-label="历史标题"]', '前情'); await change('[aria-label="历史正文"]', '未提交历史');
    await act(async () => { expect(scopeClose().preventDefault).toHaveBeenCalledOnce(); }); expect(activeCloseHandles).toBe(1);
    await act(async () => getDesktopAiConfigStore().selectExecutionLocation('server')); await settle(); expect(document.querySelector<HTMLTextAreaElement>('[aria-label="历史正文"]')?.value).toBe('未提交历史');
    await act(async () => getDesktopAiConfigStore().selectExecutionLocation('client')); await settle();
    await click('创建条目'); await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="关闭叙事历史"]')!.click()); await settle();
    await click('生成战报'); await vi.waitFor(() => expect(container.textContent).toContain('生成完成。'));
    const request = JSON.parse(received.at(-1)!.arenaInputJson!); expect(request.auxScenarios[0].title).toBe('暗潮'); expect(request.questionnaires[0].loreMarkdown).toBe('星海岛屿');
    expect(request.adjudicationEvents).toHaveLength(1); expect(request.adjudicationResults).toHaveLength(1); expect(request.adjudicationResults[0].description).toBe('辅助判定');
    expect(JSON.parse(localStorage.getItem(ADVANCED_ARENA_DRAFT_KEY)!).draft.narrativeHistoryEntries).toHaveLength(2);
  });

  it('advanced repeated text keeps original roles but replaces source events and reports skipped names', async () => {
    window.location.hash = '#/arena'; await mount(); await click('展开角色粘贴区域（手机端推荐）');
    const add = async (content: string, events: unknown[]) => {
      await change('textarea', JSON.stringify({ templateId: '通用角色', name: '重导角色', content, adjudicationEvents: events }));
      await act(async () => [...document.querySelectorAll('button')].find((item) => /从文本添加角色/.test(item.textContent ?? ''))!.click()); await settle();
    };
    await add('原正文', [{ type: 'binary', description: '原事件', probability: 100 }]);
    await add('不可覆盖正文', [{ type: 'binary', description: '替换事件', probability: 100 }]);
    const saved = () => JSON.parse(localStorage.getItem(ADVANCED_ARENA_DRAFT_KEY)!).draft;
    expect(saved().combatants).toHaveLength(1); expect(saved().combatants[0].data.content).toBe('原正文');
    expect(saved().adjudicationEvents).toMatchObject([{ description: '替换事件' }]); expect(container.textContent).toContain('已跳过 1 位重复文件名角色');
    await add('空事件副本', []); expect(saved().adjudicationEvents).toMatchObject([{ description: '替换事件' }]);
  });
  it('advanced raw history import, display sort, explicit order, save failure and full export stay separate', async () => {
    window.location.hash = '#/arena'; await mount(); await click('查看 / 编辑活动叙事历史'); await click('粘贴导入');
    const raw = '  [{"entries":[{"id":"a","title":"先","content":"原文一","unknown":true,"updatedAt":"2020-01-01"}]},{"entries":[{"id":"b","title":"后","content":"原文二","updatedAt":"2025-01-01"}]}]  ';
    await change('textarea[placeholder*="粘贴叙事历史 JSON"]', raw); await click('确认追加导入');
    const saved = () => JSON.parse(localStorage.getItem(ADVANCED_ARENA_DRAFT_KEY)!).draft;
    expect(saved().historyOriginals[0].text).toBe(raw); expect(saved().narrativeHistoryEntries.map((entry: { id: string }) => entry.id)).toEqual(['a', 'b']);
    const sort = document.querySelector<HTMLSelectElement>('[role="dialog"] select')!;
    await act(async () => { sort.value = 'created_desc'; sort.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(saved().narrativeHistoryEntries.map((entry: { id: string }) => entry.id)).toEqual(['a', 'b']);
    await click('编辑 AI 顺序'); await click('下移'); await click('完成排序');
    expect(saved().narrativeHistoryEntries.map((entry: { id: string }) => entry.id)).toEqual(['b', 'a']);
    await act(async () => document.querySelector<HTMLElement>('[role="dialog"] [role="button"]')!.click()); await settle();
    const originalId = saved().narrativeHistoryEntries.find((entry: { title: string }) => entry.title === document.querySelector<HTMLInputElement>('[aria-label="历史标题"]')!.value).id;
    await change('[aria-label="历史正文"]', '用户修订正文'); await click('保存修改'); expect(saved().narrativeHistoryEntries.find((entry: { id: string }) => entry.id === originalId).content).toBe('用户修订正文');
    await click('删除'); expect(saved().narrativeHistoryEntries).toHaveLength(2); await click('← 返回列表');
    await click('粘贴导入'); await change('textarea[placeholder*="粘贴叙事历史 JSON"]', '{"entries":[{"id":"replace","content":"替代"}]}');
    const mode = [...document.querySelectorAll<HTMLSelectElement>('[role="dialog"] select')].find((item) => item.querySelector('option[value="replace"]'))!;
    await act(async () => { mode.value = 'replace'; mode.dispatchEvent(new Event('change', { bubbles: true })); }); await click('确认覆盖导入');
    expect(saved().narrativeHistoryEntries).toHaveLength(2); expect(saved().historyOriginals).toHaveLength(1);
    vi.mocked(window.confirm).mockReturnValue(true); await click('取消', document.querySelector('[role="dialog"]')!); vi.mocked(window.confirm).mockReturnValue(false);
    failSave = true; await click('另存完整历史到本地库'); expect(document.body.textContent).toContain('完整原文仍在内存');
    failSave = false; await click('另存完整历史到本地库'); await click('另存完整历史到本地库'); expect(docs.size).toBe(1);
    const record = [...docs.values()][0]!; expect(record.provenance).toEqual({ kind: 'unsigned' });
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="关闭叙事历史"]')!.click()); await settle();
    await click('导出当前会话'); const exported = JSON.parse(mocks.download.mock.calls.at(-1)![1]); expect(exported.draft.historyOriginals[0].text).toBe(raw);
    expect(calls()).toHaveLength(0);
  });
  it('advanced late history upload after target change preserves unsubmitted paste and writes nothing', async () => {
    window.location.hash = '#/arena'; await mount(); await click('查看 / 编辑活动叙事历史'); await click('粘贴导入');
    const raw = '{"entries":[{"id":"paste","content":"未提交粘贴原件"}]}'; await change('textarea[placeholder*="粘贴叙事历史 JSON"]', raw);
    let finish!: (text: string) => void; const pending = new Promise<string>((resolve) => { finish = resolve; });
    const file = new File(['fixture'], 'pending-history.json'); Object.defineProperty(file, 'text', { value: () => pending });
    vi.mocked(window.confirm).mockReturnValue(true); const fileInput = document.querySelector<HTMLInputElement>('[role="dialog"] input[type="file"]')!;
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] }); await act(async () => fileInput.dispatchEvent(new Event('change', { bubbles: true }))); await settle();
    await act(async () => { expect(scopeClose().preventDefault).toHaveBeenCalledOnce(); }); expect(activeCloseHandles).toBe(1);
    await act(async () => getDesktopAiConfigStore().selectExecutionLocation('server')); await settle();
    await act(async () => finish('{"entries":[{"id":"late","content":"迟到"}]}')); await settle();
    expect(document.querySelector<HTMLTextAreaElement>('textarea[placeholder*="粘贴叙事历史 JSON"]')?.value).toBe(raw);
    expect(localStorage.getItem(ADVANCED_ARENA_DRAFT_KEY)).toBeNull(); expect(docs.size).toBe(0); expect(calls()).toHaveLength(0);
    vi.mocked(window.confirm).mockReturnValue(false); await act(async () => { expect(scopeClose().preventDefault).toHaveBeenCalledOnce(); });
    await click('确认追加导入'); expect(JSON.parse(localStorage.getItem(ADVANCED_ARENA_DRAFT_KEY)!).draft.narrativeHistoryEntries[0].id).toBe('paste');
  });

  it('advanced shared Lore local/preset controls and manual events freeze only enabled sources', async () => {
    const local: LocalCardRecordV1 = { id: 'lc_abcdef0123456789abcdef0123456789', schemaVersion: 1, storageLocation: 'local', cardType: 'questionnaire', title: '本地设定', data: { id: 'local-lore', title: '本地设定', kind: 'magical-girl', questions: [], loreMarkdown: '本地岛屿', nativeAllowed: true }, contentDigest: `sha256:${'c'.repeat(64)}`, provenance: { kind: 'unsigned', execution: 'imported' }, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }; docs.set(local.id, local);
    window.location.hash = '#/arena'; localStorage.setItem(ADVANCED_ARENA_DRAFT_KEY, JSON.stringify({ version: 1, draft: draft('daily', 'stream') }));
    await mount(); await click('恢复草稿'); await click('选择本地 / 公开设定'); await vi.waitFor(() => expect(document.querySelector('[aria-label="选择本地设定"]')).toBeTruthy());
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="选择本地设定"]')!.click()); await settle();
    const select = [...document.querySelectorAll('select')].find((item) => item.querySelector('option[value="girl-band-taiban-war-1.1"]'))!;
    await act(async () => { select.value = 'girl-band-taiban-war-1.1'; select.dispatchEvent(new Event('change', { bubbles: true })); }); await settle();
    const saved = () => JSON.parse(localStorage.getItem(ADVANCED_ARENA_DRAFT_KEY)!).draft;
    expect(saved().selectedQuestionnaires).toHaveLength(2); expect(saved().selectedQuestionnaires[0]).toMatchObject({ source: 'upload', questionnaire: { nativeAllowed: false } });
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="下移 本地设定"]')!.click());
    const localRow = document.querySelector('[aria-label="上移 本地设定"]')!.closest('li')!; await act(async () => localRow.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(saved().selectedQuestionnaires[1].useLore).toBe(false); await click('+ 添加根判定事件'); await change('textarea[placeholder*="输入事件描述"]', '手动天空判定');
    await click('生成战报'); await vi.waitFor(() => expect(container.textContent).toContain('生成完成。'));
    const request = JSON.parse(received.at(-1)!.arenaInputJson!); expect(request.questionnaires).toHaveLength(2); expect(request.questionnaires[0].id).toBe('girl-band-taiban-war-1.1'); expect(request.questionnaires[1].useLore).toBe(false);
    expect(received.at(-1)!.messages.map((message) => message.content).join('')).not.toContain('本地岛屿');
    expect(request.adjudicationResults).toMatchObject([{ description: '手动天空判定' }]); expect(docs.get(local.id)).toEqual(local);
  });

});


describe('Desktop Web source journey with execution closed', () => {
  it.each((['battle', 'arena'] as const).flatMap((product) => (['classic', 'kizuna', 'daily', 'scenario'] as const).map((mode) => ({ product, mode }))))('$product $mode × both delivery modes generates/saves/reopens without mounting content', async ({ product, mode }) => {
    for (const output of ['stream', 'non-stream'] as const) {
      const key = product === 'arena' ? ADVANCED_ARENA_DRAFT_KEY : ARENA_DRAFT_KEY;
      localStorage.setItem(key, JSON.stringify({ version: 1, draft: { ...draft(mode, output), reportFormat: 'web' } }));
      window.location.hash = `#/${product}`;
      const router = await mount(); await click('恢复草稿'); await settle(); await click('生成战报');
      await vi.waitFor(() => expect(container.textContent).toContain('生成完成。'));
      expect(container.querySelector('[aria-label="Web 战报源码（安全文本）"]')?.textContent).toContain('webShouldNotRun');
      expect(container.querySelector('iframe, script, img[src*="untrusted.invalid"]')).toBeNull();
      expect((globalThis as { webShouldNotRun?: boolean }).webShouldNotRun).toBeUndefined();
      expect(button('运行 Web 战报').disabled).toBe(true);
      expect(mocks.invoke.mock.calls.some(([command]) => /^(begin_web_package_instance|append_web_package_resource|open_web_package_instance)$/.test(command))).toBe(false);
      expect(JSON.parse(received.at(-1)!.arenaInputJson!).reportFormat).toBe('web');
      await click('完整导出 JSON'); const exported = JSON.parse(mocks.download.mock.calls.at(-1)![1]);
      expect(exported.result.renderSnapshot.reportFormat).toBe('web'); expect(exported.result.rawText).toContain('MAHOSHOJO_ARENA_META'); expect(exported.result.markdown).not.toContain('MAHOSHOJO_ARENA_META');
      await click('保存叙事历史到本地库'); expect([...docs.values()].some((record) => record.cardType === 'history')).toBe(true);
      await act(async () => router.navigate({ to: '/local-library' })); await settle();
      await act(async () => router.navigate({ to: `/${product}` })); await settle(); await click('恢复草稿');
      expect(container.querySelector('[aria-label="Web 战报源码（安全文本）"]')?.textContent).toContain('webShouldNotRun'); expect(button('运行 Web 战报').disabled).toBe(true);
      await act(async () => root.unmount()); root = createRoot(container); docs.clear();
    }
  });
  it.each((['battle', 'arena'] as const).flatMap((product) => (['classic', 'kizuna', 'daily', 'scenario'] as const).map((mode) => ({ product, mode }))))('$product $mode package target × both delivery modes uses the real preset and frozen artifact', async ({ product, mode }) => {
    for (const output of ['stream', 'non-stream'] as const) {
      const key = product === 'arena' ? ADVANCED_ARENA_DRAFT_KEY : ARENA_DRAFT_KEY;
      localStorage.setItem(key, JSON.stringify({ version: 1, draft: { ...draft(mode, output), reportFormat: 'web' } })); window.location.hash = `#/${product}`;
      await mount(); await click('恢复草稿'); await settle(); await openGenerationOptions(); await click('选择 Web 包');
      const preset = document.querySelector<HTMLButtonElement>('[aria-label="选择 Web 包：竞技场新闻"]');
      expect(preset, document.body.textContent ?? '').toBeTruthy(); await act(async () => preset!.click()); await settle();
      await click('生成战报'); await vi.waitFor(() => expect(container.textContent).toContain('生成完成。'));
      expect(JSON.parse(received.at(-1)!.arenaInputJson!).webPackageRef).toEqual(BUILTIN_WEB_PACKAGE_PRESETS[0]!.packageRef);
      await click('完整导出 JSON'); const exported = JSON.parse(mocks.download.mock.calls.at(-1)![1]);
      expect(exported.result.renderSnapshot.webPackage.targetPath).toBe('index.html'); expect(exported.result.markdown).toBe(webHtml + '\n');
      expect(button('运行 Web 战报').disabled).toBe(true); expect(activeCloseHandles).toBe(1);
      expect(mocks.invoke.mock.calls.some(([command]) => /^(begin_web_package_instance|append_web_package_resource|open_web_package_instance)$/.test(command))).toBe(false);
      await act(async () => root.unmount()); root = createRoot(container);
    }
  });
  it('imports ZIP with explicit local saving, reopens its exact record, and downloads original bytes', async () => {
    const base = await builtinWebPackageSource.resolve(BUILTIN_WEB_PACKAGE_PRESETS[0]!.packageRef), archive = await packWebPackageZip(base);
    saveDraft({ ...draft('daily', 'stream'), reportFormat: 'web' }); await mount(); await click('恢复草稿'); await settle(); await openGenerationOptions(); await click('选择 Web 包');
    const localTab = [...document.querySelectorAll<HTMLButtonElement>('button')].find((entry) => entry.textContent?.trim().startsWith('本地库'))!; await act(async () => localTab.click()); await settle();
    const checkbox = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((entry) => entry.closest('label')?.textContent?.includes('导入时保存到本地库'))!;
    expect(checkbox).toBeTruthy(); expect(checkbox.checked).toBe(false); await act(async () => checkbox.click());
    const file = new File([archive.slice().buffer], 'original.zip', { type: 'application/zip' }); Object.defineProperty(file, 'arrayBuffer', { value: async () => archive.slice().buffer });
    const picker = document.querySelector<HTMLInputElement>('input[type="file"][accept*="zip"]')!; expect(picker).toBeTruthy(); Object.defineProperty(picker, 'files', { configurable: true, value: [file] });
    await act(async () => picker.dispatchEvent(new Event('change', { bubbles: true }))); await vi.waitFor(() => expect(packageDocs.size).toBe(1)); await settle();
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'save_web_package')).toHaveLength(1);
    expect(localStorage.getItem(ARENA_DRAFT_KEY)).toContain(base.ref.digest);
    await act(async () => root.unmount()); root = createRoot(container); await mount(); await click('恢复草稿'); await settle(); await openGenerationOptions(); await click('更换 Web 包');
    const tab = [...document.querySelectorAll<HTMLButtonElement>('button')].find((entry) => entry.textContent?.trim().startsWith('本地库'))!; await act(async () => tab.click()); await settle();
    const download = document.querySelector<HTMLButtonElement>('[aria-label="下载 Web 包 ZIP：竞技场新闻"]'); expect(download, document.body.textContent ?? '').toBeTruthy(); await act(async () => download!.click());
    await vi.waitFor(() => expect(mocks.downloadBinary).toHaveBeenCalled()); expect(mocks.downloadBinary.mock.calls.at(-1)![1]).toEqual(archive);
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'open_web_package_instance')).toBe(false);
  });
  it.each([
    { mediaType: 'application/json', generated: '```json\n{"value":7}\n```', normalized: '{"value":7}' },
    { mediaType: 'text/javascript', generated: 'globalThis.generatedMustNotRun = true;', normalized: 'globalThis.generatedMustNotRun = true;\n' },
    { mediaType: 'text/css', generated: 'body { background: url(https://untrusted.invalid/background); }', normalized: 'body { background: url(https://untrusted.invalid/background); }\n' },
  ])('imports and validates $mediaType without evaluating or dropping opaque base resources', async ({ mediaType, generated, normalized }) => {
    const { file, base } = await arenaWebPackageFixture({ mediaType }); webTextOverride = generated + '\n' + webTrailer;
    saveDraft({ ...draft('daily', 'stream'), reportFormat: 'web' }); await mount(); await click('恢复草稿'); await openGenerationOptions(); await click('选择 Web 包');
    const tab = [...document.querySelectorAll<HTMLButtonElement>('button')].find((entry) => entry.textContent?.trim().startsWith('本地库'))!; await act(async () => tab.click()); await settle();
    const picker = document.querySelector<HTMLInputElement>('input[type="file"][accept*="zip"]')!; Object.defineProperty(picker, 'files', { configurable: true, value: [file] });
    await act(async () => picker.dispatchEvent(new Event('change', { bubbles: true }))); await vi.waitFor(() => expect(localStorage.getItem(ARENA_DRAFT_KEY)).toContain(base.ref.digest)); await settle();
    expect(packageDocs.size).toBe(0); await click('生成战报'); await vi.waitFor(() => expect(container.textContent).toContain('生成完成。'));
    await click('完整导出 JSON'); const exported = JSON.parse(mocks.download.mock.calls.at(-1)![1]);
    expect(exported.result.markdown).toBe(normalized); expect(exported.result.rawText).toBe(webTextOverride);
    expect(exported.result.renderSnapshot.webPackage).toMatchObject({ packageRef: base.ref, targetPath: base.manifest.generation.target, targetMediaType: mediaType });
    expect(container.querySelector('iframe,script,style')).toBeNull(); expect((globalThis as { generatedMustNotRun?: boolean }).generatedMustNotRun).toBeUndefined();
    expect(button('运行 Web 战报').disabled).toBe(true); expect(activeCloseHandles).toBe(1);
    await act(async () => { expect(scopeClose().preventDefault).toHaveBeenCalledOnce(); }); expect(window.confirm).toHaveBeenCalled();
    await click('下载生成目标');
    if (mediaType !== 'application/json') { expect(mocks.download.mock.calls.at(-1)![0]).toBe('arena-complete.json'); vi.mocked(window.confirm).mockReturnValue(true); await click('下载生成目标'); }
    expect(mocks.download.mock.calls.at(-1)![1]).toBe(normalized);
    await vi.waitFor(() => expect(button('下载精确 Base ZIP（不含生成目标）').disabled).toBe(false)); await click('下载精确 Base ZIP（不含生成目标）');
    const exportedBase = await unpackWebPackageZip(mocks.downloadBinary.mock.calls.at(-1)![1]); expect(exportedBase.ref).toEqual(base.ref);
    expect(exportedBase.readFile('unknown.bin')).toEqual(new Uint8Array([0, 255, 11, 42])); expect(exportedBase.readFile(base.manifest.generation.target)).toBeUndefined();
  });

  it('keeps a failed package save exportable and fences a late file read after target change', async () => {
    const { file, archive, base } = await arenaWebPackageFixture();
    saveDraft({ ...draft('daily', 'stream'), reportFormat: 'web' }); await mount(); await click('恢复草稿'); await openGenerationOptions(); await click('选择 Web 包');
    const tab = [...document.querySelectorAll<HTMLButtonElement>('button')].find((entry) => entry.textContent?.trim().startsWith('本地库'))!; await act(async () => tab.click()); await settle();
    const checkbox = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((entry) => entry.closest('label')?.textContent?.includes('导入时保存到本地库'))!; await act(async () => checkbox.click()); failSave = true;
    await uploadWebZip(file); await vi.waitFor(() => expect(document.body.textContent).toContain('保存失败')); expect(packageDocs.size).toBe(0);
    const download = document.querySelector<HTMLButtonElement>('[aria-label="下载 Web 包 ZIP：本地 json 包"]')!; expect(download).toBeTruthy(); await act(async () => download.click());
    await vi.waitFor(() => expect(mocks.downloadBinary).toHaveBeenCalled()); expect(mocks.downloadBinary.mock.calls.at(-1)![1]).toEqual(archive);
    let finish!: (buffer: ArrayBuffer) => void; const pending = new Promise<ArrayBuffer>((resolve) => { finish = resolve; });
    const late = new File(['pending'], 'late.zip'); Object.defineProperty(late, 'arrayBuffer', { value: () => pending });
    await uploadWebZip(late); const writes = mocks.invoke.mock.calls.filter(([command]) => command === 'save_web_package').length;
    await act(async () => { expect(scopeClose().preventDefault).toHaveBeenCalledOnce(); }); expect(activeCloseHandles).toBe(1);
    await act(async () => getDesktopAiConfigStore().selectExecutionLocation('server')); await settle(); finish(archive.slice().buffer); await settle();
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'save_web_package')).toHaveLength(writes); expect(packageDocs.size).toBe(0);
    expect(JSON.parse(localStorage.getItem(ARENA_DRAFT_KEY)!).draft.webPackageRef).toEqual(base.ref);
    expect(document.body.textContent).toContain('官方服务器生成'); expect(mocks.invoke.mock.calls.some(([command]) => command === 'open_web_package_instance')).toBe(false);
  });

  it.each(['cancel', 'EOF', 'target'] as const)('Web package %s retains partial source with no success artifact, history or duplicate execution', async (ending) => {
    hold = ending !== 'EOF'; eof = ending === 'EOF';
    saveDraft({ ...draft('daily', 'stream'), reportFormat: 'web', webPackageRef: BUILTIN_WEB_PACKAGE_PRESETS[0]!.packageRef });
    await mount(); await click('恢复草稿'); await act(async () => { button('生成战报').click(); button('生成战报').click(); });
    await vi.waitFor(() => expect(calls()).toHaveLength(1)); await settle();
    if (ending === 'cancel') { await click('取消生成'); release?.(); }
    if (ending === 'target') { expect(() => getDesktopAiConfigStore().selectExecutionLocation('server')).toThrow('生成期间'); await click('取消生成'); release?.(); await vi.waitFor(() => expect(getDesktopAiConfigStore().getSnapshot().generationActive).toBe(false)); await act(async () => getDesktopAiConfigStore().selectExecutionLocation('server')); await settle(); }
    await vi.waitFor(() => expect(button('取消生成')).toBeUndefined());
    await click('完整导出 JSON'); const exported = JSON.parse(mocks.download.mock.calls.at(-1)![1]);
    expect(exported.result.rawText).toContain('webShouldNotRun'); expect(exported.result.phase).not.toBe('completed'); expect(exported.result.renderSnapshot).toBeNull(); expect(exported.candidates).toBeNull();
    expect(exported.draft.narrativeHistoryEntries).toEqual([]); expect(docs.size).toBe(0); expect(calls()).toHaveLength(1);
    expect(container.querySelector('iframe,script,img[src*="untrusted.invalid"]')).toBeNull(); expect(button('运行 Web 战报').disabled).toBe(true);
  });

  it('restores missing exact packages, requires explicit candidate selection, and preserves historical provenance through compatibility', async () => {
    const original = await arenaWebPackageFixture({ version: '1.0.0' }), second = await arenaWebPackageFixture({ version: '2.0.0' }), third = await arenaWebPackageFixture({ version: '3.0.0' });
    webTextOverride = '{"value":3}\n' + webTrailer;
    saveDraft({ ...draft('daily', 'stream'), reportFormat: 'web' }); await mount(); await click('恢复草稿'); await openGenerationOptions(); await click('选择 Web 包');
    const tab = [...document.querySelectorAll<HTMLButtonElement>('button')].find((entry) => entry.textContent?.trim().startsWith('本地库'))!; await act(async () => tab.click()); await settle();
    await uploadWebZip(original.file); await click('生成战报'); await vi.waitFor(() => expect(container.textContent).toContain('生成完成。'));
    await act(async () => root.unmount()); root = createRoot(container); await mount(); await click('恢复草稿');
    await vi.waitFor(() => expect(document.body.textContent).toContain('revision 不可用'));
    const replayImport = async (file: File) => { const picker = document.querySelector<HTMLInputElement>('[data-testid="arena-web-replay-controls"] input[type="file"]')!; expect(picker).toBeTruthy(); Object.defineProperty(picker, 'files', { configurable: true, value: [file] }); await act(async () => picker.dispatchEvent(new Event('change', { bubbles: true }))); await settle(); };
    await replayImport(wrappedArenaWebPackageFile()); await vi.waitFor(() => expect(document.body.textContent).toContain('可用候选 2.0.0'));
    expect(document.querySelector('[data-testid="arena-web-replay-controls"]')?.textContent).toContain('synthetic-wrapper/');
    expect(document.querySelector('[data-testid="arena-web-replay-controls"]')?.textContent).toContain(second.base.ref.digest);
    expect(document.body.textContent).not.toContain('当前使用的是不同版本');
    await replayImport(third.file); await vi.waitFor(() => expect(document.querySelector('[data-testid="arena-web-replay-controls"] select')) .toBeTruthy());
    expect(button('确认兼容校验此版本').disabled).toBe(true);
    const select = document.querySelector<HTMLSelectElement>('[data-testid="arena-web-replay-controls"] select')!;
    await act(async () => { select.value = third.base.ref.digest; select.dispatchEvent(new Event('change', { bubbles: true })); }); await click('确认兼容校验此版本');
    await vi.waitFor(() => expect(document.body.textContent).toContain('当前使用的是不同版本'));
    await click('完整导出 JSON'); let exported = JSON.parse(mocks.download.mock.calls.at(-1)![1]); expect(exported.result.renderSnapshot.webPackage.packageRef).toEqual(original.base.ref);
    expect(button('运行 Web 战报').disabled).toBe(true); expect(button('下载精确 Base ZIP（不含生成目标）').disabled).toBe(true);
    await openGenerationOptions(); await click('更换 Web 包'); const local = [...document.querySelectorAll<HTMLButtonElement>('button')].find((entry) => entry.textContent?.trim().startsWith('本地库'))!; await act(async () => local.click()); await settle(); await uploadWebZip(original.file);
    await vi.waitFor(() => expect(document.body.textContent).toContain('已验证精确包与生成目标'));
    await click('完整导出 JSON'); exported = JSON.parse(mocks.download.mock.calls.at(-1)![1]); expect(exported.result.renderSnapshot.webPackage.packageRef).toEqual(original.base.ref);
    expect(packageDocs.size).toBe(0); expect(mocks.invoke.mock.calls.some(([command]) => command === 'open_web_package_instance')).toBe(false);
  });

});
