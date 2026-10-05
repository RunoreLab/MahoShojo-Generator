// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildUnsignedMagicalGirlDetailsCard } from '@mahoshojo/ai-core/magical-girl-details-generation';
import type { DetailsGenerationOutcome } from '../src/features/details/generation';
import { DETAILS_DRAFT_KEY } from '../src/features/details/session';
import { builtinSelectionId } from '../src/features/details/questionnaire';
import { resetDesktopAiConfigStoreForTests } from '../src/features/ai-config/use-desktop-ai-config';
import { DESKTOP_AI_CONFIG_STORAGE_KEY } from '../src/features/ai-config/desktop-ai-config-store';
import { createDesktopRouter } from '../src/app/router';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), save: vi.fn(), listen: vi.fn(), profiles: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: mocks.listen }) }));
vi.mock('../src/features/details/generation', async (original) => ({ ...await original<object>(), executeDetailsGeneration: mocks.execute }));
vi.mock('../src/platform/provider-profile-bridge', () => ({ listProviderProfileIds: async () => ['local'], getProviderProfile: mocks.profiles }));
vi.mock('../src/platform/local-card-bridge', () => ({ IpcLocalCardRepository: class { putIfAbsent = mocks.save; } }));

const questionnaire = JSON.parse(readFileSync(resolve(process.cwd(), '../../content/questionnaires/presets/magical-girl-default.json'), 'utf8'));
const card = buildUnsignedMagicalGirlDetailsCard({
  codename: '百合', appearance: { outfit: '礼服', accessories: '', colorScheme: '', overallLook: '' },
  magicConstruct: { name: '', form: '', basicAbilities: [], description: '' },
  wonderlandRule: { name: '', description: '', tendency: '', activation: '' },
  blooming: { name: '', evolvedAbilities: [], evolvedForm: '', evolvedOutfit: '', powerLevel: '' },
  analysis: { personalityAnalysis: '', abilityReasoning: '', coreTraits: [], predictionBasis: '', background: { belief: '', bonds: '' } },
}, [{ question: '性格', answer: '善良' }]);
const completed: DetailsGenerationOutcome = { status: 'completed', card, result: { status: 'completed', contractVersion: 1, requestId: 'r', mode: 'direct-local', output: { text: JSON.stringify(card) }, finishReason: 'stop' } };
let root: Root;
let container: HTMLDivElement;
let close: (event: { preventDefault: () => void }) => void;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 120)); });
const button = (name: string) => [...container.querySelectorAll('button')].find((item) => item.textContent === name)!;
const click = async (name: string) => { await act(async () => button(name).click()); await settle(); };
const draft = () => ({ version: 1, answers: { [`${builtinSelectionId(questionnaire.id)}::${questionnaire.questions[0].id}`]: '善良' }, language: '简体中文' });
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); window.localStorage.clear();
  // 新 overlay 模型下执行位置与连接选择正交且默认不自动选中；
  // 需要走通生成路径的用例统一预置"客户端执行 + 已选 local 连接"。
  window.localStorage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, JSON.stringify({
    version: 2,
    selection: { executionPreference: 'client', clientConnectionId: 'local' },
    hiddenPresetIds: [],
  }));
  resetDesktopAiConfigStoreForTests();
  mocks.profiles.mockResolvedValue({ id: 'local', name: '本地模型', adapter: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', modelId: 'model' });
  mocks.execute.mockResolvedValue(completed); mocks.save.mockResolvedValue({ written: true });
  mocks.listen.mockImplementation(async (handler) => { close = handler; return vi.fn(); });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => questionnaire })));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.location.hash = '#/details';
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const mount = async () => {
  const router = createDesktopRouter(); await router.load();
  await act(async () => root.render(<StrictMode><RouterProvider router={router} /></StrictMode>));
  await settle(); return router;
};

describe('Desktop Details real route and session UI (native adapter mock)', () => {
  it('confirms replacement, keeps the old result on cancel/save failure, and saves before regenerating', async () => {
    window.localStorage.setItem(DETAILS_DRAFT_KEY, JSON.stringify(draft()));
    await mount(); await click('恢复草稿'); await click('发送问卷并生成');
    await click('重新生成');
    expect(container.querySelector('dialog')?.open).toBe(true);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    await click('取消');
    expect(container.querySelector('dialog')?.open).toBe(false);
    expect(container.textContent).toContain('百合 · 未签名');
    await click('重新生成');
    mocks.save.mockRejectedValueOnce(new Error('disk'));
    await click('保存后重新生成');
    expect(container.querySelector('dialog')?.open).toBe(true);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('生成结果仍保留');
    await click('保存后重新生成');
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(container.querySelector('dialog')?.open).toBe(false);
    await click('重新生成'); await click('确定重新生成');
    expect(mocks.execute).toHaveBeenCalledTimes(3);
    expect(mocks.save).toHaveBeenCalledTimes(2);
  });
  it.each(['route', 'native'] as const)('cancels and flushes after confirming %s leave', async (kind) => {
    window.localStorage.setItem(DETAILS_DRAFT_KEY, JSON.stringify(draft()));
    let finish!: (outcome: DetailsGenerationOutcome) => void;
    mocks.execute.mockImplementation((_o, _i, _t, _s, partial) => { partial('离开前正文'); return new Promise((resolve) => { finish = resolve; }); });
    const router = await mount(); await click('恢复草稿'); await click('发送问卷并生成');
    vi.mocked(window.confirm).mockReturnValue(true);
    const preventDefault = vi.fn();
    await act(async () => { if (kind === 'route') await router.navigate({ to: '/' }); else close({ preventDefault }); });
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(mocks.execute.mock.calls[0]![3].aborted).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(DETAILS_DRAFT_KEY)!).output).toMatchObject({ phase: 'cancelled', rawText: '离开前正文' });
    if (kind === 'route') expect(router.state.location.pathname).toBe('/');
    else expect(preventDefault).not.toHaveBeenCalled();
    await act(async () => finish({ status: 'cancelled', contractVersion: 1, requestId: 'r', mode: 'direct-local', rawText: '离开前正文', reason: 'aborted' }));
  });
  it('does not abort on a browser unload prompt, and flushes only when pagehide actually occurs', async () => {
    window.localStorage.setItem(DETAILS_DRAFT_KEY, JSON.stringify(draft()));
    let finish!: (outcome: DetailsGenerationOutcome) => void;
    mocks.execute.mockImplementation((_o, _i, _t, _s, partial) => { partial('刷新前正文'); return new Promise((resolve) => { finish = resolve; }); });
    await mount(); await click('恢复草稿'); await click('发送问卷并生成');
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    expect(mocks.execute.mock.calls[0]![3].aborted).toBe(false);
    await act(async () => window.dispatchEvent(new Event('pagehide')));
    expect(mocks.execute.mock.calls[0]![3].aborted).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(DETAILS_DRAFT_KEY)!).output.rawText).toBe('刷新前正文');
    await act(async () => finish({ status: 'cancelled', contractVersion: 1, requestId: 'r', mode: 'direct-local', rawText: '刷新前正文', reason: 'aborted' }));
  });
  it('restores only on explicit action then generates Direct once and saves the shared result', async () => {
    window.localStorage.setItem(DETAILS_DRAFT_KEY, JSON.stringify(draft()));
    await mount();
    expect(container.querySelector('[data-testid="page-details"]')).toBeTruthy();
    expect(container.textContent).toContain('第 1 / 16 题');
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(button('发送问卷并生成').disabled).toBe(true);
    await click('恢复草稿');
    expect(container.querySelector('textarea')?.value).toBe('善良');
    await click('发送问卷并生成');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]![2]).toMatchObject({ mode: 'direct-local', modelId: 'model' });
    expect(container.textContent).toContain('百合 · 未签名');
    expect(container.textContent).toContain('礼服');
    expect(container.querySelector('pre')?.textContent).toBe(JSON.stringify(card));
    await click('保存到本地卡库');
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('已保存到本地卡库。');
  });
  it('synchronous generation locks route/refresh/native close, cancel keeps partial, then leaving is allowed', async () => {
    window.localStorage.setItem(DETAILS_DRAFT_KEY, JSON.stringify(draft()));
    let finish!: (outcome: DetailsGenerationOutcome) => void;
    let emitPartial!: (text: string) => void;
    mocks.execute.mockImplementation((_options, _input, _intent, _signal, partial) => { emitPartial = partial; partial('部分正文'); return new Promise((resolve) => { finish = resolve; }); });
    const router = await mount(); await click('恢复草稿');
    const preventDefault = vi.fn();
    await act(async () => {
      button('发送问卷并生成').click(); button('发送问卷并生成').click();
      close({ preventDefault }); void router.navigate({ to: '/' });
    });
    await settle();
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(window.confirm).toHaveBeenCalledTimes(2);
    expect(router.state.location.pathname).toBe('/details');
    expect(mocks.execute.mock.calls[0]![3].aborted).toBe(false);
    await act(async () => emitPartial('拒绝离开后继续收到正文'));
    expect(container.querySelector('pre')?.textContent).toBe('拒绝离开后继续收到正文');
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
    expect(mocks.execute.mock.calls[0]![3].aborted).toBe(false);
    expect(router.state.location.pathname).toBe('/details');
    await act(async () => emitPartial('取消刷新后仍继续收到正文'));
    expect(container.querySelector('pre')?.textContent).toBe('取消刷新后仍继续收到正文');
    await click('取消生成');
    expect(mocks.execute.mock.calls[0]![3].aborted).toBe(true);
    await act(async () => finish({ status: 'cancelled', contractVersion: 1, requestId: 'r', mode: 'direct-local', rawText: '取消刷新后仍继续收到正文', reason: 'aborted' }));
    await settle();
    expect(container.querySelector('pre')?.textContent).toBe('取消刷新后仍继续收到正文');
    await act(async () => { void router.navigate({ to: '/' }); }); await settle();
    expect(router.state.location.pathname).toBe('/');
    expect(container.querySelector('a[href="#/details"]')).toBeTruthy();
  });
  it('requires confirmation before discarding corrupt draft, and blocks generation until native guard is ready', async () => {
    window.localStorage.setItem(DETAILS_DRAFT_KEY, '{broken');
    let ready!: (release: () => void) => void;
    mocks.listen.mockImplementation(() => new Promise((resolve) => { ready = resolve; }));
    await mount();
    expect(container.textContent).toContain('无法读取草稿');
    await click('清除草稿');
    expect(window.localStorage.getItem(DETAILS_DRAFT_KEY)).toBe('{broken');
    await click('保留草稿');
    await click('清除草稿'); await click('确认清除');
    expect(window.localStorage.getItem(DETAILS_DRAFT_KEY)).toBeNull();
    expect(button('发送问卷并生成').disabled).toBe(true);
    await act(async () => ready(vi.fn())); await settle();
    expect(button('发送问卷并生成').disabled).toBe(false);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('shows external recipient and restores partial without resending, preserving save failures for retry', async () => {
    mocks.profiles.mockResolvedValue({ id: 'local', name: '外部模型', adapter: 'openai-compatible', baseUrl: 'https://model.example/v1', modelId: 'model' });
    window.localStorage.setItem(DETAILS_DRAFT_KEY, JSON.stringify({ ...draft(), output: { mode: 'direct-remote', phase: 'cancelled', card: null, rawText: '上次中断' } }));
    await mount(); await click('恢复草稿');
    expect(container.textContent).toContain('客户端 · 远端');
    expect(container.textContent).toContain('https://model.example/v1');
    expect(container.querySelector('pre')?.textContent).toBe('上次中断');
    expect(mocks.execute).not.toHaveBeenCalled();
    await click('重新生成');
    mocks.save.mockRejectedValueOnce(new Error('busy'));
    await click('保存到本地卡库');
    expect(container.textContent).toContain('生成结果仍保留');
    await click('保存到本地卡库');
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.save).toHaveBeenCalledTimes(2);
  });

  it('keeps the questionnaire editable while Provider loading fails independently', async () => {
    mocks.profiles.mockRejectedValue(new Error('profile bridge unavailable'));
    await mount();
    expect(container.querySelector('textarea')).toBeTruthy();
    expect(container.textContent).toContain('本地 Provider 配置加载失败');
    expect(button('发送问卷并生成').disabled).toBe(true);
  });

  it('loads and shows unsupported adapters instead of hiding them', async () => {
    mocks.profiles.mockResolvedValue({ id: 'local', name: 'Anthropic profile', adapter: 'anthropic', baseUrl: 'https://model.example/v1', modelId: 'model' });
    await mount();
    expect(container.querySelector('select[aria-label="AI 连接"]')?.textContent).toContain('Anthropic profile');
    expect(container.textContent).toContain('当前客户端尚未实现 anthropic 适配器');
    expect(button('发送问卷并生成').disabled).toBe(true);
  });

  it('preserves corrupt drafts and permits leaving until new content becomes dirty', async () => {
    window.localStorage.setItem(DETAILS_DRAFT_KEY, '{broken');
    const router = await mount();
    expect(container.querySelector('textarea')?.closest('fieldset')?.disabled).toBe(true);
    await act(async () => { await router.navigate({ to: '/' }); });
    await settle();
    expect(router.state.location.pathname).toBe('/');
    expect(window.localStorage.getItem(DETAILS_DRAFT_KEY)).toBe('{broken');
  });

  it('blocks route navigation when editing cannot persist the draft', async () => {
    const router = await mount();
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === DETAILS_DRAFT_KEY) throw new Error('quota exceeded');
      return original.call(this, key, value);
    });
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '尚未保存的回答');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.textContent).toContain('草稿写入失败');
    await act(async () => { void router.navigate({ to: '/' }); });
    await settle();
    expect(router.state.location.pathname).toBe('/details');
    expect(window.location.hash).toBe('#/details');
    expect(textarea.value).toBe('尚未保存的回答');
  });
});
