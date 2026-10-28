// @vitest-environment jsdom
import { ARENA_REPORT_CARD_WIDTH_KEY } from '../src/features/arena/use-report-card-width';
import { withFixtureStreamReceipt } from './helpers/stream-receipt-fixture';
/** Real Desktop route/shared views/session/B1 adapter; simulated IPC and loopback fixture, not OS/Tauri acceptance. */
import { TextEncoder as NodeTextEncoder } from 'node:util';
import { act as reactAct, StrictMode } from 'react';
import { createReactActScope } from './helpers/react-act-scope';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicRankingItem, PublicRankingRequest } from '@mahoshojo/contracts/public-ranking';
import type { AiExecutionRequest } from '@mahoshojo/contracts/ai-execution';
import { PRESET_LIST } from '@mahoshojo/domain/presets';
import { SCENARIO_PRESET_LIST } from '@mahoshojo/domain/scenario-presets';
import rankingFixture from '@mahoshojo/contracts/fixtures/public-ranking.json';
import { StoryPendingSnapshotSchema } from '@mahoshojo/contracts/desktop-arena-story';
import { DesktopArenaHostedRecoveryPointerSchema } from '@mahoshojo/contracts/desktop-arena-hosted';
import type { AiStreamEvent } from '@mahoshojo/ai-core/stream-events';
import { builtinWebPackageSource, BUILTIN_WEB_PACKAGE_PRESETS, packWebPackageZip, unpackWebPackageZip } from '@mahoshojo/web-package';
import type { LocalWebPackageRecordV1 } from '@mahoshojo/local-library/web-package-record';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import { ADVANCED_ARENA_DRAFT_KEY, ARENA_DRAFT_KEY, createInitialArenaDraft, type ArenaDraft } from '../src/features/arena/session';
import { DESKTOP_AI_CONFIG_STORAGE_KEY } from '../src/features/ai-config/desktop-ai-config-store';
import { getDesktopAiConfigStore, resetDesktopAiConfigStoreForTests } from '../src/features/ai-config/use-desktop-ai-config';
import { arenaWebPackageFixture, wrappedArenaWebPackageFile } from './fixtures/arena-web-package';
import { createDesktopRouter } from '../src/app/router';
// 编译真实 lazy 页面属于测试准备，不占用单条交互旅程的 10 秒预算；不替换路由或组件。
import '../src/app/battle-page';
import { deferred, installStoryCrypto, StoryFixturePort, storyFixtureInvoke } from './helpers/story-fixture';
import { HostedStoryFixture } from './helpers/hosted-story-fixture';
import { branchPageFixture } from './helpers/arena-story-branch-page-fixture';
import { STORY_PENDING_IPC } from '../src/platform/arena-story-pending-native';
import { ARENA_HOSTED_RECOVERY_KEYS } from '../src/features/arena/hosted-recovery';
import { getDesktopCloudSessionStore, resetDesktopCloudSessionStoreForTests } from '../src/features/account/use-desktop-cloud-session';
installStoryCrypto();
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), download: vi.fn(), downloadBinary: vi.fn(), downloadBlob: vi.fn(), capture: vi.fn(), profile: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, isTauri: () => true, Channel: class { onmessage?: (value: unknown) => void; } }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: mocks.listen }) }));
vi.mock('../src/platform/download-text-file', () => ({ downloadTextFile: mocks.download, downloadBinaryFile: mocks.downloadBinary, downloadBlobFile: mocks.downloadBlob }));
vi.mock('@mahoshojo/ui-web/client', async (original) => ({ ...await original<object>(), capturePngBlob: mocks.capture }));
vi.mock('../src/platform/provider-profile-bridge', () => ({ listProviderProfileIds: async () => ['loopback'], getProviderProfile: mocks.profile }));
let actScope: ReturnType<typeof createReactActScope>;
const act = <T,>(callback: () => T | Promise<T>) => actScope.act(callback);
let root: Root, container: HTMLDivElement, server: Server, endpoint: string;
let activeCloseHandles = 0;
let storyPort: StoryFixturePort, storyIpc: ReturnType<typeof storyFixtureInvoke>;
let storyBranch: Awaited<ReturnType<typeof branchPageFixture>> | null;
let hostedStory: HostedStoryFixture, hostedCapabilityAvailable: boolean;
let cloudAccount: { userId: number; username: string } | null;
const pendingCommands = new Set<string>(Object.values(STORY_PENDING_IPC));
let markdownSuffix = '';
let holdBeforeBody = false;
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
const button = (text: string, scope: ParentNode = document) => [...scope.querySelectorAll('button')].find((entry) => (entry.getAttribute('aria-label') ?? entry.textContent)?.trim() === text)!;
const settle = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); }); };
const openRecoveryTools = async () => { const toggle = button('问题排查'); if (toggle?.getAttribute('aria-expanded') === 'false') { await act(async () => toggle.click()); await settle(); } };
const click = async (text: string, scope?: ParentNode) => { if (text === '检查恢复条件') await openRecoveryTools(); expect(button(text, scope), text).toBeTruthy(); await act(async () => button(text, scope).click()); await settle(); };
const openGenerationOptions = async () => {
  const section = [...document.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].find((item) => item.textContent?.includes('⚡ 生成方式'));
  if (section?.getAttribute('aria-expanded') === 'false') { await act(async () => section.click()); await settle(); }
};
const change = async (selector: string, value: string) => {
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!; expect(input, selector).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
};
const mount = async () => {
  const scope = actScope; const router = createDesktopRouter(); await router.load(); await scope.act(async () => root.render(<StrictMode><RouterProvider router={router} /></StrictMode>));
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
beforeEach((context) => {
  actScope = createReactActScope(context.signal);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); localStorage.clear(); storyBranch = null; storyPort = new StoryFixturePort(); storyIpc = storyFixtureInvoke(storyPort); received = []; docs = new Map(); hold = false; failSave = false; eof = false; release = undefined; activeCloseHandles = 0; markdownSuffix = ''; holdBeforeBody = false; webTextOverride = null; packageDocs = new Map(); packageBytes = new Map();
  localStorage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, JSON.stringify({ version: 2, selection: { executionPreference: 'client', clientConnectionId: 'loopback' }, hiddenPresetIds: [] }));
  resetDesktopAiConfigStoreForTests(); resetDesktopCloudSessionStoreForTests();
  hostedStory = new HostedStoryFixture(); hostedCapabilityAvailable = true; cloudAccount = null;
  mocks.profile.mockResolvedValue({ id: 'loopback', name: 'Loopback', adapter: 'openai-compatible', baseUrl: endpoint.replace('/chat/completions', ''), modelId: 'fixture-model' });
  mocks.listen.mockImplementation(async () => { activeCloseHandles += 1; return vi.fn(() => { activeCloseHandles -= 1; }); }); mocks.download.mockResolvedValue(undefined); mocks.capture.mockResolvedValue(new Blob(['fixture'], { type: 'image/png' }));
  mocks.invoke.mockImplementation(withFixtureStreamReceipt(async (command: string, raw?: Record<string, unknown> | Uint8Array, options?: { headers: Record<string, string> }) => {
    // Pending discovery is separate; the Direct record fixture must not swallow it.
    if (pendingCommands.has(command)) return hostedStory.invoke(command, raw, options);
    if (storyBranch?.handles(command, raw, options)) return storyBranch.invoke(command, raw, options);
    if (command.includes('_arena_story_')) return storyIpc.invoke(command, raw, options);
    if (command === 'cloud_cached_account') return cloudAccount ? { account: cloudAccount } : null;
    if (command === 'cloud_auth_status') return cloudAccount ? { state: 'active', account: cloudAccount } : { state: 'signed-out' };
    if (command === 'cloud_public_ranking_read') return { kind: 'seasons', data: rankingFixture.responses.seasons };
    if (['arena_hosted_stream', 'arena_hosted_control', 'arena_hosted_detach'].includes(command)) {
      if (!hostedCapabilityAvailable && command === 'arena_hosted_stream' && (raw as { request?: { operation: string } })?.request?.operation === 'create-story-stream')
        throw { code: 'capability-unavailable', message: 'synthetic capability unavailable', dispatchState: 'not-dispatched', intentOwnership: 'current-owned' };
      return hostedStory.invoke(command, raw, options);
    }
    const args = raw as Record<string, unknown> | undefined;
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
      channel.onmessage({ ...identity, sequence: 0, type: 'started' }); channel.onmessage({ ...identity, sequence: 1, type: 'reasoning-delta', delta: output.reasoning });
      if (holdBeforeBody) await new Promise<void>((resolve) => { release = resolve; });
      channel.onmessage({ ...identity, sequence: 2, type: 'text-delta', delta: output.text });
      if (hold) await new Promise<void>((resolve) => { release = resolve; });
      if (!eof) channel.onmessage({ ...identity, sequence: 3, type: 'result', result: { ...identity, status: 'completed', output, finishReason: 'stop', resolvedModelId: 'actual-fixture-model', usage: { inputTokens: 10, outputTokens: 20, reasoningTokens: 3 } } }); return;
    }
    if (command === 'public_read_cache_query') return { status: 'ready', total: 1, bodyCount: 1, entries: [{ card: { id: 'cached-1', name: '缓存角色', type: 'character', description: '完整公开副本', is_public: 1, updated_at: '2026-10-01T00:00:00Z' }, hasBody: true, lastSuccessAt: '2026-10-01T00:00:00Z', summaryUpdatedAt: '2026-10-01T00:00:00Z', bodyUpdatedAt: '2026-10-01T00:00:00Z' }] };
    if (command === 'public_read_cache_card') return { status: 'ready', availability: 'full', entry: { card: { id: 'cached-1', name: '缓存角色', type: 'character', is_public: 1, data: JSON.stringify({ templateId: '通用角色', name: '缓存角色', content: '缓存完整原文', signature: 'unverified-source' }) }, bodyUpdatedAt: '2026-10-01T00:00:00Z', lastSuccessAt: '2026-10-01T00:00:00Z' } };
    if (command === 'has_provider_secret') return true;
    if (command === 'cloud_card_library_request') return { status: 200, body: { success: true, cards: [], tags: [], total: 0 } };
    return undefined;
  }));
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
afterEach(async () => {
  release?.();
  await actScope.drain();
  await reactAct(async () => root.unmount());
  container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe('Desktop /battle journey against loopback fixture', () => {
  it.each(['battle', 'arena'] as const)('/%s 从 reasoning-only 到完成保留共源卡壳，并由卡内导出含模型/用量/署名的图片', async product => {
    holdBeforeBody = true; cloudAccount = { userId: 42, username: '验收用户名' };
    localStorage.setItem(product === 'battle' ? ARENA_DRAFT_KEY : ADVANCED_ARENA_DRAFT_KEY, JSON.stringify({ version: 1, draft: draft('daily', 'stream') }));
    window.location.hash = `#/${product}`; await mount(); await click('生成战报');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const card = container.querySelector('.result-card')!; expect(card).not.toBeNull();
    expect(card.querySelector('.ai-reasoning-panel')?.textContent).toContain('AI 正在思考');
    await act(async () => card.querySelector<HTMLButtonElement>('.ai-reasoning-panel button')!.click());
    expect(card.querySelector('.ai-reasoning-panel pre')?.textContent).toContain('独立的推理');
    expect(card.textContent).not.toContain(text); expect(card.textContent).toContain('停止生成');
    await act(async () => release!()); await settle();
    await vi.waitFor(() => expect(card.textContent).toContain('actual-fixture-model'));
    expect(card.textContent).toContain('输入 10｜推理 3｜输出 17');
    expect(button('📱 保存为图片', card)).toBeTruthy(); expect(button('📄 下载记录', card)).toBeTruthy();
    mocks.capture.mockImplementationOnce(async (element: HTMLElement) => {
      expect(element).toBe(card); expect(element.textContent).toContain('验收用户名');
      expect(element.querySelector('.logo-placeholder img')?.getAttribute('src')).toBe('/logo-white-qrcode.svg');
      expect(element.querySelector<HTMLElement>('.logo-placeholder')?.style.display).toBe('flex');
      expect(element.querySelector<HTMLElement>('.ai-reasoning-panel')?.style.display).toBe('none');
      return new Blob(['fixture'], { type: 'image/png' });
    });
    await click('📱 保存为图片', card);
    expect(mocks.capture).toHaveBeenCalledOnce(); expect(mocks.downloadBlob).toHaveBeenCalledOnce();
    expect(calls()).toHaveLength(1);
  });
  it.each(['battle', 'arena'] as const)('/%s 图片失败保留通用错误框、恢复卡片操作，并在捕获期间阻止离开', async product => {
    localStorage.setItem(product === 'battle' ? ARENA_DRAFT_KEY : ADVANCED_ARENA_DRAFT_KEY, JSON.stringify({ version: 1, draft: draft('daily', 'non-stream') }));
    window.location.hash = `#/${product}`; await mount(); await click('生成战报');
    await vi.waitFor(() => expect(container.querySelector('.result-card')?.textContent).toContain('actual-fixture-model'));
    let rejectCapture!: (cause: unknown) => void;
    mocks.capture.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectCapture = reject; }));
    await click('📱 保存为图片'); expect(scopeClose().preventDefault).toHaveBeenCalled();
    await act(async () => rejectCapture(new Error('capture-failed'))); await settle();
    expect(container.querySelector('.error-message[role="alert"]')?.textContent).toContain('生成图片失败，请重试');
    expect(container.querySelector('.arena-feedback')).toBeNull();
    expect(button('📱 保存为图片').disabled).toBe(false); expect(container.querySelector<HTMLElement>('.logo-placeholder')?.style.display).toBe('none');
    expect(mocks.downloadBlob).not.toHaveBeenCalled(); expect(calls()).toHaveLength(1);
  });
  it.each(['battle', 'arena'] as const)('/%s 文本导出失败保留通用错误框与原报告', async product => {
    localStorage.setItem(product === 'battle' ? ARENA_DRAFT_KEY : ADVANCED_ARENA_DRAFT_KEY, JSON.stringify({ version: 1, draft: draft('daily', 'non-stream') }));
    window.location.hash = `#/${product}`; await mount(); await click('生成战报');
    await vi.waitFor(() => expect(container.querySelector('.result-card')?.textContent).toContain('actual-fixture-model'));
    mocks.download.mockImplementationOnce(() => { throw new Error('文本导出失败，网络规则未改变'); });
    await click('📄 下载战斗记录');
    expect(container.querySelector('.error-message[role="alert"]')?.textContent).toContain('文本导出失败');
    expect(container.querySelector('.error-message a')?.getAttribute('href')).toMatch(/^#\/encyclopedia\//);
    expect(container.querySelector('.arena-feedback')).toBeNull();
    expect(container.querySelector('.result-card')?.textContent).toContain(text);
    expect(calls()).toHaveLength(1);
  });
  it('多卡截图全部结束前持续保护页面和故事预览', async () => {
    saveDraft(draft('daily', 'stream')); await mount(); await click('新建连续战报');
    await vi.waitFor(() => expect(storyPort.heads()[0]?.chapterCount).toBe(1)); await settle();
    const current = container.querySelector('[aria-label="本次章节结果"]')!;
    const saved = container.querySelector('[data-story-read-status="loaded"]')!;
    const first = deferred<Blob>(), second = deferred<Blob>();
    mocks.capture.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    await click('📱 保存为图片', current); await click('📱 保存为图片', saved);
    expect(mocks.capture).toHaveBeenCalledTimes(2);
    const rows = () => [...container.querySelectorAll<HTMLButtonElement>('[aria-label="连续战报会话"] button[aria-pressed]')];
    expect(rows().length).toBeGreaterThan(0); expect(rows().every(node => node.disabled)).toBe(true);
    expect(button('清除本次预览').disabled).toBe(true);
    vi.mocked(window.confirm).mockReturnValue(true);
    await act(async () => { first.resolve(new Blob(['first'])); }); await settle();
    expect(scopeClose().preventDefault).toHaveBeenCalled();
    expect(button('清除本次预览').disabled).toBe(true); expect(rows().every(node => node.disabled)).toBe(true);
    expect(current.isConnected).toBe(true); expect(saved.isConnected).toBe(true);
    await act(async () => { second.resolve(new Blob(['second'])); }); await settle();
    expect(button('清除本次预览').disabled).toBe(false); expect(rows().every(node => !node.disabled)).toBe(true);
    expect(scopeClose().preventDefault).not.toHaveBeenCalled();
    expect(mocks.downloadBlob).toHaveBeenCalledTimes(2); expect(received).toHaveLength(1);
  });
  it('再次生成的 reasoning-only 结果仍自动定位一次', async () => {
    holdBeforeBody = true; saveDraft(draft('daily', 'stream')); vi.mocked(window.confirm).mockReturnValue(true);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 99999 } as DOMRect);
    await mount();
    const scrolls = () => vi.mocked(HTMLElement.prototype.scrollIntoView).mock.contexts.filter(node => (node as HTMLElement).getAttribute('aria-label') === '战报结果').length;
    for (let run = 1; run <= 2; run++) {
      release = undefined; await click('生成战报'); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
      expect(scrolls()).toBe(run);
      await act(async () => release!()); await settle();
      await vi.waitFor(() => expect(container.querySelector('.result-card')?.textContent).toContain('actual-fixture-model'));
      expect(scrolls()).toBe(run);
    }
    expect(received).toHaveLength(2);
  });
  it.each(['battle', 'arena'] as const)('/%s 部分正文失败复用紧凑反馈且不重放模型请求', async product => {
    eof = true;
    localStorage.setItem(product === 'battle' ? ARENA_DRAFT_KEY : ADVANCED_ARENA_DRAFT_KEY, JSON.stringify({ version: 1, draft: draft('daily', 'stream') }));
    window.location.hash = `#/${product}`; await mount(); await click('生成战报');
    const selector = `.arena-feedback--${product === 'battle' ? 'lite' : 'full'}.arena-feedback--warning[role="alert"]`;
    await vi.waitFor(() => expect(container.querySelector(selector)?.textContent).toContain('✨ 魔法失效了！'));
    expect(container.querySelector('.result-card')?.textContent).toContain(text);
    expect(container.querySelector(`${selector} a`)?.getAttribute('href')).toMatch(/^#\/encyclopedia\//);
    expect(calls()).toHaveLength(1);
  });
  it.each(['battle', 'arena'] as const)('/%s shares the guide and ordinary navigation without claiming unavailable capabilities', async product => {
    saveDraft(draft('daily', 'non-stream'));
    localStorage.setItem(ADVANCED_ARENA_DRAFT_KEY, JSON.stringify({ version: 1, draft: draft('kizuna', 'stream') }));
    window.location.hash = `#/${product}`;
    const router = await mount();
    const page = () => container.querySelector(product === 'battle' ? '.battle-lite-panel' : '.arena-page-shell')!;
    const guide = () => [...page().querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].find(item => item.textContent?.includes('使用须知'))!;
    expect(page().textContent).toContain('分别保存草稿；切换页面不会带入已选角色、情景或生成结果');
    expect(page().textContent).toContain('插图生成暂未开放');
    expect(page().textContent).not.toContain('共享同一套');
    expect(page().textContent).not.toContain('桌面简洁版 ·');
    expect(button('快速查看排行榜', page())).toBeTruthy();
    for (const href of ['/details', '/canshou', '/encyclopedia/arena', '/encyclopedia/guidance', '/ranking']) {
      expect(page().querySelector(`a[href="#${href}"]`), href).not.toBeNull();
    }
    if (product === 'battle') expect(page().querySelector('.battle-lite-hero-card a[href="#/arena"]')).not.toBeNull();
    if (product === 'arena') {
      const external = [...page().querySelectorAll<HTMLAnchorElement>('a')].find(link => link.textContent === '前往万途竞技场')!;
      await act(async () => external.click());
      expect(mocks.invoke).toHaveBeenCalledWith('open_external_url', { url: 'https://wantu-waystation.pages.dev/arena' });
      expect(window.location.hash).toBe('#/arena');
    }
    expect(guide().getAttribute('aria-expanded')).toBe('true');
    await act(async () => guide().click());
    const guideKey = product === 'battle' ? 'battle-lite.section.guide.open' : 'arena.section.guide.open';
    expect(localStorage.getItem(guideKey)).toBe('0');
    const switchLink = [...page().querySelectorAll<HTMLAnchorElement>('a')].find(link => link.textContent === (product === 'battle' ? '进入完整版竞技场' : '切换到简洁版'))!;
    const other = product === 'battle' ? 'arena' : 'battle';
    // The host keeps native modified-click semantics, rather than eagerly navigating.
    const modified = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    let preventedByHost: boolean | undefined;
    const emulateModifiedClickDefault = (event: MouseEvent) => {
      if (event !== modified) return;
      // React's root handler has already run. jsdom ignores Ctrl when following
      // anchors, so suppress only its incorrect current-document navigation.
      preventedByHost = event.defaultPrevented;
      event.preventDefault();
    };
    const historyLength = window.history.length;
    document.addEventListener('click', emulateModifiedClickDefault);
    try {
      await act(async () => switchLink.dispatchEvent(modified));
    } finally {
      document.removeEventListener('click', emulateModifiedClickDefault);
    }
    expect(preventedByHost).toBe(false);
    expect(window.location.hash).toBe(`#/${product}`);
    expect(window.history.length).toBe(historyLength);
    await act(async () => switchLink.click());
    await vi.waitFor(() => expect(window.location.hash).toBe(`#/${other}`)); await settle();
    expect(container.textContent).toContain(other === 'arena' ? '本页是完整版竞技场' : '本页是 `/battle` 简洁版');
    expect(JSON.parse(localStorage.getItem(ARENA_DRAFT_KEY)!).draft.battleMode).toBe('daily');
    expect(JSON.parse(localStorage.getItem(ADVANCED_ARENA_DRAFT_KEY)!).draft.battleMode).toBe('kizuna');
    await act(async () => router.history.back());
    await vi.waitFor(() => expect(window.location.hash).toBe(`#/${product}`)); await settle();
    expect(guide().getAttribute('aria-expanded')).toBe('false');
    expect(calls()).toHaveLength(0);
    await act(async () => (page().querySelector('a[href="#/ranking"]') as HTMLAnchorElement).click());
    await vi.waitFor(() => expect(window.location.hash).toBe('#/ranking')); await settle();
    await vi.waitFor(() => expect(container.querySelector('h1')?.textContent).toBe('排位排行榜'));
  });

  it.each(['battle', 'arena'] as const)('/%s ordinary guide links respect an in-flight generation leave decision', async product => {
    const key = product === 'arena' ? ADVANCED_ARENA_DRAFT_KEY : ARENA_DRAFT_KEY;
    localStorage.setItem(key, JSON.stringify({ version: 1, draft: draft('daily', 'stream') }));
    window.location.hash = `#/${product}`; hold = true; await mount(); await click('生成战报');
    await vi.waitFor(() => expect(received).toHaveLength(1));
    const page = container.querySelector(product === 'battle' ? '.battle-lite-panel' : '.arena-page-shell')!;
    for (const href of ['/ranking', '/encyclopedia/arena', product === 'battle' ? '/arena' : '/battle']) {
      await act(async () => (page.querySelector(`a[href="#${href}"]`) as HTMLAnchorElement).click()); await settle();
      expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining('确认离开'));
      expect(window.location.hash).toBe(`#/${product}`);
      expect(button('取消生成').disabled).toBe(false);
    }
    vi.mocked(window.confirm).mockReturnValue(true);
    await act(async () => (page.querySelector('a[href="#/ranking"]') as HTMLAnchorElement).click());
    await vi.waitFor(() => expect(window.location.hash).toBe('#/ranking')); await settle();
    release?.(); await settle();
    expect(received).toHaveLength(1);
    expect(container.querySelector('[aria-label="战报结果"]')).toBeNull();
  });

  it.each(['battle', 'arena'] as const)('/%s reopens its valid local draft automatically without replaying work', async product => {
    const value = draft('daily', 'non-stream');
    const key = product === 'arena' ? ADVANCED_ARENA_DRAFT_KEY : ARENA_DRAFT_KEY;
    const raw = JSON.stringify({ version: 1, draft: value, output: { phase: 'failed', rawText: '重启前完整原文', markdown: '', reasoning: '保留思考' } });
    const pointer = DesktopArenaHostedRecoveryPointerSchema.parse({ version: 1, protocolVersion: 'arena-hosted-sse-v1', product,
      requestId: 'synthetic-restart-request', actor: { kind: 'anonymous' }, bodyHash: 'a'.repeat(64), format: 'markdown', battleMode: 'daily',
      state: 'unknown', updatedAt: '2026-10-10T05:00:00.000Z' });
    const pointerRaw = JSON.stringify(pointer); localStorage.setItem(ARENA_HOSTED_RECOVERY_KEYS[product], pointerRaw);
    localStorage.setItem(key, raw); window.location.hash = `#/${product}`; await mount();
    expect(container.textContent).toContain('已恢复本机草稿与原文');
    expect(button('找回上次战报').disabled).toBe(false); expect(button('检查恢复条件')).toBeUndefined();
    await openRecoveryTools(); expect(button('检查恢复条件').disabled).toBe(false);
    expect(localStorage.getItem(ARENA_HOSTED_RECOVERY_KEYS[product])).toBe(pointerRaw);
    expect(button('恢复草稿')).toBeUndefined(); expect(button('生成战报').disabled).toBe(false);
    expect(document.querySelector<HTMLInputElement>('#arena-story-guidance')?.disabled).toBe(false);
    expect(calls()).toHaveLength(0); expect(docs.size).toBe(0);
    expect(mocks.invoke.mock.calls.some(([command]) => ['arena_hosted_stream', 'arena_hosted_control'].includes(command))).toBe(false);
    expect(localStorage.getItem(key)).toBe(raw);
    await click('下载会话备份');
    const exported = JSON.parse(mocks.download.mock.calls.at(-1)![1]);
    expect(exported.draft.combatants).toHaveLength(2); expect(exported.result).toMatchObject({ phase: 'failed', rawText: '重启前完整原文', reasoning: '保留思考' });
    expect(exported.generation).toBeNull(); expect(exported.candidates).toBeNull();
    expect(exported.hostedRecovery).toMatchObject({ pointer, pendingRestore: true });
  });

  it.each(['battle', 'arena'])('/%s only reads anonymous seasons after opening configuration diagnostics', async (product) => {
    window.location.hash = `#/${product}`;
    await mount();
    const reads = () => mocks.invoke.mock.calls.filter(([command]) => command === 'cloud_public_ranking_read');
    expect(reads()).toHaveLength(0);
    const before = localStorage.getItem(DESKTOP_AI_CONFIG_STORAGE_KEY);
    const diagnostic = container.querySelector<HTMLDetailsElement>('details[aria-label="严格排位配置检查"]')!;
    expect(diagnostic).not.toBeNull(); expect(diagnostic.open).toBe(false);
    await act(async () => { diagnostic.open = true; diagnostic.dispatchEvent(new Event('toggle')); });
    await vi.waitFor(() => expect(diagnostic.textContent).toContain('当前赛季'));
    // StrictMode may replay mount effects; every read must remain this anonymous operation.
    expect(reads().length).toBeGreaterThan(0);
    for (const [, args] of reads()) expect(args).toEqual({ request: { kind: 'seasons' } });
    expect(diagnostic.textContent).toContain('服务器资格未知');
    expect(diagnostic.textContent).toContain('当前选择为客户端');
    expect(localStorage.getItem(DESKTOP_AI_CONFIG_STORAGE_KEY)).toBe(before);
    expect(calls()).toHaveLength(0);
  });

  it.each(['classic', 'kizuna', 'daily', 'scenario'] as const)('%s × structured/Markdown route → execution → result → save → local-library reopen', async (mode) => {
    for (const output of ['non-stream', 'stream'] as const) {
      saveDraft(draft(mode, output)); const router = await mount();
      await click('生成战报'); await vi.waitFor(() => expect(container.textContent).toContain('生成完成。'));
      expect(received.at(-1)!.requestKind).toBe('arena'); expect(JSON.parse(received.at(-1)!.arenaInputJson!).mode).toBe(mode);
      expect(docs.size).toBe(0); expect(container.querySelector('[aria-label="战报结果"]')?.textContent).toContain(text);
      expect(container.querySelector('[data-arena-combatant-updates="v1"]')).not.toBeNull();
      expect(button('重试角色更新')).toBeUndefined();
      await click('下载会话备份');
      const beforeDownload = JSON.parse(mocks.download.mock.calls.at(-1)![1]);
      const roleToggle = container.querySelector<HTMLButtonElement>('section[aria-label$="的战后变化"] button[aria-expanded]')!;
      expect(roleToggle.getAttribute('aria-expanded')).toBe('false');
      await act(async () => roleToggle.click());
      expect(roleToggle.getAttribute('aria-expanded')).toBe('true');
      await click('下载更新设定');
      expect(JSON.parse(mocks.download.mock.calls.at(-1)![1])).toEqual(beforeDownload.candidates.characterEffects[0].data);
      expect(docs.size).toBe(0);
      await click('另存此角色到本地库');
      await vi.waitFor(() => expect(docs.size).toBe(1));
      await vi.waitFor(() => expect(button('另存战后角色副本').disabled).toBe(false));
      await click('另存战后角色副本');
      await vi.waitFor(() => { expect(docs.size).toBe(2); expect(button('保存叙事历史到本地库').disabled).toBe(false); });
      await click('保存叙事历史到本地库');
      await vi.waitFor(() => { expect(docs.size).toBe(3); expect(button('保存叙事历史到本地库').disabled).toBe(false); });
      await click('下载会话备份'); expect(JSON.parse(mocks.download.mock.calls.at(-1)![1]).result.rawText).toContain('车站重逢');
      await act(async () => router.navigate({ to: '/local-library' })); await settle(); expect(window.location.hash).toContain('/local-library');
      await act(async () => router.navigate({ to: '/battle' })); await settle(); await click('引用本地叙事历史');
      await vi.waitFor(() => expect(document.body.textContent).toContain('车站重逢')); expect(calls()).toHaveLength(output === 'stream' ? 2 : 1);
      await act(async () => root.unmount()); root = createRoot(container); docs.clear();
    }
  });
  it('waits for the character save acknowledgement before accepting a history save', async () => {
    const acknowledge = deferred<void>();
    const invoke = mocks.invoke.getMockImplementation()!;
    let awaitingAcknowledgement = false;
    const writes = () => mocks.invoke.mock.calls.filter(([command]) => command === 'save_local_card')
      .map(([, raw]) => JSON.parse(raw.request.document) as LocalCardRecordV1);
    mocks.invoke.mockImplementation(async (...args) => {
      const result = await invoke(...args);
      if (args[0] === 'save_local_card' && docs.size === 2) {
        awaitingAcknowledgement = true;
        await acknowledge.promise;
      }
      return result;
    });
    saveDraft(draft('daily', 'stream')); await mount();
    await click('生成战报'); await vi.waitFor(() => expect(container.textContent).toContain('生成完成。'));
    try {
      await click('另存战后角色副本');
      await vi.waitFor(() => expect(awaitingAcknowledgement).toBe(true));
      expect(docs.size).toBe(2); expect(button('保存叙事历史到本地库').disabled).toBe(true);
      await click('保存叙事历史到本地库');
      expect(writes().map((card) => card.cardType)).toEqual(['character', 'character']);
      expect(docs.size).toBe(2);
    } finally { await act(async () => acknowledge.resolve()); }
    await vi.waitFor(() => expect(button('保存叙事历史到本地库').disabled).toBe(false));
    expect(writes().map((card) => card.cardType)).toEqual(['character', 'character']);
    await click('保存叙事历史到本地库');
    await vi.waitFor(() => { expect(docs.size).toBe(3); expect(button('保存叙事历史到本地库').disabled).toBe(false); });
    expect(writes().map((card) => card.cardType)).toEqual(['character', 'character', 'history']);
    expect(calls()).toHaveLength(1);
  });
  it.each(['non-stream', 'stream'] as const)('%s result links use the existing confirmation boundary, never native href fallback', async (output) => {
    markdownSuffix = '\n\n[外部说明](https://example.test/report)\n\n[邮件目标](mailto:test@example.test)';
    saveDraft(draft('daily', output)); await mount(); await click('生成战报'); await vi.waitFor(() => expect(container.textContent).toContain('生成完成。'));
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
    saveDraft(draft('daily', 'stream')); await mount(); await click('生成战报'); await vi.waitFor(() => expect(container.textContent).toContain('生成完成。'));
    expect(calls()).toHaveLength(1); expect(calls()[0]![0]).toBe('stream_target_ai'); expect(calls()[0]![1]).toMatchObject({ target: { kind: 'preset', providerId: 'deepseek' } });
  });
  it.each(['battle', 'arena'] as const)('/%s character presets use independent groups and download the untouched original without changing selection', async product => {
    window.location.hash = `#/${product}`; await mount();
    const group = (title: string) => [...container.querySelectorAll('h3')].find(heading => heading.textContent === title)!.parentElement!;
    const girls = group('选择预设魔法少女'), monsters = group('选择预设残兽');
    expect(girls.querySelectorAll('[aria-pressed]')).toHaveLength(4); expect(monsters.querySelectorAll('[aria-pressed]')).toHaveLength(4);
    await click('下一页', girls); expect(girls.textContent).toContain('第 2 /'); expect(monsters.textContent).toContain('第 1 /');
    const preset = PRESET_LIST.find(item => item.type === 'canshou')!;
    const select = () => monsters.querySelector<HTMLButtonElement>('[aria-pressed]')!;
    await act(async () => select().click()); await settle();
    const key = product === 'arena' ? ADVANCED_ARENA_DRAFT_KEY : ARENA_DRAFT_KEY;
    const snapshot = localStorage.getItem(key)!; const selected = JSON.parse(snapshot).draft.combatants[0];
    const raw = readFileSync(resolve(process.cwd(), '../../content/presets', preset.filename), 'utf8');
    expect(selected).toMatchObject({ filename: preset.filename, desktopSource: 'preset', isPreset: true, isValid: false, data: JSON.parse(raw) });
    expect(select().getAttribute('aria-pressed')).toBe('true');
    await act(async () => monsters.querySelector<HTMLButtonElement>('[aria-label^="下载预设："]')!.click()); await settle();
    expect(mocks.download).toHaveBeenCalledExactlyOnceWith(preset.filename, raw, 'application/json');
    expect(localStorage.getItem(key)).toBe(snapshot); expect(container.textContent).toContain('已发起');
    await act(async () => select().click()); await settle();
    expect(JSON.parse(localStorage.getItem(key)!).draft.combatants).toHaveLength(0); expect(calls()).toHaveLength(0);
  });
  it('character preset loading is visible and cancellation retains the roster before a successful retry', async () => {
    await mount(); const baseFetch = fetch; const gate = deferred<Response>();
    vi.mocked(fetch).mockImplementationOnce(() => gate.promise);
    const select = () => container.querySelector<HTMLButtonElement>('[aria-label="选择预设角色：翠雀"]')!;
    await act(async () => { select().click(); select().click(); });
    expect(container.textContent).toContain('加载中...'); expect(select().disabled).toBe(true);
    await click('取消生成');
    await act(async () => gate.resolve(new Response(readFileSync(resolve(process.cwd(), '../../content/presets/M01_centaurea.json'), 'utf8')))); await settle();
    expect(container.querySelector('[aria-label="取消选择预设角色：翠雀"]')).toBeNull();
    expect(container.textContent).not.toContain('加载中...'); expect(select().disabled).toBe(false);
    // The original stub continues to serve only bundled fixture paths after its one deferred call.
    expect(fetch).toBe(baseFetch); await act(async () => select().click()); await settle();
    expect(JSON.parse(localStorage.getItem(ARENA_DRAFT_KEY)!).draft.combatants).toHaveLength(1);
  });
  it('已选预设共源类型、技术值与详情焦点，不改正文或触发模型', async () => {
    await mount();
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="选择预设角色：翠雀"]')!.click()); await settle();

    const roster = container.querySelector('[data-sensitive-roster-metadata]')?.closest('li') ?? container;
    expect(roster.textContent).toContain('(魔法少女)'); expect(roster.textContent).toContain('(预设)'); expect(roster.textContent).toContain('技术值：');
    const beforeDetails = localStorage.getItem(ARENA_DRAFT_KEY);
    const detailsButton = button('详情'); detailsButton.focus();
    await click('详情'); expect(document.body.textContent).toContain('此客户端内置预设版本');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭角色详情');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); await settle();
    expect(document.body.textContent).not.toContain('此客户端内置预设版本'); expect(localStorage.getItem(ARENA_DRAFT_KEY)).toBe(beforeDetails);
    expect(document.activeElement).toBe(detailsButton);
    expect(calls()).toHaveLength(0);
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
    await mount(); const section = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('🌐 在线角色库 / 随机匹配'))!; await act(async () => section.click()); await settle();
    await click('浏览在线角色库'); const localTab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(item => item.textContent?.startsWith('本地库'))!; await act(async () => localTab.click()); await vi.waitFor(() => expect(document.body.textContent).toContain('本地角色')); await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="加入"]')!.click());
    await settle(); expect(JSON.parse(localStorage.getItem(ARENA_DRAFT_KEY)!).draft.combatants[0].data.content).toBe('原卡原文'); expect(docs.get(source.id)).toEqual(source);
    const publicTab = [...document.querySelectorAll('button')].find((item) => item.textContent?.startsWith('公开'))!;
    expect(publicTab).toBeTruthy(); await act(async () => publicTab.click()); await settle(); await click('已缓存'); await vi.waitFor(() => expect(document.body.textContent).toContain('缓存角色')); await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="加入"]')!.click()); await settle();
    const stored = JSON.parse(localStorage.getItem(ARENA_DRAFT_KEY)!); expect(stored.draft.combatants).toHaveLength(2); expect(stored.draft.combatants[1]).toMatchObject({ isValid: false, isPreset: false, data: { name: '缓存角色', content: '缓存完整原文' } });
    expect(stored.draft.combatants[1]).not.toHaveProperty('sourceDataCardId'); expect(calls()).toHaveLength(0); expect(docs.size).toBe(1);
  });
  it('fails closed if the native close guard cannot register', async () => {
    mocks.listen.mockRejectedValue(new Error('native unavailable')); saveDraft(draft('daily', 'stream')); await mount();
    expect(container.textContent).toContain('窗口关闭保护初始化失败'); expect(button('生成战报').disabled).toBe(true); expect(calls()).toHaveLength(0);
    const provider = document.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!;
    expect(provider.matches(':disabled')).toBe(true); await act(async () => provider.click());
    expect([...document.querySelectorAll('button')].some((item) => item.textContent?.includes('新建自定义连接'))).toBe(false);
    expect(mocks.invoke.mock.calls.some(([command]) => ['save_provider_profile', 'set_provider_secret'].includes(command))).toBe(false);
  });
  it('server non-stream is selectable without dispatching or falling back to Direct', async () => {
    localStorage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, JSON.stringify({ version: 2, selection: { executionPreference: 'server', clientConnectionId: 'loopback' }, hiddenPresetIds: [] }));
    saveDraft(draft('daily', 'non-stream')); await mount();
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
    hold = true; saveDraft(draft('daily', 'stream')); await mount();
    await act(async () => { button('生成战报').click(); button('生成战报').click(); });
    await vi.waitFor(() => expect(release).toBeTypeOf('function')); expect(calls()).toHaveLength(1); expect(scopeClose().preventDefault).toHaveBeenCalledOnce();
    await click('取消生成'); release!(); await settle(); await vi.waitFor(() => expect(container.textContent).toContain('生成已取消'));
    expect(docs.size).toBe(0); expect(button('另存战后角色副本')).toBeUndefined(); expect(container.textContent).toContain(text);
  });
  it('EOF/failure and disk failure retain full export; retry stores once without replay', async () => {
    saveDraft(draft('daily', 'stream')); await mount(); eof = true; await click('生成战报');
    await vi.waitFor(() => expect(container.textContent).toContain('未收到可验证的完整终态')); expect(docs.size).toBe(0); await click('下载会话备份');
    expect(JSON.parse(mocks.download.mock.calls.at(-1)![1]).result.rawText).toContain(text);
    eof = false; vi.mocked(window.confirm).mockReturnValue(true); await click('生成战报'); await vi.waitFor(() => expect(container.textContent).toContain('生成完成。'));
    failSave = true; await click('保存叙事历史到本地库'); expect(container.textContent).toContain('完整原文仍在内存');
    failSave = false; await click('保存叙事历史到本地库'); await click('保存叙事历史到本地库'); expect(docs.size).toBe(1); expect(calls()).toHaveLength(2);
  });
  it.each(['battle', 'arena'] as const)('/%s 从历史选择器导入网页 JSON，关闭重开仍可引用且不覆盖活动历史', async product => {
    const key = product === 'battle' ? ARENA_DRAFT_KEY : ADVANCED_ARENA_DRAFT_KEY;
    const original = draft('daily', 'stream');
    localStorage.setItem(key, JSON.stringify({ version: 1, draft: original }));
    window.location.hash = `#/${product}`; await mount();
    expect(button('查看 / 编辑活动叙事历史')).toBeTruthy();
    await click('引用本地叙事历史');
    await vi.waitFor(() => expect(document.querySelector('input[type=file][aria-label="导入 JSON 并保存到本机"]')).not.toBeNull());
    const entry = { id: 'from-web', title: '网页迁移片段', content: '网页导出的完整正文', createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z' };
    const payload = { templateId: 'narrative-history', version: 1, updatedAt: entry.updatedAt, entries: [entry], extension: { keep: true } };
    let finish!: (text: string) => void;
    const file = { name: 'web-history.json', size: 100, text: () => new Promise<string>(resolve => { finish = resolve; }) } as File;
    await act(async () => {
      const input = document.querySelector<HTMLInputElement>('input[type=file][aria-label="导入 JSON 并保存到本机"]')!;
      Object.defineProperty(input, 'files', { value: [file] }); input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => { expect(scopeClose().preventDefault).toHaveBeenCalled(); });
    expect(button('取消', document.querySelector('[role="dialog"]')!).disabled).toBe(true);
    await act(async () => finish(JSON.stringify(payload)));
    await vi.waitFor(() => expect(document.body.textContent).toContain('已保存到本机（1 条）'));
    await vi.waitFor(() => expect(document.body.textContent).toContain('网页迁移片段'));
    expect([...docs.values()].find(item => item.cardType === 'history')?.data).toEqual(payload);
    await click('取消', document.querySelector('[role="dialog"]')!); await click('引用本地叙事历史');
    await vi.waitFor(() => expect(document.body.textContent).toContain('网页迁移片段'));
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(item => item.textContent?.includes('网页迁移片段'))!.click());
    await click('使用选中（1 条）');
    const saved = JSON.parse(localStorage.getItem(key)!).draft as ArenaDraft;
    expect(saved.historyReferences).toHaveLength(1);
    expect(saved.historyReferences[0].content).toBe(entry.content);
    expect(saved.narrativeHistoryEntries).toEqual(original.narrativeHistoryEntries);
    expect(calls()).toHaveLength(0);
  });
  it('locks target edits during a pending response, then switching never replays cancelled generation', async () => {
    hold = true; saveDraft(draft('daily', 'stream')); await mount(); await click('生成战报'); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    // Settings UI itself locks edits during generation; test the external store replacement boundary.
    expect(() => getDesktopAiConfigStore().selectExecutionLocation('server')).toThrow('生成期间');
    await click('取消生成'); release!(); await settle();
    await act(async () => { getDesktopAiConfigStore().selectExecutionLocation('server'); }); await settle(); expect(button('另存战后角色副本')).toBeUndefined(); expect(docs.size).toBe(0);
  });
  it.each(['classic', 'kizuna', 'daily', 'scenario'] as const)('advanced /arena %s completes both outputs with an independent draft', async (mode) => {
    const battleOriginal = JSON.stringify({ version: 1, draft: { ...draft('daily', 'stream'), customStoryLength: '独立简洁稿' } }); localStorage.setItem(ARENA_DRAFT_KEY, battleOriginal);
    for (const output of ['non-stream', 'stream'] as const) {
      localStorage.setItem(ADVANCED_ARENA_DRAFT_KEY, JSON.stringify({ version: 1, draft: { ...draft(mode, output), selectedQuestionnaires: [{ source: 'upload', selectionId: 'lore', questionnaire: { id: 'lore', title: '岛屿设定', kind: 'magical-girl', questions: [], loreMarkdown: '星海岛屿' } }] } }));
      window.location.hash = '#/arena'; const router = await mount(); expect(container.textContent).toContain('本页是完整版竞技场');
      await click('生成战报'); await vi.waitFor(() => expect(container.textContent).toContain('生成完成。'));
      expect(JSON.parse(received.at(-1)!.arenaInputJson!)).toMatchObject({ mode, questionnaires: [{ loreMarkdown: '星海岛屿' }] });
      await click('保存叙事历史到本地库'); expect([...docs.values()].some((item) => item.cardType === 'history')).toBe(true);
      await act(async () => router.navigate({ to: '/local-library' })); await settle(); expect(window.location.hash).toContain('/local-library'); expect(localStorage.getItem(ARENA_DRAFT_KEY)).toBe(battleOriginal);
      await act(async () => root.unmount()); root = createRoot(container); docs.clear();
    }
  });
  it('advanced real Lore/auxiliary/history controls freeze an edited source-aware request', async () => {
    window.location.hash = '#/arena'; localStorage.setItem(ADVANCED_ARENA_DRAFT_KEY, JSON.stringify({ version: 1, draft: draft('scenario', 'stream') }));
    await mount(); await click('粘贴 JSON'); await change('textarea[placeholder*="问卷 JSON"]', JSON.stringify({ id: 'lore', title: '岛屿', kind: 'magical-girl', questions: [], loreMarkdown: '星海岛屿', adjudicationEvents: [{ type: 'binary', description: 'Lore不得执行', probability: 100 }] })); await click('导入');
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
    await click('下载会话备份'); const exported = JSON.parse(mocks.download.mock.calls.at(-1)![1]); expect(exported.draft.historyOriginals[0].text).toBe(raw);
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
    await mount(); await click('选择本地 / 公开设定'); await vi.waitFor(() => expect(document.querySelector('[aria-label="选择本地设定"]')).toBeTruthy());
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
      holdBeforeBody = output === 'stream'; release = undefined;
      const key = product === 'arena' ? ADVANCED_ARENA_DRAFT_KEY : ARENA_DRAFT_KEY;
      localStorage.setItem(key, JSON.stringify({ version: 1, draft: { ...draft(mode, output), reportFormat: 'web' } }));
      window.location.hash = `#/${product}`;
      const router = await mount(); await settle(); await click('生成战报');
      if (output === 'stream') {
        await vi.waitFor(() => expect(release).toBeTypeOf('function'));
        const pendingCard = container.querySelector('.result-card');
        expect(pendingCard?.textContent).toContain('模型：fixture-model');
        expect(pendingCard?.textContent).toContain('tokens：输入 未提供｜推理 未提供｜输出 未提供');
        expect(pendingCard?.querySelector('.ai-reasoning-panel')?.textContent).toContain('AI 正在思考');
        expect(pendingCard?.querySelector('img[src="/arena-white.svg"]')).not.toBeNull();
        expect(button('📱 保存为图片', pendingCard!)).toBeTruthy();
        expect(button('普通显示').getAttribute('aria-pressed')).toBe('true');
        expect(container.querySelector('iframe, script, img[src*="untrusted.invalid"]')).toBeNull();
        await act(async () => release!()); holdBeforeBody = false;
      }
      await vi.waitFor(() => expect(container.textContent).toContain('生成完成。'));
      const resultCard = container.querySelector('.result-card');
      expect(resultCard?.textContent).toContain('模型：actual-fixture-model');
      expect(resultCard?.textContent).toContain('tokens：输入 10｜推理 3｜输出 17');
      expect(resultCard?.querySelector('img[src="/arena-white.svg"]')).not.toBeNull();
      expect(button('📱 保存为图片', resultCard!)).toBeTruthy();
      expect(container.querySelectorAll('.result-card')).toHaveLength(1);
      expect(mocks.capture).not.toHaveBeenCalled();
      expect(container.querySelector('[aria-label="Web 战报源码（安全文本）"]')?.textContent).toContain('webShouldNotRun');
      expect(container.querySelector('iframe, script, img[src*="untrusted.invalid"]')).toBeNull();
      expect((globalThis as { webShouldNotRun?: boolean }).webShouldNotRun).toBeUndefined();
      expect(button('运行 Web 战报').disabled).toBe(true);
      expect(mocks.invoke.mock.calls.some(([command]) => /^(begin_web_package_instance|append_web_package_resource|open_web_package_instance)$/.test(command))).toBe(false);
      expect(JSON.parse(received.at(-1)!.arenaInputJson!).reportFormat).toBe('web');
      await click('下载会话备份'); const exported = JSON.parse(mocks.download.mock.calls.at(-1)![1]);
      expect(exported.result.renderSnapshot.reportFormat).toBe('web'); expect(exported.result.rawText).toContain('MAHOSHOJO_ARENA_META'); expect(exported.result.markdown).not.toContain('MAHOSHOJO_ARENA_META');
      await click('保存叙事历史到本地库'); expect([...docs.values()].some((record) => record.cardType === 'history')).toBe(true);
      await act(async () => router.navigate({ to: '/local-library' })); await settle();
      await act(async () => router.navigate({ to: `/${product}` })); await settle();
      expect(container.querySelector('[aria-label="Web 战报源码（安全文本）"]')?.textContent).toContain('webShouldNotRun'); expect(button('运行 Web 战报').disabled).toBe(true);
      await act(async () => root.unmount()); root = createRoot(container); docs.clear();
    }
  });
  it.each((['battle', 'arena'] as const).flatMap((product) => (['classic', 'kizuna', 'daily', 'scenario'] as const).map((mode) => ({ product, mode }))))('$product $mode package target × both delivery modes uses the real preset and frozen artifact', async ({ product, mode }) => {
    for (const output of ['stream', 'non-stream'] as const) {
      const key = product === 'arena' ? ADVANCED_ARENA_DRAFT_KEY : ARENA_DRAFT_KEY;
      localStorage.setItem(key, JSON.stringify({ version: 1, draft: { ...draft(mode, output), reportFormat: 'web' } })); window.location.hash = `#/${product}`;
      await mount(); await settle(); await openGenerationOptions(); await click('选择 Web 包');
      const preset = document.querySelector<HTMLButtonElement>('[aria-label="选择 Web 包：竞技场新闻"]');
      expect(preset, document.body.textContent ?? '').toBeTruthy(); await act(async () => preset!.click()); await settle();
      await click('生成战报'); await vi.waitFor(() => expect(container.textContent).toContain('生成完成。'));
      expect(JSON.parse(received.at(-1)!.arenaInputJson!).webPackageRef).toEqual(BUILTIN_WEB_PACKAGE_PRESETS[0]!.packageRef);
      await click('下载会话备份'); const exported = JSON.parse(mocks.download.mock.calls.at(-1)![1]);
      expect(exported.result.renderSnapshot.webPackage.targetPath).toBe('index.html'); expect(exported.result.markdown).toBe(webHtml + '\n');
      expect(button('运行 Web 战报').disabled).toBe(true); expect(activeCloseHandles).toBe(1);
      expect(mocks.invoke.mock.calls.some(([command]) => /^(begin_web_package_instance|append_web_package_resource|open_web_package_instance)$/.test(command))).toBe(false);
      await act(async () => root.unmount()); root = createRoot(container);
    }
  });
  it('imports ZIP with explicit local saving, reopens its exact record, and downloads original bytes', async () => {
    const base = await builtinWebPackageSource.resolve(BUILTIN_WEB_PACKAGE_PRESETS[0]!.packageRef), archive = await packWebPackageZip(base);
    saveDraft({ ...draft('daily', 'stream'), reportFormat: 'web' }); await mount(); await settle(); await openGenerationOptions(); await click('选择 Web 包');
    const localTab = [...document.querySelectorAll<HTMLButtonElement>('button')].find((entry) => entry.textContent?.trim().startsWith('本地库'))!; await act(async () => localTab.click()); await settle();
    const checkbox = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((entry) => entry.closest('label')?.textContent?.includes('导入时保存到本地库'))!;
    expect(checkbox).toBeTruthy(); expect(checkbox.checked).toBe(false); await act(async () => checkbox.click());
    const file = new File([archive.slice().buffer], 'original.zip', { type: 'application/zip' }); Object.defineProperty(file, 'arrayBuffer', { value: async () => archive.slice().buffer });
    const picker = document.querySelector<HTMLInputElement>('input[type="file"][accept*="zip"]')!; expect(picker).toBeTruthy(); Object.defineProperty(picker, 'files', { configurable: true, value: [file] });
    await act(async () => picker.dispatchEvent(new Event('change', { bubbles: true }))); await vi.waitFor(() => expect(packageDocs.size).toBe(1)); await settle();
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'save_web_package')).toHaveLength(1);
    expect(localStorage.getItem(ARENA_DRAFT_KEY)).toContain(base.ref.digest);
    await act(async () => root.unmount()); root = createRoot(container); await mount(); await settle(); await openGenerationOptions(); await click('更换 Web 包');
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
    saveDraft({ ...draft('daily', 'stream'), reportFormat: 'web' }); await mount(); await openGenerationOptions(); await click('选择 Web 包');
    const tab = [...document.querySelectorAll<HTMLButtonElement>('button')].find((entry) => entry.textContent?.trim().startsWith('本地库'))!; await act(async () => tab.click()); await settle();
    const picker = document.querySelector<HTMLInputElement>('input[type="file"][accept*="zip"]')!; Object.defineProperty(picker, 'files', { configurable: true, value: [file] });
    await act(async () => picker.dispatchEvent(new Event('change', { bubbles: true }))); await vi.waitFor(() => expect(localStorage.getItem(ARENA_DRAFT_KEY)).toContain(base.ref.digest)); await settle();
    expect(packageDocs.size).toBe(0); await click('生成战报'); await vi.waitFor(() => expect(container.textContent).toContain('生成完成。'));
    await click('下载会话备份'); const exported = JSON.parse(mocks.download.mock.calls.at(-1)![1]);
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
    saveDraft({ ...draft('daily', 'stream'), reportFormat: 'web' }); await mount(); await openGenerationOptions(); await click('选择 Web 包');
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
    await mount(); await act(async () => { button('生成战报').click(); button('生成战报').click(); });
    await vi.waitFor(() => expect(calls()).toHaveLength(1)); await settle();
    if (ending === 'cancel') { await click('取消生成'); release?.(); }
    if (ending === 'target') { expect(() => getDesktopAiConfigStore().selectExecutionLocation('server')).toThrow('生成期间'); await click('取消生成'); release?.(); await vi.waitFor(() => expect(getDesktopAiConfigStore().getSnapshot().generationActive).toBe(false)); await act(async () => getDesktopAiConfigStore().selectExecutionLocation('server')); await settle(); }
    await vi.waitFor(() => expect(button('取消生成')).toBeUndefined());
    await click('下载会话备份'); const exported = JSON.parse(mocks.download.mock.calls.at(-1)![1]);
    expect(exported.result.rawText).toContain('webShouldNotRun'); expect(exported.result.phase).not.toBe('completed'); expect(exported.result.renderSnapshot).toBeNull(); expect(exported.candidates).toBeNull();
    expect(exported.draft.narrativeHistoryEntries).toEqual([]); expect(docs.size).toBe(0); expect(calls()).toHaveLength(1);
    expect(container.querySelector('iframe,script,img[src*="untrusted.invalid"]')).toBeNull(); expect(button('运行 Web 战报').disabled).toBe(true);
  });

  it('restores missing exact packages, requires explicit candidate selection, and preserves historical provenance through compatibility', async () => {
    const original = await arenaWebPackageFixture({ version: '1.0.0' }), second = await arenaWebPackageFixture({ version: '2.0.0' }), third = await arenaWebPackageFixture({ version: '3.0.0' });
    webTextOverride = '{"value":3}\n' + webTrailer;
    saveDraft({ ...draft('daily', 'stream'), reportFormat: 'web' }); await mount(); await openGenerationOptions(); await click('选择 Web 包');
    const tab = [...document.querySelectorAll<HTMLButtonElement>('button')].find((entry) => entry.textContent?.trim().startsWith('本地库'))!; await act(async () => tab.click()); await settle();
    await uploadWebZip(original.file); await click('生成战报'); await vi.waitFor(() => expect(container.textContent).toContain('生成完成。'));
    await act(async () => root.unmount()); root = createRoot(container); await mount();
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
    await click('下载会话备份'); let exported = JSON.parse(mocks.download.mock.calls.at(-1)![1]); expect(exported.result.renderSnapshot.webPackage.packageRef).toEqual(original.base.ref);
    expect(button('运行 Web 战报').disabled).toBe(true); expect(button('下载精确 Base ZIP（不含生成目标）').disabled).toBe(true);
    await openGenerationOptions(); await click('更换 Web 包'); const local = [...document.querySelectorAll<HTMLButtonElement>('button')].find((entry) => entry.textContent?.trim().startsWith('本地库'))!; await act(async () => local.click()); await settle(); await uploadWebZip(original.file);
    await vi.waitFor(() => expect(document.body.textContent).toContain('已验证精确包与生成目标'));
    await click('下载会话备份'); exported = JSON.parse(mocks.download.mock.calls.at(-1)![1]); expect(exported.result.renderSnapshot.webPackage.packageRef).toEqual(original.base.ref);
    expect(packageDocs.size).toBe(0); expect(mocks.invoke.mock.calls.some(([command]) => command === 'open_web_package_instance')).toBe(false);
  });

});


describe('Desktop two-route continuous story through actual default binder', () => {
  it.each(['battle', 'arena'] as const)('%s starts, explicitly continues, reopens the same device story and exports the complete chain', async (product) => {
    const value = draft('daily', 'non-stream');
    window.localStorage.setItem(product === 'arena' ? ADVANCED_ARENA_DRAFT_KEY : ARENA_DRAFT_KEY, JSON.stringify({ version: 1, draft: value }));
    window.location.hash = `#/${product}`; const router = await mount();
    await click('新建连续战报'); await vi.waitFor(() => expect(storyPort.heads()[0]?.chapterCount).toBe(1)); await settle();
    expect(container.querySelector('[aria-label="连续战报会话"]')?.textContent).toContain('共 1 章');
    expect(JSON.parse(received[0]!.arenaInputJson!).internalGuidance).toContain('首章');
    expect(JSON.parse(localStorage.getItem(product === 'arena' ? ADVANCED_ARENA_DRAFT_KEY : ARENA_DRAFT_KEY)!).draft.combatants).toEqual(value.combatants);
    await change('textarea[aria-label="下一章故事引导"]', '沿本故事继续');
    await click('继续续写'); await vi.waitFor(() => expect(storyPort.heads()[0]?.chapterCount).toBe(2)); await settle();
    expect(received).toHaveLength(2); expect(JSON.parse(received[1]!.arenaInputJson!).userGuidance).toBe('沿本故事继续');
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'append_arena_story_part').every(([,body]) => body instanceof Uint8Array)).toBe(true);
    await click('导出完整 Markdown'); await vi.waitFor(() => expect(container.textContent).toContain('完整故事已导出'));
    expect(storyIpc.exported).toContain('章节数：2 章'); expect(storyIpc.exported.match(/^# 车站重逢$/gm)).toHaveLength(3);
    vi.mocked(window.confirm).mockReturnValue(true);
    await act(async () => router.navigate({ to: product === 'battle' ? '/arena' : '/battle' })); await settle();
    await vi.waitFor(() => expect(container.querySelector('[data-story-read-status="loaded"]')).not.toBeNull());
    expect(container.querySelector('[aria-label="连续战报会话"]')?.textContent).toContain('共 2 章'); expect(received).toHaveLength(2);
    expect(activeCloseHandles).toBe(1);
  });
  it.each(['battle', 'arena'] as const)('%s shared unknown outcome queries only its original receipt and retains exported or cancelled results', async (product) => {
    storyPort.loseEndReply = true; storyPort.hideReceipts = true;
    window.localStorage.setItem(product === 'arena' ? ADVANCED_ARENA_DRAFT_KEY : ARENA_DRAFT_KEY, JSON.stringify({ version: 1, draft: draft('daily', 'stream') }));
    window.location.hash = `#/${product}`; const router = await mount(); await click('新建连续战报');
    await vi.waitFor(() => expect(container.textContent).toContain('保存状态待确认')); await settle();
    const pending = container.querySelector('[data-story-pending-outcome]')!, original = storyPort.begin.mock.calls[0]![0];
    expect(pending.querySelector('[role="status"][aria-live="polite"]')?.textContent).toContain('保存状态待确认');
    expect([...pending.querySelectorAll('button')].map(node => node.textContent)).toEqual(['查询原保存结果', '导出未保存章节', '导出完整原始输出', '丢弃当前结果']);
    expect([...pending.querySelectorAll('button')].every(node => node.tabIndex === 0)).toBe(true);
    expect(pending.contains(container.querySelector('[aria-label="本次章节结果"]'))).toBe(false);
    storyPort.receipt.mockClear(); await click('查询原保存结果');
    expect(storyPort.receipt).toHaveBeenCalledExactlyOnceWith(original.sessionId, original.operationId);
    expect(pending.textContent).toContain('保存状态待确认'); expect(received).toHaveLength(1); expect(storyPort.begin).toHaveBeenCalledTimes(1);
    await click('导出未保存章节', pending); expect(mocks.download.mock.calls.at(-1)![1]).toContain(text);
    await click('导出完整原始输出', pending);
    expect(JSON.parse(mocks.download.mock.calls.at(-1)![1])).toMatchObject({ rawText: rendered(true), reasoning: '独立的推理' });
    await click('丢弃当前结果', pending);
    expect(window.confirm).toHaveBeenLastCalledWith('丢弃当前未保存结果？请先导出。保存待确认时，本机可能已有此章。');
    expect(container.querySelector('[data-story-pending-outcome]')).toBe(pending);
    expect(container.querySelector('[aria-label="本次章节结果"]')?.textContent).toContain(text);
    await act(async () => { expect(scopeClose().preventDefault).toHaveBeenCalledOnce(); });
    await act(async () => { void router.navigate({ to: '/local-library' }); }); await settle();
    expect(window.location.hash).toBe(`#/${product}`); expect(container.querySelector('[data-story-pending-outcome]')).toBe(pending);
    storyPort.hideReceipts = false; await click('查询原保存结果'); await vi.waitFor(() => expect(container.textContent).toContain('完整章节已保存到本机故事'));
    expect(storyPort.receipt.mock.calls).toEqual([[original.sessionId, original.operationId], [original.sessionId, original.operationId]]);
    expect(container.querySelector('[data-story-pending-outcome]')).toBeNull(); expect(button('读取刚保存的章节')).toBeUndefined();
    expect(received).toHaveLength(1); expect(storyPort.begin).toHaveBeenCalledTimes(1); expect(storyPort.end).toHaveBeenCalledTimes(1);
  });
  it.each(['single', 'story'] as const)('delayed anonymous bootstrap preserves in-flight Direct %s credential preparation', async flow => {
    localStorage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, JSON.stringify({ version: 5,
      selection: { executionPreference: 'client', clientTarget: { kind: 'preset', providerId: 'deepseek' }, serverTarget: { kind: 'system' } },
      hiddenPresetIds: [], presetsByProviderId: { deepseek: { selectedModelId: 'deepseek-chat', generationOverrides: {} } } }));
    const bootstrap = deferred<null>(), credential = deferred<boolean>(), originalInvoke = mocks.invoke.getMockImplementation()!;
    let holdCredential = false;
    mocks.invoke.mockImplementation((command, args, options) => command === 'cloud_cached_account' ? bootstrap.promise
      : command === 'has_provider_secret' && holdCredential ? credential.promise : originalInvoke(command, args, options));
    release = () => { bootstrap.resolve(null); credential.resolve(true); };
    saveDraft(draft('daily', 'stream')); await mount();
    expect(getDesktopCloudSessionStore().getSnapshot().bootstrapped).toBe(false);
    holdCredential = true;
    await click(flow === 'single' ? '生成战报' : '新建连续战报');
    expect(getDesktopAiConfigStore().isPreparingGeneration()).toBe(true); expect(calls()).toHaveLength(0);
    const cancelPreparing = vi.spyOn(getDesktopAiConfigStore(), 'cancelPreparingGeneration');
    await act(async () => bootstrap.resolve(null)); await settle();
    expect(getDesktopCloudSessionStore().getSnapshot()).toMatchObject({ bootstrapped: true, account: null });
    expect(cancelPreparing).not.toHaveBeenCalled(); expect(getDesktopAiConfigStore().isPreparingGeneration()).toBe(true);
    await act(async () => credential.resolve(true)); await settle();
    if (flow === 'story') await vi.waitFor(() => expect(storyPort.heads()[0]?.chapterCount).toBe(1));
    else await vi.waitFor(() => expect(container.textContent).toContain('生成完成。'));
    expect(calls()).toHaveLength(1); expect(calls()[0]).toMatchObject(['stream_target_ai', { target: { kind: 'preset', providerId: 'deepseek' } }]);
    expect(received).toHaveLength(1); expect(hostedStory.streams).toHaveLength(0); expect(hostedStory.slots.size).toBe(0);
    expect(getDesktopAiConfigStore().isPreparingGeneration()).toBe(false);
  });

  it('stops a real in-flight Direct chapter, preserves received prose and leaves the stored chain intact', async () => {
    saveDraft(draft('daily','stream')); await mount(); await click('新建连续战报');
    await vi.waitFor(() => expect(storyPort.heads()[0]?.chapterCount).toBe(1)); await settle();hold = true;
    await click('继续续写'); await vi.waitFor(() => expect(container.querySelector('[aria-label="本次章节结果"]')?.textContent).toContain(text));
    await click('停止章节生成'); release?.(); await settle();
    expect(storyPort.heads()[0]?.chapterCount).toBe(1); expect(storyPort.begin).toHaveBeenCalledTimes(1); expect(received).toHaveLength(2);
    await click('导出完整原始输出'); expect(JSON.parse(mocks.download.mock.calls.at(-1)![1]).rawText).toContain(text);
    expect(scopeClose().preventDefault).toHaveBeenCalled();
  });
});


// Actual RouterProvider → DesktopBattleForm → owner → default IPC binders.
// Native IPC and saved-credential presence are synthetic, never real keys/accounts.
describe('Desktop Hosted story routes through prepared targets and default binders', () => {
  const enableHosted = () => {
    // Match browser TextEncoder byte realm; Node's encoder otherwise fails IPC instanceof guards in jsdom.
    vi.stubGlobal('TextEncoder', class extends NodeTextEncoder { encode(input?: string) { return Uint8Array.from(super.encode(input)); } });
    storyPort = hostedStory.records; storyIpc = hostedStory.recordInvoke;
    // Native independently checks the public prewrite in the real page's localStorage.
    vi.spyOn(hostedStory.pointers, 'get').mockImplementation(key => localStorage.getItem(key) ?? undefined);
  };
  const mountProduct = async (product: 'battle' | 'arena') => {
    localStorage.setItem(product === 'battle' ? ARENA_DRAFT_KEY : ADVANCED_ARENA_DRAFT_KEY, JSON.stringify({ version: 1, draft: draft('daily', 'non-stream') }));
    window.location.hash = `#/${product}`;
    const router = await mount(); return router;
  };
  const chooseHosted = async (funding: 'system' | 'preset') => {
    await click('服务器');
    if (funding === 'preset') {
      const trigger = document.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!;
      await act(async () => trigger.click()); await settle();
      const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(item => item.querySelector('span')?.textContent?.trim() === 'DeepSeek')!;
      expect(option).toBeTruthy(); await act(async () => option.click()); await settle();
      const modelTrigger = document.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="listbox"]')[1]!;
      await act(async () => modelTrigger.click()); await settle();
      const model = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(item => item.querySelector('span')?.textContent?.trim() === 'DeepSeek-V3.2')!;
      expect(model).toBeTruthy(); await act(async () => model.click()); await settle();
    }
    expect(getDesktopAiConfigStore().getSnapshot().selection).toMatchObject({ executionPreference: 'server', serverTarget: funding === 'system' ? { kind: 'system' } : { kind: 'preset', providerId: 'deepseek' } });
  };
  const requests = (operation: string) => hostedStory.streams.filter(request => request.operation === operation);
  const streamCommands = (operation: string) => mocks.invoke.mock.calls.filter(([command, args]) => command === 'arena_hosted_stream' && args.request.operation === operation);
  const settledChapter = async (count: number) => {
    await vi.waitFor(() => expect(storyPort.heads()[0]?.chapterCount, container.textContent ?? '').toBe(count)); await settle();
    expect(container.querySelector('[aria-label="连续战报会话"]')?.textContent).toContain(`共 ${count} 章`);
  };
  for (const product of ['battle', 'arena'] as const) it.each(['system', 'preset'] as const)(`${product}/%s selects the real prepared Hosted target, saves one start and continuation, then reads the directory`, async funding => {
    enableHosted(); const router = await mountProduct(product); await chooseHosted(funding);
    const prepared = vi.spyOn(getDesktopAiConfigStore(), 'withPreparedGeneration');
    expect(button('生成战报').disabled).toBe(false); expect(button('新建连续战报').disabled).toBe(false);
    await click('新建连续战报'); await settledChapter(1);
    expect(prepared).toHaveBeenCalledTimes(1); expect(requests('create-story-stream')).toHaveLength(1); expect(requests('reconcile-story')).toHaveLength(1);
    expect(hostedStory.commands(STORY_PENDING_IPC.prepareSave)).toHaveLength(1); expect(hostedStory.commands(STORY_PENDING_IPC.save)).toHaveLength(1);
    const sessionId = storyPort.heads()[0]!.id;
    await change('textarea[aria-label="下一章故事引导"]', '沿原 Hosted 故事续写'); await click('继续续写'); await settledChapter(2);
    expect(prepared).toHaveBeenCalledTimes(2); expect(requests('create-story-stream')).toHaveLength(2); expect(requests('reconcile-story')).toHaveLength(2);
    expect(hostedStory.commands(STORY_PENDING_IPC.prepareSave)).toHaveLength(2); expect(hostedStory.commands(STORY_PENDING_IPC.save)).toHaveLength(2);
    expect(hostedStory.attempts.size).toBe(0); expect(storyPort.heads()).toHaveLength(1); expect(storyPort.heads()[0]!.id).toBe(sessionId);
    for (const request of requests('create-story-stream')) {
      expect(request).toMatchObject({ product, actor: { kind: 'anonymous' }, ...(funding === 'system' ? { systemConfig: {} } : { presetConfig: { providerId: 'deepseek', modelId: 'deepseek-chat' } }) });
      expect(request).not.toHaveProperty(funding === 'system' ? 'presetConfig' : 'systemConfig'); expect(request).not.toHaveProperty('body');
      expect(request).not.toHaveProperty('apiKey'); expect(request).not.toHaveProperty('combatants');
    }
    const second = hostedStory.sealed.find(item => item.snapshot.manifest.expectedRevision === 1)!;
    const input = JSON.parse(new TextDecoder().decode(second.bytes.get('input')));
    expect(input).toMatchObject({ action: 'continue', userGuidance: '沿原 Hosted 故事续写', chapterIndex: 2 });
    expect(input.chapterContext.workingCombatants[0]).toMatchObject({ data: { name: '甲', signature: 'server-signed-fixture' }, isNative: true });
    expect(JSON.parse(localStorage.getItem(product === 'battle' ? ARENA_DRAFT_KEY : ADVANCED_ARENA_DRAFT_KEY)!).draft.combatants).toEqual(draft('daily', 'non-stream').combatants);
    expect(localStorage.getItem(ARENA_HOSTED_RECOVERY_KEYS[product])).toBeNull(); expect(hostedStory.slots.size).toBe(0);
    expect(received).toHaveLength(0); expect(calls()).toHaveLength(0);
    await click('导出完整 Markdown'); await vi.waitFor(() => expect(container.textContent).toContain('完整故事已导出'));
    expect(storyIpc.exported).toContain('章节数：2 章'); expect(storyIpc.exported).toContain(hostedStory.markdown.trim());
    vi.mocked(window.confirm).mockReturnValue(true);
    await act(async () => router.navigate({ to: product === 'battle' ? '/arena' : '/battle' })); await settle();
    await vi.waitFor(() => expect(container.querySelector('[data-story-read-status="loaded"]')).not.toBeNull());
    expect(container.querySelector('[data-story-read-status="loaded"]')?.textContent).toContain('合成故事');
    expect(container.querySelector('[aria-label="连续战报会话"]')?.textContent).toContain('共 2 章');
    expect(requests('create-story-stream')).toHaveLength(2); expect(activeCloseHandles).toBe(1);
  });
  it.each(['battle', 'arena'] as const)('%s Native-only candidate opens its original product from the other route and restores without a fresh create', async product => {
    enableHosted(); hostedStory.roleMode = 'network'; const router = await mountProduct(product); await chooseHosted('system');
    await click('新建连续战报'); await vi.waitFor(() => expect(container.textContent).toContain('Hosted 正文已封存，尚未保存到故事')); await settle();
    const original = structuredClone(hostedStory.slots.get(product)!.snapshot);
    expect(requests('create-story-stream')).toHaveLength(1); expect(hostedStory.commands(STORY_PENDING_IPC.save)).toHaveLength(0);
    localStorage.removeItem(ARENA_HOSTED_RECOVERY_KEYS[product]);
    vi.mocked(window.confirm).mockReturnValue(true);
    await act(async () => router.navigate({ to: product === 'battle' ? '/arena' : '/battle' })); await settle();
    const foreign = document.querySelector(`[aria-label="${product === 'battle' ? '简洁版 /battle' : '高级版 /arena'}原候选"]`)!;
    expect(foreign.textContent).toContain(original.manifest.requestId); expect(button('读取原件（本地）', foreign)).toBeUndefined();
    await click(`前往${product === 'battle' ? '简洁版 /battle' : '高级版 /arena'}处理原候选`, foreign);
    expect(window.location.hash).toBe(`#/${product}`); await click('读取原件（本地）'); await settle();
    expect(hostedStory.slots.get(product)!.snapshot.manifest).toEqual(original.manifest);
    expect(button('恢复原请求').disabled).toBe(false); expect(localStorage.getItem(ARENA_HOSTED_RECOVERY_KEYS[product])).toBeNull();
    hostedCapabilityAvailable = false;
    await click('恢复原请求'); await vi.waitFor(() => expect(requests('resume')).toHaveLength(1)); await settle();
    expect(hostedStory.controls.at(-1)).toEqual({ operation: 'lookup-request', product, requestId: original.manifest.requestId, actor: original.manifest.actor, restoreSession: true });
    expect(requests('resume')[0]).not.toHaveProperty('after'); expect(streamCommands('create-story-stream')).toHaveLength(1);
    expect(requests('reconcile-story')).toHaveLength(1); expect(hostedStory.commands(STORY_PENDING_IPC.save)).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(ARENA_HOSTED_RECOVERY_KEYS[product])!)).toMatchObject({ version: 4, purpose: 'story', product, requestId: original.manifest.requestId });
    expect(received).toHaveLength(0);
  });
  it('a proven capability rejection gates create only, keeps the no-claim original readable, and never falls back', async () => {
    enableHosted(); hostedCapabilityAvailable = false; await mountProduct('battle'); await chooseHosted('system'); await click('新建连续战报');
    await vi.waitFor(() => expect(container.textContent).toContain('服务器尚未声明所选生成方式及身份保护所需协议'));
    expect(streamCommands('create-story-stream')).toHaveLength(1); expect(hostedStory.streams).toHaveLength(0); expect(hostedStory.controls).toHaveLength(0);
    expect(hostedStory.slots.get('battle')!.snapshot.createClaim).toBeNull(); expect(hostedStory.commands(STORY_PENDING_IPC.save)).toHaveLength(0);
    expect(button('新建连续战报').disabled).toBe(true); expect(button('恢复原请求').disabled).toBe(true);
    await click('导出全部已封存原件'); expect(hostedStory.exports.length).toBeGreaterThan(0);
    expect(calls()).toHaveLength(0); expect(received).toHaveLength(0);
  });
  it('account scope changes during real preset preparation prevent any candidate or create', async () => {
    enableHosted(); cloudAccount = { userId: 7, username: 'fixture-user-seven' };
    await mountProduct('battle'); await chooseHosted('preset');
    const gate = deferred<boolean>(), originalInvoke = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((command, args, options) => command === 'has_provider_secret' ? gate.promise : originalInvoke(command, args, options));
    release = () => gate.resolve(true);
    await click('新建连续战报'); expect(getDesktopAiConfigStore().isPreparingGeneration()).toBe(true);
    cloudAccount = { userId: 8, username: 'fixture-user-eight' };
    await act(async () => getDesktopCloudSessionStore().refresh()); await settle();
    await act(async () => gate.resolve(true)); await settle();
    expect(getDesktopAiConfigStore().isPreparingGeneration()).toBe(false);
    expect(hostedStory.slots.size).toBe(0); expect(hostedStory.streams).toHaveLength(0);
    expect(localStorage.getItem(ARENA_HOSTED_RECOVERY_KEYS.battle)).toBeNull();
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'set_provider_secret')).toBe(false);
    expect(calls()).toHaveLength(0);
  });

  it('a delayed anonymous bootstrap activates the Hosted actor after the AI target is already ready', async () => {
    enableHosted(); const gate = deferred<null>(), originalInvoke = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((command, args, options) => command === 'cloud_cached_account' ? gate.promise : originalInvoke(command, args, options));
    release = () => gate.resolve(null);
    await mountProduct('battle'); await chooseHosted('system');
    expect(button('新建连续战报').disabled).toBe(true); expect(container.textContent).toContain('正在确认本机账号身份');
    await act(async () => gate.resolve(null)); await settle();
    expect(button('新建连续战报').disabled).toBe(false);
    await click('新建连续战报'); await settledChapter(1);
    expect(requests('create-story-stream')[0]).toMatchObject({ actor: { kind: 'anonymous' } });
  });

  it.each([{ ending: 'leave', phase: 'model' }, { ending: 'account', phase: 'model' }, { ending: 'account', phase: 'role' }] as const)('$ending fences late $phase settlement before accepting roles or saving', async ({ ending, phase }) => {
    enableHosted(); cloudAccount = { userId: 7, username: 'fixture-user-seven' }; const gate = deferred<void>();
    if (phase === 'model') hostedStory.beforeModelSettles = () => gate.promise; else hostedStory.beforeRoleSettles = () => gate.promise;
    release = () => gate.resolve();
    const router = await mountProduct('battle'); await chooseHosted('system'); await click('新建连续战报');
    await vi.waitFor(() => expect(phase === 'model' ? hostedStory.trace.includes('model:c0-completed') : requests('reconcile-story').length === 1).toBe(true));
    expect(container.querySelector('[aria-label="本次章节结果"]')?.textContent).toContain('合成故事');
    expect(requests('create-story-stream')[0]).toMatchObject({ actor: { kind: 'account', expectedUserId: 7 } });
    if (ending === 'leave') {
      vi.mocked(window.confirm).mockReturnValue(true);
      await act(async () => router.navigate({ to: '/arena' })); await settle(); expect(window.location.hash).toBe('#/arena');
      expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('只停止本机订阅'));
    } else {
      cloudAccount = { userId: 8, username: 'fixture-user-eight' };
      await act(async () => getDesktopCloudSessionStore().refresh()); await settle();
      expect(container.textContent).toContain('当前账号与原请求不一致');
    }
    gate.resolve(); await settle(); await vi.waitFor(() => expect(hostedStory.trace).toContain(`${phase}:invoke-settled`)); await settle();
    expect(requests('create-story-stream')).toHaveLength(1); expect(requests('reconcile-story')).toHaveLength(phase === 'model' ? 0 : 1);
    expect(hostedStory.sealed.some(item => item.snapshot.manifest.roleState === 'accepted')).toBe(false);
    expect(hostedStory.commands(STORY_PENDING_IPC.prepareSave)).toHaveLength(0); expect(hostedStory.commands(STORY_PENDING_IPC.save)).toHaveLength(0);
    expect(hostedStory.slots.get('battle')!.snapshot.manifest).toMatchObject({ actor: { kind: 'account', expectedUserId: 7 }, modelCompleted: phase === 'role' });
    expect(storyPort.heads()).toHaveLength(0); expect(calls()).toHaveLength(0);
    if (ending === 'leave') expect(container.querySelector('[aria-label="本次章节结果"]')).toBeNull();
  });

  const coldPendingStory = async (product: 'battle' | 'arena' = 'battle') => {
    enableHosted(); hostedStory.roleMode = 'network';
    const router = await mountProduct(product); await chooseHosted('system'); await click('新建连续战报');
    await vi.waitFor(() => expect(container.textContent).toContain('Hosted 正文已封存，尚未保存到故事')); await settle();
    vi.mocked(window.confirm).mockReturnValue(true);
    await act(async () => router.navigate({ to: product === 'battle' ? '/arena' : '/battle' })); await settle();
    await act(async () => router.navigate({ to: `/${product}` })); await settle();
    expect(container.textContent).toContain('此恢复记录属于连续故事');
    await click('读取原件（本地）'); await settle();
  };
  const finishColdPending = async (outcome: 'save' | 'abandon') => {
    if (outcome === 'save') {
      hostedStory.roleMode = 'accepted'; await click('重试角色同步');
      await vi.waitFor(() => expect(storyPort.heads()[0]?.chapterCount).toBe(1));
    } else {
      await click('放弃本机候选…'); await click('确认不导出并放弃本机候选');
    }
    await vi.waitFor(() => expect(hostedStory.slots.size).toBe(0)); await settle();
  };
  const rejectFreshOrdinaryCreate = () => {
    const originalInvoke = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((command, args, options) => {
      if (command === 'arena_hosted_stream' && ['create-json', 'create-stream'].includes(args.request.operation))
        throw { code: 'capability-unavailable', message: 'synthetic ordinary create boundary', dispatchState: 'not-dispatched', intentOwnership: 'current-owned' };
      return originalInvoke(command, args, options);
    });
  };
  for (const product of ['battle', 'arena'] as const) it.each(['save', 'abandon'] as const)(`${product} cold story %s releases the same-page ordinary Hosted preparation and Native dispatch`, async outcome => {
    await coldPendingStory(product); await finishColdPending(outcome);
    expect(localStorage.getItem(ARENA_HOSTED_RECOVERY_KEYS[product])).toBeNull();
    expect(container.textContent).not.toContain('此恢复记录属于连续故事');
    expect(button('生成战报').disabled).toBe(false); rejectFreshOrdinaryCreate();
    await click('生成战报'); await vi.waitFor(() => expect(streamCommands('create-json')).toHaveLength(1)); await settle();
    const next = JSON.parse(localStorage.getItem(ARENA_HOSTED_RECOVERY_KEYS[product])!);
    expect(next).toMatchObject({ version: 3, product, actor: { kind: 'anonymous' } });
    expect(next).not.toHaveProperty('purpose');
    expect(streamCommands('create-json')[0]![1].request).toMatchObject({ product, requestId: next.requestId });
    expect(requests('create-story-stream')).toHaveLength(1); expect(calls()).toHaveLength(0);
  });

  it.each(['save', 'abandon'] as const)('cold story %s preserves a concurrently replaced public pointer and exposes its original ordinary restore', async outcome => {
    await coldPendingStory();
    const original = DesktopArenaHostedRecoveryPointerSchema.parse({ version: 1, protocolVersion: 'arena-hosted-sse-v1', product: 'battle',
      requestId: 'concurrent-ordinary-request', actor: { kind: 'anonymous' }, bodyHash: 'c'.repeat(64), format: 'markdown', battleMode: 'daily',
      state: 'unknown', updatedAt: '2026-10-10T05:00:00.000Z' });
    const raw = JSON.stringify(original, null, 2), originalInvoke = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(async (command, args, options) => {
      const result = await originalInvoke(command, args, options);
      if (command === (outcome === 'save' ? STORY_PENDING_IPC.save : STORY_PENDING_IPC.abandon)) localStorage.setItem(ARENA_HOSTED_RECOVERY_KEYS.battle, raw);
      if (command === 'arena_hosted_control' && args.request.requestId === original.requestId)
        return { status: 404, body: { code: 'NOT_FOUND' }, recoveryCredentialState: 'stored' };
      return result;
    });
    await finishColdPending(outcome);
    expect(localStorage.getItem(ARENA_HOSTED_RECOVERY_KEYS.battle)).toBe(raw);
    expect(container.querySelector('[aria-label="服务器恢复记录"]')?.textContent).not.toContain(original.requestId);
    expect(button('找回上次战报').disabled).toBe(false);
    vi.mocked(window.confirm).mockReturnValue(false); await click('生成战报');
    expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining('已有服务器恢复记录'));
    expect(localStorage.getItem(ARENA_HOSTED_RECOVERY_KEYS.battle)).toBe(raw); expect(streamCommands('create-json')).toHaveLength(0);
    vi.mocked(window.confirm).mockReturnValue(true); await click('找回上次战报');
    expect(mocks.invoke.mock.calls.filter(([command, args]) => command === 'arena_hosted_control' && args.request.operation === 'lookup-request')).toEqual([
      ['arena_hosted_control', { request: { operation: 'lookup-request', product: 'battle', requestId: original.requestId, actor: original.actor, restoreSession: true } }],
    ]);
    expect(streamCommands('create-json')).toHaveLength(0); expect(requests('create-story-stream')).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(ARENA_HOSTED_RECOVERY_KEYS.battle)!)).toMatchObject({ requestId: original.requestId, actor: original.actor });
  });

  it('foreign-retained abandonment keeps the original diagnosis route without silently authorizing replacement', async () => {
    await coldPendingStory(); const originalInvoke = mocks.invoke.getMockImplementation()!;
    const originalRequestId = 'native-retained-ordinary-request';
    mocks.invoke.mockImplementation(async (command, args, options) => {
      if (command === 'arena_hosted_recovery_hint') return { product: 'battle', state: 'available', requestId: originalRequestId, actorKind: 'anonymous' };
      const result = await originalInvoke(command, args, options);
      return command === STORY_PENDING_IPC.abandon ? { ...result, flight: 'foreign-retained', secret: 'foreign-retained' } : result;
    });
    await finishColdPending('abandon');
    expect(localStorage.getItem(ARENA_HOSTED_RECOVERY_KEYS.battle)).toBeNull();
    expect(container.textContent).toContain('原生槽仍保留另一恢复身份'); expect(container.textContent).toContain('不能保证本产品已可新建');
    expect(streamCommands('create-json')).toHaveLength(0); expect(requests('create-story-stream')).toHaveLength(1);
    await openRecoveryTools(); expect(button('检查恢复条件').disabled).toBe(false); await click('检查恢复条件');
    expect(container.querySelector('[aria-label="本机恢复身份诊断"]')?.textContent).not.toContain(originalRequestId);
    vi.mocked(window.confirm).mockReturnValue(false); await click('生成战报');
    expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining('放弃找回上次战报'));
    expect(streamCommands('create-json')).toHaveLength(0); expect(localStorage.getItem(ARENA_HOSTED_RECOVERY_KEYS.battle)).toBeNull();
  });

  it.each(['hosted', 'direct'] as const)('the top-page stop control cancels the actual %s story owner before any role or save', async location => {
    enableHosted(); const gate = deferred<void>();
    if (location === 'hosted') hostedStory.beforeModelSettles = () => gate.promise; else hold = true;
    const releaseDirect = () => release?.();
    await mountProduct('battle'); if (location === 'hosted') await chooseHosted('system');
    await click('新建连续战报');
    if (location === 'hosted') { release = () => gate.resolve(); await vi.waitFor(() => expect(hostedStory.trace).toContain('model:c0-completed')); }
    else await vi.waitFor(() => expect(received).toHaveLength(1));
    const stop = button('生成战报').nextElementSibling as HTMLButtonElement;
    expect(stop.tagName).toBe('BUTTON'); expect(stop.disabled).toBe(false);
    expect(stop.getAttribute('aria-label')).toBe(location === 'hosted' ? '请求服务器停止' : '取消生成');
    expect(stop.getAttribute('title')).toBe(stop.getAttribute('aria-label'));
    expect(stop.textContent?.trim()).toBe('⏹');
    expect(stop.classList.contains('rounded-full')).toBe(true);
    await act(async () => { stop.click(); stop.click(); }); await settle();
    if (location === 'hosted') gate.resolve(); else releaseDirect();
    await settle();
    expect(storyPort.heads()).toHaveLength(0); expect(hostedStory.commands(STORY_PENDING_IPC.save)).toHaveLength(0);
    expect(requests('reconcile-story')).toHaveLength(0); expect(storyPort.begin).not.toHaveBeenCalled();
    expect(hostedStory.controls.filter(request => request.operation === 'stop')).toHaveLength(location === 'hosted' ? 1 : 0);
    expect(location === 'hosted' ? requests('create-story-stream') : received).toHaveLength(1);
  });

});


// Real RouterProvider → shared page factory → story owner → both branch IPC
// binders → synthetic byte storage and loopback model. No injected page owner.
describe('Desktop Direct branch routes through actual default factories', () => {
  const setupBranch = async (k = 2, total = 3) => {
    const fixture = await branchPageFixture(k, total);
    storyBranch = fixture; storyPort = fixture.records; storyIpc = storyFixtureInvoke(storyPort);
    return fixture;
  };
  const mountBranch = async (product: 'battle' | 'arena' = 'battle') => {
    localStorage.setItem(product === 'battle' ? ARENA_DRAFT_KEY : ADVANCED_ARENA_DRAFT_KEY, JSON.stringify({ version: 1, draft: draft('daily', 'stream') }));
    window.location.hash = `#/${product}`;
    const router = await mount();
    await vi.waitFor(() => expect(container.querySelector('[data-story-read-status="loaded"]')).toBeTruthy());
    return router;
  };
  const chooseChapter = async (index: number) => {
    const row = [...container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find(node => node.textContent?.startsWith(`第 ${index} 章 ·`));
    expect(row, `chapter ${index}`).toBeTruthy(); await act(async () => row!.click()); await settle();
    await vi.waitFor(() => expect(container.querySelector('[data-story-read-status="loaded"]')?.textContent).toContain(`第 ${index} 章`));
  };
  const reader = () => container.querySelector('[data-story-read-status]')!;
  const assertNoBranchDispatch = (fixture: Awaited<ReturnType<typeof setupBranch>>) => {
    expect(received).toHaveLength(0); expect(calls()).toHaveLength(0); expect(fixture.begin).not.toHaveBeenCalled();
    expect(fixture.end).not.toHaveBeenCalled(); expect(hostedStory.streams).toHaveLength(0); expect(storyPort.heads()).toHaveLength(1);
  };
  it.each(['battle', 'arena'] as const)('%s tail click uses the actual Direct factory, saves one independent branch and reopens it', async product => {
    const fixture = await setupBranch(), source = new Map([...storyPort.documents].map(([key, doc]) => [key, Buffer.from(doc.bytes)]));
    const router = await mountBranch(product);
    const draftKey = product === 'battle' ? ARENA_DRAFT_KEY : ADVANCED_ARENA_DRAFT_KEY, draftBefore = localStorage.getItem(draftKey);
    const prepared = vi.spyOn(getDesktopAiConfigStore(), 'withPreparedGeneration');
    await change('textarea[aria-label="下一章故事引导"]', '从尾章改走北方');
    await click('创建分支'); await vi.waitFor(() => expect(storyPort.heads()).toHaveLength(2)); await settle();
    expect(prepared).toHaveBeenCalledTimes(1); expect(received).toHaveLength(1);
    expect(fixture.resolveAnchor).toHaveBeenCalledWith({ sessionId: fixture.sessionId, revision: 3, expectedChapterCount: 3,
      expectedLastChapterId: fixture.chapterIds[2], anchorChapterId: fixture.chapterIds[2], anchorIndex: 3 });
    const manifest = fixture.manifests[0]!, target = manifest.sessionId;
    expect(fixture.begin).toHaveBeenCalledTimes(1); expect(fixture.end).toHaveBeenCalledTimes(1);
    expect(manifest.parts.map(part => part.kind)).toEqual(['session', 'chapter', 'checkpoint1']);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'append_arena_story_part').every(([, raw]) => raw instanceof Uint8Array)).toBe(true);
    const payload = JSON.parse(received[0]!.arenaInputJson!);
    expect(payload.userGuidance).toBe('从尾章改走北方'); expect(payload.internalGuidance).toContain('分支续写第 4 章');
    expect(payload.combatants[0].data.name).toBe('甲-boundary-3');
    expect(storyPort.chapterDocuments(target).map(chapter => chapter.action)).toEqual(['start', 'continue', 'continue', 'branch']);
    expect(storyPort.documents.get(`${target}:session`)!.value.branchOf).toMatchObject({ sessionId: fixture.sessionId, chapterId: fixture.chapterIds[2], chapterIndex: 3 });
    expect(reader().getAttribute('data-story-session-id')).toBe(target); expect(reader().getAttribute('data-story-chapter-id')).toBe(manifest.operationId);
    expect(localStorage.getItem(draftKey)).toBe(draftBefore);
    for (const [key, bytes] of source) expect(Buffer.from(storyPort.documents.get(key)!.bytes)).toEqual(bytes);
    await click('导出完整 Markdown'); expect(storyIpc.exported).toContain('章节数：4 章'); expect(storyIpc.exported).toContain('边界 1 的历史完整正文');
    vi.mocked(window.confirm).mockReturnValue(true);
    await act(async () => router.navigate({ to: product === 'battle' ? '/arena' : '/battle' })); await settle();
    await vi.waitFor(() => expect(reader().getAttribute('data-story-session-id')).toBe(target));
    expect(received).toHaveLength(1); expect(activeCloseHandles).toBe(1);
  });
  it('uses the real chapter-55 tail while the directory still shows only its first page', async () => {
    const fixture = await setupBranch(53, 55); await mountBranch();
    expect([...container.querySelectorAll('button[aria-pressed]')].filter(node => node.textContent?.startsWith('第 '))).toHaveLength(25);
    expect(reader().getAttribute('data-story-chapter-id')).toBe(fixture.chapterIds[54]);
    await click('创建分支'); await vi.waitFor(() => expect(storyPort.heads()).toHaveLength(2)); await settle();
    expect(fixture.resolveAnchor).toHaveBeenCalledWith({ sessionId: fixture.sessionId, revision: 55, expectedChapterCount: 55,
      expectedLastChapterId: fixture.chapterIds[54], anchorChapterId: fixture.chapterIds[54], anchorIndex: 55 });
    expect(fixture.manifests[0]!.source.anchorIndex).toBe(55);
    expect(storyPort.heads().find(head => head.id !== fixture.sessionId)?.chapterCount).toBe(56);
    expect(JSON.parse(received[0]!.arenaInputJson!).internalGuidance).toContain('分支续写第 56 章'); expect(received).toHaveLength(1);
  });
  it('branches from a paginated historical chapter with boundary roles and bounded source reads', async () => {
    const fixture = await setupBranch(53, 55); await mountBranch('arena');
    expect(reader().getAttribute('data-story-chapter-id')).toBe(fixture.chapterIds[54]);
    while (!([...container.querySelectorAll('button[aria-pressed]')].some(node => node.textContent?.startsWith('第 53 章 ·')))) await click('更多章节');
    await chooseChapter(53); storyPort.read.mockClear(); storyPort.listChapters.mockClear();
    await click('从第 53 章创建分支'); await vi.waitFor(() => expect(storyPort.heads()).toHaveLength(2)); await settle();
    expect(fixture.manifests[0]!.source).toMatchObject({ anchorIndex: 53, expectedChapterCount: 55, anchor: { recordId: fixture.chapterIds[52] } });
    const payload = JSON.parse(received[0]!.arenaInputJson!);
    expect(payload.combatants[0].data.name).toBe('甲-boundary-53'); expect(payload.internalGuidance).toContain('分支续写第 54 章');
    expect(payload.internalGuidance).not.toContain('边界 54 的历史完整正文');
    const sourceReads = storyPort.read.mock.calls.filter(([descriptor]) => descriptor.sessionId === fixture.sessionId && descriptor.kind === 'chapter');
    expect(sourceReads.map(([descriptor]) => descriptor.recordId)).toEqual(fixture.chapterIds.slice(41, 53));
    expect(storyPort.listChapters.mock.calls.filter(([id]) => id === fixture.sessionId).map(([, , cursor, limit]) => [cursor?.index ?? 0, limit])).toEqual([[0, 50], [50, 3]]);
    expect(storyPort.heads().find(head => head.id !== fixture.sessionId)?.chapterCount).toBe(54); expect(received).toHaveLength(1);
  });
  it('disables the completed plan head while an earlier selected chapter can still branch', async () => {
    const fixture = await setupBranch(), source = storyPort.documents.get(`${fixture.sessionId}:session`)!.value;
    fixture.put(fixture.sessionId, 'session', { ...source, chapterPlan: { totalChapters: 3, source: 'user', locked: false } });
    await mountBranch(); expect(button('创建分支').disabled).toBe(true); expect(button('继续续写').disabled).toBe(true);
    expect(button('从第 3 章创建分支').disabled).toBe(true);
    await chooseChapter(1); expect(button('从第 1 章创建分支').disabled).toBe(false);
    await click('从第 1 章创建分支'); await vi.waitFor(() => expect(storyPort.heads()).toHaveLength(2)); await settle();
    expect(fixture.manifests[0]!.source.anchorIndex).toBe(1); expect(storyPort.heads().find(head => head.id !== fixture.sessionId)?.chapterCount).toBe(2);
    expect(received).toHaveLength(1);
  });
  it.each(['battle', 'arena'] as const)('%s keeps Hosted branch controls disabled without switching execution location', async product => {
    const fixture = await setupBranch(); await mountBranch(product);
    await act(async () => getDesktopAiConfigStore().selectExecutionLocation('server')); await settle();
    expect(button('创建分支').disabled).toBe(true); expect(button('从第 3 章创建分支').disabled).toBe(true);
    expect(button('创建分支').title).toContain('Direct');
    await click('创建分支'); await click('从第 3 章创建分支');
    expect(getDesktopAiConfigStore().getSnapshot().selection.executionPreference).toBe('server');
    expect(fixture.resolveAnchor).not.toHaveBeenCalled(); assertNoBranchDispatch(fixture);
  });

  it('rejects a Hosted target returned at the actual AI preparation seam with no dispatch', async () => {
    const fixture = await setupBranch(); await mountBranch();
    const prepare = vi.spyOn(getDesktopAiConfigStore(), 'withPreparedGeneration').mockImplementationOnce(async run => run({
      location: 'server', providerTarget: { kind: 'system' }, profile: null, mode: null, modelId: 'default',
      availableModelIds: [], generationOverrides: undefined, unavailableReason: null,
    }).then(() => {}));
    await click('创建分支'); await vi.waitFor(() => expect(container.textContent).toContain('Hosted 分支不受支持'));
    expect(prepare).toHaveBeenCalledTimes(1); expect(fixture.resolveAnchor).toHaveBeenCalledTimes(1); assertNoBranchDispatch(fixture);
  });
  it('coalesces repeated branch clicks while its frozen source is still being prepared', async () => {
    const fixture = await setupBranch(), gate = deferred<void>(), original = fixture.resolveAnchor.getMockImplementation()!;
    fixture.resolveAnchor.mockImplementation(async request => { await gate.promise; return original(request); });
    release = () => gate.resolve(); await mountBranch();
    await change('textarea[aria-label="下一章故事引导"]', '一次冻结引导');
    const tail = button('创建分支'); await act(async () => { tail.click(); tail.click(); }); await settle();
    expect(fixture.resolveAnchor).toHaveBeenCalledTimes(1); expect(button('创建分支').disabled).toBe(true); expect(received).toHaveLength(0);
    await act(async () => gate.resolve()); await vi.waitFor(() => expect(storyPort.heads()).toHaveLength(2)); await settle();
    expect(fixture.begin).toHaveBeenCalledTimes(1); expect(fixture.end).toHaveBeenCalledTimes(1); expect(received).toHaveLength(1);
    expect(JSON.parse(received[0]!.arenaInputJson!).userGuidance).toBe('一次冻结引导');
  });
  it.each(['selection', 'ABA'] as const)('a %s change during source preparation never dispatches from a stale click', async changeKind => {
    const fixture = await setupBranch(), gate = deferred<void>(), original = fixture.resolveAnchor.getMockImplementation()!;
    fixture.resolveAnchor.mockImplementation(async request => { await gate.promise; return original(request); });
    release = () => gate.resolve(); await mountBranch(); await click('创建分支');
    await chooseChapter(1); if (changeKind === 'ABA') await chooseChapter(3);
    await act(async () => gate.resolve()); await vi.waitFor(() => expect(button('创建分支').disabled).toBe(false)); await settle();
    expect(reader().getAttribute('data-story-chapter-id')).toBe(fixture.chapterIds[changeKind === 'ABA' ? 2 : 0]);
    expect(fixture.resolveAnchor).toHaveBeenCalledTimes(1); assertNoBranchDispatch(fixture);
  });
  it('late committed branch success preserves a newer manual chapter selection', async () => {
    const fixture = await setupBranch(), gate = deferred<void>(); fixture.state.beforeEnd = () => gate.promise;
    release = () => gate.resolve(); await mountBranch(); await click('创建分支');
    await vi.waitFor(() => expect(fixture.end).toHaveBeenCalledTimes(1)); await chooseChapter(1);
    await act(async () => gate.resolve()); await vi.waitFor(() => expect(storyPort.heads()).toHaveLength(2)); await settle();
    expect(reader().getAttribute('data-story-session-id')).toBe(fixture.sessionId);
    expect(reader().getAttribute('data-story-chapter-id')).toBe(fixture.chapterIds[0]);
    expect(container.querySelector('[aria-label="本次章节结果"]')?.textContent).toContain('已保存');
    await click('读取刚保存的章节');
    expect(reader().getAttribute('data-story-session-id')).toBe(fixture.manifests[0]!.sessionId);
    expect(fixture.begin).toHaveBeenCalledTimes(1); expect(fixture.end).toHaveBeenCalledTimes(1); expect(received).toHaveLength(1);
  });
  it('cancels in-flight branch generation, keeps received text, and confirms before replacing unsaved output', async () => {
    const fixture = await setupBranch(); await mountBranch(); hold = true;
    await click('创建分支'); await vi.waitFor(() => expect(container.querySelector('[aria-label="本次章节结果"]')?.textContent).toContain(text));
    await click('停止章节生成'); release?.(); await settle(); hold = false;
    expect(storyPort.heads()).toHaveLength(1); expect(fixture.begin).not.toHaveBeenCalled(); expect(received).toHaveLength(1);
    await click('导出完整原始输出'); expect(JSON.parse(mocks.download.mock.calls.at(-1)![1]).rawText).toContain(text);
    await click('创建分支'); expect(window.confirm).toHaveBeenCalledWith('开始新章节会清除当前未保存原文，请先导出。继续？');
    expect(received).toHaveLength(1); expect(fixture.resolveAnchor).toHaveBeenCalledTimes(1);
    vi.mocked(window.confirm).mockReturnValue(true); await click('创建分支');
    await vi.waitFor(() => expect(storyPort.heads()).toHaveLength(2)); expect(received).toHaveLength(2); expect(fixture.begin).toHaveBeenCalledTimes(1);
  });
  it('keeps a confirmed branch save read-only after target reading fails', async () => {
    const fixture = await setupBranch(); await mountBranch();
    storyPort.beforeDescribe = async (id, kind) => { if (id !== fixture.sessionId && kind === 'chapter') throw new Error('synthetic saved chapter read failure'); };
    await click('创建分支'); await vi.waitFor(() => expect(container.textContent).toContain('synthetic saved chapter read failure')); await settle();
    expect(storyPort.heads()).toHaveLength(2); expect(container.querySelector('[aria-label="本次章节结果"]')?.textContent).toContain('已保存');
    expect(button('重试本地保存')).toBeUndefined(); expect(button('查询原保存结果')).toBeUndefined();
    storyPort.beforeDescribe = undefined; await click('读取刚保存的章节');
    expect(reader().getAttribute('data-story-chapter-id')).toBe(fixture.manifests[0]!.operationId);
    expect(fixture.begin).toHaveBeenCalledTimes(1); expect(fixture.end).toHaveBeenCalledTimes(1); expect(received).toHaveLength(1);
  });
  it('unknown branch saving only queries its original identity even after source removal and instance change', async () => {
    const fixture = await setupBranch(); fixture.state.loseEndReply = true; await mountBranch();
    await click('创建分支'); await vi.waitFor(() => expect(container.textContent).toContain('保存状态待确认')); await settle();
    const manifest = fixture.manifests[0]!, query = fixture.receipt.mock.calls.at(-1)!;
    expect(button('创建分支').disabled).toBe(true); expect(button('重试本地保存')).toBeUndefined();
    await click('查询原保存结果'); await click('导出未保存章节'); expect(mocks.download.mock.calls.at(-1)![0]).toBe('未保存章节.md');
    expect(mocks.download.mock.calls.at(-1)![1]).toContain(text);
    for (const key of [...storyPort.documents.keys()]) if (key.startsWith(`${fixture.sessionId}:`)) storyPort.documents.delete(key);
    storyPort.instance = 'b'.repeat(32); fixture.state.hideReceipt = false;
    await click('查询原保存结果'); await vi.waitFor(() => expect(container.textContent).toContain('完整章节已保存到本机故事'));
    expect(fixture.receipt.mock.calls.every(args => JSON.stringify(args) === JSON.stringify(query))).toBe(true);
    expect(fixture.begin).toHaveBeenCalledTimes(1); expect(fixture.end).toHaveBeenCalledTimes(1); expect(fixture.resolveAnchor).toHaveBeenCalledTimes(1);
    expect(received).toHaveLength(1); expect(reader().getAttribute('data-story-chapter-id')).toBe(manifest.operationId);
  });
  it('handles a missing source boundary before dispatch without an unhandled page promise', async () => {
    const fixture = await setupBranch(); await mountBranch(); storyPort.documents.delete(`${fixture.sessionId}:${fixture.checkpointIds[3]}`);
    await click('创建分支'); await vi.waitFor(() => expect(button('创建分支').disabled).toBe(false)); await settle();
    expect(fixture.resolveAnchor).toHaveBeenCalledTimes(1); assertNoBranchDispatch(fixture);
  });
  it('keeps both branch actions disabled while source deletion is unknown', async () => {
    const fixture = await setupBranch(); await mountBranch();
    storyPort.deleteSession.mockRejectedValue(new Error('ambiguous deletion transport failure'));
    await click('删除本机会话'); await click('确认删除本机会话');
    await vi.waitFor(() => expect(document.body.textContent).toContain('删除状态待确认')); await click('返回');
    expect(button('创建分支').disabled).toBe(true); expect(button('从第 3 章创建分支').disabled).toBe(true);
    await click('创建分支'); expect(fixture.resolveAnchor).not.toHaveBeenCalled(); assertNoBranchDispatch(fixture);
  });
  it.each(['cancel', 'actor-ABA'] as const)('an exact success after end-time %s stays saved without automatic navigation', async ending => {
    const fixture = await setupBranch(), gate = deferred<void>(); fixture.state.beforeEnd = () => gate.promise;
    release = () => gate.resolve(); cloudAccount = { userId: 7, username: 'fixture-user-seven' }; await mountBranch(); await click('创建分支');
    await vi.waitFor(() => expect(fixture.end).toHaveBeenCalledTimes(1));
    if (ending === 'cancel') await click('取消生成');
    else {
      cloudAccount = { userId: 8, username: 'fixture-user-eight' }; await act(async () => getDesktopCloudSessionStore().refresh()); await settle();
      cloudAccount = { userId: 7, username: 'fixture-user-seven' }; await act(async () => getDesktopCloudSessionStore().refresh()); await settle();
    }
    await act(async () => gate.resolve()); await vi.waitFor(() => expect(storyPort.heads()).toHaveLength(2)); await settle();
    expect(reader().getAttribute('data-story-session-id')).toBe(fixture.sessionId);
    expect(reader().getAttribute('data-story-chapter-id')).toBe(fixture.chapterIds[2]);
    expect(container.querySelector('[aria-label="本次章节结果"]')?.textContent).toContain('已保存');
    expect(button('读取刚保存的章节')).toBeTruthy(); expect(button('重试本地保存')).toBeUndefined();
    expect(received).toHaveLength(1); expect(fixture.begin).toHaveBeenCalledTimes(1); expect(fixture.end).toHaveBeenCalledTimes(1);
  });
  it.each(['candidate', 'read-error'] as const)('waits for fresh Hosted discovery after manually selecting a story during delayed initial %s', async outcome => {
    const fixture = await setupBranch(), gate = deferred<void>(), original = mocks.invoke.getMockImplementation()!;
    const pending = StoryPendingSnapshotSchema.parse({ manifest: { version: 1, product: 'arena', requestId: 'existing-hosted-request', actor: { kind: 'anonymous' },
      pendingRevision: 1, sessionId: fixture.sessionId, operationId: 'existing-hosted-chapter', outputCheckpointId: 'existing-hosted-output', initialCheckpointId: null,
      createdAt: 4, localAssembly: { version: 1, chapterPlan: null }, expectedRevision: 3, expectedLastChapterId: fixture.chapterIds[2],
      lastInputCheckpointId: fixture.checkpointIds[3], inputDigest: `sha256:${'a'.repeat(64)}`,
      writeOptions: { writeArenaHistory: false, writeCurrentState: false, writeNarrativeHistory: false },
      modelCompleted: false, roleState: 'not-requested', roleInputDigest: null,
      parts: [{ kind: 'input', byteLength: 1, digest: `sha256:${'a'.repeat(64)}` }], commitManifest: null },
      createClaim: null, saveAttemptId: null, restored: false, abandonRequested: false });
    mocks.invoke.mockImplementation(async (command, args, options) => {
      if (command === STORY_PENDING_IPC.describe) {
        await gate.promise;
        if (outcome === 'read-error') throw new Error('synthetic discovery read failure');
        return args.product === 'arena' ? pending : null;
      }
      return original(command, args, options);
    });
    release = () => gate.resolve(); saveDraft(draft('daily', 'stream')); await mount();
    const sourceRow = [...container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find(node => node.textContent?.startsWith(fixture.head.titlePreview))!;
    expect(sourceRow).toBeTruthy(); await act(async () => sourceRow.click()); await settle();
    expect(reader().getAttribute('data-story-read-status')).toBe('loaded'); expect(button('创建分支').disabled).toBe(false);
    await click('创建分支'); expect(fixture.resolveAnchor).not.toHaveBeenCalled(); assertNoBranchDispatch(fixture);
    await act(async () => gate.resolve()); await vi.waitFor(() => expect(container.textContent).toContain('原 Hosted 故事候选尚未处理或核清'));
    expect(fixture.resolveAnchor).not.toHaveBeenCalled(); assertNoBranchDispatch(fixture);
  });
  it('can cancel Direct source preparation after displaying a saved Hosted chapter', async () => {
    const fixture = await setupBranch();
    vi.stubGlobal('TextEncoder', class extends NodeTextEncoder { encode(input?: string) { return Uint8Array.from(super.encode(input)); } });
    hostedStory.records.documents = storyPort.documents;
    // The Direct fixture intentionally carries opaque draft settings; Hosted has a closed input schema.
    const seed = structuredClone(storyPort.documents.get(`${fixture.sessionId}:seed`)!.value);
    delete (seed.settings as Record<string, unknown>).userGuidance; fixture.put(fixture.sessionId, 'seed', seed);
    vi.spyOn(hostedStory.pointers, 'get').mockImplementation(key => localStorage.getItem(key) ?? undefined);
    await mountBranch(); await act(async () => getDesktopAiConfigStore().selectExecutionLocation('server')); await settle();
    await click('继续续写'); await vi.waitFor(() => expect(storyPort.heads()[0]?.chapterCount, container.textContent ?? '').toBe(4)); await settle();
    expect(container.querySelector('[aria-label="本次章节结果"]')?.textContent).toContain('合成故事');
    await act(async () => getDesktopAiConfigStore().selectExecutionLocation('client')); await settle();
    const gate = deferred<void>(), original = fixture.resolveAnchor.getMockImplementation()!;
    fixture.resolveAnchor.mockImplementation(async request => { await gate.promise; return original(request); }); release = () => gate.resolve();
    await click('创建分支'); await vi.waitFor(() => expect(fixture.resolveAnchor).toHaveBeenCalledTimes(1));
    expect(button('停止章节生成')).toBeTruthy(); await click('停止章节生成');
    await act(async () => gate.resolve()); await settle();
    expect(received).toHaveLength(0); expect(fixture.begin).not.toHaveBeenCalled(); expect(storyPort.heads()).toHaveLength(1);
    expect(hostedStory.streams.filter(request => request.operation === 'create-story-stream')).toHaveLength(1);
  });
  it('does not revive an old source error after cancellation and a newer successful branch', async () => {
    const fixture = await setupBranch(), gate = deferred<void>();
    fixture.resolveAnchor.mockImplementationOnce(async () => { await gate.promise; throw new Error('obsolete branch source error'); });
    release = () => gate.resolve(); await mountBranch(); await click('创建分支');
    await vi.waitFor(() => expect(fixture.resolveAnchor).toHaveBeenCalledTimes(1)); await click('停止章节生成');
    await click('创建分支'); await vi.waitFor(() => expect(storyPort.heads()).toHaveLength(2)); await settle();
    const target = fixture.manifests[0]!.sessionId;
    await act(async () => gate.resolve()); await settle();
    expect(container.textContent).not.toContain('obsolete branch source error');
    expect(reader().getAttribute('data-story-session-id')).toBe(target);
    expect(container.querySelector('[aria-label="本次章节结果"]')?.textContent).toContain('已保存');
    expect(received).toHaveLength(1); expect(fixture.begin).toHaveBeenCalledTimes(1);
  });
});


describe('Desktop Strict preparation and real dispatch boundary', () => {
  const advisory = () => ({ success: true, preflightVersion: 'desktop-strict-preflight-v1', viewerUserId: 7,
    willCount: true, reasons: [], range: null, daily: { used: 0, limit: 10, exceeded: false, sinceIso: null },
    pair: { used: 0, limit: 3, exceeded: false, recentDeduped: false, recentAppliedAtIso: null, nextEligibleAtIso: null, windowMinutes: 10 } });
  const creates = () => mocks.invoke.mock.calls.filter(([command, args]) => command === 'arena_hosted_stream' && ['create-json', 'create-stream'].includes(args.request.operation));
  const prepare = async (product: 'battle' | 'arena', presetFunding = false) => {
    cloudAccount = { userId: 7, username: 'fixture-seven' }; window.location.hash = `#/${product}`;
    const base = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((command, args, options) => {
      if (command === 'cloud_public_ranking_read') return Promise.resolve({ kind: 'seasons', data: { schemaVersion: 1, seasons: [{ id: 'S1', name: '合成赛季', status: 'current', startsAt: '2026-01-01', description: '' }] } });
      if (command === 'cloud_arena_strict_preflight') return Promise.resolve(advisory());
      if (command === 'arena_hosted_stream' && ['create-json', 'create-stream'].includes(args.request.operation))
        throw { code: 'capability-unavailable', message: 'synthetic dispatch boundary', dispatchState: 'not-dispatched', intentOwnership: 'current-owned' };
      return base(command, args, options);
    });
    await mount();
    if (presetFunding) await act(async () => {
      const store = getDesktopAiConfigStore(); store.selectExecutionLocation('server'); store.selectProviderTarget({ kind: 'preset', providerId: 'deepseek' });
      store.selectPresetModel('deepseek', 'deepseek-chat'); store.setPresetKeyDraft('deepseek', 'synthetic-prepared-key'); store.selectExecutionLocation('client');
    });
    for (const index of [0, 1]) {
      const preset = container.querySelectorAll<HTMLButtonElement>('[aria-label^="选择预设角色："]')[index]!;
      expect(preset).toBeTruthy(); await act(async () => preset.click()); await settle();
    }
    const before = localStorage.getItem(DESKTOP_AI_CONFIG_STORAGE_KEY);
    const details = container.querySelector<HTMLDetailsElement>('details[aria-label="严格排位配置检查"]')!;
    await act(async () => { details.open = true; details.dispatchEvent(new Event('toggle')); }); await settle();
    await click('一键严格设置并锁定服务器');
    await vi.waitFor(() => expect(container.textContent).toContain('本次执行锁定为服务器'));
    expect(getDesktopAiConfigStore().getSnapshot().selection.executionPreference).toBe('client');
    expect(localStorage.getItem(DESKTOP_AI_CONFIG_STORAGE_KEY)).toBe(before);
    expect(button('客户端').disabled).toBe(true); expect(button('服务器').disabled).toBe(true);
    expect(button('生成战报').disabled).toBe(true);
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'cloud_arena_strict_preflight')).toBe(false);
    return before;
  };
  it.each(['battle', 'arena'] as const)('%s prepares the actual server target, preflights, dispatches Native Hosted only and restores preference on exit', async product => {
    const before = await prepare(product);
    const owner = vi.spyOn(getDesktopAiConfigStore(), 'withPreparedGeneration');
    await click('检查服务器计分条件'); expect(button('生成战报').disabled).toBe(false);
    await click('生成战报'); await vi.waitFor(() => expect(creates()).toHaveLength(1));
    expect(owner.mock.calls[0]?.[1]).toEqual({ executionLocation: 'server' });
    expect(creates()[0]![1].request).toMatchObject({ product, actor: { kind: 'account', expectedUserId: 7 }, body: { arenaFreeRankingEnabled: false, readArenaHistory: false, readCurrentState: false, combatants: [{ isPreset: true }, { isPreset: true }] } });
    expect(calls()).toHaveLength(0); expect(received).toHaveLength(0);
    expect(localStorage.getItem(DESKTOP_AI_CONFIG_STORAGE_KEY)).toBe(before);
    await click('退出严格排位准备'); expect(button('客户端').disabled).toBe(false);
    expect(getDesktopAiConfigStore().getSnapshot().selection).toMatchObject({ executionPreference: 'client', clientTarget: { kind: 'custom', profileId: 'loopback' } });
  });
  it.each(['battle', 'arena'] as const)('%s persists its exact pending preset Key without invalidating its own checked dispatch', async product => {
    const before = await prepare(product, true); await click('检查服务器计分条件');
    expect(button('生成战报').disabled).toBe(false); await click('生成战报');
    await vi.waitFor(() => expect(creates()).toHaveLength(1));
    expect(creates()[0]![1].request).toMatchObject({ presetConfig: { providerId: 'deepseek', modelId: 'deepseek-chat' } });
    expect(getDesktopAiConfigStore().getPresetKeyDraft('deepseek')).toBe('');
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'set_provider_secret')).toHaveLength(1);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'cloud_arena_strict_preflight')).toHaveLength(1);
    expect(localStorage.getItem(DESKTOP_AI_CONFIG_STORAGE_KEY)).toBe(before); expect(calls()).toHaveLength(0);
  });
  it('blocks a newly authenticating account during Key preparation even before its viewer changes', async () => {
    await prepare('battle', true); await click('检查服务器计分条件');
    const gate = deferred<boolean>(), base = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((command, args, options) => command === 'has_provider_secret' ? gate.promise : base(command, args, options));
    release = () => gate.resolve(true); await click('生成战报');
    expect(getDesktopAiConfigStore().isPreparingGeneration()).toBe(true);
    const cloud = getDesktopCloudSessionStore(), previous = cloud.getSnapshot();
    vi.spyOn(cloud, 'getSnapshot').mockReturnValue({ ...previous, authFlow: { kind: 'authenticating', flowId: 'new-login', authorizeUrl: 'https://example.invalid' } });
    await act(async () => gate.resolve(true)); await settle();
    expect(creates()).toHaveLength(0); expect(calls()).toHaveLength(0);
  });
  it('ignores a preflight result after account change and leaves the next account unchecked', async () => {
    await prepare('battle'); const gate = deferred<ReturnType<typeof advisory>>(), base = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((command, args, options) => command === 'cloud_arena_strict_preflight' ? gate.promise : base(command, args, options));
    await click('检查服务器计分条件'); cloudAccount = { userId: 8, username: 'fixture-eight' };
    await act(async () => getDesktopCloudSessionStore().refresh()); await settle();
    await act(async () => gate.resolve(advisory())); await settle();
    expect(container.textContent).not.toContain('当前服务器预检未发现计分阻断'); expect(button('生成战报').disabled).toBe(true); expect(creates()).toHaveLength(0);
  });
  it('rejects a same-turn server override change before the old generate handler can dispatch', async () => {
    await prepare('battle'); await click('检查服务器计分条件');
    const generate = button('生成战报'); expect(generate.disabled).toBe(false);
    await act(async () => { getDesktopAiConfigStore().setGenerationOverrides('system', 'default', { temperature: 0.3 }); generate.click(); });
    await settle(); expect(creates()).toHaveLength(0); expect(calls()).toHaveLength(0); expect(button('生成战报').disabled).toBe(true);
  });
  it.each(['close', 'config', 'account'] as const)('does not apply delayed public preparation after %s changes its owner', async changeKind => {
    const filename = SCENARIO_PRESET_LIST[0]!.filename, gate = deferred<Response>(), base = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((command, args, options) => command === 'cloud_public_ranking_read'
      ? Promise.resolve({ kind: 'seasons', data: { schemaVersion: 1, seasons: [{ id: 'S1', name: '合成情景赛季', status: 'current', startsAt: '', description: '', specialRules: { mode: 'scenario', scenarioPresetFilename: filename } }] } })
      : base(command, args, options));
    const baseFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((input, init) => String(input) === `/scenario-presets/${filename}` ? gate.promise : baseFetch(input, init));
    saveDraft(draft('daily', 'non-stream')); await mount();
    const details = container.querySelector<HTMLDetailsElement>('details[aria-label="严格排位配置检查"]')!;
    await act(async () => { details.open = true; details.dispatchEvent(new Event('toggle')); }); await settle();
    await click('一键严格设置并锁定服务器');
    expect(container.textContent).not.toContain('退出严格排位准备');
    await act(async () => {
      if (changeKind === 'close') { details.open = false; details.dispatchEvent(new Event('toggle')); }
      else if (changeKind === 'config') getDesktopAiConfigStore().setGenerationOverrides('system', 'default', { temperature: 0.6 });
      else { const cloud = getDesktopCloudSessionStore(); vi.spyOn(cloud, 'getSnapshot').mockReturnValue({ ...cloud.getSnapshot(), account: { userId: 8, username: 'new-viewer' } }); }
      gate.resolve(new Response(JSON.stringify({ templateId: '通用情景', title: '迟到', content: '迟到正文' })));
    }); await settle();
    expect(container.textContent).not.toContain('退出严格排位准备');
    expect(JSON.parse(localStorage.getItem(ARENA_DRAFT_KEY)!).draft.battleMode).toBe('daily'); expect(creates()).toHaveLength(0);
  });
  it('withdraws prior success before a same-turn recheck and never dispatches on its late failure', async () => {
    await prepare('battle'); await click('检查服务器计分条件'); expect(button('生成战报').disabled).toBe(false);
    let reject!: (reason: unknown) => void;
    const pending = new Promise((_resolve, fail) => { reject = fail; }), base = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((command, args, options) => command === 'cloud_arena_strict_preflight' ? pending : base(command, args, options));
    await act(async () => { button('检查服务器计分条件').click(); button('生成战报').click(); });
    expect(creates()).toHaveLength(0); expect(calls()).toHaveLength(0); expect(button('生成战报').disabled).toBe(true);
    await act(async () => reject({ code: 'network-error', message: 'synthetic read failed' })); await settle();
    expect(button('生成战报').disabled).toBe(true); await click('生成战报'); expect(creates()).toHaveLength(0);
  });
  it('requires a fresh check after a guidance edit and does not use restored provenance', async () => {
    await prepare('arena'); await click('检查服务器计分条件');
    await change('#arena-story-guidance', '修改引导');
    expect(button('生成战报').disabled).toBe(true);
    await click('退出严格排位准备');
    const key = ADVANCED_ARENA_DRAFT_KEY, saved = JSON.parse(localStorage.getItem(key)!);
    expect(saved.draft.combatants.every((card: { desktopSource?: string }) => card.desktopSource === 'preset')).toBe(true);
    await act(async () => root.unmount()); root = createRoot(container); await mount();
    const details = container.querySelector<HTMLDetailsElement>('details[aria-label="严格排位配置检查"]')!;
    await act(async () => { details.open = true; details.dispatchEvent(new Event('toggle')); }); await settle();
    expect(container.textContent).toContain('线上角色身份尚未确认'); expect(container.textContent).not.toContain('退出严格排位准备');
  });
});

it('restores advanced Arena section folding without changing the lite layout', async () => {
  localStorage.setItem('arena.section.presetCharacters.open', '0');
  window.location.hash = '#/arena';
  const router = await mount();
  const presets = () => [...container.querySelectorAll('button')].find(b => b.textContent?.includes('🎴 预设角色'));
  expect(presets()?.getAttribute('aria-expanded')).toBe('false');
  await act(async () => presets()!.click());
  expect(localStorage.getItem('arena.section.presetCharacters.open')).toBe('1');
  await act(async () => router.navigate({ to: '/battle' })); await settle();
  expect(container.textContent).toContain('简洁');
  expect(localStorage.getItem('arena.section.presetCharacters.open')).toBe('1');
  await act(async () => router.navigate({ to: '/arena' })); await settle();
  expect(presets()?.getAttribute('aria-expanded')).toBe('true');
});

it('advanced scenario opens after main removal but leaves manual folding intact on draft edits', async () => {
  window.location.hash = '#/arena';
  localStorage.setItem(ADVANCED_ARENA_DRAFT_KEY, JSON.stringify({ version: 1, draft: { ...draft('scenario', 'stream'), scenarioDisplayName: '车站' } }));
  localStorage.setItem('arena.section.scenario.open', '0');
  await mount();
  const scenario = () => [...container.querySelectorAll('button')].find(b => b.textContent?.includes('🎭 情景设置'));
  expect(scenario()?.getAttribute('aria-expanded')).toBe('false');
  // keepMounted preserves the real clear action even while its section is folded.
  await click('清除主情景');
  expect(scenario()?.getAttribute('aria-expanded')).toBe('true');
  await act(async () => scenario()!.click());
  await click('+ 新建分队'); await change('[aria-label="分队名称"]', '折叠回归');
  expect(scenario()?.getAttribute('aria-expanded')).toBe('false');
  expect(localStorage.getItem('arena.section.scenario.open')).toBe('0');
  expect(JSON.parse(localStorage.getItem(ADVANCED_ARENA_DRAFT_KEY)!).draft.scenario.content).toBeNull();
});

describe('Desktop Arena character-library parity', () => {
  const openLibrarySection = async () => {
    const section = [...document.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')]
      .find(item => item.textContent?.includes('🌐 在线角色库 / 随机匹配'));
    expect(section).toBeTruthy();
    if (section!.getAttribute('aria-expanded') === 'false') await act(async () => section!.click());
    await settle();
  };
  const tab = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    .find(item => item.textContent?.startsWith(label));
  const requests = () => mocks.invoke.mock.calls.filter(([command]) => command === 'cloud_card_library_request')
    .map(([, args]) => args.request as { routeId: string; expectedUserId?: number; query?: Record<string, string> });
  const publicRow = () => ({ id: 'random-source', name: '随机公开角色', type: 'character', is_public: 1,
    review_status: 'approved', updated_at: '2026-10-01T00:00:00Z', data: JSON.stringify({ templateId: '通用角色',
      name: '随机公开角色', content: '完整原件', _cardId: 'source-extension-kept', signature: 'unverified-original' }) });
  const fixture = (read: (request: { routeId: string; query?: Record<string, string> }) => Promise<unknown> | unknown) => {
    const native = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((...args) => args[0] === 'cloud_card_library_request' ? read(args[1].request) : native(...args));
  };

  it.each(['battle', 'arena'] as const)('/%s uses the Web two-button layout and all authenticated library categories', async product => {
    cloudAccount = { userId: 7, username: 'fixture-user-seven' };
    fixture(() => ({ status: 200, body: { success: true, cards: [], tags: [], favorites: [], total: 0, nextOffset: null } }));
    window.location.hash = `#/${product}`; await mount(); await openLibrarySection();
    expect(button('浏览在线角色库').parentElement?.classList.contains('flex-col')).toBe(product === 'battle');
    expect(button('随机匹配角色')).toBeTruthy();
    await click('浏览在线角色库');
    for (const label of ['我的角色', '本地库', '公开角色', '管理员推荐', '我的收藏']) expect(tab(label), label).toBeTruthy();
    expect(tab('我的角色')?.getAttribute('aria-selected')).toBe('true');
    await act(async () => tab('我的角色')!.click()); await settle();
    expect(requests()).toContainEqual(expect.objectContaining({ routeId: 'data-cards.query', expectedUserId: 7,
      query: expect.objectContaining({ types: 'character', view: 'summary', offset: '0' }) }));
    await act(async () => tab('我的收藏')!.click()); await settle();
    expect(requests()).toContainEqual(expect.objectContaining({ routeId: 'favorites.query', expectedUserId: 7,
      query: expect.objectContaining({ types: 'character', view: 'summary', offset: '0' }) }));
    await act(async () => tab('管理员推荐')!.click()); await settle();
    expect(requests().filter(item => item.routeId === 'public-data-cards.query').at(-1)?.query)
      .toMatchObject({ type: 'character', view: 'summary', recommendedOnly: '1', offset: '0' });
    await act(async () => tab('公开角色')!.click()); await settle();
    expect(requests().filter(item => item.routeId === 'public-data-cards.query').at(-1)?.query).not.toHaveProperty('recommendedOnly');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await settle(); expect(document.querySelector('[role="dialog"]')).toBeNull();
    await click('浏览在线角色库'); expect(tab('管理员推荐')).toBeTruthy();
    expect(calls()).toHaveLength(0); expect(docs.size).toBe(0);
  });

  it.each(['battle', 'arena'] as const)('/%s keeps public recommendations and offline local cards available while signed out', async product => {
    window.location.hash = `#/${product}`; await mount(); await openLibrarySection(); await click('浏览在线角色库');
    for (const label of ['本地库', '公开角色', '管理员推荐']) expect(tab(label)).toBeTruthy();
    expect(tab('我的角色')).toBeUndefined(); expect(tab('我的收藏')).toBeUndefined();
    expect(tab('公开角色')?.getAttribute('aria-selected')).toBe('true');
    expect(requests().some(item => ['data-cards.query', 'favorites.query'].includes(item.routeId))).toBe(false);
  });

  const localCharacter = (id: string, title: string): LocalCardRecordV1 => ({ id, schemaVersion: 1, storageLocation: 'local', cardType: 'character', title,
    data: { templateId: '通用角色', name: '同名角色', content: title, _cardId: 'body-extension', sourceDataCardId: 'untrusted-body-id',
      adjudicationEvents: [{ id, type: 'binary', description: title, probability: 100 }] }, contentDigest: `sha256:${'a'.repeat(64)}`,
    provenance: { kind: 'unsigned', execution: 'imported' }, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' });
  const toggleLibraryRow = (name: string, action: '加入' | '移除' | '已达到上限') => {
    const card = [...document.querySelectorAll<HTMLElement>('.grid > .relative')].find(row => row.textContent?.includes(name));
    expect(card, name).toBeTruthy();
    const toggle = card!.querySelector<HTMLButtonElement>(`button[aria-label="${action}"]`); expect(toggle, action).toBeTruthy();
    return toggle!;
  };
  it.each(['battle', 'arena'] as const)('/%s continuously selects same-name local sources and removes exactly one with its events', async product => {
    const first = localCharacter('lc_11111111111111111111111111111111', '来源甲'), second = localCharacter('lc_22222222222222222222222222222222', '来源乙');
    docs.set(first.id, first); docs.set(second.id, second);
    window.location.hash = `#/${product}`; await mount(); await openLibrarySection(); await click('浏览在线角色库');
    await act(async () => tab('本地库')!.click()); await settle();
    await act(async () => toggleLibraryRow(first.title, '加入').click()); await settle();
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    await act(async () => toggleLibraryRow(second.title, '加入').click()); await settle();
    const read = () => JSON.parse(localStorage.getItem(product === 'battle' ? ARENA_DRAFT_KEY : ADVANCED_ARENA_DRAFT_KEY)!).draft;
    expect(read().combatants).toHaveLength(2);
    expect(read().combatants[0]).toMatchObject({ cardLibrarySelectionId: `local:${first.id}`, data: first.data });
    expect(read().combatants[0]).not.toHaveProperty('sourceDataCardId');
    expect(read().combatants[0]).not.toHaveProperty('signal');
    expect(read().combatants[0]).not.toHaveProperty('desktopSource');
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label^="关闭"]')!.click()); await settle();
    await click('浏览在线角色库'); await act(async () => tab('本地库')!.click()); await settle();
    await act(async () => toggleLibraryRow(first.title, '移除').click()); await settle();
    expect(read().combatants).toHaveLength(1); expect(read().combatants[0].cardLibrarySelectionId).toBe(`local:${second.id}`);
    if (product === 'arena') expect(read().adjudicationEvents).toEqual([expect.objectContaining({ sourceKey: `library:local:${second.id}`, description: second.title })]);
    expect(docs.get(first.id)).toEqual(first); expect(docs.get(second.id)).toEqual(second); expect(calls()).toHaveLength(0);
  });

  const openReferenceLibrary = async (purpose: 'auxScenario' | 'material' | 'scenario') => {
    if (purpose === 'auxScenario') {
      const disclosure = [...container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].find(item => item.textContent?.includes('辅助情景（可选）'))!;
      if (disclosure.getAttribute('aria-expanded') === 'false') { await act(async () => disclosure.click()); await settle(); }
    }
    const label = purpose === 'material' ? '浏览在线数据卡' : '浏览在线情景库';
    const candidates = [...container.querySelectorAll<HTMLButtonElement>('button')].filter(item => item.textContent === label);
    expect(candidates.length).toBeGreaterThan(0);
    await act(async () => candidates[purpose === 'auxScenario' ? 1 : 0]!.click()); await settle();
  };
  const localScenario = (id: string, title: string): LocalCardRecordV1 => ({ ...localCharacter(id, title), cardType: 'scenario',
    data: { templateId: '通用情景', title: '同名情景', content: title,
      adjudicationEvents: [{ id, type: 'binary', description: title, probability: 100 }] } });
  const storedReferences = () => JSON.parse(localStorage.getItem(ADVANCED_ARENA_DRAFT_KEY)!).draft;
  const prepareReferences = (over: Partial<ArenaDraft> = {}) => {
    window.location.hash = '#/arena';
    localStorage.setItem(ADVANCED_ARENA_DRAFT_KEY, JSON.stringify({ version: 1, draft: { ...draft('scenario', 'stream'), scenarioDisplayName: '车站', ...over } }));
  };

  it.each(['auxScenario', 'material'] as const)('%s continuously selects, reopens with exact row selection, and removes one same-name source', async purpose => {
    const first = localScenario('lc_11111111111111111111111111111111', '参考来源甲'), second = localScenario('lc_22222222222222222222222222222222', '参考来源乙');
    docs.set(first.id, first); docs.set(second.id, second); prepareReferences();
    const router = await mount(); await openReferenceLibrary(purpose); await act(async () => tab('本地库')!.click()); await settle();
    for (const card of [first, second]) {
      await act(async () => toggleLibraryRow(card.title, '加入').click()); await settle();
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    }
    const key = purpose === 'auxScenario' ? 'auxScenarios' : 'materials';
    expect(storedReferences()[key].map((item: { cardLibrarySelectionId: string }) => item.cardLibrarySelectionId))
      .toEqual([`local:${first.id}`, `local:${second.id}`]);
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label^="关闭"]')!.click()); await settle();
    await act(async () => router.navigate({ to: '/' })); await settle();
    await act(async () => router.navigate({ to: '/arena' })); await settle();
    await openReferenceLibrary(purpose); await act(async () => tab('本地库')!.click()); await settle();
    expect(toggleLibraryRow(second.title, '移除')).toBeTruthy();
    await act(async () => toggleLibraryRow(first.title, '移除').click()); await settle();
    expect(storedReferences()[key]).toHaveLength(1);
    expect(storedReferences()[key][0].cardLibrarySelectionId).toBe(`local:${second.id}`);
    if (purpose === 'auxScenario') expect(storedReferences().adjudicationEvents).toEqual([
      expect.objectContaining({ sourceKey: `data_card:local:${second.id}`, description: second.title }),
    ]);
    expect(docs.get(first.id)).toEqual(first); expect(calls()).toHaveLength(0);
  });

  it.each(['auxScenario', 'material'] as const)('%s uses the remaining shared capacity and allows removal at the limit', async purpose => {
    const first = localScenario('lc_11111111111111111111111111111111', '最后一项'), second = localScenario('lc_22222222222222222222222222222222', '超额项');
    docs.set(first.id, first); docs.set(second.id, second);
    prepareReferences({ materials: Array.from({ length: 255 }, (_, index) => ({ id: String(index), name: '原素材', content: {}, fileName: null, sourceKind: 'raw-json', sourceType: 'raw-json', isNative: false })) });
    await mount(); await openReferenceLibrary(purpose); await act(async () => tab('本地库')!.click()); await settle();
    await act(async () => toggleLibraryRow(first.title, '加入').click()); await settle();
    expect(toggleLibraryRow(second.title, '已达到上限').disabled).toBe(true);
    expect(toggleLibraryRow(first.title, '移除').disabled).toBe(false);
    await act(async () => toggleLibraryRow(first.title, '移除').click()); await settle();
    expect(toggleLibraryRow(second.title, '加入').disabled).toBe(false);
    expect(storedReferences().materials).toHaveLength(255); expect(storedReferences().auxScenarios).toHaveLength(0);
  });

  it('keeps the main scenario single-select and closes only after successful admission', async () => {
    const source = localScenario('lc_11111111111111111111111111111111', '新主情景'); docs.set(source.id, source); prepareReferences();
    await mount(); await openReferenceLibrary('scenario'); await act(async () => tab('本地库')!.click()); await settle();
    const row = [...document.querySelectorAll<HTMLElement>('.grid > .relative')].find(item => item.textContent?.includes(source.title))!;
    const select = row.matches('[role="button"][aria-label^="选择"]') ? row : null;
    expect(select).toBeTruthy(); await act(async () => select.click()); await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(storedReferences().scenario.content.content).toBe(source.title);
    expect(storedReferences().auxScenarios).toHaveLength(0);
  });

  it.each([['auxScenario', 'close'], ['material', 'close'], ['auxScenario', 'account'], ['material', 'account']] as const)('%s discards a late read after %s changes the picker scope', async (purpose, reason) => {
    const gate = deferred<void>(); release = () => gate.resolve();
    const row = { ...publicRow(), type: 'scenario', name: '旧参考', data: JSON.stringify({ templateId: '通用情景', title: '旧参考', content: '旧正文' }) };
    const { data: _data, ...summary } = row;
    fixture(async request => {
      if (request.query?.id === row.id) { await gate.promise; return { status: 200, body: { success: true, card: row } }; }
      return { status: 200, body: { success: true, cards: [summary], tags: [], total: 1 } };
    });
    prepareReferences(); await mount(); await openReferenceLibrary(purpose);
    await act(async () => toggleLibraryRow(row.name, '加入').click()); await settle();
    if (reason === 'close') {
      await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label^="关闭"]')!.click()); await settle();
      await openReferenceLibrary(purpose);
    } else {
      cloudAccount = { userId: 8, username: 'fixture-user-eight' };
      await act(async () => getDesktopCloudSessionStore().refresh()); await settle();
    }
    await act(async () => gate.resolve()); await settle();
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    expect(storedReferences().auxScenarios).toHaveLength(0); expect(storedReferences().materials).toHaveLength(0);
    expect(requests().some(request => request.routeId === 'data-card-stats.report')).toBe(false);
    expect(calls()).toHaveLength(0);
  });

  it.each(['auxScenario', 'material', 'scenario'] as const)('%s keeps a failed selection open without writing inputs or reporting usage', async purpose => {
    const row = { ...publicRow(), type: 'scenario', name: '损坏参考', data: '{invalid' };
    fixture(() => ({ status: 200, body: { success: true, cards: [row], tags: [], total: 1 } }));
    prepareReferences(); await mount(); await openReferenceLibrary(purpose);
    const before = localStorage.getItem(ADVANCED_ARENA_DRAFT_KEY);
    const entry = [...document.querySelectorAll<HTMLElement>('.grid > .relative')].find(item => item.textContent?.includes(row.name))!;
    const select = purpose === 'scenario' ? entry : entry.querySelector<HTMLButtonElement>('button[aria-label="加入"]')!;
    expect(select).toBeTruthy(); await act(async () => select.click()); await settle();
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    expect(localStorage.getItem(ADVANCED_ARENA_DRAFT_KEY)).toBe(before);
    expect(requests().some(request => request.routeId === 'data-card-stats.report')).toBe(false);
    expect(calls()).toHaveLength(0);
  });

  it('uses the latest roster limit, disables additions at 32 and keeps exact removal available', async () => {
    const source = localCharacter('lc_11111111111111111111111111111111', '第三十二位'); docs.set(source.id, source);
    const base = draft('daily', 'stream'); base.combatants = Array.from({ length: 31 }, (_, index) => ({ ...base.combatants[0]!, filename: `角色${index}` }));
    saveDraft(base); await mount(); await openLibrarySection(); await click('浏览在线角色库'); await act(async () => tab('本地库')!.click()); await settle();
    await act(async () => toggleLibraryRow(source.title, '加入').click()); await settle();
    const read = () => JSON.parse(localStorage.getItem(ARENA_DRAFT_KEY)!).draft;
    expect(read().combatants).toHaveLength(32); expect(document.body.textContent).toContain('已选 32/32');
    expect(toggleLibraryRow(source.title, '移除').disabled).toBe(false);
    await act(async () => toggleLibraryRow(source.title, '移除').click()); await settle(); expect(read().combatants).toHaveLength(31);
  });

  it('keeps existing local Wantu conversion without rewriting the original library card', async () => {
    const source = localCharacter('lc_11111111111111111111111111111111', '万途原件');
    source.data = { format: 'wantu-data-card', card: { name: '万途角色', domains: { content: { kind: 'text', status: 'ready', value: '万途原文' } } } };
    docs.set(source.id, source);
    window.location.hash = '#/arena'; await mount(); await click('浏览在线角色库');
    await act(async () => tab('本地库')!.click()); await settle();
    await act(async () => toggleLibraryRow(source.title, '加入').click()); await settle();
    const saved = JSON.parse(localStorage.getItem(ADVANCED_ARENA_DRAFT_KEY)!).draft.combatants[0];
    expect(saved).toMatchObject({ cardLibrarySelectionId: `local:${source.id}`, data: { templateId: '通用角色', name: '万途角色', content: '万途原文' } });
    expect(saved).not.toHaveProperty('sourceDataCardId');
    expect(docs.get(source.id)?.data).toEqual(source.data);
  });

  it.each(['close', 'account'] as const)('cancels a pending real library body on %s without admitting the late source', async reason => {
    const gate = deferred<void>(); release = () => gate.resolve();
    const row = publicRow(); const { data: _data, ...summary } = row;
    fixture(async request => {
      if (request.query?.id === row.id) { await gate.promise; return { status: 200, body: { success: true, card: row } }; }
      return { status: 200, body: { success: true, cards: [summary], tags: [], total: 1 } };
    });
    await mount(); await openLibrarySection(); await click('浏览在线角色库');
    await act(async () => toggleLibraryRow(row.name, '加入').click()); await settle();
    expect(document.body.textContent).toContain('正在处理选择');
    expect(toggleLibraryRow(row.name, '加入').disabled).toBe(true);
    if (reason === 'close') {
      await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label^="关闭"]')!.click()); await settle();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    } else {
      cloudAccount = { userId: 8, username: 'fixture-user-eight' };
      await act(async () => getDesktopCloudSessionStore().refresh()); await settle();
    }
    await act(async () => gate.resolve()); await settle();
    expect(JSON.parse(localStorage.getItem(ARENA_DRAFT_KEY) ?? '{"draft":{"combatants":[]}}').draft.combatants).toHaveLength(0);
    expect(calls()).toHaveLength(0);
  });

  it('rejects a delayed library addition when another completed import fills the latest draft', async () => {
    const gate = deferred<void>(); release = () => gate.resolve();
    const row = publicRow(), random = { ...publicRow(), id: 'other-source' }; const { data: _data, ...summary } = row;
    fixture(async request => {
      if (request.query?.id === row.id) { await gate.promise; return { status: 200, body: { success: true, card: row } }; }
      if (request.routeId === 'random-public-card.query' || request.query?.id === random.id) return { status: 200, body: { success: true, card: random } };
      return { status: 200, body: { success: true, cards: [summary], tags: [], total: 1 } };
    });
    const base = draft('daily', 'stream'); base.combatants = Array.from({ length: 31 }, (_, index) => ({ ...base.combatants[0]!, filename: `旧角色${index}` }));
    saveDraft(base); await mount(); await openLibrarySection(); await click('浏览在线角色库');
    await act(async () => toggleLibraryRow(row.name, '加入').click()); await settle();
    await click('随机匹配角色');
    const read = () => JSON.parse(localStorage.getItem(ARENA_DRAFT_KEY)!).draft;
    expect(read().combatants).toHaveLength(32);
    await act(async () => gate.resolve()); await settle();
    expect(read().combatants).toHaveLength(32);
    expect(read().combatants.some((item: { sourceDataCardId?: string }) => item.sourceDataCardId === row.id)).toBe(false);
    expect(document.body.textContent).toContain('角色总数超过 32 位'); expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it.each(['battle', 'arena'] as const)('/%s random selection is single-flight, freshly read and retains exact source data', async product => {
    const gate = deferred<void>(); release = () => gate.resolve(); const row = publicRow();
    const fresh = { ...row, updated_at: '2026-10-02T00:00:00Z', data: JSON.stringify({ ...JSON.parse(row.data), content: '重新读取的完整原件' }) };
    fixture(async request => {
      if (request.routeId === 'random-public-card.query') { await gate.promise; return { status: 200, body: { success: true, card: row } }; }
      if (request.routeId === 'public-data-cards.query' && request.query?.id === row.id) return { status: 200, body: { success: true, card: fresh } };
      throw new Error(`Unexpected library route: ${request.routeId}`);
    });
    window.location.hash = `#/${product}`; await mount(); await openLibrarySection();
    const random = button('随机匹配角色'); await act(async () => { random.click(); random.click(); }); await settle();
    expect(button('匹配中...').disabled).toBe(true);
    expect(requests().filter(item => item.routeId === 'random-public-card.query')).toHaveLength(1);
    await act(async () => gate.resolve()); await settle();
    const saved = JSON.parse(localStorage.getItem(product === 'battle' ? ARENA_DRAFT_KEY : ADVANCED_ARENA_DRAFT_KEY)!);
    expect(saved.draft.combatants).toHaveLength(1);
    expect(saved.draft.combatants[0]).toMatchObject({ desktopSource: 'online', sourceDataCardId: row.id, isValid: false,
      isPreset: false, sourceDataCardUpdatedAt: fresh.updated_at, data: JSON.parse(fresh.data) });
    expect(requests()).toContainEqual({ routeId: 'public-data-cards.query', query: { id: row.id } });
    expect(button('随机匹配角色').disabled).toBe(false); expect(calls()).toHaveLength(0); expect(docs.size).toBe(0);
  });

  it.each(['account', 'cancel-and-navigation'] as const)('drops a late random response after %s changes without saving or retrying it', async changeScope => {
    const gate = deferred<void>(); release = () => gate.resolve();
    cloudAccount = { userId: 7, username: 'fixture-user-seven' };
    fixture(async () => { await gate.promise; return { status: 200, body: { success: true, card: publicRow() } }; });
    const router = await mount(); await openLibrarySection(); await click('随机匹配角色');
    if (changeScope === 'account') {
      cloudAccount = { userId: 8, username: 'fixture-user-eight' };
      await act(async () => getDesktopCloudSessionStore().refresh()); await settle();
    } else {
      await click('取消生成');
      expect(button('随机匹配角色').disabled).toBe(false);
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await act(async () => { void router.navigate({ to: '/' }); }); await settle();
      await vi.waitFor(() => expect(router.state.location.pathname).toBe('/'));
    }
    if (changeScope === 'account') expect(button('随机匹配角色').disabled).toBe(false);
    await act(async () => gate.resolve()); await settle();
    expect(requests().filter(item => item.routeId === 'random-public-card.query')).toHaveLength(1);
    expect(requests().some(item => item.routeId === 'public-data-cards.query')).toBe(false);
    expect(JSON.parse(localStorage.getItem(ARENA_DRAFT_KEY) ?? '{"draft":{"combatants":[]}}').draft.combatants).toHaveLength(0);
    expect(calls()).toHaveLength(0); expect(docs.size).toBe(0);
  });

  it('cancels a hanging random read immediately and does not let its late result replace a newer selection', async () => {
    const old = deferred<void>(); release = () => old.resolve(); let requestCount = 0;
    const fresh = { ...publicRow(), id: 'new-random-source' };
    fixture(async request => {
      if (request.routeId === 'random-public-card.query') {
        requestCount += 1;
        if (requestCount === 1) { await old.promise; return { status: 200, body: { success: true, card: publicRow() } }; }
        return { status: 200, body: { success: true, card: fresh } };
      }
      if (request.routeId === 'public-data-cards.query') return { status: 200, body: { success: true, card: fresh } };
      throw new Error('Unexpected library route');
    });
    await mount(); await openLibrarySection(); await click('随机匹配角色'); await click('取消生成');
    expect(button('随机匹配角色').disabled).toBe(false);
    await click('随机匹配角色');
    const saved = localStorage.getItem(ARENA_DRAFT_KEY)!;
    expect(JSON.parse(saved).draft.combatants[0].sourceDataCardId).toBe('new-random-source');
    await act(async () => old.resolve()); await settle();
    expect(localStorage.getItem(ARENA_DRAFT_KEY)).toBe(saved);
    expect(requestCount).toBe(2);
    expect(requests().filter(item => item.routeId === 'public-data-cards.query')).toHaveLength(1);
    expect(calls()).toHaveLength(0);
  });

  it('leaves the roster intact when no public random character is available', async () => {
    fixture(() => ({ status: 404, body: { success: false } }));
    saveDraft(draft('daily', 'stream')); await mount(); await openLibrarySection();
    await click('随机匹配角色');
    expect(container.textContent).toContain('暂时没有可随机匹配的公开角色');
    expect(JSON.parse(localStorage.getItem(ARENA_DRAFT_KEY)!).draft.combatants).toHaveLength(2);
    expect(button('随机匹配角色').disabled).toBe(false); expect(calls()).toHaveLength(0);
  });
});

describe('session backup feedback in the real route', () => {
  it.each(['battle', 'arena'] as const)('/%s explains backup contents and reports only download initiation', async product => {
    window.location.hash = `#/${product}`;
    const key = product === 'arena' ? ADVANCED_ARENA_DRAFT_KEY : ARENA_DRAFT_KEY;
    localStorage.setItem(key, JSON.stringify({ version: 1, draft: draft('daily', 'stream') }));
    await mount();
    expect(container.querySelector('[aria-label="会话备份"]')?.textContent).toContain('角色、输入草稿、已收到的结果和恢复状态');
    await click('下载会话备份');
    expect(mocks.download).toHaveBeenLastCalledWith('arena-complete.json', expect.any(String), 'application/json');
    expect(JSON.parse(mocks.download.mock.calls.at(-1)![1]).draft.combatants).toHaveLength(2);
    expect(container.textContent).toContain('已发起下载，请查看系统保存提示或下载目录');
    expect(container.textContent).toContain('无法确认文件是否已保存'); expect(calls()).toHaveLength(0);
    mocks.download.mockImplementationOnce(() => { throw new Error('private OS diagnostic'); });
    await click('下载会话备份');
    expect(container.textContent).toContain('未能发起下载，当前内容仍保留');
    expect(container.textContent).not.toContain('已发起下载'); expect(container.textContent).not.toContain('private OS diagnostic');
    expect(calls()).toHaveLength(0);
  });
  it('shows protected local-draft problems above disabled controls and keeps the original exportable', async () => {
    const original = '{"synthetic":"unfinished draft"'; localStorage.setItem(ARENA_DRAFT_KEY, original);
    await mount();
    const notice = container.querySelector('[aria-label="本机草稿提示"]')!;
    expect(notice.textContent).toContain('旧草稿无法读取，原数据已保留');
    expect([...container.querySelectorAll('button')].filter(node => node.textContent === '下载会话备份')).toHaveLength(1);
    expect(notice.compareDocumentPosition(button('生成战报')) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    await click('下载会话备份', notice);
    expect(JSON.parse(mocks.download.mock.calls.at(-1)![1]).protectedLocalDraft.raw).toBe(original);
    expect(localStorage.getItem(ARENA_DRAFT_KEY)).toBe(original); expect(calls()).toHaveLength(0);

  });
});


describe('Desktop Quick ranking real routes', () => {
  type LibraryRequest = { routeId: string; query?: Record<string, string>; body?: Record<string, unknown> };
  const publicRow = (id = 'quick-source') => ({ id, name: '同名排行角色', type: 'character', is_public: 1,
    review_status: 'approved', updated_at: '2026-10-01T00:00:00Z', data: JSON.stringify({ templateId: '通用角色',
      name: '同名排行角色', content: '排行榜完整原件', _cardId: 'body-extension', sourceDataCardId: 'untrusted-body-reference',
      signature: 'unverified-original', opaqueExtension: { nested: ['完整保留', 3] } }) });
  const rankingItem = (entityId: string, patch: Partial<PublicRankingItem> = {}): PublicRankingItem => ({
    rank: 1, entityType: 'data_card', entityId, displayName: entityId, authorName: null, rating: 1300, games: 20,
    wins: 10, losses: 8, draws: 2, tier: '花牌', techScore: null, techLevel: null, isNative: null, tagIds: [], ...patch,
  });
  const reads = () => mocks.invoke.mock.calls.filter(([command]) => command === 'cloud_public_ranking_read')
    .map(([, args]) => args.request as PublicRankingRequest);
  const requests = () => mocks.invoke.mock.calls.filter(([command]) => command === 'cloud_card_library_request')
    .map(([, args]) => args.request as LibraryRequest);
  const usage = () => requests().filter(request => request.routeId === 'data-card-stats.report' && request.body?.type === 'usage');
  const freshReads = (id: string) => requests().filter(request => request.routeId === 'public-data-cards.query' && request.query?.id === id);
  const fixture = (options: {
    items?: PublicRankingItem[] | ((request: Extract<PublicRankingRequest, { kind: 'leaderboard' }>) => PublicRankingItem[]);
    read?: (request: LibraryRequest) => unknown | Promise<unknown>;
  } = {}) => {
    const native = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((...args) => {
      if (args[0] === 'cloud_public_ranking_read') {
        const request = args[1].request as PublicRankingRequest;
        if (request.kind === 'leaderboard') {
          const values = typeof options.items === 'function' ? options.items(request) : options.items ?? [rankingItem('quick-source')];
          return { kind: request.kind, data: { success: true, items: values.map((item, index) => ({ ...item, rank: request.offset + index + 1 })) } };
        }
        if (request.kind === 'entityRating') return { kind: request.kind, data: { ...rankingFixture.responses.entityRating,
          entityType: request.entityType, entityId: request.entityId, queue: request.queue ?? 'strict', rating: 1300, games: 20 } };
        if (request.kind === 'tags' || request.kind === 'seasons') return { kind: request.kind, data: rankingFixture.responses[request.kind] };
        throw new Error(`Unexpected quick ranking kind: ${request.kind}`);
      }
      if (args[0] === 'cloud_card_library_request') {
        const request = args[1].request as LibraryRequest;
        if (request.routeId === 'data-card-stats.report') return { status: 200, body: { success: true } };
        if (options.read) return options.read(request);
        if (request.routeId === 'public-data-cards.query' && request.query?.id) return { status: 200, body: { success: true, card: publicRow(request.query.id) } };
      }
      return native(...args);
    });
  };
  const modal = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
    .find(node => node.textContent?.includes('排位排行榜（可加入参战）'))!;
  const row = (name: string) => [...modal().querySelectorAll<HTMLButtonElement>('button[aria-label^="查看角色详情"]')]
    .find(node => node.getAttribute('aria-label') === `查看角色详情：${name}`)?.closest('tr');
  const toggle = (name = 'quick-source') => {
    const result = row(name)?.lastElementChild?.querySelector<HTMLButtonElement>('button'); expect(result, name).toBeTruthy(); return result!;
  };
  const prefilter = () => [...modal().querySelectorAll('label')].find(label => label.textContent?.includes('严格分差预筛'))!.querySelector<HTMLInputElement>('input')!;
  const stored = (product: 'battle' | 'arena' = 'battle'): ArenaDraft => JSON.parse(localStorage.getItem(product === 'arena' ? ADVANCED_ARENA_DRAFT_KEY : ARENA_DRAFT_KEY) ?? '{"draft":{"combatants":[]}}').draft;
  const clickToggle = async (name = 'quick-source') => { await act(async () => toggle(name).click()); await settle(); };
  const openRandomSection = async () => {
    const section = [...container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].find(node => node.textContent?.includes('🌐 在线角色库 / 随机匹配'));
    if (section?.getAttribute('aria-expanded') === 'false') { await act(async () => section.click()); await settle(); }
  };

  it.each(['battle', 'arena'] as const)('/%s reads anonymously, admits exact public source and removes without rereading or another usage', async product => {
    fixture({ items: [rankingItem('quick-source', { techScore: 73, techLevel: 'L4' })] }); window.location.hash = `#/${product}`; await mount();
    const accountReads = () => mocks.invoke.mock.calls.filter(([command]) => ['cloud_auth_status', 'cloud_cached_account'].includes(command)).length;
    const accountCount = accountReads(); expect(reads()).toHaveLength(0);
    await click('快速查看排行榜');
    expect(modal()).toBeTruthy(); expect(accountReads()).toBe(accountCount);
    expect(reads()).toContainEqual({ kind: 'tags' }); expect(reads()).toContainEqual({ kind: 'seasons' });
    expect(reads().find(request => request.kind === 'leaderboard')).toMatchObject({ kind: 'leaderboard', offset: 0, limit: 30, filters: { queue: 'strict' } });
    expect(reads().every(request => ['leaderboard', 'tags', 'seasons'].includes(request.kind))).toBe(true);
    await clickToggle();
    expect(stored(product).combatants).toHaveLength(1);
    expect(stored(product).combatants[0]).toMatchObject({ desktopSource: 'online', sourceDataCardId: 'quick-source', sourceDataCardUpdatedAt: publicRow().updated_at,
      cardLibrarySelectionId: 'cloud:quick-source', isPreset: false, isValid: false, data: JSON.parse(publicRow().data) });
    expect(stored(product).combatants[0]).not.toHaveProperty('signal');
    expect(container.textContent).toContain('技术值：73');
    expect(stored(product).combatants[0]).not.toHaveProperty('displayMetadata');
    expect(freshReads('quick-source')).toHaveLength(1);
    expect(usage()).toEqual([{ routeId: 'data-card-stats.report', body: { cardId: 'quick-source', type: 'usage' } }]);
    expect(toggle().textContent).toBe('移除/已加入'); await clickToggle();
    expect(stored(product).combatants).toHaveLength(0); expect(freshReads('quick-source')).toHaveLength(1); expect(usage()).toHaveLength(1);
    await clickToggle(); expect(stored(product).combatants).toHaveLength(1); expect(freshReads('quick-source')).toHaveLength(2);
    expect(usage()).toHaveLength(1); expect(calls()).toHaveLength(0); expect(docs.size).toBe(0);
  });

  it.each(['battle', 'arena'] as const)('/%s shows real selected entity scores and shared pair prediction without persisting observations', async product => {
    fixture({ items: [rankingItem('first'), rankingItem('second')] });
    window.location.hash = `#/${product}`; await mount(); await click('快速查看排行榜');
    await clickToggle('first'); await clickToggle('second');
    await act(async () => button('关闭', modal()).click()); await settle();
    expect(container.textContent).toContain('预计胜率');
    expect(container.textContent).toContain('50%');
    expect(container.textContent).toContain('1300');
    for (const entityId of ['first', 'second']) for (const queue of ['strict', 'free']) {
      expect(reads()).toContainEqual({ kind: 'entityRating', entityType: 'data_card', entityId, queue });
    }
    expect(JSON.stringify(stored(product))).not.toContain('expectedPct');
    expect(JSON.stringify(stored(product))).not.toContain('"rating"');
    expect(calls()).toHaveLength(0); expect(docs.size).toBe(0);
  });

  it.each(['battle', 'arena'] as const)('/%s toggles packaged presets but explains unavailable presets without fetching them', async product => {
    const preset = PRESET_LIST[0]!;
    fixture({ items: [rankingItem(preset.filename, { entityType: 'preset', displayName: '包内预设' }), rankingItem('unknown.json', { entityType: 'preset', displayName: '陌生预设' })] });
    window.location.hash = `#/${product}`; await mount(); await click('快速查看排行榜');
    expect(toggle('陌生预设').disabled).toBe(true); expect(row('陌生预设')?.textContent).toContain('此客户端未收录该预设正文');
    await clickToggle('包内预设');
    expect(stored(product).combatants).toHaveLength(1);
    expect(stored(product).combatants[0]).toMatchObject({ filename: preset.filename, desktopSource: 'preset', isPreset: true, isValid: false,
      data: JSON.parse(readFileSync(resolve(process.cwd(), '../../content/presets', preset.filename), 'utf8')) });
    expect(prefilter().disabled).toBe(false); await act(async () => prefilter().click()); await settle();
    expect(reads().some(request => request.kind === 'entityRating' && request.queue === undefined)).toBe(false);
    expect(reads()).toContainEqual({ kind: 'entityRating', entityType: 'preset', entityId: preset.filename, queue: 'free' });
    await act(async () => prefilter().click()); await settle(); await clickToggle('包内预设');
    expect(stored(product).combatants).toHaveLength(0); expect(usage()).toHaveLength(0);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('unknown.json'))).toBe(false);
    expect(requests().some(request => request.routeId === 'public-data-cards.query' && request.query?.id)).toBe(false);
  });

  it.each([false, true])('/arena preset removal keeps the same-filename upload and cleans only its explicit source (%s)', async explicit => {
    const preset = PRESET_LIST[0]!, base = draft('daily', 'stream');
    const upload = { ...base.combatants[0]!, filename: preset.filename, isPreset: false, characterGuidance: '上传行动', adjudicationSourceKey: `file:${preset.filename}` };
    const event = { id: 'upload-event', description: '上传事件', type: 'binary' as const, probability: 50, sourceKey: `file:${preset.filename}` };
    const value: ArenaDraft = { ...base, combatants: [upload, ...(explicit ? [{ ...upload, isPreset: true, adjudicationSourceKey: `preset:${preset.filename}` }] : [])],
      adjudicationEvents: [event, ...(explicit ? [{ ...event, id: 'preset-event', sourceKey: `preset:${preset.filename}` }] : [])] };
    localStorage.setItem(ADVANCED_ARENA_DRAFT_KEY, JSON.stringify({ version: 1, draft: value }));
    fixture({ items: [rankingItem(preset.filename, { entityType: 'preset', displayName: '包内预设' })] });
    window.location.hash = '#/arena'; await mount(); await click('快速查看排行榜');
    if (!explicit) { await clickToggle('包内预设'); expect(stored('arena').combatants).toHaveLength(2); }
    await clickToggle('包内预设');
    expect(stored('arena').combatants).toHaveLength(1);
    expect(stored('arena').combatants[0]).toMatchObject({ filename: preset.filename, isPreset: false, characterGuidance: '上传行动' });
    expect(stored('arena').adjudicationEvents).toEqual([event]); expect(usage()).toHaveLength(0);
  });

  it('uses a freshly selected single online pivot and the real strict data-card IPC for the low-games prefilter', async () => {
    const opponents = [rankingItem('边界', { rating: 900, games: 5 }), rankingItem('超出', { rating: 899, games: 5 }), rankingItem('例外预设', { entityType: 'preset', rating: 1, games: 1 })];
    fixture({ items: request => request.filters.minRating === null ? [rankingItem('quick-source'), ...opponents] : opponents });
    await mount(); await click('快速查看排行榜'); expect(prefilter().disabled).toBe(true); await clickToggle();
    expect(prefilter().disabled).toBe(false);
    await change('input[placeholder="如 800"]', '1'); await settle();
    expect(row('quick-source')).toBeUndefined(); expect(reads().some(request => request.kind === 'entityRating' && request.queue === undefined)).toBe(false);
    await act(async () => prefilter().click()); await settle();
    const ratings = reads().filter(request => request.kind === 'entityRating' && request.queue === undefined);
    expect(ratings.length).toBeGreaterThan(0);
    for (const request of ratings) expect(request).toEqual({ kind: 'entityRating', entityType: 'data_card', entityId: 'quick-source' });
    expect(row('边界')).toBeTruthy(); expect(row('超出')).toBeUndefined(); expect(row('例外预设')).toBeTruthy();
    expect(modal().textContent).toContain('仅预筛当前页的分差');
  });

  it.each(['restored-online', 'local', 'cache'] as const)('never upgrades %s fields or cloudRef to a ranking pivot', async source => {
    const value = draft('daily', 'stream');
    const marker = source === 'restored-online' ? { desktopSource: 'online' as const, cardLibrarySelectionId: 'cloud:quick-source' }
      : { cardLibrarySelectionId: `${source}:quick-source` };
    value.combatants = [{ ...value.combatants[0]!, ...marker, sourceDataCardId: 'quick-source', filename: 'quick-source',
      data: { ...JSON.parse(publicRow().data), cloudRef: { id: 'quick-source' } } }];
    saveDraft(value); fixture(); await mount(); await click('快速查看排行榜');
    expect(prefilter().disabled).toBe(true); expect(reads().some(request => request.kind === 'entityRating')).toBe(false);
  });

  it.each(['local-cloud-copy', 'cached-public-body'] as const)('does not grant a pivot to a freshly selected %s', async source => {
    const local: LocalCardRecordV1 = { id: 'lc_33333333333333333333333333333333', schemaVersion: 1, storageLocation: 'local', cardType: 'character', title: '本机云端副本',
      data: JSON.parse(publicRow().data), contentDigest: `sha256:${'a'.repeat(64)}`, provenance: { kind: 'unsigned', execution: 'downloaded' },
      cloudRef: { cardId: 'quick-source', copiedAt: '2026-10-01T00:00:00Z' }, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' };
    docs.set(local.id, local); fixture(); await mount(); await openRandomSection(); await click('浏览在线角色库');
    if (source === 'local-cloud-copy') {
      const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(node => node.textContent?.startsWith('本地库'))!;
      await act(async () => tab.click()); await settle();
    } else {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      await click('已缓存');
    }
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="加入"]')!.click()); await settle();
    expect(stored().combatants).toHaveLength(1);
    expect(stored().combatants[0]).not.toHaveProperty('desktopSource');
    expect(stored().combatants[0]).not.toHaveProperty('sourceDataCardId');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); await settle();
    await click('快速查看排行榜'); expect(prefilter().disabled).toBe(true);
    expect(reads().some(request => request.kind === 'entityRating')).toBe(false); expect(usage()).toHaveLength(0);
    expect(docs.get(local.id)).toEqual(local);
  });

  it('opens the real host details over the quick modal and returns focus one Escape layer at a time', async () => {
    fixture(); await mount(); const opener = button('快速查看排行榜'); opener.focus(); await click('快速查看排行榜');
    const detailsOpener = row('quick-source')!.querySelector<HTMLButtonElement>('button[aria-label]')!;
    detailsOpener.focus(); await act(async () => detailsOpener.click()); await settle();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
    const detail = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(node => node !== modal())!;
    expect(detail.contains(document.activeElement)).toBe(true); expect(detail.textContent).toContain('当前榜单：#1');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); await settle();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1); expect(modal()).toBeTruthy(); expect(document.activeElement).toBe(detailsOpener);
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(opener);
    expect(stored().combatants).toHaveLength(0); expect(usage()).toHaveLength(0);
  });

  it.each(['close', 'account'] as const)('drops a late public body after %s without admission or usage', async reason => {
    const gate = deferred<void>(); release = () => gate.resolve();
    fixture({ read: async request => {
      if (request.query?.id === 'quick-source') { await gate.promise; return { status: 200, body: { success: true, card: publicRow() } }; }
      throw new Error('Unexpected public body request');
    } });
    await mount(); await click('快速查看排行榜'); await clickToggle(); expect(toggle().textContent).toBe('处理中...');
    if (reason === 'close') { await click('关闭', modal()); expect(modal()).toBeUndefined(); }
    else {
      cloudAccount = { userId: 8, username: 'fixture-user-eight' };
      await act(async () => getDesktopCloudSessionStore().refresh()); await settle();
    }
    await act(async () => gate.resolve()); await settle();
    expect(stored().combatants).toHaveLength(0); expect(usage()).toHaveLength(0); expect(freshReads('quick-source')).toHaveLength(1);
    expect(calls()).toHaveLength(0);
  });

  it.each(['withdrawn', 'invalid-body'] as const)('does not report usage or alter the roster for a %s public card', async failure => {
    const row = publicRow();
    fixture({ read: () => ({ status: 200, body: { success: true, card: failure === 'withdrawn' ? { ...row, review_status: 'pending' } : { ...row, data: '{invalid' } } }) });
    await mount(); await click('快速查看排行榜'); await clickToggle();
    expect(stored().combatants).toHaveLength(0); expect(usage()).toHaveLength(0); expect(toggle().textContent).toBe('加入参战');
    expect(modal().querySelector('[role="alert"]')?.textContent).toContain('失败');
  });

  it('checks the latest full roster, skips usage for the rejected addition, and still allows exact removal', async () => {
    const gate = deferred<void>(); release = () => gate.resolve();
    fixture({ items: [rankingItem('quick-source'), rankingItem('random-source')], read: async request => {
      if (request.query?.id === 'quick-source') await gate.promise;
      const id = request.routeId === 'random-public-card.query' ? 'random-source' : request.query?.id ?? 'quick-source';
      return { status: 200, body: { success: true, card: publicRow(id) } };
    } });
    const base = draft('daily', 'stream'); base.combatants = Array.from({ length: 31 }, (_, index) => ({ ...base.combatants[0]!, filename: `原角色${index}` }));
    saveDraft(base); await mount(); await openRandomSection(); await click('快速查看排行榜'); await clickToggle();
    await click('随机匹配角色'); expect(stored().combatants).toHaveLength(32);
    await act(async () => gate.resolve()); await settle();
    expect(stored().combatants).toHaveLength(32); expect(stored().combatants.some(card => card.sourceDataCardId === 'quick-source')).toBe(false);
    expect(usage()).toHaveLength(0); expect(document.body.textContent).toContain('角色总数超过 32 位');
    expect(toggle('random-source').disabled).toBe(false); expect(toggle('random-source').textContent).toBe('移除/已加入');
    const before = freshReads('random-source').length; await clickToggle('random-source');
    expect(stored().combatants).toHaveLength(31); expect(freshReads('random-source')).toHaveLength(before); expect(usage()).toHaveLength(0);
  });

  it('treats an already-added concurrent source as a no-op without usage or duplicate admission', async () => {
    const gate = deferred<void>(); release = () => gate.resolve(); let publicReads = 0;
    fixture({ read: async request => {
      if (request.routeId === 'public-data-cards.query' && ++publicReads === 1) await gate.promise;
      return { status: 200, body: { success: true, card: publicRow() } };
    } });
    await mount(); await openRandomSection(); await click('快速查看排行榜'); await clickToggle(); await click('随机匹配角色');
    expect(stored().combatants).toHaveLength(1);
    await act(async () => gate.resolve()); await settle();
    expect(stored().combatants).toHaveLength(1); expect(usage()).toHaveLength(0);
    expect(modal().textContent).toContain('未能加入参战'); expect(toggle().textContent).toBe('移除/已加入');
  });

  it('removes only the exact cloud selection and leaves same-name local/cache/UI-key collisions intact', async () => {
    const base = draft('daily', 'stream');
    base.combatants = ['local', 'cache'].map(source => ({ ...base.combatants[0]!, filename: 'quick-source',
      cardLibrarySelectionId: `${source}:quick-source`, sourceDataCardId: 'quick-source', data: JSON.parse(publicRow().data) }));
    saveDraft(base); fixture(); await mount(); await click('快速查看排行榜');
    expect(toggle().textContent).toBe('加入参战'); await clickToggle(); expect(stored().combatants).toHaveLength(3);
    await clickToggle(); expect(stored().combatants).toHaveLength(2);
    expect(stored().combatants.map(card => card.cardLibrarySelectionId)).toEqual(['local:quick-source', 'cache:quick-source']);
    expect(freshReads('quick-source')).toHaveLength(1); expect(usage()).toHaveLength(1);
  });
});


describe('device report width across real Arena routes', () => {
  it('edits only in arena, preserves independent drafts, and shares the choice with battle', async () => {
    for (const key of [ARENA_DRAFT_KEY, ADVANCED_ARENA_DRAFT_KEY]) localStorage.setItem(key, JSON.stringify({ version: 1, draft: draft('daily', 'non-stream') }));
    window.location.hash = '#/arena'; const router = await mount();
    const snapshot = [localStorage.getItem(ARENA_DRAFT_KEY), localStorage.getItem(ADVANCED_ARENA_DRAFT_KEY)];
    const width = () => container.querySelector<HTMLInputElement>('input[type=number][min="360"]');
    const manual = [...container.querySelectorAll<HTMLInputElement>('input[type=radio]')].find(node => node.closest('label')?.textContent?.includes('手动指定宽度'))!;
    expect(manual).toBeTruthy(); await act(async () => manual.click()); await settle(); expect(width()?.value).toBe('500');
    const preset = [...container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find(node => node.textContent?.includes('标准 · 760px'))!;
    await act(async () => preset.click()); await settle(); expect(width()?.value).toBe('760');
    expect([localStorage.getItem(ARENA_DRAFT_KEY), localStorage.getItem(ADVANCED_ARENA_DRAFT_KEY)]).toEqual(snapshot);
    await click('生成战报'); await vi.waitFor(() => expect(container.querySelector<HTMLElement>('.result-card')?.style.maxWidth).toBe('760px'));
    expect(JSON.stringify(received)).not.toContain('battleReportCardWidth');
    await act(async () => router.navigate({ to: '/battle' })); await settle(); expect(container.textContent).not.toContain('战报卡片宽度');
    await click('生成战报'); await vi.waitFor(() => expect(container.querySelector<HTMLElement>('.result-card')?.style.maxWidth).toBe('760px'));
    await act(async () => router.navigate({ to: '/arena' })); await settle(); expect(width()?.value).toBe('760');
    const auto = [...container.querySelectorAll<HTMLInputElement>('input[type=radio]')].find(node => node.closest('label')?.textContent?.includes('自动宽度'))!;
    await act(async () => auto.click()); await settle(); expect(width()).toBeNull();
    expect(JSON.parse(localStorage.getItem(ARENA_REPORT_CARD_WIDTH_KEY)!)).toEqual({ battleReportCardWidthMode: 'auto', battleReportCardWidthPx: 760 });
    expect(container.querySelector<HTMLElement>('.result-card')?.style.maxWidth).toBe('100%');
  });
  it.each([['stream', 'web'], ['non-stream', 'web'], ['stream', 'markdown'], ['non-stream', 'markdown']] as const)('passes saved manual width to the real %s/%s report surface', async (generationMode, reportFormat) => {
    localStorage.setItem(ARENA_REPORT_CARD_WIDTH_KEY, JSON.stringify({ battleReportCardWidthMode: 'manual', battleReportCardWidthPx: 640 }));
    const value = draft('daily', generationMode); value.reportFormat = reportFormat; saveDraft(value); await mount(); await click('生成战报');
    await vi.waitFor(() => {
      if (reportFormat === 'web') expect(container.querySelector('[data-testid="arena-web-result"]')).not.toBeNull();
      else expect(container.querySelector('.result-card')?.textContent).toContain(text);
    });
    expect(container.querySelector<HTMLElement>('.result-card')?.style.maxWidth).toBe('640px');
    expect(JSON.stringify(received)).not.toContain('battleReportCardWidth');
  });
});

it('角色云端未知结果期间，草稿清除与连续故事入口不能确认或丢弃原结果', async () => {
  cloudAccount = { userId: 7, username: 'fixture-user-seven' };
  saveDraft(draft('daily', 'non-stream'));
  const originalInvoke = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((command, args) => command === 'cloud_card_library_request'
    ? Promise.resolve(args.request.routeId === 'user-capacity.query'
      ? { status: 200, body: { success: true, capacity: 10, usedSlots: 0 } }
      : { status: 503, body: {} })
    : originalInvoke(command, args));
  await mount();
  const originalSet = Storage.prototype.setItem;
  const failingDraft = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key === ARENA_DRAFT_KEY) throw new Error('fixture draft disk full');
    originalSet.call(this, key, value);
  });
  await click('生成战报'); await vi.waitFor(() => expect(container.textContent).toContain('生成完成。'));
  const roleToggle = container.querySelector<HTMLButtonElement>('section[aria-label$="的战后变化"] button[aria-expanded]')!;
  expect(roleToggle.getAttribute('aria-expanded')).toBe('false');
  await act(async () => roleToggle.click()); await settle();
  expect(roleToggle.getAttribute('aria-expanded')).toBe('true');
  await click('保存到云端'); await click('保存');
  await vi.waitFor(() => expect(document.body.textContent).toContain('结果不确定'));
  await click('取消');
  const repairToggle = [...container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].find(node => node.textContent?.startsWith('自定义修复本次角色变化'))!;
  await act(async () => repairToggle.click()); await settle();
  expect(container.querySelector<HTMLTextAreaElement>('[data-arena-combatant-updates] textarea')!.disabled).toBe(true);
  expect(button('应用修复').disabled).toBe(true);
  await click('应用修复');
  await click('下载会话备份'); const before = JSON.parse(mocks.download.mock.calls.at(-1)![1]);
  const notice = container.querySelector('[aria-label="本机草稿提示"]')!;
  expect(button('清除草稿', notice).disabled).toBe(true);
  vi.mocked(window.confirm).mockClear();
  await click('清除草稿', notice); await click('新建连续战报');
  expect(window.confirm).not.toHaveBeenCalled();
  await click('下载会话备份'); const after = JSON.parse(mocks.download.mock.calls.at(-1)![1]);
  expect(after.result.rawText).toBe(before.result.rawText); expect(after.candidates).toEqual(before.candidates);
  expect(received).toHaveLength(1); expect(storyPort.heads()).toHaveLength(0);
  expect(mocks.invoke.mock.calls.filter(([command, args]) => command === 'cloud_card_library_request' && args.request.routeId === 'data-cards.create')).toHaveLength(1);
  failingDraft.mockRestore();
});

// Manual repair stays on real routes, default session/domain and local-library IPC.
// Only the external Provider/Native peer and file download sink are synthetic.
describe('manual repair on actual battle and arena routes', () => {
  const generationId = `arena_${'f'.repeat(64)}`;
  const longBody = '甲与乙共同面对挑战，并在事件结束后保留各自的设定。'.repeat(12);
  const repairInput = (impact = '手工修复后的影响') => JSON.stringify({ impacts: [{ combatantIndex: 0, characterName: '甲', impact }] });
  const repairToggle = () => [...container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].find(node => node.textContent?.startsWith('自定义修复本次角色变化'))!;
  const openRepair = async () => { expect(repairToggle()).toBeTruthy(); if (repairToggle().getAttribute('aria-expanded') === 'false') { await act(async () => repairToggle().click()); await settle(); } };
  const editRepair = async (value: string) => change('[data-arena-combatant-updates] textarea', value);
  const openRole = async () => {
    const toggle = container.querySelector<HTMLButtonElement>('section[aria-label="甲的战后变化"] button[aria-expanded]')!;
    expect(toggle).toBeTruthy(); if (toggle.getAttribute('aria-expanded') === 'false') { await act(async () => toggle.click()); await settle(); }
    return container.querySelector<HTMLElement>('section[aria-label="甲的战后变化"]')!;
  };
  const completeExport = async () => { await click('下载会话备份'); return JSON.parse(mocks.download.mock.calls.at(-1)![1]); };
  const installHostedRepairPeer = (failReconcileOnce = false) => {
    vi.stubGlobal('TextEncoder', class extends NodeTextEncoder { encode(input?: string) { return Uint8Array.from(super.encode(input)); } });
    const original = mocks.invoke.getMockImplementation()!;
    const peer = withFixtureStreamReceipt(async (_command: string, args: Record<string, any>) => {
      const request = args.request, channel = args.onEvent; let sequence = 0;
      const send = (value: Record<string, unknown>) => channel.onmessage({ requestId: request.requestId, sequence: sequence++, ...value });
      const respond = (body: unknown, status = 200) => {
        send({ kind: 'json-response', status, generationId, generationRequestId: request.requestId, recoveryCredentialState: 'stored' });
        send({ kind: 'json-fragment', text: JSON.stringify(body), final: true }); send({ kind: 'json-end' });
      };
      if (request.operation === 'reconcile') {
        if (failReconcileOnce) { failReconcileOnce = false; respond({ version: 'arena-reconciliation-v1', generationId, code: 'FINALIZATION_PENDING', error: '等待服务器结算' }, 409); return; }
        respond({ version: 'arena-reconciliation-v1', generationId, success: true, warnings: [], updatedCombatants: [{ combatantIndex: 0, isNative: true,
          data: { ...request.combatants[0].data, signature: 'synthetic-official-signature', metadata: { signature: 'legacy-signature' },
            arena_history: { entries: [{ id: 1, impact: '服务器原影响', metadata: { generation_id: generationId } }] }, current_state: { summary: '安心', generation_id: generationId } } }] });
        return;
      }
      respond({ version: 'arena-companion-v1', body: { generationId, updatedCombatants: [], report: {
        headline: '车站重逢', reporterInfo: { name: '记者', publication: '刊物' }, mode: 'daily', article: { body: longBody, analysis: '彼此扶持' }, officialReport: { winner: '甲', conclusion: '合作' },
      } }, metadata: { reportFormat: 'markdown', outputContract: 'structured-report', mode: 'daily' } });
    });
    mocks.invoke.mockImplementation((command, args, options) => command === 'arena_hosted_stream' && ['create-json', 'reconcile'].includes(args.request.operation)
      ? peer(command, args) : original(command, args, options));
  };
  const prepare = async (product: 'battle' | 'arena', hosted = false, effects = true, failReconcileOnce = false) => {
    markdownSuffix = longBody;
    const input = draft('daily', 'non-stream'); input.settings.writeArenaHistory = effects; input.settings.writeCurrentState = effects;
    localStorage.setItem(product === 'arena' ? ADVANCED_ARENA_DRAFT_KEY : ARENA_DRAFT_KEY, JSON.stringify({ version: 1, draft: input }));
    window.location.hash = `#/${product}`; if (hosted) installHostedRepairPeer(failReconcileOnce);
    const router = await mount(); if (hosted) await click('服务器');
    await click('生成战报'); await vi.waitFor(() => expect(repairToggle()).toBeTruthy()); await settle(); await openRepair();
    return router;
  };

  for (const product of ['battle', 'arena'] as const) it.each([false, true])(`/${product} hosted=%s applies, displays, downloads and explicitly saves unsigned without replacing original candidates`, async hosted => {
    await prepare(product, hosted);
    const before = await completeExport(), callsBefore = mocks.invoke.mock.calls.filter(([command]) => ['stream_direct_ai', 'stream_target_ai', 'arena_hosted_stream'].includes(command)).length;
    await editRepair(repairInput()); expect(docs.size).toBe(0);
    vi.mocked(window.confirm).mockReturnValue(true); await click('应用修复');
    await vi.waitFor(() => expect(container.textContent).toContain('已应用 1 位角色的非原生修复'));
    const role = await openRole(); expect(role.textContent).toContain('手工修复后的影响'); expect(role.textContent).toContain('未签名');
    expect(docs.size).toBe(0); await click('下载更新设定', role);
    const downloaded = JSON.parse(mocks.download.mock.calls.at(-1)![1]);
    expect(downloaded).not.toHaveProperty('signature'); expect(downloaded.metadata ?? {}).not.toHaveProperty('signature');
    expect(downloaded.arena_history.entries.at(-1).impact).toBe('手工修复后的影响');
    await click('另存此修复副本到本地库', role); await vi.waitFor(() => expect(docs.size).toBe(1));
    expect([...docs.values()][0]!.provenance).toEqual({ kind: 'unsigned', execution: 'edited' }); expect([...docs.values()][0]!.data).toEqual(downloaded);
    const after = await completeExport(); expect(after.candidates).toEqual(before.candidates); expect(after.result.roleUpdates).toEqual(before.result.roleUpdates);
    expect(after.result.repairs.items[0].data).toEqual(downloaded); expect(after.draft.combatants[1]).toEqual(before.draft.combatants[1]);
    if (hosted) { expect(button('重试角色更新').disabled).toBe(true); await click('重试角色更新'); }
    expect(mocks.invoke.mock.calls.filter(([command]) => ['stream_direct_ai', 'stream_target_ai', 'arena_hosted_stream'].includes(command))).toHaveLength(callsBefore);
  });

  it.each([false, true])('late Hosted retry seeds only untouched drafts; userEdited=%s', async userEdited => {
    await prepare('battle', true, true, true);
    const textarea = () => container.querySelector<HTMLTextAreaElement>('[data-arena-combatant-updates] textarea')!;
    expect(textarea().value).toBe('');
    if (userEdited) await editRepair(repairInput('用户先输入的草稿'));
    await click('重试角色更新'); await vi.waitFor(() => expect(container.textContent).toContain('角色更新已应用'));
    await vi.waitFor(() => expect(textarea().value).toContain(userEdited ? '用户先输入的草稿' : '服务器原影响'));
    expect(textarea().value).not.toContain(userEdited ? '服务器原影响' : '用户先输入的草稿');
    expect(docs.size).toBe(0);
  });

  it('no-op changes neither roster trust nor save records', async () => {
    await prepare('battle'); const before = await completeExport(); vi.mocked(window.confirm).mockClear();
    await click('应用修复'); await vi.waitFor(() => expect(container.textContent).toContain('未改变其信任状态'));
    expect(window.confirm).not.toHaveBeenCalled(); expect((await completeExport()).draft).toEqual(before.draft); expect(docs.size).toBe(0);
  });

  it('missing effect asks explicitly and cancel leaves the original native-looking source untouched', async () => {
    await prepare('battle', false, false); const before = await completeExport(); await editRepair(repairInput());
    vi.mocked(window.confirm).mockReturnValueOnce(true).mockReturnValueOnce(false);
    await click('应用修复'); await vi.waitFor(() => expect(container.textContent).toContain('已取消，角色未修改'));
    expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining('创建明确标记的自定义 effect'));
    expect((await completeExport()).draft).toEqual(before.draft); expect(docs.size).toBe(0);
    vi.mocked(window.confirm).mockReturnValue(true); await click('应用修复');
    await vi.waitFor(() => expect(container.textContent).toContain('已应用 1 位角色'));
    expect((await completeExport()).draft.combatants[0].data.arena_history.entries).toHaveLength(1);
  });

  it('new report resets the repair draft; pending old apply is discarded when the route owner unmounts', async () => {
    await prepare('battle'); await editRepair(repairInput()); await click('应用修复');
    await vi.waitFor(() => expect(container.textContent).toContain('已应用 1 位角色'));
    vi.mocked(window.confirm).mockReturnValue(true);
    const prepared = vi.spyOn(getDesktopAiConfigStore(), 'withPreparedGeneration');
    await click('生成战报'); expect(prepared).toHaveBeenCalledOnce();
    await act(async () => { await prepared.mock.results[0]!.value; });
    expect(received).toHaveLength(2); await settle(); await openRepair();
    expect(container.querySelector<HTMLTextAreaElement>('[data-arena-combatant-updates] textarea')!.value).not.toContain('手工修复后的影响');
    const before = localStorage.getItem(ARENA_DRAFT_KEY);
    // Force a trust-bearing current source by using a new real route/Hosted result, not a fake session.
    await act(async () => root.unmount()); root = createRoot(container);
    await prepare('arena', true); await editRepair(repairInput());
    const gate = deferred<boolean>(); vi.mocked(window.confirm).mockImplementation(() => gate.promise as unknown as boolean);
    await click('应用修复'); expect(button('生成战报').disabled).toBe(true);
    const stored = localStorage.getItem(ADVANCED_ARENA_DRAFT_KEY);
    await act(async () => root.unmount()); root = createRoot(container);
    await act(async () => gate.resolve(true)); await settle();
    expect(localStorage.getItem(ADVANCED_ARENA_DRAFT_KEY)).toBe(stored); expect(localStorage.getItem(ARENA_DRAFT_KEY)).toBe(before); expect(docs.size).toBe(0);
  });
});

// Random placeholders exercise the real shared roster and Desktop submission boundary.
describe('桌面随机占位符共源旅程', () => {
  const stored = (product: 'battle' | 'arena') => JSON.parse(localStorage.getItem(product === 'battle' ? ARENA_DRAFT_KEY : ADVANCED_ARENA_DRAFT_KEY)!);
  it.each(['battle', 'arena'] as const)('/%s 空列表可添加两种占位符，提交前一次物化且重试沿用同一正文', async product => {
    const empty = createInitialArenaDraft();
    // Isolate random identity from the existing, separately tested post-battle history updates.
    localStorage.setItem(product === 'battle' ? ARENA_DRAFT_KEY : ADVANCED_ARENA_DRAFT_KEY, JSON.stringify({ version: 1,
      draft: { ...empty, settings: { ...empty.settings, writeArenaHistory: false, writeCurrentState: false } } }));
    window.location.hash = `#/${product}`; await mount();
    await click('+ 添加随机魔法少女'); await click('+ 添加随机残兽');
    const pending = stored(product);
    expect(pending.version).toBe(2);
    expect(pending.draft.combatants.map((item: { type: string }) => item.type)).toEqual(['random-magical-girl', 'random-canshou']);
    expect(pending.draft.combatants.every((item: object) => !('data' in item))).toBe(true);
    expect(button('生成战报').disabled).toBe(false); expect(calls()).toHaveLength(0);
    await click('生成战报'); await vi.waitFor(() => expect(received, container.querySelector('.error-message')?.textContent ?? '').toHaveLength(1));
    await vi.waitFor(() => expect(container.textContent).toContain('生成完成。')); await settle();
    const installed = stored(product).draft.combatants;
    expect(stored(product).version).toBe(1);
    expect(installed.map((item: { type: string }) => item.type)).toEqual(['magical-girl', 'canshou']);
    expect(installed.every((item: { isValid: boolean; isPreset: boolean }) => !item.isValid && !item.isPreset && !('id' in item) && !('desktopSource' in item))).toBe(true);
    const firstInput = JSON.parse(received[0]!.arenaInputJson!);
    expect(firstInput.combatants.map((item: { data: unknown }) => item.data)).toEqual(installed.map((item: { data: unknown }) => item.data));
    vi.mocked(window.confirm).mockReturnValue(true);
    await click('生成战报'); await vi.waitFor(() => expect(received).toHaveLength(2));
    expect(JSON.parse(received[1]!.arenaInputJson!).combatants).toEqual(firstInput.combatants);
  });

  it('普通 Hosted 共用物化入口，只向原生桥提交冻结实卡，失败后不重抽', async () => {
    localStorage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, JSON.stringify({ version: 2, selection: { executionPreference: 'server', clientConnectionId: 'loopback' }, hiddenPresetIds: [] }));
    const native = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((command, args, options) => {
      if (command === 'arena_hosted_stream' && ['create-json', 'create-stream'].includes(args.request.operation))
        throw { code: 'capability-unavailable', message: 'synthetic dispatch boundary', dispatchState: 'not-dispatched', intentOwnership: 'current-owned' };
      return native(command, args, options);
    });
    const creates = () => mocks.invoke.mock.calls.filter(([command, args]) => command === 'arena_hosted_stream' && ['create-json', 'create-stream'].includes(args.request.operation));
    await mount(); await click('+ 添加随机魔法少女'); await click('+ 添加随机残兽');
    await click('生成战报'); await vi.waitFor(() => expect(creates(), container.querySelector('.error-message')?.textContent ?? '').toHaveLength(1)); await settle();
    const installed = stored('battle').draft.combatants;
    expect(installed.map((item: { type: string }) => item.type)).toEqual(['magical-girl', 'canshou']);
    expect(JSON.stringify(creates()[0]![1].request)).not.toContain('random-magical-girl');
    expect(JSON.stringify(creates()[0]![1].request)).not.toContain('random-canshou');
    vi.mocked(window.confirm).mockReturnValue(true);
    await click('生成战报'); await vi.waitFor(() => expect(creates()).toHaveLength(2));
    expect(stored('battle').draft.combatants).toEqual(installed);
    expect(creates()[1]![1].request.body.combatants).toEqual(creates()[0]![1].request.body.combatants);
    expect(creates()[0]![1].request.body.combatants.map((item: { data: unknown }) => item.data)).toEqual(installed.map((item: { data: unknown }) => item.data));
    expect(received).toHaveLength(0);
  });

  it('取消替换现有结果不物化', async () => {
    saveDraft(draft('daily', 'non-stream')); await mount(); await click('生成战报');
    await vi.waitFor(() => expect(container.textContent).toContain('生成完成。'));
    await click('+ 添加随机魔法少女'); const before = stored('battle').draft.combatants;
    await click('生成战报'); expect(window.confirm).toHaveBeenCalled();
    expect(stored('battle').draft.combatants).toEqual(before); expect(received).toHaveLength(1);
  });

  it('32 人满额按钮禁用，移除后可继续添加', async () => {
    const full = { ...createInitialArenaDraft(), combatants: Array.from({ length: 32 }, (_, index) => ({ type: 'random-canshou', id: `slot-${index}`, filename: '随机残兽' })) };
    localStorage.setItem(ARENA_DRAFT_KEY, JSON.stringify({ version: 2, draft: full })); await mount();
    expect(button('+ 添加随机魔法少女').disabled).toBe(true); expect(button('+ 添加随机残兽').disabled).toBe(true);
    const remove = container.querySelector<HTMLButtonElement>('button[aria-label="移除 随机残兽"]')!;
    expect(remove).toBeTruthy(); await act(async () => remove.click()); await settle();
    expect(stored('battle').draft.combatants).toHaveLength(31); expect(button('+ 添加随机残兽').disabled).toBe(false);
  });
});
