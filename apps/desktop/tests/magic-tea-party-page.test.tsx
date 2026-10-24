// @vitest-environment jsdom
import { withFixtureStreamReceipt } from './helpers/stream-receipt-fixture';
import { webcrypto } from 'node:crypto';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { TeaReadRequestSchema, TeaWriteRequestSchema, type TeaSessionDocument, type TeaMessageDocument } from '@mahoshojo/contracts/desktop-magic-tea-party';
import type { AiStreamEvent } from '@mahoshojo/ai-core/stream-events';
import * as downloads from '../src/platform/download-text-file';
import { createDesktopRouter } from '../src/app/router';
import { getDesktopAiConfigStore, resetDesktopAiConfigStoreForTests } from '../src/features/ai-config/use-desktop-ai-config';
import { resetDesktopCloudSessionStoreForTests } from '../src/features/account/use-desktop-cloud-session';
import { resetDesktopAnnouncementsStoreForTests } from '../src/features/announcements/use-desktop-announcements';
import { DESKTOP_AI_CONFIG_STORAGE_KEY } from '../src/features/ai-config/desktop-ai-config-store';
const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke, isTauri: () => true, Channel: class { onmessage?: (_event: unknown) => void; } }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: native.listen }) }));
const profile = { version: 1, id: 'tea-page', name: '合成测试连接', adapter: 'openai-compatible', baseUrl: 'http://127.0.0.1:18080/v1', modelId: 'synthetic', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' };
let root: Root; let container: HTMLDivElement; let document: TeaSessionDocument | null; let revision: number; let messages: TeaMessageDocument[]; let streams: number;
let streamOutput: string; let streamReasoning: string;
let mountedRouter: ReturnType<typeof createDesktopRouter> | undefined;
const originalPushState = window.history.pushState;
const originalReplaceState = window.history.replaceState;
let instance = 'a'.repeat(32);
let forkParent: { session: TeaSessionDocument; instance: string; revision: number; messages: TeaMessageDocument[] } | null = null;
const button = (text: string) => { const node = [...container.querySelectorAll('button')].find(item => item.textContent?.trim() === text); expect(node, text).toBeTruthy(); return node!; };
const click = (text: string) => act(async () => button(text).click());
const openSession = (title: string) => act(async () => { const node = [...container.querySelectorAll('button')].find(item => item.querySelector('.line-clamp-1')?.textContent === title); expect(node).toBeTruthy(); node!.click(); });
const change = async (selector: string, value: string) => {
  const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  expect(input, selector).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
};
// 冷模块编译属于夹具准备，不应挤占首个交互用例的预算；仍通过真实 lazy route 挂载。
beforeAll(async () => {
  await Promise.all([import('../src/app/magic-tea-party-page'), import('../src/app/settings-page')]);
});
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); localStorage.clear(); resetDesktopAiConfigStoreForTests(); resetDesktopCloudSessionStoreForTests();
  resetDesktopAnnouncementsStoreForTests();
  vi.stubGlobal('crypto', webcrypto); native.listen.mockResolvedValue(vi.fn());
  document = null; revision = 1; messages = []; streams = 0; instance = 'a'.repeat(32);
  streamOutput = '{"type":"narration","text":"共源茶会正文😀"}\n';
  streamReasoning = ''; forkParent = null;
  localStorage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, JSON.stringify({ version: 5, selection: { executionPreference: 'client', clientTarget: { kind: 'custom', profileId: profile.id }, serverTarget: { kind: 'system' }, systemModelId: 'default' }, hiddenPresetIds: [], modelsByProfileId: {}, presetsByProviderId: {} }));
  native.invoke.mockImplementation(withFixtureStreamReceipt(async (command: string, args: Record<string, unknown> = {}) => {
    if (command === 'list_provider_profile_ids') return [profile.id];
    if (command === 'get_provider_profile') return JSON.stringify(profile);
    if (command === 'has_provider_secret') return true;
    if (command === 'cloud_cached_account') return null;
    if (command === 'cloud_auth_status') return { state: 'signed-out' };
    if (command === 'list_local_cards' || command === 'list_web_packages') return { documents: [] };
    if (command === 'read_magic_tea_party') {
      const request = TeaReadRequestSchema.parse(args.request).request;
      if (request.action === 'merge-preview') {
        if (!forkParent || !document?.forkedFrom) throw new Error('missing parent');
        const anchor = forkParent.messages.findIndex(message => message.id === document!.forkedFrom!.messageId);
        const edited = messages.findIndex(message => message.revisionOf === document!.forkedFrom!.messageId);
        return { version: 1, result: { action: 'merge-preview', source: request.source, parent: { sessionId: forkParent.session.id, instance: forkParent.instance, expectedRevision: forkParent.revision },
          anchorMessageId: forkParent.messages[anchor]!.id, editedMessageId: messages[edited]!.id, sourceTitle: document.title, parentTitle: forkParent.session.title,
          anchorPreview: forkParent.messages[anchor]!.content, editedPreview: messages[edited]!.content, replacedMessageCount: forkParent.messages.length - anchor, copiedMessageCount: messages.length - edited } };
      }
      if (request.action === 'list') return { version: 1, result: { action: 'list', catalogRevision: revision, rows: document ? [{ id: document.id, instance, revision, title: document.title, titleTruncated: false, pinnedAt: 0, pinnedOrder: 0, createdAt: document.createdAt, updatedAt: document.updatedAt, messageCount: messages.length, roleNames: document.roles.map(role => role.name), roleCount: document.roles.length, scenarioTitle: null }] : [], nextCursor: null } };
      if (request.action === 'session') return { version: 1, result: { action: 'session', catalogRevision: revision, record: document ? { session: document, instance, revision } : null } };
      if (request.action === 'messages') return { version: 1, result: { action: 'messages', catalogRevision: revision, sessionId: document!.id, instance, revision, rows: messages.map((message, index) => ({ ordinal: index + 1, message })), nextCursor: null } };
      throw new Error('unconfigured read');
    }
    if (command === 'mutate_magic_tea_party') {
      const request = TeaWriteRequestSchema.parse(args.request).request;
      if (request.action === 'fork') {
        forkParent = { session: structuredClone(document!), instance, revision, messages: structuredClone(messages) };
        document = { ...document!, id: request.targetSessionId, branchLabel: '改写分支', forkedFrom: { sessionId: request.sessionId, messageId: request.anchorMessageId, createdAt: 10 } }; revision = 1; instance = 'b'.repeat(32);
        const anchor = messages.findIndex(message => message.id === request.anchorMessageId);
        messages = messages.slice(0, anchor + 1).map((message, index) => ({ ...message, sessionId: request.targetSessionId, ...(index === anchor ? { id: `edited-${message.id}`, content: request.editedContent, revisionOf: message.id } : {}) }));
        return { version: 1, result: { action: 'fork', operationId: request.operationId, sessionId: request.targetSessionId, instance, revision } };
      }
      if (request.action === 'merge') {
        if (!forkParent || request.parent.expectedRevision !== forkParent.revision) throw { code: 'tea-stale', message: 'Local tea storage did not complete; retain the input or unsaved result', writeEvidence: 'not-written' };
        const source = { sessionId: document!.id, instance, revision };
        const anchor = forkParent.messages.findIndex(message => message.id === request.anchorMessageId);
        const edited = messages.findIndex(message => message.id === request.editedMessageId);
        messages = [...forkParent.messages.map((message, index) => index < anchor ? message : { ...message, meta: { ...message.meta, superseded: true } }),
          ...messages.slice(edited).map(message => ({ ...message, id: `merged-${message.id}`, sessionId: forkParent!.session.id }))];
        document = structuredClone(forkParent.session); instance = forkParent.instance; revision = forkParent.revision + 1;
        return { version: 1, result: { action: 'merge', operationId: request.operationId, sessionId: document.id, instance, revision, source } };
      }
      if (request.action === 'import' || request.action === 'set-pin' || request.action === 'delete-selected') throw new Error('not used by page fixture');
      revision = request.action === 'create' ? 1 : request.expectedRevision + (request.action === 'delete' ? 0 : 1);
      const sessionId = request.action === 'create' ? request.session.id : request.sessionId;
      if (request.action === 'delete') { document = null; messages = []; } else document = request.session;
      if (request.action === 'begin-generation') { if (request.userMessage) messages.push(request.userMessage); messages.push(request.assistantMessage); }
      if (request.action === 'finish-generation') messages = messages.map(message => message.id === request.assistantMessage.id ? request.assistantMessage : message);
      return { version: 1, result: { action: request.action, sessionId, instance, revision,
        ...('operationId' in request ? { operationId: request.operationId, assistantMessageId: request.assistantMessage.id } : {}) } };
    }
    if (command === 'stream_target_ai') {
      streams += 1; const request = args.request as { requestId: string; contractVersion: 1; mode: 'direct-local' };
      const channel = args.onEvent as { onmessage: (_event: AiStreamEvent) => void };
      const identity = { requestId: request.requestId, contractVersion: request.contractVersion, mode: request.mode };
      const text = streamOutput;
      channel.onmessage({ ...identity, sequence: 0, type: 'started' }); channel.onmessage({ ...identity, sequence: 1, type: 'text-delta', delta: text });
      if (streamReasoning) channel.onmessage({ ...identity, sequence: 2, type: 'reasoning-delta', delta: streamReasoning });
      channel.onmessage({ ...identity, sequence: streamReasoning ? 3 : 2, type: 'result', result: { ...identity, status: 'completed', output: { text, ...(streamReasoning ? { reasoning: streamReasoning } : {}) }, finishReason: 'stop' } }); return;
    }
    throw new Error(`Unconfigured native boundary ${command}`);
  }));
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (input === '/announcements.json' && init?.credentials === 'omit' && init.redirect === 'error') return new Response('[]', { status: 200 });
    throw new Error('Tea must not use renderer network');
  }));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); HTMLElement.prototype.scrollIntoView = vi.fn(); HTMLElement.prototype.scrollTo = vi.fn();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; }; HTMLDialogElement.prototype.close = function () { this.open = false; };
  container = window.document.createElement('div'); window.document.body.append(container); root = createRoot(container);
});
// RouterProvider 卸载只取消订阅；夹具拥有的 history 还需释放监听器和 History API 包装。
const unmount = async () => {
  await act(async () => root.unmount());
  mountedRouter?.history.destroy();
  mountedRouter = undefined;
  expect(window.history.pushState).toBe(originalPushState);
  expect(window.history.replaceState).toBe(originalReplaceState);
};
afterEach(async () => { await unmount(); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const mount = async (href = '#/magic-tea-party') => {
  window.location.hash = href; const router = createDesktopRouter(); mountedRouter = router; await router.load();
  await act(async () => root.render(<StrictMode><RouterProvider router={router} /></StrictMode>));
  await act(async () => getDesktopAiConfigStore().refreshProfiles());
  return router;
};
const setupControlCases = [
  ['角色', 'input[type="file"]', 0],
  ['粘贴或拖入角色 JSON；PNG 与媒体附件暂不支持', 'textarea', 0],
  ['情景', 'input[type="file"]', 1],
  ['粘贴 / 拖拽导入情景卡', 'textarea', 1],
  ['扮演方式', 'select', 0],
  ['会话标题', 'input[placeholder="输入会话标题"]', 0],
] as const;
const setupPanel = () => container.querySelector('input[placeholder="输入会话标题"]')!.closest('fieldset')!;
const setupControls = () => [...setupPanel().querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')];

it.each(setupControlCases)('gives the delivered setup control "%s" its native label and forwards label activation', async (name, selector, index) => {
  await mount();
  const control = setupPanel().querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector)[index]!;
  const labels = [...(control.labels ?? [])];
  expect(labels).toHaveLength(1);
  const label = labels[0]!;
  expect(label.textContent?.trim()).toBe(name);
  expect(label.htmlFor).toBe(control.id);
  expect(control.id).not.toBe('');
  expect(label.control).toBe(control);
  expect(window.document.getElementById(label.htmlFor)).toBe(control);
  expect([...window.document.querySelectorAll('[id]')].filter(node => node.id === control.id)).toEqual([control]);
  // 原生 label 是名称来源；不允许额外 ARIA 名称覆盖可见文案。
  expect(control.getAttribute('aria-label')).toBeNull();
  expect(control.getAttribute('aria-labelledby')).toBeNull();

  const activated = vi.fn();
  control.addEventListener('click', activated);
  expect(control.matches(':disabled')).toBe(true);
  await act(async () => { label.click(); control.focus(); });
  expect(activated).not.toHaveBeenCalled();
  expect(window.document.activeElement).not.toBe(control);

  await click('新建会话');
  expect(control.isConnected).toBe(true);
  expect(control.matches(':disabled')).toBe(false);
  const before = native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party').length;
  await act(async () => label.click());
  expect(activated).toHaveBeenCalledTimes(1);
  expect(activated.mock.calls[0]![0].target).toBe(control);
  // jsdom 不实现标签默认聚焦；独立验证真实控件可聚焦，不安装 focus shim。
  await act(async () => control.focus());
  expect(window.document.activeElement).toBe(control);
  await act(async () => control.blur());
  expect(native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party')).toHaveLength(before);
  expect(streams).toBe(0);
});

it('labels delivered session-list search and page size without owner writes or generation', async () => {
  await mount(); await click('新建会话');
  const search = container.querySelector<HTMLInputElement>('input[placeholder="搜索已加载会话标题 / 角色 / 情景"]')!;
  const list = search.closest('fieldset')!;
  const pageSize = list.querySelector<HTMLSelectElement>('select')!;
  const writes = native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party').length;
  for (const [control, name] of [[search, search.placeholder], [pageSize, '每页']] as const) {
    const labels = [...(control.labels ?? [])];
    expect(labels).toHaveLength(1);
    const label = labels[0]!;
    expect(label.textContent?.trim()).toBe(name);
    expect(control.id).not.toBe(''); expect(label.htmlFor).toBe(control.id); expect(label.control).toBe(control);
    expect([...container.querySelectorAll('[id]')].filter(node => node.id === control.id)).toEqual([control]);
    expect(control.getAttribute('aria-label')).toBeNull(); expect(control.getAttribute('aria-labelledby')).toBeNull();
    const activated = vi.fn(); control.addEventListener('click', activated);
    await act(async () => label.click());
    expect(activated).toHaveBeenCalledTimes(1); expect(activated.mock.calls[0]![0].target).toBe(control);
    // jsdom 不实现标签默认聚焦；独立验证真实控件可聚焦。
    await act(async () => control.focus()); expect(window.document.activeElement).toBe(control);
  }
  expect(list.textContent).toContain('已加载 1 个会话');
  await change('input[placeholder="搜索已加载会话标题 / 角色 / 情景"]', '不存在的茶会');
  expect(search.value).toBe('不存在的茶会'); expect(list.textContent).toContain('已加载 0 个会话');
  await change('input[placeholder="搜索已加载会话标题 / 角色 / 情景"]', '');
  expect(list.textContent).toContain('已加载 1 个会话'); expect(pageSize.value).toBe('10');
  await act(async () => { pageSize.value = '5'; pageSize.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(pageSize.value).toBe('5');
  expect(native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party')).toHaveLength(writes);
  expect(streams).toBe(0);
});

it('shows the generated canonical reasoning through the delivered route and shared message panel', async () => {
  streamReasoning = '模型实际返回的思考😀';
  await mount(); await click('新建会话'); await click('生成开场');
  await click('AI 思考过程'); expect(container.textContent).toContain(streamReasoning);
  expect(messages.at(-1)?.meta?.aiReasoning).toEqual({ status: 'done', source: 'provider', text: streamReasoning });
  expect(streams).toBe(1);
  expect(vi.mocked(fetch).mock.calls).toEqual([['/announcements.json', { credentials: 'omit', redirect: 'error' }]]);
});

it('opens a legacy deep link in the existing tea page without creating a session or changing provider state', async () => {
  // 先完成既有配置归一化，再单独检查旧深链导航的副作用。
  getDesktopAiConfigStore().init();
  await getDesktopAiConfigStore().refreshProfiles();
  const preference = localStorage.getItem(DESKTOP_AI_CONFIG_STORAGE_KEY);
  const router = await mount('#/magic-tavern?session=%E6%98%9F%E8%A6%8B#%E8%8C%B6%E4%BC%9A');
  expect(router.state.location.pathname).toBe('/magic-tea-party');
  expect(container.textContent).toContain('本地文本茶会');
  expect(container.querySelector('[data-testid="page-tavern"]')).toBeNull();
  expect(document).toBeNull(); expect(messages).toEqual([]); expect(streams).toBe(0);
  expect(native.invoke.mock.calls.some(([command]) => command === 'mutate_magic_tea_party')).toBe(false);
  expect(native.invoke.mock.calls.some(([command]) => command === 'open_external_url')).toBe(false);
  expect(native.invoke.mock.calls.some(([command]) => /^(save|delete|set)_provider_/.test(command))).toBe(false);
  expect(localStorage.getItem(DESKTOP_AI_CONFIG_STORAGE_KEY)).toBe(preference);
  expect(vi.mocked(fetch).mock.calls).toEqual([['/announcements.json', { credentials: 'omit', redirect: 'error' }]]);
});
it('runs the delivered route with shared layout, real owner/IPC/Direct adapters and unchanged ordinary provider preference', async () => {
  await mount(); const preference = localStorage.getItem(DESKTOP_AI_CONFIG_STORAGE_KEY);
  expect(container.querySelector('.container')?.className).toBe('container !max-w-[1200px]');
  expect(container.textContent).toContain('本地文本茶会'); expect(button('生成选项').title).toContain('当前模型');
  await click('新建会话');
  await change('textarea[placeholder^="粘贴角色"]', JSON.stringify({ templateId: '通用角色', name: '星見', content: '完整设定' }));
  await click('导入'); expect(document?.roles[0]?.name).toBe('星見');
  const composer = container.querySelector<HTMLTextAreaElement>('textarea[placeholder^="输入你的行动"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(composer, '喝茶'); composer.dispatchEvent(new Event('input', { bubbles: true })); });
  await click('发送');
  expect(streams).toBe(1); expect(container.textContent).toContain('共源茶会正文😀');
  expect(messages.at(-1)).toMatchObject({ status: 'done', meta: { completion: 'provider' } });
  expect(localStorage.getItem(DESKTOP_AI_CONFIG_STORAGE_KEY)).toBe(preference);
  expect(vi.mocked(fetch).mock.calls).toEqual([['/announcements.json', { credentials: 'omit', redirect: 'error' }]]);
  expect(container.querySelector('img[src^="http"]')).toBeNull();
});
it.each(['Markdown', 'JSONL'])('runs manual choices → one-click send → continue with unchanged %s preference and retained draft', async format => {
  await mount(); await click('新建会话'); await click(format);
  await change('textarea[placeholder^="输入你的行动"]', '保留未发送草稿');
  streamOutput = '{"type":"choices","items":[{"id":"c1","text":"端起热茶"},{"id":"c2","text":"走向窗边"}]}';
  await act(async () => { button('生成选项').click(); button('生成选项').click(); });
  expect(streams).toBe(1); expect(messages.filter(message => message.role === 'user')).toHaveLength(0);
  expect(document).toMatchObject({ settings: { outputFormat: format === 'Markdown' ? 'markdown' : 'jsonl' }, draft: '保留未发送草稿', lastChoices: [{ id: 'c1', text: '端起热茶' }, { id: 'c2', text: '走向窗边' }] });
  expect(button('端起热茶').title).toBe('选择该行动'); streamOutput = format === 'Markdown' ? '接着讲故事' : '{"type":"narration","text":"接着讲故事"}';
  await act(async () => { button('端起热茶').click(); button('走向窗边').click(); });
  expect(streams).toBe(2); expect(messages.filter(message => message.role === 'user').map(message => message.content)).toEqual(['端起热茶']);
  expect(container.querySelector<HTMLTextAreaElement>('textarea[placeholder^="输入你的行动"]')!.value).toBe('保留未发送草稿');
  await click('继续生成'); expect(streams).toBe(3); expect(messages.filter(message => message.role === 'user')).toHaveLength(1);
  expect(document?.draft).toBe('保留未发送草稿');
});
it('shows invalid choices as preserved text instead of actionable buttons', async () => {
  await mount(); await click('新建会话');
  streamOutput = '{"type":"choices","items":[{"id":"c1","text":"不可执行的前缀"}]}\n{"type":"notice","level":"error","message":"生成要求未满足"}';
  await click('生成选项'); expect(container.textContent).toContain('不可执行的前缀');
  expect([...container.querySelectorAll('button')].some(node => node.textContent?.trim() === '不可执行的前缀')).toBe(false);
  expect(messages.at(-1)).toMatchObject({ status: 'error', meta: { rawOutput: streamOutput, choicesValid: false } });
  expect(streams).toBe(1);
});
it('preserves composer draft across preference updates and keeps null/player selection truthful', async () => {
  await mount(); await click('新建会话');
  await change('textarea[placeholder^="粘贴角色"]', JSON.stringify({ templateId: '通用角色', name: '唯一角色', content: '设定' })); await click('导入');
  const composer = container.querySelector<HTMLTextAreaElement>('textarea[placeholder^="输入你的行动"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(composer, '保住草稿'); composer.dispatchEvent(new Event('input', { bubbles: true })); });
  await click('Markdown'); expect(document?.draft).toBe('保住草稿'); expect(composer.value).toBe('保住草稿');
  const select = [...container.querySelectorAll('select')].find(item => [...item.options].some(option => option.textContent === '唯一角色'))!;
  expect(select.value).toBe(''); expect([...select.options].map(option => option.value)).toContain('');
  await act(async () => { select.value = document!.roles[0]!.id; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(document?.playerRoleId).toBe(document!.roles[0]!.id);
  await act(async () => { select.value = ''; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(document?.playerRoleId).toBeNull(); expect(composer.value).toBe('保住草稿');
});
it('removes the selected player role through the shared setup panel and sends as the fallback identity', async () => {
  await mount(); await click('新建会话');
  await change('textarea[placeholder^="粘贴角色"]', JSON.stringify([
    { templateId: '通用角色', name: '原玩家', content: '第一位设定' },
    { templateId: '通用角色', name: '新玩家', content: '第二位设定' },
  ])); await click('导入');
  const first = document!.roles[0]!; const second = document!.roles[1]!;
  const select = [...container.querySelectorAll('select')].find(item => [...item.options].some(option => option.textContent === '原玩家'))!;
  await act(async () => { select.value = first.id; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await change('textarea[placeholder^="输入你的行动"]', '过去的玩家台词'); await click('发送');
  const historical = structuredClone(messages);
  await change('textarea[placeholder^="输入你的行动"]', '留下草稿');
  await change('input[placeholder^="例如：旅人"]', '  自定旅人  ');
  const writes = () => native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party');
  const before = writes().length;
  const remove = container.querySelector<HTMLButtonElement>('[aria-label="编辑角色：原玩家"]')!.parentElement!.querySelectorAll('button')[1]!;
  await act(async () => remove.click());
  expect(writes()).toHaveLength(before + 1);
  expect(document).toMatchObject({ roles: [second], playerRoleId: null, draft: '留下草稿' });
  expect(select.value).toBe(''); expect(messages).toEqual(historical);
  await click('发送');
  const fallback = messages.find(message => message.content === '留下草稿');
  expect(fallback).not.toHaveProperty('speakerId'); expect(fallback?.meta?.speakerName).toBe('自定旅人');
  await act(async () => { select.value = second.id; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await change('textarea[placeholder^="输入你的行动"]', '重新扮演'); await click('发送');
  expect(messages.find(message => message.content === '重新扮演')).toMatchObject({ speakerId: second.id, meta: { speakerName: second.name } });
  expect(messages.slice(0, historical.length)).toEqual(historical);
  await click('×'); expect(document).toMatchObject({ roles: [], playerRoleId: null }); expect(select.value).toBe('');
});
it.each([false, true])('keeps the player selection unchanged while the role-removal save is unresolved (unknown=%s)', async unknown => {
  const role = { id: 'player', name: '原玩家', source: 'local' as const, card: { name: '原玩家' } };
  document = { id: 's', title: '恢复茶会', createdAt: 1, updatedAt: 1, roles: [role], playerRoleId: role.id,
    settings: { providerId: 'openai', modelId: 'm' }, draft: '' };
  await mount(); await openSession('恢复茶会');
  await change('textarea[placeholder^="输入你的行动"]', '保留草稿');
  const select = [...container.querySelectorAll('select')].find(item => [...item.options].some(option => option.textContent === role.name))!;
  const original = native.invoke.getMockImplementation()!; let reject = true;
  native.invoke.mockImplementation(async (command, args) => {
    if (command === 'mutate_magic_tea_party' && TeaWriteRequestSchema.parse(args.request).request.action === 'update' && reject) {
      reject = false;
      if (unknown) { await original(command, args); throw new Error('synthetic reply loss after commit'); }
      throw { code: 'tea-io', message: 'Local tea storage did not complete; retain the input or unsaved result', writeEvidence: 'not-written' };
    }
    return original(command, args);
  });
  const writes = () => native.invoke.mock.calls.filter(([command, args]) => command === 'mutate_magic_tea_party' && TeaWriteRequestSchema.parse(args.request).request.action === 'update').map(([, args]) => args.request);
  await click('×');
  expect(select.value).toBe(role.id); expect(select.disabled).toBe(true);
  expect(container.querySelector('[aria-label="编辑角色：原玩家"]')).toBeTruthy();
  expect(container.querySelector<HTMLTextAreaElement>('textarea[placeholder^="输入你的行动"]')!.value).toBe('保留草稿');
  expect(document).toMatchObject(unknown ? { roles: [], playerRoleId: null } : { roles: [role], playerRoleId: role.id });
  const pending = structuredClone(writes()[0]);
  expect(pending).toMatchObject({ request: { action: 'update', session: { roles: [], playerRoleId: null, draft: '保留草稿' } } });
  expect(button('重试原保存').disabled).toBe(unknown);
  expect(button('明确放弃易失结果').disabled).toBe(unknown);
  expect(button('导出未保存内容').disabled).toBe(false);
  await click(unknown ? '核对原保存' : '重试原保存');
  expect(writes()).toEqual(unknown ? [pending] : [pending, pending]);
  expect(select.value).toBe(''); expect(select.disabled).toBe(false);
  expect(container.querySelector('[aria-label="编辑角色：原玩家"]')).toBeNull();
  expect(document).toMatchObject({ roles: [], playerRoleId: null, draft: '保留草稿' });
  expect(streams).toBe(0);
});
it('opens an orphan player session without writing and normalizes the next sent message', async () => {
  document = { id: 's', title: '恢复茶会', createdAt: 1, updatedAt: 1, roles: [], playerRoleId: 'deleted',
    settings: { providerId: 'openai', modelId: 'm', userDisplayName: '  恢复旅人  ' }, draft: '恢复草稿' };
  await mount(); await openSession('恢复茶会');
  expect(native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party')).toHaveLength(0);
  expect(document.playerRoleId).toBe('deleted');
  await click('发送');
  expect(messages[0]).not.toHaveProperty('speakerId');
  expect(messages[0]).toMatchObject({ content: '恢复草稿', meta: { speakerName: '恢复旅人' } });
  expect(document.playerRoleId).toBeNull(); expect(streams).toBe(1);
});
it('keeps the player selected at send while credential preparation disables role removal', async () => {
  const role = { id: 'player', name: '原玩家', source: 'local' as const, card: { name: '原玩家' } };
  document = { id: 's', title: '恢复茶会', createdAt: 1, updatedAt: 1, roles: [role], playerRoleId: role.id,
    settings: { providerId: 'openai', modelId: 'm' }, draft: '在途台词' };
  await mount(); await openSession('恢复茶会');
  await act(async () => getDesktopAiConfigStore().selectProviderTarget({ kind: 'preset', providerId: 'deepseek' }));
  const original = native.invoke.getMockImplementation()!; let release!: () => void;
  native.invoke.mockImplementation(async (command, args) => {
    if (command === 'has_provider_secret') await new Promise<void>(resolve => { release = resolve; });
    return original(command, args);
  });
  await click('发送'); expect(release).toBeTypeOf('function');
  expect(button('×').disabled).toBe(true); await click('×');
  expect(document).toMatchObject({ roles: [role], playerRoleId: role.id });
  await act(async () => release());
  expect(messages[0]).toMatchObject({ speakerId: role.id, content: '在途台词', meta: { speakerName: role.name } });
  expect(streams).toBe(1);
});
it('stages completed title IME and continuous display-name typing without per-character writes or disabling the fields', async () => {
  await mount(); await click('新建会话');
  const writes = () => native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party').length;
  const before = writes();
  const title = container.querySelector<HTMLInputElement>('input[placeholder="输入会话标题"]')!;
  await act(async () => { title.focus(); title.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); });
  await change('input[placeholder="输入会话标题"]', '输入法组合中的标题');
  expect(title.value).toBe('输入法组合中的标题');
  expect(container.textContent).toContain('当前会话：新茶会');
  expect(container.textContent).not.toContain('当前会话：输入法组合中的标题');
  expect(writes()).toBe(before); expect(document?.title).toBe('新茶会');
  await act(async () => title.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  expect(container.textContent).toContain('当前会话：输入法组合中的标题');
  await act(async () => title.blur());
  expect(writes()).toBe(before); expect(document?.title).toBe('新茶会');
  for (const value of ['新', '新的', '新的标题😀']) {
    await change('input[placeholder="输入会话标题"]', value);
    expect(container.querySelector<HTMLInputElement>('input[placeholder="输入会话标题"]')!.matches(':disabled')).toBe(false);
  }
  for (const value of ['小', '小星', '小星😀']) await change('input[placeholder^="例如：旅人"]', value);
  expect(writes()).toBe(before); expect(document?.title).toBe('新茶会');
  await click('保存会话草稿');
  expect(writes()).toBe(before + 1); expect(document).toMatchObject({ title: '新的标题😀', settings: { userDisplayName: '小星😀' } });
});
it.each([false, true])('freezes the click intent while a real preset credential check is deferred (cancel=%s)', async cancel => {
  const router = await mount(); await click('新建会话');
  await act(async () => getDesktopAiConfigStore().selectProviderTarget({ kind: 'preset', providerId: 'deepseek' }));
  const composer = container.querySelector<HTMLTextAreaElement>('textarea[placeholder^="输入你的行动"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(composer, '点击时原输入'); composer.dispatchEvent(new Event('input', { bubbles: true })); });
  const original = native.invoke.getMockImplementation()!; let release!: () => void;
  native.invoke.mockImplementation(async (command, args) => {
    if (command === 'has_provider_secret') await new Promise<void>(resolve => { release = resolve; });
    return original(command, args);
  });
  await click('发送'); expect(release).toBeTypeOf('function'); expect(streams).toBe(0);
  expect(composer.disabled).toBe(true); expect(button('新建').matches(':disabled')).toBe(true);
  expect(setupControls()).toHaveLength(6);
  for (const control of setupControls()) {
    expect(control.matches(':disabled')).toBe(true);
    const activated = vi.fn(); control.addEventListener('click', activated);
    await act(async () => { control.labels![0]!.click(); control.focus(); });
    expect(activated).not.toHaveBeenCalled();
    expect(window.document.activeElement).not.toBe(control);
  }
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(composer, '不得替换的新输入'); composer.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { void router.navigate({ to: '/settings' }); });
  expect(container.textContent).toContain('茶会仍有生成');
  if (cancel) await click('停止生成');
  await act(async () => release());
  expect(streams).toBe(cancel ? 0 : 1);
  if (cancel) expect(composer.value).toBe('点击时原输入');
  else expect(messages.find(message => message.role === 'user')?.content).toBe('点击时原输入');
  expect(getDesktopAiConfigStore().getSnapshot().generationActive).toBe(false);
});
it.each([
  ['choices', false], ['choices', true], ['selected-choice', false], ['selected-choice', true],
] as const)('freezes %s and its independent draft during credential preparation (cancel=%s)', async (kind, cancel) => {
  await mount(); await click('新建会话'); await click('Markdown');
  streamOutput = '{"type":"choices","items":[{"id":"c1","text":"冻结点击的行动"}]}';
  if (kind === 'selected-choice') await click('生成选项');
  const before = streams; await change('textarea[placeholder^="输入你的行动"]', '不能替换的草稿');
  await act(async () => getDesktopAiConfigStore().selectProviderTarget({ kind: 'preset', providerId: 'deepseek' }));
  const original = native.invoke.getMockImplementation()!; let release!: () => void;
  native.invoke.mockImplementation(async (command, args) => {
    if (command === 'has_provider_secret') await new Promise<void>(resolve => { release = resolve; });
    return original(command, args);
  });
  const label = kind === 'choices' ? '生成选项' : '冻结点击的行动';
  await act(async () => { button(label).click(); button(label).click(); });
  expect(streams).toBe(before); expect(release).toBeTypeOf('function');
  const composer = container.querySelector<HTMLTextAreaElement>('textarea[placeholder^="输入你的行动"]')!;
  expect(composer.disabled).toBe(true); expect(button('新建').matches(':disabled')).toBe(true);
  await change('textarea[placeholder^="输入你的行动"]', '不可晚到覆盖');
  if (cancel) await click('停止生成');
  await act(async () => release());
  expect(streams).toBe(before + (cancel ? 0 : 1)); expect(composer.value).toBe('不能替换的草稿');
  expect(document?.settings.outputFormat).toBe('markdown');
  expect(messages.filter(message => message.role === 'user').map(message => message.content)).toEqual(kind === 'selected-choice' && !cancel ? ['冻结点击的行动'] : []);
  expect(getDesktopAiConfigStore().getSnapshot().generationActive).toBe(false);
});
it('keeps unsubmitted paste behind the leave guard and allows explicit local clearing after session deletion', async () => {
  const router = await mount(); await click('新建会话');
  await change('textarea[placeholder^="粘贴角色"]', '尚未导入的唯一原文');
  await act(async () => { void router.navigate({ to: '/settings' }); });
  expect(container.textContent).toContain('茶会仍有生成');
  await click('删除'); await click('确认删除');
  const paste = container.querySelector<HTMLTextAreaElement>('textarea[placeholder^="粘贴角色"]')!;
  expect(document).toBeNull(); expect(paste.value).toBe('尚未导入的唯一原文');
  const clear = [...container.querySelectorAll('button')].find(item => item.textContent?.trim() === '清空' && !item.disabled)!;
  expect(clear).toBeTruthy(); await act(async () => clear.click()); expect(paste.value).toBe('');
  await act(async () => { await router.navigate({ to: '/settings' }); });
  expect(container.querySelector('[data-testid="page-settings"]')).toBeTruthy();
});
it.each(['/settings', '/magic-tavern'] as const)('retains unsaved draft and blocks %s departure until its explicit save', async (to) => {
  const router = await mount(); await click('新建会话');
  const composer = container.querySelector<HTMLTextAreaElement>('textarea[placeholder^="输入你的行动"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(composer, '未保存😀'); composer.dispatchEvent(new Event('input', { bubbles: true })); });
  const sessionId = document?.id;
  const preference = localStorage.getItem(DESKTOP_AI_CONFIG_STORAGE_KEY);
  const writesBeforeNavigation = native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party').length;
  await act(async () => { void router.navigate({ to }); });
  expect(container.textContent).toContain('茶会仍有生成');
  expect(router.state.location.pathname).toBe('/magic-tea-party');
  expect(window.location.hash).toBe('#/magic-tea-party');
  expect(composer.value).toBe('未保存😀');
  expect(native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party')).toHaveLength(writesBeforeNavigation);
  await click('保存会话草稿'); expect(document?.draft).toBe('未保存😀');
  await act(async () => { await router.navigate({ to }); });
  if (to === '/settings') expect(container.querySelector('[data-testid="page-settings"]')).toBeTruthy();
  else {
    expect(router.state.location.pathname).toBe('/magic-tea-party');
    expect(window.location.hash).toBe('#/magic-tea-party');
    expect(container.querySelector<HTMLTextAreaElement>('textarea[placeholder^="输入你的行动"]')!.value).toBe('未保存😀');
  }
  expect(document?.id).toBe(sessionId); expect(streams).toBe(0);
  expect(localStorage.getItem(DESKTOP_AI_CONFIG_STORAGE_KEY)).toBe(preference);
});

it('runs the real page manual summary controls, preserves draft and persists full edited text before clearing', async () => {
  await mount(); await click('新建会话'); await change('textarea[placeholder^="输入你的行动"]', '先前剧情'); await click('发送');
  await change('textarea[placeholder^="输入你的行动"]', '不能发出的草稿');
  await change('textarea[aria-label="会话摘要正文"]', '  手工摘要原件  ');
  expect(document?.summary).toBeUndefined(); expect(button('保存摘要').disabled).toBe(false);
  await click('保存摘要'); expect(document?.summary).toBe('  手工摘要原件  ');
  streamOutput = '  成功的摘要正文😀  ';
  await act(async () => { button('生成/更新摘要').click(); button('生成/更新摘要').click(); });
  expect(streams).toBe(2); expect(document?.summary).toBe('成功的摘要正文😀');
  expect(document?.draft).toBe('不能发出的草稿'); expect(messages.at(-1)).toMatchObject({ meta: { kind: 'summary', rawOutput: streamOutput } });
  expect(container.textContent).toContain('魔法茶会 · 摘要操作');
  const calls = native.invoke.mock.calls.filter(([command]) => command === 'stream_target_ai');
  const summaryRequest = calls.at(-1)![1]!.request as { messages: Array<{ content: string }> };
  expect(summaryRequest.messages[0]!.content).toContain('【任务】生成会话摘要'); expect(summaryRequest.messages[0]!.content).not.toContain('不能发出的草稿');
  await unmount(); root = createRoot(container); await mount(); await openSession('新茶会');
  expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="会话摘要正文"]')!.value).toBe('成功的摘要正文😀');
  const panel = container.querySelector('textarea[aria-label="会话摘要正文"]')!.closest('.rounded-xl')!;
  await act(async () => [...panel.querySelectorAll('button')].find(node => node.textContent === '清空')!.click());
  expect(document?.summary).toBeUndefined(); expect(document?.summaryMeta).toBeUndefined();
  expect(streams).toBe(2);
});
it('protects summary drafts on departure and does not write one session document for each keystroke', async () => {
  const router = await mount(); await click('新建会话');
  const before = native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party').length;
  await change('textarea[aria-label="会话摘要正文"]', '一'); await change('textarea[aria-label="会话摘要正文"]', '完整编辑中的摘要');
  expect(native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party')).toHaveLength(before);
  await act(async () => { void router.navigate({ to: '/settings' }); }); expect(container.textContent).toContain('茶会仍有生成');
  await click('保存摘要'); expect(document?.summary).toBe('完整编辑中的摘要');
  await act(async () => { await router.navigate({ to: '/settings' }); }); expect(container.querySelector('[data-testid="page-settings"]')).toBeTruthy();
});
it.each([false, true])('freezes manual summary and composer edits during credential preparation (cancel=%s)', async cancel => {
  await mount(); await click('新建会话'); await change('textarea[placeholder^="输入你的行动"]', '已有历史'); await click('发送');
  const before = streams; await change('textarea[placeholder^="输入你的行动"]', '冻结草稿'); await change('textarea[aria-label="会话摘要正文"]', '冻结摘要编辑');
  await act(async () => getDesktopAiConfigStore().selectProviderTarget({ kind: 'preset', providerId: 'deepseek' }));
  const original = native.invoke.getMockImplementation()!; let release!: () => void;
  native.invoke.mockImplementation(async (command, args) => { if (command === 'has_provider_secret') await new Promise<void>(resolve => { release = resolve; }); return original(command, args); });
  await act(async () => { button('生成/更新摘要').click(); button('生成/更新摘要').click(); });
  expect(streams).toBe(before); expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="会话摘要正文"]')!.disabled).toBe(true);
  await change('textarea[aria-label="会话摘要正文"]', '不得迟到替换'); await change('textarea[placeholder^="输入你的行动"]', '不得迟到发出');
  if (cancel) await click('停止生成'); streamOutput = '摘要完成'; await act(async () => release());
  expect(streams).toBe(before + (cancel ? 0 : 1)); expect(container.querySelector<HTMLTextAreaElement>('textarea[placeholder^="输入你的行动"]')!.value).toBe('冻结草稿');
  expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="会话摘要正文"]')!.value).toBe(cancel ? '冻结摘要编辑' : '摘要完成');
  expect(getDesktopAiConfigStore().getSnapshot().generationActive).toBe(false);
});

it('offers an actual export after staged summary admission fails, with no Native write or model call', async () => {
  await mount(); await click('新建会话'); document!.future = 'x'.repeat(8 * 1024 * 1024 - 4000); await openSession('新茶会');
  const text = '原件'.repeat(3000); await change('textarea[aria-label="会话摘要正文"]', text);
  const before = native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party').length;
  await click('保存摘要'); expect(streams).toBe(0); expect(document?.summary).toBeUndefined();
  expect(native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party')).toHaveLength(before);
  expect(container.textContent).toContain('内容超过桌面文本存储边界');
  const download = vi.spyOn(downloads, 'downloadTextFile').mockImplementation(() => {});
  await click('导出未保存摘要'); expect(download).toHaveBeenCalledOnce();
  expect(JSON.parse(download.mock.calls[0]![1])).toMatchObject({ summary: text, future: document!.future });
});

it('persists the actual per-session automatic switch without invoking a model, then summarizes one normal turn', async () => {
  document = { id: 'automatic-page', title: '显式自动摘要茶会', createdAt: 1, updatedAt: 1, roles: [],
    settings: { providerId: 'openai', modelId: 'synthetic', outputFormat: 'markdown', maxContextMessages: 2, summaryMinGapMessages: 8 } };
  messages = Array.from({ length: 8 }, (_, index) => ({ id: `auto-history-${index}`, sessionId: document!.id,
    role: 'user' as const, content: `原始剧情${index}`, createdAt: index, status: 'done' as const }));
  const before = JSON.stringify(messages);
  await mount(); await openSession('显式自动摘要茶会');
  const checkbox = [...container.querySelectorAll('label')].find(label => label.textContent?.includes('自动更新会话摘要'))!.querySelector<HTMLInputElement>('input')!;
  expect(checkbox.checked).toBe(false); expect(streams).toBe(0);
  await act(async () => checkbox.click());
  expect(document?.settings.autoSummaryEnabled).toBe(true); expect(streams).toBe(0);
  streamOutput = '正常剧情和摘要'; await click('继续生成');
  expect(streams).toBe(2); expect(document?.summary).toBe('正常剧情和摘要');
  expect(JSON.stringify(messages.slice(0, 8))).toBe(before);
  expect(messages.at(-1)?.meta?.kind).toBe('summary');
});

it('restores sidebar folding and persists toggles without mutating tea sessions', async () => {
  const key = 'magic-tea-party:session-sidebar-v1';
  localStorage.setItem(key, JSON.stringify({ pinnedCollapsed: true, recentCollapsed: true }));
  await mount(); await click('新建会话');
  native.invoke.mockClear();
  const recent = () => [...container.querySelectorAll('button')].find(b => b.textContent?.includes('最近会话（'));
  expect(recent()?.textContent).toContain('展开');
  await act(async () => recent()!.click());
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ pinnedCollapsed: true, recentCollapsed: false });
  await unmount(); root = createRoot(container); await mount();
  expect(recent()?.textContent).toContain('收起');
  expect(native.invoke.mock.calls.some(([command]) => command === 'mutate_magic_tea_party')).toBe(false);
});

it('edits a session role through the shared form and actual owner/bridge receipt, then reloads the saved source', async () => {
  await mount(); await click('新建会话');
  const card = { templateId: '通用角色', name: '星見', content: '完整设定', extension: { keep: ['😀', 7] },
    current_state: { summary: '旧状态', fields: [{ id: 'hp', label: '生命', type: 'number', value: 4 }], extra: { untouched: true } } };
  await change('textarea[placeholder^="粘贴角色"]', JSON.stringify(card)); await click('导入');
  const openEditor = () => act(async () => container.querySelector<HTMLButtonElement>('button[aria-label^="编辑角色："]')!.click());
  await openEditor(); expect(window.document.activeElement?.textContent).toBe('会话角色编辑');
  await change('input[aria-label="角色名称"]', '新星見'); await change('input[aria-label="角色备注"]', '会话备注');
  await change('textarea[aria-label="当前状态摘要"]', '新状态');
  const original = native.invoke.getMockImplementation()!; let release!: () => void; let updates = 0;
  native.invoke.mockImplementation(async (command, args) => {
    if (command === 'mutate_magic_tea_party' && TeaWriteRequestSchema.parse(args.request).request.action === 'update') {
      updates += 1; await new Promise<void>(resolve => { release = resolve; });
    }
    return original(command, args);
  });
  await act(async () => { button('保存修改').click(); button('保存修改').click(); });
  expect(updates).toBe(1); expect(document!.roles[0]!.name).toBe('星見'); expect(container.textContent).not.toContain('角色修改已保存');
  expect(container.querySelector<HTMLInputElement>('input[aria-label="角色名称"]')!.matches(':disabled')).toBe(true);
  await act(async () => release());
  expect(container.textContent).toContain('角色修改已保存到本地会话');
  expect(document!.roles[0]).toMatchObject({ name: '新星見', notes: '会话备注', card: { ...card, name: '新星見', current_state: { ...card.current_state, summary: '新状态' } } });
  expect(streams).toBe(0);
  await click('收起角色编辑'); expect(window.document.activeElement?.getAttribute('aria-label')).toBe('编辑角色：新星見');
  await unmount(); root = createRoot(container); native.invoke.mockImplementation(original);
  await mount(); await openSession('新茶会'); await openEditor();
  expect(container.querySelector<HTMLInputElement>('input[aria-label="角色名称"]')!.value).toBe('新星見');
  expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="当前状态摘要"]')!.value).toBe('新状态');
  expect(document!.roles[0]!.card.extension).toEqual(card.extension); expect(streams).toBe(0);
});

it('keeps a failed role draft, fences navigation, and retries only the original local write', async () => {
  const router = await mount(); await click('新建会话');
  await change('textarea[placeholder^="粘贴角色"]', JSON.stringify({ templateId: '通用角色', name: '原名', content: '完整设定' })); await click('导入');
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label^="编辑角色："]')!.click());
  await change('input[aria-label="角色名称"]', '失败保稿');
  await act(async () => { void router.navigate({ to: '/settings' }); });
  expect(container.textContent).toContain('茶会仍有生成、未保存输入');
  const original = native.invoke.getMockImplementation()!; let fail = true;
  native.invoke.mockImplementation(async (command, args) => {
    if (command === 'mutate_magic_tea_party' && fail) { fail = false; throw { code: 'tea-io', message: 'Local tea storage did not complete; retain the input or unsaved result', writeEvidence: 'not-written' }; }
    return original(command, args);
  });
  await click('保存修改'); expect(container.querySelector<HTMLInputElement>('input[aria-label="角色名称"]')!.value).toBe('失败保稿');
  expect(container.textContent).toContain('保存未完成'); expect(document!.roles[0]!.name).toBe('原名');
  await click('重试原保存'); expect(document!.roles[0]!.name).toBe('失败保稿'); expect(streams).toBe(0);
  await click('重置'); expect(container.querySelector<HTMLInputElement>('input[aria-label="角色名称"]')!.value).toBe('失败保稿');
  await act(async () => { await router.navigate({ to: '/settings' }); }); expect(container.textContent).toContain('设置');
});

it.each(['role', 'session'] as const)('keeps an orphaned role draft after deleting its %s and releases departure only after confirmed discard', async target => {
  const router = await mount(); await click('新建会话');
  await change('textarea[placeholder^="粘贴角色"]', JSON.stringify({ templateId: '通用角色', name: '待移除角色', content: '原设定' }));
  await click('导入');
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label^="编辑角色："]')!.click());
  await change('input[aria-label="角色名称"]', '仍需保留的未保存角色稿');
  if (target === 'role') {
    const roleChip = container.querySelector<HTMLButtonElement>('button[aria-label^="编辑角色："]')!.parentElement!;
    await act(async () => [...roleChip.querySelectorAll('button')].find(node => node.textContent?.trim() === '×')!.click());
    expect(document?.roles).toEqual([]);
  } else {
    await click('删除'); await click('确认删除'); expect(document).toBeNull();
  }
  expect(container.textContent).toContain('有未保存的角色修改');
  const discard = button('放弃全部角色草稿');
  expect(discard.closest('[hidden]')).toBeNull(); expect(discard.matches(':disabled')).toBe(false);
  const writes = native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party').length;
  await act(async () => { void router.navigate({ to: '/settings' }); });
  expect(router.state.location.pathname).toBe('/magic-tea-party');
  expect(container.textContent).toContain('茶会仍有生成、未保存输入');
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  await click('放弃全部角色草稿'); expect(confirm).toHaveBeenCalledOnce();
  expect(button('放弃全部角色草稿').closest('[hidden]')).toBeNull();
  await act(async () => { void router.navigate({ to: '/settings' }); });
  expect(router.state.location.pathname).toBe('/magic-tea-party');
  const stillProtected = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(stillProtected); expect(stillProtected.defaultPrevented).toBe(true);
  expect(native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party')).toHaveLength(writes);
  confirm.mockReturnValue(true); await click('放弃全部角色草稿'); expect(confirm).toHaveBeenCalledTimes(2);
  const released = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(released); expect(released.defaultPrevented).toBe(false);
  expect(native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party')).toHaveLength(writes);
  expect(streams).toBe(0);
  await act(async () => { await router.navigate({ to: '/settings' }); });
  expect(container.querySelector('[data-testid="page-settings"]')).toBeTruthy();
});

it('keeps successful role receipts across name-only and cleared-notes saves using the owner normalized JSON snapshot', async () => {
  const router = await mount(); await click('新建会话');
  await change('textarea[placeholder^="粘贴角色"]', JSON.stringify({ templateId: '通用角色', name: '原始角色', content: '原设定', extension: { keep: ['原件'] } }));
  await click('导入');
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label^="编辑角色："]')!.click());
  const before = native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party').length;
  const scenarios = [
    { name: '只改名称', notes: '', expectedNotes: undefined },
    { name: '第二次名称', notes: '临时备注', expectedNotes: '临时备注' },
    { name: '清空备注后名称', notes: '   ', expectedNotes: undefined },
    { name: '继续只改名称', notes: '', expectedNotes: undefined },
  ];
  for (const scenario of scenarios) {
    await change('input[aria-label="角色名称"]', scenario.name);
    await change('input[aria-label="角色备注"]', scenario.notes);
    await click('保存修改');
    const saved = document!.roles[0]!;
    expect(saved.name).toBe(scenario.name);
    expect(saved.notes).toBe(scenario.expectedNotes);
    expect(Object.hasOwn(saved, 'notes')).toBe(scenario.expectedNotes !== undefined);
    expect(saved.card.extension).toEqual({ keep: ['原件'] });
    const editor = container.querySelector('form[aria-label="会话角色基础编辑"]')!;
    expect(editor.querySelector('[role="status"]')?.textContent).toBe('角色修改已保存到本地会话。');
    expect(editor.querySelector('[role="alert"]')).toBeNull();
    expect(button('保存修改').disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[aria-label="角色名称"]')!.value).toBe(scenario.name);
  }
  expect(native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party')).toHaveLength(before + scenarios.length);
  expect(streams).toBe(0);
  await act(async () => { await router.navigate({ to: '/settings' }); });
  expect(container.querySelector('[data-testid="page-settings"]')).toBeTruthy();
});


it('previews an existing preset, cancels without writes, then applies one CAS', async () => {
  await mount(); await click('新建会话');
  const before = native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party').length;
  const choose = () => act(async () => container.querySelector<HTMLButtonElement>('button[title="预览并应用预设"]')!.click());
  await choose();
  expect(container.textContent).toContain('预览');
  expect(native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party')).toHaveLength(before);
  await click('返回，不更改');
  expect(native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party')).toHaveLength(before);
  await choose(); await click('确认应用预设');
  expect(native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party')).toHaveLength(before + 1);
  expect(document?.settings.presetId).toBe('arena-classic');
});

it('cancels actual loaded-selection cleanup without a write and invalidates confirmation when search changes', async () => {
  await mount(); await click('新建会话');
  const original = native.invoke.getMockImplementation()!;
  native.invoke.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    const response = await original(command, args);
    if (command === 'read_magic_tea_party' && (args.request as { request?: { action?: string } }).request?.action === 'list') {
      response.result.rows.push({ id: 'other', instance: 'b'.repeat(32), revision: 1, title: '其他会话', titleTruncated: false,
        createdAt: 1, updatedAt: 1, pinnedAt: 0, pinnedOrder: 0, messageCount: 0, roleCount: 0, roleNames: [], scenarioTitle: null });
    }
    return response;
  });
  await click('刷新首页');
  await change('textarea[placeholder^="输入你的行动"]', '未保存当前草稿');
  const writes = () => native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party').length;
  const before = writes();
  const select = () => act(async () => container.querySelector<HTMLInputElement>('input[aria-label="选择清理 其他会话"]')!.click());
  await select(); await click('预览清理 1 个会话');
  expect(container.textContent).toContain('将永久删除以下 1 个会话');
  await click('取消清理'); expect(writes()).toBe(before);
  expect(container.querySelector<HTMLTextAreaElement>('textarea[placeholder^="输入你的行动"]')!.value).toBe('未保存当前草稿');
  await click('预览清理 1 个会话');
  await change('input[placeholder="搜索已加载会话标题 / 角色 / 情景"]', '其他');
  expect(container.textContent).not.toContain('将永久删除以下');
  expect(button('预览清理 0 个会话').disabled).toBe(true); expect(writes()).toBe(before);
});

it('uses the shared user editor for cancel, empty and single-write fork; continuation stays manual', async () => {
  await mount(); await click('新建会话'); await change('textarea[placeholder^="输入你的行动"]', '原输入'); await click('发送');
  const original = structuredClone(document); const before = native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party').length;
  const generated = streams;
  await click('编辑并分支'); await change('textarea[placeholder="编辑后将创建新会话分支"]', ' ');
  expect(button('创建分支').disabled).toBe(true);
  expect(button('导出消息编辑草稿').disabled).toBe(false);
  const editor = container.querySelector('textarea[placeholder="编辑后将创建新会话分支"]')!.parentElement!;
  await act(async () => [...editor.querySelectorAll('button')].find(node => node.textContent?.trim() === '取消')!.click());
  expect(container.querySelector('textarea[placeholder="编辑后将创建新会话分支"]')).toBeNull();
  expect(native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party')).toHaveLength(before);
  await click('编辑并分支'); await change('textarea[placeholder="编辑后将创建新会话分支"]', '分支输入😀');
  await act(async () => { button('创建分支').click(); button('创建分支').click(); });
  const writes = native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party');
  expect(writes).toHaveLength(before + 1);
  expect(TeaWriteRequestSchema.parse(writes.at(-1)![1]!.request).request).toMatchObject({ action: 'fork', sessionId: original!.id, editedContent: '分支输入😀' });
  expect(document!.id).not.toBe(original!.id); expect(messages).toHaveLength(1); expect(messages[0]!.content).toBe('分支输入😀');
  expect(container.querySelector('textarea[placeholder="编辑后将创建新会话分支"]')).toBeNull(); expect(streams).toBe(generated);
  expect(container.textContent).toContain('可手动续写');
  expect(container.textContent).toContain(`分支来源（改写分支）：会话 ${original!.id}`);
  expect(container.textContent).toContain('原会话与分支保持独立');
  expect(button('审阅合并到原会话').disabled).toBe(false);
});

it('refuses inline fork editing while composer or pasted card drafts are unsaved', async () => {
  await mount(); await click('新建会话'); await change('textarea[placeholder^="输入你的行动"]', '原输入'); await click('发送');
  const before = native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party').length;
  await change('textarea[placeholder^="输入你的行动"]', '未保存输入'); await click('编辑并分支');
  expect(container.querySelector('textarea[placeholder="编辑后将创建新会话分支"]')).toBeNull();
  expect(container.querySelector<HTMLTextAreaElement>('textarea[placeholder^="输入你的行动"]')!.value).toBe('未保存输入');
  await change('textarea[placeholder^="输入你的行动"]', '');
  await change('textarea[placeholder^="粘贴角色"]', '未导入角色'); await click('编辑并分支');
  expect(container.querySelector('textarea[placeholder="编辑后将创建新会话分支"]')).toBeNull();
  expect(container.querySelector<HTMLTextAreaElement>('textarea[placeholder^="粘贴角色"]')!.value).toBe('未导入角色');
  expect(native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party')).toHaveLength(before);
});


it('preserves a role form draft rather than forking or saving it implicitly', async () => {
  await mount(); await click('新建会话');
  await change('textarea[placeholder^="粘贴角色"]', JSON.stringify({ templateId: '通用角色', name: '原角色', content: '设定' })); await click('导入');
  await change('textarea[placeholder^="输入你的行动"]', '原输入'); await click('发送');
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label^="编辑角色："]')!.click());
  await change('input[aria-label="角色名称"]', '未保存角色');
  const before = native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party').length;
  await click('编辑并分支');
  expect(container.querySelector('textarea[placeholder="编辑后将创建新会话分支"]')).toBeNull();
  expect(container.querySelector<HTMLInputElement>('input[aria-label="角色名称"]')!.value).toBe('未保存角色');
  expect(document!.roles[0]!.name).toBe('原角色');
  expect(native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party')).toHaveLength(before);
});

it('preserves a provider connection draft and does not fork or save it implicitly', async () => {
  await mount(); await click('新建会话'); await change('textarea[placeholder^="输入你的行动"]', '原输入'); await click('发送');
  await click('更新凭据');
  const heading = [...container.querySelectorAll('h3')].find(node => node.textContent?.trim() === '编辑连接')!;
  const name = heading.parentElement!.querySelector('input')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, '未保存连接'); name.dispatchEvent(new Event('input', { bubbles: true })); });
  const before = native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party').length;
  await click('编辑并分支');
  expect(container.querySelector('textarea[placeholder="编辑后将创建新会话分支"]')).toBeNull(); expect(name.value).toBe('未保存连接');
  expect(native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party')).toHaveLength(before);
  expect(native.invoke.mock.calls.some(([command]) => command === 'save_provider_profile')).toBe(false);
});

const createMergeBranch = async () => {
  await mount(); await click('新建会话'); await change('textarea[placeholder^="输入你的行动"]', '父剧情锚点'); await click('发送');
  await click('编辑并分支'); await change('textarea[placeholder="编辑后将创建新会话分支"]', '分支改写剧情'); await click('创建分支');
};
const teaWrites = () => native.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party');

it('previews both merge targets, cancels without writes and confirms once without generating', async () => {
  await createMergeBranch();
  const branch = document!.id; const before = teaWrites().length; const generated = streams;
  await click('审阅合并到原会话');
  const preview = container.querySelector('section[aria-label="审阅分支合并"]')!;
  expect(preview.textContent).toContain(branch); expect(preview.textContent).toContain(forkParent!.session.id);
  for (const text of ['父剧情锚点', '分支改写剧情', '替换 2 条', '复制分支尾部 1 条', '旧历史仍保留', '来源分支不变', '不会调用模型']) expect(preview.textContent).toContain(text);
  expect(button('保存会话草稿').disabled).toBe(true);
  await click('取消合并');
  expect(container.querySelector('section[aria-label="审阅分支合并"]')).toBeNull(); expect(teaWrites()).toHaveLength(before);
  await click('审阅合并到原会话');
  await act(async () => { button('确认合并到原会话').click(); button('确认合并到原会话').click(); });
  expect(teaWrites()).toHaveLength(before + 1); expect(streams).toBe(generated);
  const request = TeaWriteRequestSchema.parse(teaWrites().at(-1)![1]!.request).request;
  expect(request).toMatchObject({ action: 'merge', source: { sessionId: branch }, parent: { sessionId: forkParent!.session.id } });
  expect(document!.id).toBe(forkParent!.session.id);
  expect(container.querySelector('section[aria-label="审阅分支合并"]')).toBeNull();
});

it('preserves pasted and composer drafts rather than implicitly saving them for merge', async () => {
  await createMergeBranch(); const before = teaWrites().length;
  await change('textarea[placeholder^="粘贴角色"]', '未导入的角色草稿');
  await click('审阅合并到原会话');
  expect(container.querySelector('section[aria-label="审阅分支合并"]')).toBeNull();
  expect(container.querySelector<HTMLTextAreaElement>('textarea[placeholder^="粘贴角色"]')!.value).toBe('未导入的角色草稿');
  await change('textarea[placeholder^="粘贴角色"]', '');
  await change('textarea[placeholder^="输入你的行动"]', '尚未保存的行动'); await click('审阅合并到原会话');
  expect(container.querySelector('section[aria-label="审阅分支合并"]')).toBeNull();
  expect(container.querySelector<HTMLTextAreaElement>('textarea[placeholder^="输入你的行动"]')!.value).toBe('尚未保存的行动');
  expect(teaWrites()).toHaveLength(before);
});

it('keeps superseded Desktop choice messages visible but non-actionable and active choices still work', async () => {
  await mount(); await click('新建会话');
  const choices = [{ id: 'old', text: '被替换的旧行动' }];
  messages = [{ id: 'old-choice', sessionId: document!.id, role: 'assistant', content: '旧行动', createdAt: 1, status: 'done',
    choices, segments: [{ type: 'choices', items: choices }], meta: { superseded: true, choicesValid: true } }];
  await click('首批消息');
  expect(container.textContent).toContain('被替换的旧行动'); expect(container.textContent).toContain('该条消息已被更新替换');
  expect([...container.querySelectorAll('button')].some(node => node.textContent === '被替换的旧行动')).toBe(false);
  const before = teaWrites().length;
  const historicalAction = [...container.querySelectorAll('div')].find(node => node.textContent === '被替换的旧行动')!;
  expect(historicalAction).toBeTruthy(); await act(async () => historicalAction.click());
  expect(teaWrites()).toHaveLength(before); expect(streams).toBe(0);
  messages = [{ ...messages[0]!, meta: { choicesValid: true } }]; await click('首批消息');
  await click('被替换的旧行动'); expect(streams).toBe(1);
});

it('preserves a role form draft and blocks merge without an implicit role save', async () => {
  await createMergeBranch();
  await change('textarea[placeholder^="粘贴角色"]', JSON.stringify({ templateId: '通用角色', name: '原角色', content: '设定' })); await click('导入');
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label^="编辑角色："]')!.click());
  await change('input[aria-label="角色名称"]', '合并前未保存角色');
  const before = teaWrites().length;
  await click('审阅合并到原会话');
  expect(container.querySelector('section[aria-label="审阅分支合并"]')).toBeNull();
  expect(container.querySelector<HTMLInputElement>('input[aria-label="角色名称"]')!.value).toBe('合并前未保存角色');
  expect(document!.roles[0]!.name).toBe('原角色'); expect(teaWrites()).toHaveLength(before);
});

it('preserves a provider draft and blocks merge without an implicit connection save', async () => {
  await createMergeBranch(); await click('更新凭据');
  const heading = [...container.querySelectorAll('h3')].find(node => node.textContent?.trim() === '编辑连接')!;
  const name = heading.parentElement!.querySelector('input')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, '合并前未保存连接'); name.dispatchEvent(new Event('input', { bubbles: true })); });
  const before = teaWrites().length;
  await click('审阅合并到原会话');
  expect(container.querySelector('section[aria-label="审阅分支合并"]')).toBeNull(); expect(name.value).toBe('合并前未保存连接');
  expect(teaWrites()).toHaveLength(before); expect(native.invoke.mock.calls.some(([command]) => command === 'save_provider_profile')).toBe(false);
});

it('keeps a changed parent out of the merge and requires a fresh review instead of silently refreshing CAS', async () => {
  await createMergeBranch(); const sourceId = document!.id; const originalMessages = structuredClone(messages);
  await click('审阅合并到原会话'); const reviewedRevision = forkParent!.revision; forkParent!.revision += 1;
  await click('确认合并到原会话');
  expect(document!.id).toBe(sourceId); expect(messages).toEqual(originalMessages);
  expect(container.textContent).toContain('重新审阅');
  const failed = TeaWriteRequestSchema.parse(teaWrites().at(-1)![1]!.request).request;
  expect(failed).toMatchObject({ action: 'merge', parent: { expectedRevision: reviewedRevision } });
  expect(container.querySelector('section[aria-label="审阅分支合并"]')).toBeNull();
  vi.spyOn(window, 'confirm').mockReturnValue(true); await click('明确放弃易失结果');
  await click('审阅合并到原会话'); await click('确认合并到原会话');
  expect(document!.id).toBe(forkParent!.session.id);
  const fresh = TeaWriteRequestSchema.parse(teaWrites().at(-1)![1]!.request).request;
  expect(fresh).toMatchObject({ action: 'merge', parent: { expectedRevision: reviewedRevision + 1 } });
  expect(fresh.action === 'merge' && failed.action === 'merge' && fresh.operationId !== failed.operationId).toBe(true);
});
