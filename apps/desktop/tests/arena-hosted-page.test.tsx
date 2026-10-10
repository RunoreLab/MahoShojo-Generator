// @vitest-environment jsdom
/** Real router/shared DOM/session/Hosted adapter/C0/bridge → synthetic IPC → loopback HTTP.
 * Not Rust, real Tauri, OS credential, production account or model acceptance. */
import { ARENA_COMPANION_PROTOCOL_VERSION, ARENA_COMPANION_PROTOCOL_HEADER, ArenaCompanionEnvelopeSchema, type ArenaCompanionEnvelope } from '@mahoshojo/contracts/arena-companion';
import { DesktopArenaHostedJsonCreateRequestSchema, DesktopArenaHostedJsonChannelEventSchema, DesktopArenaHostedAnyRecoveryPointerSchema, type DesktopArenaHostedJsonCreateRequest } from '@mahoshojo/contracts/desktop-arena-hosted-json';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopArenaHostedChannelEventSchema, DesktopArenaHostedControlRequestSchema, DesktopArenaHostedControlResponseSchema,
  DesktopArenaHostedRecoveryHintRequestSchema, DesktopArenaHostedRecoveryHintSchema,
  DesktopArenaHostedRecoveryPointerSchema, DesktopArenaHostedSseEventSchema, DesktopArenaHostedStreamRequestSchema,
  type DesktopArenaHostedControlRequest, type DesktopArenaHostedRecoveryHint, type DesktopArenaHostedStreamRequest } from '@mahoshojo/contracts/desktop-arena-hosted';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import { createDesktopRouter } from '../src/app/router';
import { ADVANCED_ARENA_DRAFT_KEY, ARENA_DRAFT_KEY, createInitialArenaDraft, type ArenaDraft } from '../src/features/arena/session';
import { ARENA_HOSTED_RECOVERY_KEYS } from '../src/features/arena/hosted-recovery';
import { DESKTOP_AI_CONFIG_STORAGE_KEY } from '../src/features/ai-config/desktop-ai-config-store';
import { getDesktopAiConfigStore, resetDesktopAiConfigStoreForTests } from '../src/features/ai-config/use-desktop-ai-config';
import { getDesktopCloudSessionStore, resetDesktopCloudSessionStoreForTests } from '../src/features/account/use-desktop-cloud-session';
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), hint: vi.fn(), download: vi.fn(), downloadBinary: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, isTauri: () => true, Channel: class { onmessage?: (value: unknown) => void; } }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: mocks.listen }) }));
vi.mock('../src/platform/download-text-file', () => ({ downloadTextFile: mocks.download, downloadBinaryFile: mocks.downloadBinary }));
type Product = 'battle' | 'arena';
type Funding = 'system' | 'preset';
const nativeFetch = globalThis.fetch, generationId = `arena_${'a'.repeat(64)}`;
const markdown = '# 车站重逢\n\n甲与乙共同守护车站。';
const web = '<!doctype html><html><head><title>车站重逢</title></head><body><script>globalThis.hostedMustNotRun=true</script><img src="https://untrusted.invalid/tracker.png"/>甲与乙共同守护车站。</body></html>';
const draftKey = (product: Product) => product === 'arena' ? ADVANCED_ARENA_DRAFT_KEY : ARENA_DRAFT_KEY;
let root: Root, container: HTMLDivElement, server: Server, endpoint: string;
let holdFirstChunk = false, nativeResponseCount = 0;
let saveBarrier: Promise<void> | null = null;
let releaseSave: (() => void) | null = null;
let accountId: number | null, hold: boolean, failSave: boolean, activeCloseHandles: number;
let webOverride: string | null;
let streamRequests: (DesktopArenaHostedStreamRequest | DesktopArenaHostedJsonCreateRequest)[], controlRequests: DesktopArenaHostedControlRequest[];
let httpRequests: { method: string; path: string; body: Record<string, unknown> | null }[];
let docs: Map<string, LocalCardRecordV1>, released: (() => void)[], pendingNative: Set<Promise<unknown>>;
let output: { requestId: string; text: string };
let companion: ArenaCompanionEnvelope | null = null;
const adjudications = [{ depth: 0, description: '服务端未知类型记录', type: 'legacy-unknown', roll: 51, outcome: '未知', details: '' }];
const wire = (id: string, event: string, data: unknown) => {
  const checked = DesktopArenaHostedSseEventSchema.parse({ id, event, data });
  return `id: ${checked.id}\nevent: ${checked.event}\ndata: ${JSON.stringify(checked.data)}\n\n`;
};
beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ''; req.on('data', part => { body += part; }); req.on('end', () => {
      const value = body ? JSON.parse(body) as Record<string, unknown> : null, path = req.url!;
      httpRequests.push({ method: req.method!, path, body: value });
      const jsonCreate = req.method === 'POST' && path === '/api/generate-battle-story';
      if (jsonCreate) {
        expect(req.headers[ARENA_COMPANION_PROTOCOL_HEADER.toLowerCase()]).toBe(ARENA_COMPANION_PROTOCOL_VERSION);
        const body = value!.reportFormat === 'web' ? webOverride ?? web : markdown;
        const report = { headline: '车站重逢', reporterInfo: { name: '服务端记者', publication: '服务端日报' },
          article: { body, analysis: '完整非流分析' }, officialReport: { winner: '甲', conclusion: '完整非流结论' }, mode: value!.mode,
          ...(value!.reportFormat === 'web' ? { reportFormat: 'web', webHtml: body } : {}),
          aiReasoning: { status: 'complete', text: '完整非流推理' } };
        companion = ArenaCompanionEnvelopeSchema.parse({ version: ARENA_COMPANION_PROTOCOL_VERSION,
          body: { report, updatedCombatants: [], generationId, adjudicationResults: adjudications }, metadata: { reportFormat: value!.reportFormat,
            outputContract: value!.reportFormat === 'web' ? 'web-document' : 'structured-report', mode: value!.mode,
            scenarioDisplayName: '仅完整元数据保留的情景', language: 'zh-CN', storyLength: 'medium', adjudicationResults: adjudications } });
        output = { requestId: value!.generationRequestId as string, text: value!.reportFormat === 'web' ? body : JSON.stringify({ headline: report.headline, article: report.article, officialReport: report.officialReport }) };
        const finish = () => { res.setHeader('content-type', 'application/json'); res.setHeader(ARENA_COMPANION_PROTOCOL_HEADER, ARENA_COMPANION_PROTOCOL_VERSION);
          res.setHeader('X-Mahoshojo-Generation-Id', generationId); res.setHeader('X-Mahoshojo-Generation-Request-Id', output.requestId); res.end(JSON.stringify(companion)); };
        if (hold || holdFirstChunk) released.push(finish); else finish(); return;
      }
      const create = req.method === 'POST' && path === '/api/arena/generate-stream';
      if (create) output = { requestId: value!.generationRequestId as string, text: value!.reportFormat === 'web' ? webOverride ?? web : markdown };
      if (create || path.includes('/stream')) {
        res.setHeader('content-type', 'text/event-stream'); res.setHeader('X-Mahoshojo-Generation-Id', generationId); res.setHeader('X-Mahoshojo-Generation-Request-Id', output.requestId);
        if (holdFirstChunk) { res.flushHeaders(); released.push(() => { res.write(wire('1-0', 'markdown', { chunk: output.text })); res.end(wire('2-0', 'done', { ok: true, status: 'completed' })); }); return; }
        res.write(wire('1-0', 'markdown', { chunk: output.text }));
        const finish = () => res.end(wire('2-0', 'done', { ok: true, status: 'completed' }));
        if (hold) released.push(finish); else finish(); return;
      }
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST' || req.method === 'DELETE') res.statusCode = 202;
      res.end(JSON.stringify({ status: res.statusCode === 202 ? 'cancelling' : 'running', generationId, generationRequestId: output.requestId }));
    });
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { await new Promise<void>(done => server.close(() => done())); });
const button = (text: string, scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find(entry => entry.textContent?.trim() === text);
const settle = async () => { await act(async () => { await new Promise(done => setTimeout(done, 25)); }); };
const click = async (text: string, scope?: ParentNode) => { expect(button(text, scope), text).toBeTruthy(); await act(async () => button(text, scope)!.click()); await settle(); };
const openSection = async (name: string) => {
  const section = [...document.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].find(item => item.textContent?.includes(name));
  if (section?.getAttribute('aria-expanded') === 'false') { await act(async () => section.click()); await settle(); }
};
const mount = async (product: Product = 'battle') => {
  window.location.hash = `#/${product}`; const router = createDesktopRouter(); await router.load(); await act(async () => root.render(<StrictMode><RouterProvider router={router} /></StrictMode>));
  await vi.waitFor(() => expect(container.textContent).toContain('生成战报')); await settle(); return router;
};
const configure = (funding: Funding = 'system') => {
  localStorage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, JSON.stringify({ version: 5,
    selection: { executionPreference: 'server', clientTarget: { kind: 'preset', providerId: 'deepseek' }, serverTarget: funding === 'preset' ? { kind: 'preset', providerId: 'deepseek' } : { kind: 'system' } },
    hiddenPresetIds: [], presetsByProviderId: { deepseek: { selectedModelId: 'deepseek-chat', generationOverrides: {} } } })); resetDesktopAiConfigStoreForTests();
};
const draft = (mode: ArenaDraft['battleMode'] = 'daily', format: ArenaDraft['reportFormat'] = 'markdown'): ArenaDraft => ({
  ...createInitialArenaDraft(), battleMode: mode, generationMode: 'non-stream', reportFormat: format,
  combatants: ['甲', '乙'].map(name => ({ type: 'general-character', data: { templateId: '通用角色', name, content: '完整设定', signature: 'source-signature' }, isValid: false, isPreset: false, filename: name })),
  scenario: { content: mode === 'scenario' ? { title: '车站', content: '雨中重逢' } : null, fileName: null },
  adjudicationEvents: [{ id: 'server-only-roll', type: 'binary', description: '服务器判定一次', probability: 50 }],
  settings: { ...createInitialArenaDraft().settings, writeArenaHistory: true, writeCurrentState: true, writeNarrativeHistory: true },
});
const saveDraft = (value: ArenaDraft, product: Product = 'battle') => localStorage.setItem(draftKey(product), JSON.stringify({ version: 1, draft: value }));
const exportResult = async () => { await click('完整导出 JSON'); return JSON.parse(mocks.download.mock.calls.at(-1)![1]); };
const restoreAndSelectStream = async () => {
  await click('恢复草稿'); await openSection('⚡ 生成方式');
  expect(button('生成战报')!.disabled).toBe(false); expect(button('非流式')!.disabled).toBe(false); expect(button('非流式')!.getAttribute('aria-pressed')).toBe('true');
  await click('流式'); expect(button('生成战报')!.disabled, container.textContent ?? '').toBe(false);
};
const releaseAll = () => { released.splice(0).forEach(finish => finish()); };
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); localStorage.clear(); holdFirstChunk = false; nativeResponseCount = 0; saveBarrier = null; releaseSave = null; accountId = null; hold = false; failSave = false; activeCloseHandles = 0; webOverride = null;
  companion = null; streamRequests = []; controlRequests = []; httpRequests = []; docs = new Map(); released = []; pendingNative = new Set(); configure(); resetDesktopCloudSessionStoreForTests();
  mocks.hint.mockReset().mockImplementation(async (product: Product) => ({ product, state: 'none' }));
  mocks.listen.mockImplementation(async () => { activeCloseHandles += 1; return vi.fn(() => { activeCloseHandles -= 1; }); }); mocks.download.mockResolvedValue(undefined);
  mocks.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'list_provider_profile_ids') return [];
    if (command === 'has_provider_secret') return true;
    if (command === 'cloud_cached_account') return accountId === null ? null : { account: { userId: accountId, username: 'synthetic-account' } };
    if (command === 'cloud_auth_status') return accountId === null ? { state: 'signed-out' } : { state: 'active', account: { userId: accountId, username: 'synthetic-account' } };
    if (command === 'cloud_sign_out') { accountId = null; return { revoked: true }; }
    if (command === 'list_local_cards') { const request = args!.request as { cardTypes: string[] }; return { documents: [...docs.values()].filter(card => !request.cardTypes.length || request.cardTypes.includes(card.cardType)).map(card => JSON.stringify(card)) }; }
    if (command === 'get_local_card') return docs.has(args!.id as string) ? JSON.stringify(docs.get(args!.id as string)) : null;
    if (command === 'save_local_card') {
      if (saveBarrier) await saveBarrier;
      if (failSave) throw new Error('synthetic-disk-full'); const request = args!.request as { document: string; writeMode: string }; expect(request.writeMode).toBe('insert-if-absent');
      const card = JSON.parse(request.document) as LocalCardRecordV1, alreadyPresent = docs.has(card.id); if (!alreadyPresent) docs.set(card.id, card); return { id: card.id, alreadyPresent };
    }
    if (command === 'list_web_packages') return { documents: [] };
    if (command === 'arena_hosted_recovery_hint') {
      const request = DesktopArenaHostedRecoveryHintRequestSchema.parse(args?.request);
      return DesktopArenaHostedRecoveryHintSchema.parse(await mocks.hint(request.product));
    }
    if (command === 'arena_hosted_detach') return; // Deliberately no server cancellation.
    if (command === 'arena_hosted_control') {
      const request = DesktopArenaHostedControlRequestSchema.parse(args?.request); controlRequests.push(request);
      const route = request.operation === 'lookup-request' ? `/api/arena/generation-requests/${request.requestId}` : request.operation === 'status' ? `/api/arena/generations/${request.generationId}` : request.generationId ? `/api/arena/generations/${request.generationId}/cancel` : '/api/arena/generate-stream';
      const method = request.operation !== 'stop' ? 'GET' : request.generationId ? 'POST' : 'DELETE';
      const response = await nativeFetch(endpoint + route, { method, ...(method !== 'GET' ? { body: JSON.stringify({ generationRequestId: request.requestId, reason: 'user' }) } : {}) });
      return DesktopArenaHostedControlResponseSchema.parse({ status: response.status, body: await response.json(), recoveryCredentialState: 'stored' });
    }
    if (command === 'arena_hosted_stream') {
      const request = (args?.request as { operation?: string })?.operation === 'create-json'
        ? DesktopArenaHostedJsonCreateRequestSchema.parse(args?.request) : DesktopArenaHostedStreamRequestSchema.parse(args?.request); streamRequests.push(request);
      if (request.operation === 'create-stream' || request.operation === 'create-json') expect(DesktopArenaHostedAnyRecoveryPointerSchema.parse(JSON.parse(localStorage.getItem(ARENA_HOSTED_RECOVERY_KEYS[request.product])!))).toMatchObject({ requestId: request.requestId, actor: request.actor });
      const run = (async () => {
        if (request.operation === 'create-json') {
          const response = await nativeFetch(endpoint + '/api/generate-battle-story', { method: 'POST', headers: { [ARENA_COMPANION_PROTOCOL_HEADER]: ARENA_COMPANION_PROTOCOL_VERSION },
            body: JSON.stringify({ ...request.body, generationRequestId: request.requestId }) });
          const channel = args!.onEvent as { onmessage(value: unknown): void }; let sequence = 0;
          const send = (value: Record<string, unknown>) => channel.onmessage(DesktopArenaHostedJsonChannelEventSchema.parse({ requestId: request.requestId, sequence: sequence++, ...value }));
          nativeResponseCount += 1;
          send({ kind: 'json-response', status: response.status, generationId: response.headers.get('X-Mahoshojo-Generation-Id'), generationRequestId: response.headers.get('X-Mahoshojo-Generation-Request-Id'), recoveryCredentialState: 'stored' });
          const raw = await response.text(); ArenaCompanionEnvelopeSchema.parse(JSON.parse(raw));
          for (let offset = 0; offset < raw.length; offset += 31) send({ kind: 'json-fragment', text: raw.slice(offset, offset + 31), final: offset + 31 >= raw.length });
          send({ kind: 'json-end' }); return;
        }
        const route = request.operation === 'create-stream' ? '/api/arena/generate-stream' : `/api/arena/generations/${request.generationId}/stream${request.after ? `?after=${request.after}` : ''}`;
        const response = await nativeFetch(endpoint + route, request.operation === 'create-stream' ? { method: 'POST', body: JSON.stringify({ ...request.body, generationRequestId: request.requestId }) } : undefined);
        const channel = args!.onEvent as { onmessage(value: unknown): void }; let sequence = 0;
        const send = (value: Record<string, unknown>) => channel.onmessage(DesktopArenaHostedChannelEventSchema.parse({ requestId: request.requestId, sequence: sequence++, ...value }));
        nativeResponseCount += 1;
        send({ kind: 'response', status: response.status, generationId: response.headers.get('X-Mahoshojo-Generation-Id'), generationRequestId: response.headers.get('X-Mahoshojo-Generation-Request-Id'), metadataState: 'missing', recoveryCredentialState: 'stored' });
        const reader = response.body!.getReader(), decoder = new TextDecoder(); let buffer = '';
        while (true) {
          const next = await reader.read(); if (next.done) break; buffer += decoder.decode(next.value, { stream: true }); let boundary = buffer.indexOf('\n\n');
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary + 2); buffer = buffer.slice(boundary + 2);
            for (let offset = 0; offset < block.length; offset += 17) send({ kind: 'sse-fragment', text: block.slice(offset, offset + 17), final: offset + 17 >= block.length });
            boundary = buffer.indexOf('\n\n');
          }
        }
        expect(buffer).toBe(''); send({ kind: 'stream-end' });
      })();
      pendingNative.add(run); try { await run; } finally { pendingNative.delete(run); } return;
    }
    if (/^(stream_target_ai|stream_direct_ai|stream_hosted_ai|hosted_ai_request|begin_web_package_instance|open_web_package_instance)$/.test(command)) throw new Error(`Forbidden alternative execution: ${command}`);
    return undefined;
  });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input); if (url === '/languages.json') return new Response(JSON.stringify([{ code: 'zh-CN', name: '简体中文' }]));
    if (url.startsWith('/presets/') || url.startsWith('/scenario-presets/') || url.startsWith('/questionnaires/')) return new Response(readFileSync(resolve(process.cwd(), '../../content', url.slice(1)), 'utf8'));
    throw new Error(`Renderer must not fetch Hosted APIs or the network: ${url}`);
  }));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); HTMLElement.prototype.scrollIntoView = vi.fn(); vi.spyOn(window, 'confirm').mockReturnValue(false);
  HTMLDialogElement.prototype.showModal = function () { this.open = true; }; HTMLDialogElement.prototype.close = function () { this.open = false; };
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => { root.unmount(); releaseAll(); releaseSave?.(); if (saveBarrier) await saveBarrier; await Promise.allSettled([...pendingNative]); }); expect(activeCloseHandles).toBe(0); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const matrix = (['battle', 'arena'] as const).flatMap(product =>
  (['classic', 'kizuna', 'daily', 'scenario'] as const).flatMap(mode =>
    (['markdown', 'web'] as const).flatMap(format =>
      (['system', 'preset'] as const).flatMap(funding =>
        [false, true].flatMap(account => (['stream', 'non-stream'] as const).map(delivery => ({ product, mode, format, account, funding, delivery })))))));
describe('Desktop Hosted real-route loopback journey', () => {
  it.each(matrix)('/$product $mode $format $delivery account=$account funding=$funding uses controls → create → explicit save → reopen', async ({ product, mode, format, account, funding, delivery }) => {
    accountId = account ? 42 : null; configure(funding); const original = draft(mode, format); saveDraft(original, product); const router = await mount(product); if (delivery === 'stream') await restoreAndSelectStream(); else { await click('恢复草稿'); await openSection('⚡ 生成方式'); expect(button('非流式')!.getAttribute('aria-pressed')).toBe('true'); }
    await openSection(product === 'arena' ? '⚙️ 读写设置' : '🧠 故事');
    const writes = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].filter(input => input.closest('label')?.textContent?.includes('战报后写入') && ['历战记录', '当前状态'].includes(input.closest('fieldset')?.querySelector('legend')?.textContent ?? ''));
    expect(writes).toHaveLength(2); for (const input of writes) { expect(input.disabled).toBe(true); expect(input.checked).toBe(false); expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toContain('服务器签名角色更新尚未接入'); }
    const random = vi.spyOn(crypto, 'getRandomValues'); await act(async () => { button('生成战报')!.click(); button('生成战报')!.click(); });
    await vi.waitFor(async () => { await settle(); expect(container.textContent).toContain('服务器生成完成'); }); await settle();
    expect(random).not.toHaveBeenCalled(); expect(streamRequests).toHaveLength(1); expect(httpRequests.filter(request => request.method === 'POST' && request.path === (delivery === 'stream' ? '/api/arena/generate-stream' : '/api/generate-battle-story'))).toHaveLength(1);
    expect(streamRequests[0]).toMatchObject({ operation: delivery === 'stream' ? 'create-stream' : 'create-json', product, actor: account ? { kind: 'account', expectedUserId: 42 } : { kind: 'anonymous' }, body: { mode, reportFormat: format, writeArenaHistory: false, writeCurrentState: false, adjudicationEvents: original.adjudicationEvents } });
    expect(streamRequests[0]).toHaveProperty(funding === 'system' ? 'systemConfig' : 'presetConfig'); expect(streamRequests[0]).not.toHaveProperty('body.adjudicationResults');
    expect(docs.size).toBe(0); expect(activeCloseHandles).toBe(1); expect(button('另存战后角色副本')).toBeUndefined();
    expect(container.querySelector('[aria-label="服务器生成状态"]')?.textContent).toContain(delivery === 'stream' ? '本次判定、记者等附加元数据未取得' : '完整非流式报告与附加元数据已保留');
    if (delivery === 'non-stream' && format === 'markdown') expect(container.textContent).toContain('服务端未知类型记录');
    if (delivery === 'non-stream') expect(container.querySelector('[aria-label="服务器生成状态"]')?.textContent).not.toContain('仅完整元数据保留的情景');
    if (format === 'web') {
      expect(container.querySelector('[aria-label="Web 战报源码（安全文本）"]')?.textContent).toContain('hostedMustNotRun'); expect(button('运行 Web 战报')!.disabled).toBe(true);
      expect(container.querySelector('iframe,script,img[src*="untrusted.invalid"]')).toBeNull(); expect((globalThis as { hostedMustNotRun?: boolean }).hostedMustNotRun).toBeUndefined();
    }
    const exported = await exportResult(); expect(exported.result.rawText).toBe(format === 'web' ? web : markdown);
    expect(exported.result.hosted).toMatchObject({ metadataState: delivery === 'stream' ? 'missing' : 'available', serverStatus: 'completed', outputValidation: 'valid' }); expect(exported.result.report.officialReport.winner).toBe(delivery === 'stream' ? '' : '甲');
    if (delivery === 'non-stream') { expect(exported.result.hosted.companion).toEqual(companion); expect(exported.result.hosted.terminal).toBeNull(); } expect(exported.generation.adjudicationResults).toEqual([]);
    expect(exported.draft.combatants).toEqual(original.combatants); expect(exported.draft.settings).toMatchObject({ writeArenaHistory: true, writeCurrentState: true }); expect(exported.draft.narrativeHistoryEntries).toHaveLength(1); expect(exported.draft.narrativeHistoryEntries[0].hostedSource).toMatchObject({ generationId, metadataState: delivery === 'stream' ? 'missing' : 'available', signedCharacterUpdates: false }); expect(exported.candidates).toBeNull();
    // Hold both saves in one case until the real repository IPC is observed. No elapsed-time
    // assumption can count a disabled second click as an idempotent retry.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (product === 'arena' && mode === 'scenario' && format === 'markdown' && !account && funding === 'preset')
        saveBarrier = new Promise(resolve => { releaseSave = resolve; });
      expect(button('保存叙事历史到本地库')!.disabled).toBe(false);
      await act(async () => button('保存叙事历史到本地库')!.click());
      await vi.waitFor(() => expect(mocks.invoke.mock.calls.filter(([command]) => command === 'save_local_card')).toHaveLength(attempt));
      if (releaseSave) {
        expect(button('保存叙事历史到本地库')!.disabled).toBe(true);
        expect(container.textContent).not.toContain('已保存到本地库，可在卡库重新打开。');
        await act(async () => releaseSave!()); releaseSave = null;
      }
      await vi.waitFor(async () => {
        await act(async () => {});
        expect(container.textContent).toContain('已保存到本地库，可在卡库重新打开。');
        expect(button('保存叙事历史到本地库')!.disabled).toBe(false);
        expect(docs.size).toBe(1);
      });
    }
    expect([...docs.values()][0]).toMatchObject({ cardType: 'history', provenance: { kind: 'unsigned' } });
    vi.mocked(window.confirm).mockReturnValue(true); await act(async () => router.navigate({ to: '/local-library' })); await settle(); expect(window.location.hash).toContain('/local-library');
    await act(async () => router.navigate({ to: `/${product}` })); await settle(); await click('恢复草稿'); await click('引用本地叙事历史'); await vi.waitFor(() => expect(document.body.textContent).toContain('甲与乙共同守护车站'));
    expect(streamRequests).toHaveLength(1); expect(controlRequests).toHaveLength(0); expect(activeCloseHandles).toBe(1);
  });
});

describe('Hosted recovery and interruption ownership through the real route', () => {
  it.each([{ product: 'battle' as const, actor: null }, { product: 'arena' as const, actor: 42 }])('/$product recovers the original actor after restart, without create/funding or automatic old history effects', async ({ product, actor }) => {
    accountId = actor; configure('preset'); saveDraft(draft(), product); await mount(product); await restoreAndSelectStream(); await click('生成战报');
    await vi.waitFor(async () => { await settle(); expect(container.textContent).toContain('服务器生成完成'); });
    const saved = DesktopArenaHostedRecoveryPointerSchema.parse(JSON.parse(localStorage.getItem(ARENA_HOSTED_RECOVERY_KEYS[product])!));
    await act(async () => root.unmount()); root = createRoot(container); localStorage.removeItem(draftKey(product));
    // A cold pointer may retain a terminal/cancel-unconfirmed cursor while its body draft is unavailable.
    localStorage.setItem(ARENA_HOSTED_RECOVERY_KEYS[product], JSON.stringify({ ...saved, state: 'cancel_unconfirmed', cursor: '99-0' }));
    accountId = actor ?? 99; resetDesktopCloudSessionStoreForTests(); await mount(product); expect(streamRequests).toHaveLength(1);
    expect(container.querySelector('[aria-label="服务器恢复记录"]')?.textContent).toContain(actor === null ? '原匿名身份' : '账号 42');
    await click('恢复原服务器战报'); expect(controlRequests).toHaveLength(0); expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining(actor === null ? '以原匿名身份' : '以原账号'));
    vi.mocked(window.confirm).mockReturnValue(true);
    const beforeRecovery = mocks.invoke.mock.calls.length;
    await act(async () => { button('恢复原服务器战报')!.click(); button('恢复原服务器战报')!.click(); });
    await vi.waitFor(async () => { await settle(); expect(container.textContent).toContain('服务器生成完成'); });
    expect(streamRequests.map(request => request.operation)).toEqual(['create-stream', 'resume']);
    expect(controlRequests).toEqual([{ operation: 'lookup-request', product, requestId: saved.requestId, actor: saved.actor, restoreSession: true }]);
    expect(streamRequests[1]).toEqual({ operation: 'resume', product, requestId: saved.requestId, actor: saved.actor, generationId });
    const recoveryCalls = mocks.invoke.mock.calls.slice(beforeRecovery);
    expect(recoveryCalls.some(([command]) => command === 'has_provider_secret' || command === 'get_provider_secret' || command === 'set_provider_secret')).toBe(false);
    expect(httpRequests.filter(request => request.method === 'POST' && request.path === '/api/arena/generate-stream')).toHaveLength(1);
    const exported = await exportResult(); expect(exported.result.rawText).toBe(markdown); expect(exported.result.hosted.restored).toBe(true);
    expect(exported.draft.narrativeHistoryEntries).toEqual([]); expect(docs.size).toBe(0);
    await click('将本次正文加入活动历史'); await click('将本次正文加入活动历史'); expect((await exportResult()).draft.narrativeHistoryEntries).toHaveLength(1);
    failSave = true; await click('保存叙事历史到本地库'); expect(container.textContent).toContain('完整原文仍在内存'); expect(docs.size).toBe(0);
    expect((await exportResult()).result.rawText).toBe(markdown); failSave = false; await click('保存叙事历史到本地库'); expect(docs.size).toBe(1); expect(streamRequests).toHaveLength(2);
  });

  it('an account pointer refuses a different signed-in account before all recovery IPC', async () => {
    accountId = 42; saveDraft(draft()); await mount(); await restoreAndSelectStream(); await click('生成战报');
    await vi.waitFor(async () => { await settle(); expect(container.textContent).toContain('服务器生成完成'); });
    await act(async () => root.unmount()); root = createRoot(container); localStorage.removeItem(ARENA_DRAFT_KEY); accountId = 43; resetDesktopCloudSessionStoreForTests(); await mount();
    vi.mocked(window.confirm).mockReturnValue(true); await click('恢复原服务器战报');
    expect(container.textContent).toContain('请先登录原生成账号'); expect(controlRequests).toHaveLength(0); expect(streamRequests).toHaveLength(1);
  });

  it('stop 202 is acceptance rather than terminal completion; a late done never appends history', async () => {
    hold = true; saveDraft(draft()); await mount(); await restoreAndSelectStream(); await click('生成战报');
    await vi.waitFor(async () => { await settle(); expect(container.querySelector('[aria-label="战报结果"]')?.textContent).toContain('甲与乙共同守护车站'); });
    expect(activeCloseHandles).toBe(1); await click('请求服务器停止');
    await vi.waitFor(async () => { await settle(); expect(button('请求服务器停止')).toBeUndefined(); });
    expect(controlRequests).toHaveLength(1); expect(controlRequests[0]).toMatchObject({ operation: 'stop', reason: 'user', generationId });
    expect(httpRequests.filter(request => request.path.endsWith('/cancel'))).toHaveLength(1);
    let exported = await exportResult(); expect(exported.result.phase).toBe('cancelled'); expect(exported.result.hosted).toMatchObject({ connectionState: 'cancelled', serverStatus: null, terminal: null });
    expect(container.textContent).toContain('最终状态仍以恢复查询为准'); expect(exported.draft.narrativeHistoryEntries).toEqual([]);
    await act(async () => { releaseAll(); await Promise.allSettled([...pendingNative]); }); await settle(); exported = await exportResult();
    expect(exported.result.phase).toBe('cancelled'); expect(exported.draft.narrativeHistoryEntries).toEqual([]); expect(exported.result.rawText).toBe(markdown); expect(docs.size).toBe(0); expect(streamRequests).toHaveLength(1);
  });

  it('confirmed navigation detaches locally without HTTP cancel and ignores late server completion', async () => {
    hold = true; saveDraft(draft()); const router = await mount(); await restoreAndSelectStream(); await click('生成战报');
    await vi.waitFor(async () => { await settle(); expect(container.querySelector('[aria-label="战报结果"]')?.textContent).toContain('甲与乙共同守护车站'); });
    const event = { preventDefault: vi.fn() }; await act(async () => mocks.listen.mock.calls.at(-1)![0](event));
    expect(event.preventDefault).toHaveBeenCalledOnce(); expect(activeCloseHandles).toBe(1); expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining('只停止本机订阅'));
    vi.mocked(window.confirm).mockReturnValue(true); await act(async () => router.navigate({ to: '/' })); await settle(); expect(window.location.hash).toBe('#/');
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'arena_hosted_detach')).toBe(true); expect(controlRequests).toHaveLength(0);
    expect(httpRequests.some(request => request.path.endsWith('/cancel') || request.method === 'DELETE')).toBe(false);
    await act(async () => { releaseAll(); await Promise.allSettled([...pendingNative]); });
    expect(JSON.parse(localStorage.getItem(ARENA_DRAFT_KEY)!).draft.narrativeHistoryEntries).toEqual([]); expect(docs.size).toBe(0);
    await act(async () => router.navigate({ to: '/battle' })); await settle(); await click('恢复草稿');
    const exported = await exportResult(); expect(exported.result.rawText).toBe(markdown); expect(exported.result.phase).not.toBe('completed'); expect(exported.draft.narrativeHistoryEntries).toEqual([]); expect(activeCloseHandles).toBe(1);
  });

  it.each(['account', 'target'] as const)('a changed %s scope cannot publish the old final packet or acquire a second close handle', async kind => {
    accountId = 42; hold = true; saveDraft(draft()); await mount(); await restoreAndSelectStream(); await click('生成战报');
    await vi.waitFor(async () => { await settle(); expect(container.querySelector('[aria-label="战报结果"]')?.textContent).toContain('甲与乙共同守护车站'); });
    if (kind === 'account') await act(async () => { await getDesktopCloudSessionStore().signOut(); });
    else {
      // The public store rejects target mutation during the prepared/active flight.
      expect(() => getDesktopAiConfigStore().selectProviderTarget({ kind: 'preset', providerId: 'deepseek' })).toThrow('生成期间');
      await click('请求服务器停止'); await vi.waitFor(async () => { await settle(); expect(getDesktopAiConfigStore().getSnapshot().generationActive).toBe(false); });
      await act(async () => getDesktopAiConfigStore().selectProviderTarget({ kind: 'preset', providerId: 'deepseek' }));
    }
    await settle(); const before = await exportResult(); expect(activeCloseHandles).toBe(1);
    await act(async () => { releaseAll(); await Promise.allSettled([...pendingNative]); }); await settle(); const after = await exportResult();
    expect(after.result.phase).not.toBe('completed'); expect(after.draft.narrativeHistoryEntries).toEqual([]); expect(after.result.rawText).toBe(before.result.rawText); expect(docs.size).toBe(0); expect(streamRequests).toHaveLength(1); expect(activeCloseHandles).toBe(1);
    expect(controlRequests.filter(request => request.operation === 'stop')).toHaveLength(kind === 'account' ? 0 : 1);
  });
});

describe('Hosted non-stream lifecycle through the real route', () => {
  it('stops through original lookup before JSON headers and rejects late full completion', async () => {
    hold = true; saveDraft(draft()); await mount(); await click('恢复草稿'); await click('生成战报');
    await vi.waitFor(() => expect(httpRequests.filter(request => request.path === '/api/generate-battle-story')).toHaveLength(1));
    expect(nativeResponseCount).toBe(0); expect(activeCloseHandles).toBe(1);
    await act(async () => { button('请求服务器停止')!.click(); button('请求服务器停止')?.click(); });
    await vi.waitFor(async () => { await settle(); expect(button('请求服务器停止')).toBeUndefined(); });
    expect(controlRequests.map(request => request.operation)).toEqual(['lookup-request', 'stop']);
    expect(controlRequests.every(request => request.requestId === streamRequests[0]!.requestId)).toBe(true);
    expect(controlRequests[1]).toMatchObject({ operation: 'stop', generationId });
    expect(container.textContent).toContain('最终状态仍以恢复查询为准');
    await act(async () => { releaseAll(); await Promise.allSettled([...pendingNative]); }); await settle();
    const saved = JSON.parse(localStorage.getItem(ARENA_DRAFT_KEY)!);
    expect(saved.output.phase).toBe('cancelled'); expect(saved.output.hosted.companion).toBeNull();
    expect(saved.draft.narrativeHistoryEntries).toEqual([]); expect(docs.size).toBe(0); expect(streamRequests).toHaveLength(1);
    expect(httpRequests.filter(request => request.path === '/api/generate-battle-story')).toHaveLength(1);
  });

  it('restores checked full JSON from a local draft and exports it after an explicit save failure', async () => {
    saveDraft(draft()); await mount(); await click('恢复草稿'); await click('生成战报');
    await vi.waitFor(async () => { await settle(); expect(container.textContent).toContain('服务器生成完成'); });
    const original = companion;
    await act(async () => root.unmount()); root = createRoot(container); await mount(); await click('恢复草稿');
    expect(container.textContent).toContain('完整非流分析'); expect(container.textContent).toContain('服务端未知类型记录');
    await openSection('⚡ 生成方式'); await click('流式');
    expect(button('流式')!.getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain('完整非流分析'); expect(container.textContent).toContain('服务端未知类型记录');
    expect(container.querySelector('[aria-label="服务器生成状态"]')?.textContent).not.toContain('仅完整元数据保留的情景');
    expect(button('将本次正文加入活动历史')).toBeUndefined();
    failSave = true; await click('保存叙事历史到本地库');
    await vi.waitFor(() => expect(container.textContent).toContain('完整原文仍在内存'));
    const exported = await exportResult(); expect(exported.result.hosted.companion).toEqual(original);
    expect(exported.result.report.article.analysis).toBe('完整非流分析'); expect(exported.candidates).toBeNull();
    expect(exported.draft.narrativeHistoryEntries).toHaveLength(1); expect(docs.size).toBe(0);
    expect(streamRequests.map(request => request.operation)).toEqual(['create-json']); expect(controlRequests).toHaveLength(0);
  });

  it('reopens a v2 JSON pointer using original structured model replay without claiming the original companion', async () => {
    accountId = 42; configure('preset'); saveDraft(draft(), 'arena'); await mount('arena'); await click('恢复草稿'); await click('生成战报');
    await vi.waitFor(async () => { await settle(); expect(container.textContent).toContain('服务器生成完成'); });
    const pointer = DesktopArenaHostedAnyRecoveryPointerSchema.parse(JSON.parse(localStorage.getItem(ARENA_HOSTED_RECOVERY_KEYS.arena)!));
    expect(pointer).toMatchObject({ version: 2, delivery: 'non-stream', actor: { kind: 'account', expectedUserId: 42 } });
    const originalRaw = output.text;
    await act(async () => root.unmount()); root = createRoot(container); localStorage.removeItem(ADVANCED_ARENA_DRAFT_KEY);
    await mount('arena'); vi.mocked(window.confirm).mockReturnValue(true); await click('恢复原服务器战报');
    await vi.waitFor(async () => { await settle(); expect(container.textContent).toContain('已恢复原任务可用正文与终态'); });
    expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining('原完整非流式 JSON'));
    expect(streamRequests.map(request => request.operation)).toEqual(['create-json', 'resume']);
    expect(streamRequests[1]).not.toHaveProperty('after'); expect(streamRequests[1]).not.toHaveProperty('presetConfig');
    expect(controlRequests).toEqual([{ operation: 'lookup-request', product: 'arena', requestId: pointer.requestId, actor: pointer.actor, restoreSession: true }]);
    expect(container.textContent).toContain('完整非流分析');
    const exported = await exportResult(); expect(exported.result.rawText).toBe(originalRaw); expect(exported.result.markdown).toBe(markdown);
    expect(exported.result.hosted).toMatchObject({ delivery: 'non-stream', restored: true, companionState: 'recovered-model-only' });
    expect(exported.result.hosted.companion).toBeNull(); expect(exported.draft.narrativeHistoryEntries).toEqual([]);
    await click('将本次正文加入活动历史'); expect((await exportResult()).draft.narrativeHistoryEntries).toHaveLength(1);
    expect(httpRequests.filter(request => request.path === '/api/generate-battle-story')).toHaveLength(1);
  });

  it('shows a soft warning while still waiting for JSON response headers, then completes that same request', async () => {
    hold = true; saveDraft(draft()); await mount(); await click('恢复草稿');
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    try {
      await act(async () => button('生成战报')!.click());
      await vi.waitFor(() => expect(httpRequests.filter(request => request.path === '/api/generate-battle-story')).toHaveLength(1));
      expect(nativeResponseCount).toBe(0);
      await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
      expect(container.textContent).toContain('300 秒仍未收到新内容'); expect(controlRequests).toHaveLength(0);
      vi.useRealTimers(); releaseAll();
      await vi.waitFor(async () => { await settle(); expect(container.textContent).toContain('服务器生成完成'); });
      expect(container.textContent).not.toContain('此提示不会自动停止或重新创建请求');
      expect(streamRequests).toHaveLength(1); expect(controlRequests).toHaveLength(0);
    } finally { vi.useRealTimers(); releaseAll(); }
  });
});

describe('Hosted preparation fails closed in the shared route', () => {
  it('a failed independent pointer write sends zero create and retains the full exportable input', async () => {
    saveDraft(draft()); await mount(); await restoreAndSelectStream();
    const realSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === ARENA_HOSTED_RECOVERY_KEYS.battle) throw new DOMException('synthetic quota full', 'QuotaExceededError');
      return realSet.call(this, key, value);
    });
    await act(async () => { button('生成战报')!.click(); button('生成战报')!.click(); });
    await vi.waitFor(async () => { await settle(); expect(container.textContent).toContain('恢复指针保存失败'); });
    expect(streamRequests).toHaveLength(0); expect(controlRequests).toHaveLength(0); expect(httpRequests).toHaveLength(0); expect(activeCloseHandles).toBe(1);
    expect(button('生成战报')!.disabled).toBe(false); await click('导出当前会话');
    const exported = JSON.parse(mocks.download.mock.calls.at(-1)![1]); expect(exported.draft.combatants).toEqual(draft().combatants); expect(exported.hostedRecovery.saved).toBe(false);
  });
  it('late StrictMode close registrations block preparation until ready, then leave exactly one active handle', async () => {
    const registrations: { callback: (event: { preventDefault(): void }) => void; resolve: (release: () => void) => void }[] = [];
    mocks.listen.mockImplementation((callback: (event: { preventDefault(): void }) => void) => new Promise<() => void>(resolve => { registrations.push({ callback, resolve }); }));
    saveDraft({ ...draft(), generationMode: 'stream' }); await mount(); await click('恢复草稿');
    expect(button('生成战报')!.disabled).toBe(true); expect(streamRequests).toHaveLength(0); expect(registrations.length).toBeGreaterThanOrEqual(2);
    const stale = { preventDefault: vi.fn() }; registrations[0]!.callback(stale); expect(stale.preventDefault).toHaveBeenCalledOnce();
    await act(async () => { for (const registration of registrations) { activeCloseHandles += 1; registration.resolve(() => { activeCloseHandles -= 1; }); } }); await settle();
    expect(activeCloseHandles).toBe(1); expect(button('生成战报')!.disabled).toBe(false);
    await click('生成战报'); await vi.waitFor(async () => { await settle(); expect(container.textContent).toContain('服务器生成完成'); });
    expect(activeCloseHandles).toBe(1); expect(streamRequests).toHaveLength(1);
  });
});

describe('Read-only Native recovery diagnosis through the real route', () => {
  const nativeRequestId = 'native-original-request-0001';
  const corruptRaw = '{"requestId":"untrusted-partial-id", broken original';
  const diagnosis = () => container.querySelector('[aria-label="本机恢复身份诊断"]');
  const hintCalls = () => mocks.invoke.mock.calls.filter(([command]) => command === 'arena_hosted_recovery_hint');
  const validPointer = (product: Product, requestId: string) => DesktopArenaHostedRecoveryPointerSchema.parse({
    version: 1, protocolVersion: 'arena-hosted-sse-v1', product, requestId, bodyHash: 'a'.repeat(64),
    actor: { kind: 'anonymous' }, format: 'markdown', battleMode: 'daily', state: 'unknown', updatedAt: '2026-10-10T05:00:00.000Z',
  });
  const preparePage = async (product: Product = 'battle', raw: string | null = corruptRaw) => {
    if (raw !== null) localStorage.setItem(ARENA_HOSTED_RECOVERY_KEYS[product], raw);
    saveDraft({ ...draft(), generationMode: 'stream' }, product); await mount(product); await click('恢复草稿');
  };
  const expectReadOnly = () => {
    expect(streamRequests).toHaveLength(0); expect(controlRequests).toHaveLength(0); expect(httpRequests).toHaveLength(0);
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'arena_hosted_detach')).toBe(false);
  };

  it.each([{ product: 'battle' as const, state: 'available' as const }, { product: 'arena' as const, state: 'expired' as const }])(
    '/$product $state diagnosis preserves a corrupt original through cancelled consent and failed writes until one successful replacement', async ({ product, state }) => {
      mocks.hint.mockResolvedValue({ product, state, requestId: nativeRequestId, actorKind: 'anonymous' });
      await preparePage(product); const key = ARENA_HOSTED_RECOVERY_KEYS[product];
      const realSet = Storage.prototype.setItem, writes: { previous: string | null; next: string }[] = []; let failPointerWrite = false;
      const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, name, value) {
        if (name === key) {
          if (failPointerWrite) throw new DOMException('synthetic quota full', 'QuotaExceededError');
          writes.push({ previous: this.getItem(name), next: value });
        }
        return realSet.call(this, name, value);
      });
      const remove = vi.spyOn(Storage.prototype, 'removeItem');
      expect(button('生成战报')!.disabled).toBe(true); await click('检查本机恢复身份');
      expect(hintCalls()).toEqual([['arena_hosted_recovery_hint', { request: { product } }]]);
      expect(diagnosis()?.textContent).toContain(nativeRequestId); expect(diagnosis()?.textContent).toContain(state === 'expired' ? '凭据已到期' : '本机身份可用');
      expect(diagnosis()?.textContent).toContain('不保证服务器仍保留结果'); expectReadOnly();
      expect(set.mock.calls.filter(([name]) => name === key)).toEqual([]); expect(remove.mock.calls.filter(([name]) => name === key)).toEqual([]);
      expect(window.confirm).not.toHaveBeenCalled(); expect(localStorage.getItem(key)).toBe(corruptRaw); expect(button('生成战报')!.disabled).toBe(false);

      await click('生成战报'); expectReadOnly(); expect(localStorage.getItem(key)).toBe(corruptRaw); expect(writes).toEqual([]);
      expect(window.confirm).toHaveBeenCalledOnce(); const consent = vi.mocked(window.confirm).mock.calls[0]![0]!;
      expect(consent).toContain(nativeRequestId); expect(consent).toContain('放弃其本机恢复'); expect(consent).toContain('不会停止旧服务器任务');
      expect(consent).toContain('新指针保存成功后替换');

      vi.mocked(window.confirm).mockReturnValue(true); failPointerWrite = true; await click('生成战报');
      await vi.waitFor(async () => { await settle(); expect(container.textContent).toContain('恢复指针保存失败'); });
      expectReadOnly(); expect(localStorage.getItem(key)).toBe(corruptRaw); expect(writes).toEqual([]);
      expect(button('生成战报')!.disabled).toBe(true); expect(diagnosis()?.textContent).not.toContain(nativeRequestId);
      failPointerWrite = false; await click('检查本机恢复身份'); await click('生成战报');
      await vi.waitFor(async () => { await settle(); expect(container.textContent).toContain('服务器生成完成'); });
      expect(streamRequests).toHaveLength(1); expect(streamRequests[0]).toMatchObject({ operation: 'create-stream', product, replaceRequestId: nativeRequestId });
      expect(streamRequests[0]!.requestId).not.toBe(nativeRequestId); expect(writes[0]?.previous).toBe(corruptRaw);
      expect(DesktopArenaHostedRecoveryPointerSchema.parse(JSON.parse(writes[0]!.next))).toMatchObject({ product, state: 'prepared', requestId: streamRequests[0]!.requestId });
      expect(writes.filter(write => write.previous === corruptRaw)).toHaveLength(1);
      expect(remove.mock.calls.filter(([name]) => name === key)).toEqual([]); expect(controlRequests).toHaveLength(0);
      expect(httpRequests.map(request => [request.method, request.path])).toEqual([['POST', '/api/arena/generate-stream']]);
      expect(hintCalls()).toHaveLength(2); expect(activeCloseHandles).toBe(1);
    },
  );

  it('replaces the exact Native identity independently of a different valid local pointer, then invalidates that hint when a new pointer owns recovery', async () => {
    const original = validPointer('battle', 'local-original-request-0002');
    mocks.hint.mockResolvedValue({ product: 'battle', state: 'available', requestId: nativeRequestId, actorKind: 'anonymous' });
    await preparePage('battle', JSON.stringify(original)); await click('检查本机恢复身份');
    expectReadOnly(); expect(container.querySelector('[aria-label="服务器恢复记录"]')?.textContent).toContain(original.requestId);
    expect(diagnosis()?.textContent).toContain(nativeRequestId); expect(JSON.parse(localStorage.getItem(ARENA_HOSTED_RECOVERY_KEYS.battle)!)).toEqual(original);
    await click('生成战报'); expectReadOnly(); expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining(nativeRequestId));
    vi.mocked(window.confirm).mockReturnValue(true); await click('生成战报');
    await vi.waitFor(async () => { await settle(); expect(container.textContent).toContain('服务器生成完成'); });
    expect(streamRequests).toHaveLength(1); expect(streamRequests[0]).toMatchObject({ operation: 'create-stream', replaceRequestId: nativeRequestId });
    const newRequestId = streamRequests[0]!.requestId; expect(newRequestId).not.toBe(original.requestId); expect(newRequestId).not.toBe(nativeRequestId);
    expect(JSON.parse(localStorage.getItem(ARENA_HOSTED_RECOVERY_KEYS.battle)!).requestId).toBe(newRequestId);
    expect(diagnosis()?.textContent).not.toContain(nativeRequestId); expect(container.querySelector('[aria-label="服务器恢复记录"]')?.textContent).toContain(newRequestId);
    await click('生成战报'); await vi.waitFor(async () => { await settle(); expect(streamRequests).toHaveLength(2); expect(container.textContent).toContain('服务器生成完成'); });
    expect(streamRequests[1]).toMatchObject({ operation: 'create-stream', replaceRequestId: newRequestId });
    expect(streamRequests[1]!.requestId).not.toBe(newRequestId); expect(hintCalls()).toHaveLength(1); expect(controlRequests).toHaveLength(0);
    expect(httpRequests.map(request => [request.method, request.path])).toEqual([['POST', '/api/arena/generate-stream'], ['POST', '/api/arena/generate-stream']]);
  });

  it('single-flights repeated diagnosis clicks and blocks generation until the read-only response arrives', async () => {
    let resolveHint!: (value: DesktopArenaHostedRecoveryHint) => void;
    mocks.hint.mockReturnValue(new Promise<DesktopArenaHostedRecoveryHint>(resolve => { resolveHint = resolve; }));
    await preparePage(); const key = ARENA_HOSTED_RECOVERY_KEYS.battle;
    await act(async () => { button('检查本机恢复身份')!.click(); button('检查本机恢复身份')!.click(); }); await settle();
    expect(hintCalls()).toHaveLength(1); expect(button('检查本机恢复身份')!.disabled).toBe(true); expect(button('生成战报')!.disabled).toBe(true);
    await click('生成战报'); expectReadOnly(); expect(window.confirm).not.toHaveBeenCalled(); expect(localStorage.getItem(key)).toBe(corruptRaw);
    await act(async () => resolveHint({ product: 'battle', state: 'available', requestId: nativeRequestId, actorKind: 'anonymous' })); await settle();
    expect(diagnosis()?.textContent).toContain(nativeRequestId); expect(button('检查本机恢复身份')!.disabled).toBe(false); expect(button('生成战报')!.disabled).toBe(false);
    expect(hintCalls()).toHaveLength(1); expectReadOnly(); expect(activeCloseHandles).toBe(1);
  });

  it.each(['account', 'target'] as const)('a changed %s scope discards a late diagnosis without publishing its identity or clearing a newer flight', async kind => {
    accountId = 42; const resolvers: ((value: DesktopArenaHostedRecoveryHint) => void)[] = [];
    mocks.hint.mockImplementation(() => new Promise<DesktopArenaHostedRecoveryHint>(resolve => { resolvers.push(resolve); }));
    await preparePage(); await click('检查本机恢复身份'); expect(hintCalls()).toHaveLength(1);
    if (kind === 'account') await act(async () => { await getDesktopCloudSessionStore().signOut(); });
    else await act(async () => getDesktopAiConfigStore().selectProviderTarget({ kind: 'preset', providerId: 'deepseek' }));
    await settle(); expect(button('检查本机恢复身份')!.disabled).toBe(false); await click('检查本机恢复身份'); expect(hintCalls()).toHaveLength(2);
    await act(async () => resolvers[0]!({ product: 'battle', state: 'available', requestId: nativeRequestId, actorKind: 'account' })); await settle();
    expect(diagnosis()?.textContent).not.toContain(nativeRequestId); expect(button('检查本机恢复身份')!.disabled).toBe(true); expect(button('生成战报')!.disabled).toBe(true);
    await click('检查本机恢复身份'); expect(hintCalls()).toHaveLength(2);
    await act(async () => resolvers[1]!({ product: 'battle', state: 'none' })); await settle();
    expect(diagnosis()?.textContent).toContain('未找到可显示的原生恢复记录'); expect(diagnosis()?.textContent).not.toContain(nativeRequestId);
    expect(button('检查本机恢复身份')!.disabled).toBe(false); expect(button('生成战报')!.disabled).toBe(true);
    expectReadOnly(); expect(window.confirm).not.toHaveBeenCalled(); expect(localStorage.getItem(ARENA_HOSTED_RECOVERY_KEYS.battle)).toBe(corruptRaw); expect(activeCloseHandles).toBe(1);
  });

  it('refuses an approved stale repair when another local writer changes the original pointer after diagnosis', async () => {
    mocks.hint.mockResolvedValue({ product: 'battle', state: 'available', requestId: nativeRequestId, actorKind: 'anonymous' });
    await preparePage(); await click('检查本机恢复身份');
    const key = ARENA_HOSTED_RECOVERY_KEYS.battle, newerRaw = JSON.stringify(validPointer('battle', 'newer-local-request-0003'));
    localStorage.setItem(key, newerRaw); const set = vi.spyOn(Storage.prototype, 'setItem'), remove = vi.spyOn(Storage.prototype, 'removeItem');
    vi.mocked(window.confirm).mockReturnValue(true); await click('生成战报');
    await vi.waitFor(async () => { await settle(); expect(container.textContent).toContain('恢复指针保存失败'); });
    expectReadOnly(); expect(localStorage.getItem(key)).toBe(newerRaw); expect(set.mock.calls.filter(([name]) => name === key)).toEqual([]);
    expect(remove.mock.calls.filter(([name]) => name === key)).toEqual([]); expect(diagnosis()?.textContent).not.toContain(nativeRequestId); expect(button('生成战报')!.disabled).toBe(true);
  });

  it.each(['none', 'unavailable'] as const)('%s diagnosis never invents a replacement identity or unlocks a corrupt pointer', async state => {
    mocks.hint.mockResolvedValue({ product: 'battle', state }); await preparePage(); await click('检查本机恢复身份');
    expect(diagnosis()?.textContent).toContain(state === 'none' ? '未找到可显示的原生恢复记录' : '原生恢复凭据无法读取');
    expect(diagnosis()?.textContent).not.toContain('原生记录：'); expect(diagnosis()?.textContent).not.toContain('untrusted-partial-id');
    expect(button('生成战报')!.disabled).toBe(true); vi.mocked(window.confirm).mockReturnValue(true); await click('生成战报');
    expectReadOnly(); expect(window.confirm).not.toHaveBeenCalled(); expect(localStorage.getItem(ARENA_HOSTED_RECOVERY_KEYS.battle)).toBe(corruptRaw);
    // A clean page can still submit a new intent without fabricating an old request ID; Native owns admission.
    await act(async () => root.unmount()); root = createRoot(container); localStorage.removeItem(ARENA_HOSTED_RECOVERY_KEYS.battle);
    await mount(); await click('恢复草稿'); await click('检查本机恢复身份'); expectReadOnly(); await click('生成战报');
    await vi.waitFor(async () => { await settle(); expect(container.textContent).toContain('服务器生成完成'); });
    expect(streamRequests).toHaveLength(1); expect(streamRequests[0]).toMatchObject({ operation: 'create-stream', product: 'battle' });
    // Optional undefined fields survive the in-process Zod parse but are absent from the Native JSON payload.
    expect(streamRequests[0]).toHaveProperty('replaceRequestId', undefined); expect(JSON.parse(JSON.stringify(streamRequests[0]))).not.toHaveProperty('replaceRequestId');
    expect(window.confirm).not.toHaveBeenCalled(); expect(controlRequests).toHaveLength(0);
    expect(httpRequests.map(request => [request.method, request.path])).toEqual([['POST', '/api/arena/generate-stream']]);
  });
});

describe('Free Web source completion does not grant HTML framing or execution authority', () => {
  it.each(['只有普通文本', '<html><script>const close="</html>";'])('retains completed unframed source safely in history and full export: %s', async source => {
    webOverride = source; saveDraft(draft('daily', 'web')); await mount(); await restoreAndSelectStream(); await click('生成战报');
    await vi.waitFor(async () => { await settle(); expect(container.textContent).toContain('服务器生成完成'); });
    expect(container.textContent).toContain('未识别完整 HTML，保留安全源码，不能运行');
    expect(container.querySelector('[aria-label="Web 战报源码（安全文本）"]')?.textContent).toContain(source);
    expect(container.querySelector('iframe,script,style')).toBeNull(); expect(button('运行 Web 战报')!.disabled).toBe(true);
    expect(button('下载 HTML')).toBeUndefined(); expect(button('下载源码文本')!.disabled).toBe(false);
    const exported = await exportResult(); expect(exported.result).toMatchObject({ phase: 'completed', rawText: source, markdown: source, hosted: { serverStatus: 'completed', metadataState: 'missing' } });
    expect(exported.draft.narrativeHistoryEntries).toHaveLength(1); expect(exported.draft.narrativeHistoryEntries[0].content).toBe(source);
    expect(exported.candidates).toBeNull(); expect(button('另存战后角色副本')).toBeUndefined();
    await click('保存叙事历史到本地库'); expect(docs.size).toBe(1);
    expect(mocks.invoke.mock.calls.some(([command]) => /^(begin_web_package_instance|append_web_package_resource|open_web_package_instance)$/.test(command))).toBe(false);
    expect(streamRequests).toHaveLength(1);
  });
});


it('shows a live soft timeout before the first story chunk and still completes the same server request', async () => {
  holdFirstChunk = true; saveDraft(draft()); await mount(); await restoreAndSelectStream();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  try {
    await act(async () => { button('生成战报')!.click(); });
    await vi.waitFor(() => expect(nativeResponseCount).toBe(1));
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
    expect(container.textContent).toContain('300 秒仍未收到新内容'); expect(container.textContent).toContain('此提示不会自动停止或重新创建请求');
    expect(container.textContent).not.toContain(markdown); expect(streamRequests).toHaveLength(1); expect(controlRequests).toHaveLength(0);
    vi.useRealTimers(); releaseAll();
    await vi.waitFor(async () => { await settle(); expect(container.textContent).toContain('服务器生成完成'); });
    expect(container.textContent).not.toContain('此提示不会自动停止或重新创建请求'); expect(streamRequests).toHaveLength(1); expect(controlRequests).toHaveLength(0);
  } finally { vi.useRealTimers(); releaseAll(); }
});
