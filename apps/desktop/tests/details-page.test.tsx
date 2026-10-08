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
import { describeRegenerateConfirm } from '../src/app/details-page';

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
const completed: DetailsGenerationOutcome = { status: 'completed', mode: 'direct-local', card, cardKind: 'magical-girl', rawText: JSON.stringify(card), result: { status: 'completed', contractVersion: 1, requestId: 'r', mode: 'direct-local', output: { text: JSON.stringify(card) }, finishReason: 'stop' } };
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
  it('keeps the brand at the top when starting the questionnaire', async () => {
    await mount();
    const logo = container.querySelector('img[alt="Questionnaire Logo"]');
    expect(logo).toBeTruthy();
    expect(logo?.closest('.card')?.firstElementChild?.contains(logo)).toBe(true);
    expect(container.querySelector('[aria-label="介绍"]')?.contains(logo)).toBe(false);
    expect(container.querySelector('h1')?.textContent).toBe('魔法少女问卷生成');
    await click('开始回答问卷');
    expect(container.querySelector('[aria-label="介绍"]')).toBeNull();
    expect(container.querySelector('img[alt="Questionnaire Logo"]')).toBe(logo);
    expect(container.querySelector('textarea')).toBeTruthy();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('shows rounded progress, effective soft limits and skip guidance only for optional questions', async () => {
    const custom = {
      id: 'answer-hints', kind: 'magical-girl', title: '作答提示问卷', description: 'd',
      questions: [
        { id: 'required', question: '必答角色设定', required: true, maxLength: 4 },
        { id: 'optional', question: '选答角色设定', required: false, maxLength: 800 },
        { id: 'default', question: '默认上限设定', required: false },
      ],
    };
    window.localStorage.setItem(DETAILS_DRAFT_KEY, JSON.stringify({
      version: 1, language: '简体中文', answers: { 'preset:answer-hints::required': '初始答案' },
      questionnaireSelections: [{ source: 'preset', questionnaire: custom, selectionId: 'preset:answer-hints' }],
    }));
    await mount(); await click('恢复草稿');
    expect(container.textContent).toContain('进度 33%');
    expect(container.textContent).toContain('请基于您构想的虚拟角色身份回答，并确保内容符合公序良俗，请勿使用任何真实信息。');
    expect(container.textContent).not.toContain('其他题目可以跳过');
    expect(container.textContent).not.toContain('本题可跳过');
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="必答角色设定"]')!;
    expect(textarea.hasAttribute('maxlength')).toBe(false);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '  保留超限回答  ');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(textarea.value).toBe('  保留超限回答  ');
    expect(container.textContent).toContain('有效字数：6/4');
    expect(container.textContent).toContain('回答超过建议长度，仍可生成未签名角色卡。');
    await click('下一题');
    expect(container.textContent).toContain('进度 67%');
    expect(container.textContent).toContain('有效字数：0/500');
    expect(container.textContent).toContain('本题可跳过，不作答将不会记录');
    await click('下一题');
    expect(container.textContent).toContain('进度 100%');
    expect(container.textContent).toContain('有效字数：0/500');
    expect(mocks.execute).not.toHaveBeenCalled();
  });

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
    const logo = container.querySelector('img[alt="Questionnaire Logo"]');
    expect(logo).toBeTruthy();
    await click('恢复草稿');
    expect(container.querySelector('img[alt="Questionnaire Logo"]')).toBe(logo);
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
    // 「清除草稿」= 内容清空：清后可立即落一份干净初始草稿（空回答+默认内置问卷
    // 选择；落盘格式恒带 output 头，须为 idle/空卡），语义等价于空——D5.1-P2
    // 选择集入草稿后默认问卷会作为新草稿的一部分被持续保存。
    const clearedRaw = window.localStorage.getItem(DETAILS_DRAFT_KEY);
    const cleared = clearedRaw === null
      ? null
      : JSON.parse(clearedRaw) as { answers?: Record<string, string>; output?: { phase?: string; card?: unknown; rawText?: string } };
    expect(cleared === null || (
      (cleared.output === undefined || (cleared.output.phase === 'idle' && cleared.output.card === null && cleared.output.rawText === ''))
      && Object.keys(cleared.answers ?? {}).length === 0
    )).toBe(true);
    await click('开始回答问卷');
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
    await mount(); await click('开始回答问卷');
    expect(container.querySelector('textarea')).toBeTruthy();
    expect(container.textContent).toContain('本地 Provider 配置加载失败');
    expect(button('发送问卷并生成').disabled).toBe(true);
  });

  it('keeps hosted generation available when the local Provider bridge fails', async () => {
    // 服务器执行不消费本地 profile：Profile bridge 故障只能门禁客户端通路，
    // 不得把 hosted System Default 一起封死（DESK-ONLINE-001/009 正交，D5.1-P2-r2）。
    window.localStorage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, JSON.stringify({
      version: 2,
      selection: { executionPreference: 'server', clientConnectionId: 'local' },
      hiddenPresetIds: [],
    }));
    mocks.profiles.mockRejectedValue(new Error('profile bridge unavailable'));
    window.localStorage.setItem(DETAILS_DRAFT_KEY, JSON.stringify(draft()));
    await mount(); await click('恢复草稿');
    // 服务器模式下如实标注影响范围而不是无条件告警原文（D5.1-P2-r4）。
    expect(container.textContent).toContain('本地 Provider 配置加载失败，仅影响客户端执行');
    expect(container.textContent).not.toContain('可以稍后重试');
    expect(container.textContent).toContain('服务器 · 云端');
    expect(button('发送问卷并生成').disabled).toBe(false);
    await click('发送问卷并生成');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]![2]).toMatchObject({ mode: 'hosted-json' });
  });

  it('loads and shows unsupported adapters instead of hiding them', async () => {
    mocks.profiles.mockResolvedValue({ id: 'local', name: 'Anthropic profile', adapter: 'anthropic', baseUrl: 'https://model.example/v1', modelId: 'model' });
    await mount(); await click('开始回答问卷');
    // 自定义连接选择器（非原生 select）：已选连接名展示在 trigger 上。
    expect(container.textContent).toContain('Anthropic profile');
    expect(container.textContent).toContain('当前客户端尚未实现 anthropic 适配器');
    expect(button('发送问卷并生成').disabled).toBe(true);
  });

  it('preserves corrupt drafts and permits leaving until new content becomes dirty', async () => {
    window.localStorage.setItem(DETAILS_DRAFT_KEY, '{broken');
    const router = await mount(); await click('开始回答问卷');
    expect(container.querySelector('textarea')?.closest('fieldset')?.disabled).toBe(true);
    await act(async () => { await router.navigate({ to: '/' }); });
    await settle();
    expect(router.state.location.pathname).toBe('/');
    expect(window.localStorage.getItem(DETAILS_DRAFT_KEY)).toBe('{broken');
  });

  it('blocks route navigation when editing cannot persist the draft', async () => {
    const router = await mount(); await click('开始回答问卷');
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

  it('dispatches hosted system config while signed out, with system-scoped advanced settings', async () => {
    window.localStorage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, JSON.stringify({
      version: 2,
      // 服务器偏好与已选客户端连接正交共存；hosted dispatch 不消费 profile。
      selection: { executionPreference: 'server', clientConnectionId: 'local' },
      hiddenPresetIds: [],
    }));
    window.localStorage.setItem(DETAILS_DRAFT_KEY, JSON.stringify(draft()));
    await mount(); await click('恢复草稿');
    expect(container.textContent).toContain('服务器 · 云端');
    // D5.1-AIP-r1：服务器模式呈现系统模型行与按系统模型保存的高级参数
    // （经 hosted systemConfig 非秘密偏好下发，与 Web 同语义）。
    expect(container.textContent).toContain('使用系统默认配置');
    expect(container.textContent).toContain('高级生成设置');
    expect(container.textContent).not.toContain('服务器执行需要先登录');
    expect(button('发送问卷并生成').disabled).toBe(false);
    await click('发送问卷并生成');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]![0].profileId).toBe('');
    expect(mocks.execute.mock.calls[0]![2]).toMatchObject({ mode: 'hosted-json' });
    expect(mocks.execute.mock.calls[0]![1].hosted).toMatchObject({
      allowNativeSignature: true,
      selections: [{ source: 'preset', questionnaire: { id: 'magical-girl-default' } }],
    });
  });

  it('sends allowNativeSignature=false on hosted dispatch when an answer exceeds the limit', async () => {
    window.localStorage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, JSON.stringify({
      version: 2,
      selection: { executionPreference: 'server', clientConnectionId: null },
      hiddenPresetIds: [],
    }));
    window.localStorage.setItem(DETAILS_DRAFT_KEY, JSON.stringify({
      ...draft(),
      answers: { [`${builtinSelectionId(questionnaire.id)}::${questionnaire.questions[0].id}`]: '字'.repeat(501) },
    }));
    await mount(); await click('恢复草稿'); await click('发送问卷并生成');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]![1].hosted.allowNativeSignature).toBe(false);
  });

  it('quick-random produces a saveable card without touching the model path', async () => {
    await mount();
    await click('快速随机生成');
    // 本机产物归一化后携带空 userAnswers——与 generate() 完成路径同形，
    // 不因缺字段被 validateCard 拒掉（D5.1-P2-r1 回归：此前入口 100% 报错）。
    expect(container.textContent).toContain('已在本机生成');
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(button('保存到本地卡库').disabled).toBe(false);
    const stored = JSON.parse(window.localStorage.getItem(DETAILS_DRAFT_KEY)!) as {
      output?: { card?: { userAnswers?: unknown } };
    };
    expect(stored.output?.card?.userAnswers).toEqual([]);
  });

  it('restores a pending draft with non-default selections without dropping its answers', async () => {
    // 待恢复草稿携带非默认选择集：恢复前页面以默认内置问卷做预览，恢复后目标集变化
    // 触发答案重映射——基线必须重置，否则恢复的回答会被映射为空并落盘（D5.1-P2-r1）。
    const custom = { id: 'preset-extra', kind: 'magical-girl', title: '自定义问卷', description: 'd', questions: [{ id: 'q1', question: '自定义问题' }] };
    window.localStorage.setItem(DETAILS_DRAFT_KEY, JSON.stringify({
      version: 1,
      answers: { 'preset:preset-extra::q1': '保留的回答' },
      language: '简体中文',
      questionnaireSelections: [{ source: 'preset', questionnaire: custom, selectionId: 'preset:preset-extra' }],
    }));
    await mount();
    await click('恢复草稿');
    expect(container.querySelector('textarea')?.value).toBe('保留的回答');
    const stored = JSON.parse(window.localStorage.getItem(DETAILS_DRAFT_KEY)!) as { answers: Record<string, string> };
    expect(stored.answers['preset:preset-extra::q1']).toBe('保留的回答');
  });

  it('clears a stale builtin load error once a custom selection set is committed', async () => {
    // 内置问卷加载失败不应成为生成门禁：草稿恢复出用户自备选择集后错误清除、
    // 可以直接生成（D5.1-P2-r1 回归：此前错误永远清不掉，形成死锁）。
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const custom = { id: 'preset-extra', kind: 'magical-girl', title: '自定义问卷', description: 'd', questions: [{ id: 'q1', question: '自定义问题' }] };
    window.localStorage.setItem(DETAILS_DRAFT_KEY, JSON.stringify({
      version: 1,
      answers: { 'preset:preset-extra::q1': '保留的回答' },
      language: '简体中文',
      questionnaireSelections: [{ source: 'preset', questionnaire: custom, selectionId: 'preset:preset-extra' }],
    }));
    await mount();
    expect(container.textContent).toContain('内置问卷加载失败');
    await click('恢复草稿');
    expect(container.textContent).not.toContain('内置问卷加载失败');
    await click('发送问卷并生成');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it('applies a residue draft silently instead of showing the restore prompt', async () => {
    // 自动写回的空壳草稿（无回答/无结果/默认内置选择）不弹恢复提示、直接进入可用态
    //（D5.1-P2-r1：此前每次进页面都会拦一次「发现上次草稿」）。
    window.localStorage.setItem(DETAILS_DRAFT_KEY, JSON.stringify({
      version: 1,
      answers: {},
      language: '简体中文',
      questionnaireSelections: [{ source: 'preset', questionnaire, selectionId: builtinSelectionId(questionnaire.id) }],
      output: { mode: 'direct-local', cardKind: 'magical-girl', card: null, rawText: '', phase: 'idle' },
    }));
    await mount();
    expect(container.textContent).not.toContain('发现上次草稿');
    await click('开始回答问卷');
    expect(container.textContent).toContain('第 1 / 16 题');
  });

  it('warns about possible duplicate cost before regenerating after an uncertain hosted-json outcome', async () => {
    window.localStorage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, JSON.stringify({
      version: 2,
      selection: { executionPreference: 'server', clientConnectionId: null },
      hiddenPresetIds: [],
    }));
    window.localStorage.setItem(DETAILS_DRAFT_KEY, JSON.stringify(draft()));
    mocks.execute.mockResolvedValueOnce({
      status: 'uncertain', mode: 'hosted-json', rawText: '',
      message: '无法确认这次生成是否在服务器执行——请求可能已发送。不会自动重试；再次生成会发起新请求，可能产生重复调用与费用。',
    } satisfies DetailsGenerationOutcome);
    await mount(); await click('恢复草稿'); await click('发送问卷并生成');
    expect(container.textContent).toContain('无法确认这次生成是否在服务器执行');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    await click('重新生成');
    // uncertain 终态下再次生成必须显式确认——无保存按钮（没有卡可保存）。
    expect(container.querySelector('dialog')?.open).toBe(true);
    expect(container.querySelector('dialog')?.textContent).toContain('重复调用与费用');
    expect(container.querySelector('dialog')?.textContent).not.toContain('保存后重新生成');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    await click('取消');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    await click('重新生成'); await click('确定重新生成');
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it('describes quick-random over an unconfirmed result as local overwrite, not billed retry', () => {
    // quick-random 是纯本机生成：uncertain 残留上确认的理由是「覆盖尚未确认的结果」，
    // 不得声称会再次发起模型请求或计费（D5.1-P2-r2；当前 UI 中 uncertain 与 Intro
    // 不同屏，该分支为防御性语义，直接对文案决策函数断言）。
    const copy = describeRegenerateConfirm('quick-random', 'uncertain');
    expect(copy.title).toBe('重新随机生成？');
    expect(copy.description).not.toContain('重复调用与费用');
    expect(copy.description).not.toContain('可能已经完成并计费');
    expect(copy.description).toContain('不产生费用');
    expect(copy.description).toContain('尚未确认');
    expect(describeRegenerateConfirm('generate', 'uncertain').description).toContain('重复调用与费用');
    expect(describeRegenerateConfirm('generate', 'unsaved').description).toContain('尚未保存到本地卡库');
  });

  it('shows a restored signed card as unverified evidence instead of official-signed', async () => {
    const signedCard = { ...card, signature: 'server-issued-signature' };
    window.localStorage.setItem(DETAILS_DRAFT_KEY, JSON.stringify({
      ...draft(),
      output: { mode: 'hosted-json', phase: 'completed', rawText: JSON.stringify(signedCard), card: signedCard },
    }));
    await mount(); await click('恢复草稿');
    const heading = container.querySelector('section[aria-label="生成结果"] h2');
    expect(heading?.textContent).toBe('百合 · 含签名字段（本机未验证）');
    await click('保存到本地卡库');
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      provenance: { kind: 'signature-unverified', signature: 'server-issued-signature', execution: 'hosted' },
    }));
  });
});
