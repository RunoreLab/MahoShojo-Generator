// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildUnsignedMagicalGirlDetailsCard } from '@mahoshojo/ai-core/magical-girl-details-generation';
import { GENERAL_CHARACTER_TEMPLATE_ID } from '@mahoshojo/domain/data-cards';
import type { CreatorGenerationOutcome } from '../src/features/creator/generation';
import { CREATOR_DRAFT_KEY } from '../src/features/creator/session';
import { builtinSelectionId } from '../src/features/details/questionnaire';
import { resetDesktopAiConfigStoreForTests } from '../src/features/ai-config/use-desktop-ai-config';
import { DESKTOP_AI_CONFIG_STORAGE_KEY } from '../src/features/ai-config/desktop-ai-config-store';
import { createDesktopRouter } from '../src/app/router';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), save: vi.fn(), listen: vi.fn(), profiles: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: mocks.listen }) }));
vi.mock('../src/features/creator/generation', async (original) => ({ ...await original<object>(), executeCreatorGeneration: mocks.execute }));
vi.mock('../src/platform/provider-profile-bridge', () => ({ listProviderProfileIds: async () => ['local'], getProviderProfile: mocks.profiles }));
vi.mock('../src/platform/local-card-bridge', () => ({ IpcLocalCardRepository: class { putIfAbsent = mocks.save; } }));

const questionnaire = JSON.parse(readFileSync(resolve(process.cwd(), '../../content/questionnaires/presets/magical-girl-default.json'), 'utf8'));
const presetIndex = {
  version: 1,
  presets: [{
    id: 'magical-girl-default',
    kind: 'magical-girl',
    title: questionnaire.title,
    path: '/questionnaires/presets/magical-girl-default.json',
    isDefault: true,
  }],
};
const selection = {
  source: 'preset',
  selectionId: builtinSelectionId(questionnaire.id),
  questionnaire,
};
const card = buildUnsignedMagicalGirlDetailsCard({
  codename: '百合', appearance: { outfit: '礼服', accessories: '', colorScheme: '', overallLook: '' },
  magicConstruct: { name: '', form: '', basicAbilities: [], description: '' },
  wonderlandRule: { name: '', description: '', tendency: '', activation: '' },
  blooming: { name: '', evolvedAbilities: [], evolvedForm: '', evolvedOutfit: '', powerLevel: '' },
  analysis: { personalityAnalysis: '', abilityReasoning: '', coreTraits: [], predictionBasis: '', background: { belief: '', bonds: '' } },
}, [{ question: '性格', answer: '善良' }]);
const completed = (mode: string, over: Record<string, unknown> = {}): CreatorGenerationOutcome => ({
  status: 'completed',
  mode,
  card,
  cardKind: 'magical-girl',
  rawText: JSON.stringify(card),
  result: { status: 'completed', contractVersion: 1, requestId: 'r', mode, output: { text: JSON.stringify(card) }, finishReason: 'stop' },
  ...over,
} as unknown as CreatorGenerationOutcome);
let root: Root;
let container: HTMLDivElement;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 120)); });
const button = (name: string) => [...container.querySelectorAll('button')].find((item) => item.textContent === name)!;
const click = async (name: string) => { await act(async () => button(name).click()); await settle(); };
const clickText = async (text: string) => {
  await act(async () => [...container.querySelectorAll('button')].find((item) => item.textContent!.includes(text))!.click());
  await settle();
};
const draft = (over: Record<string, unknown> = {}) => ({
  version: 1,
  answers: { [`${builtinSelectionId(questionnaire.id)}::${questionnaire.questions[0].id}`]: '善良' },
  language: 'zh-CN',
  template: 'magical-girl',
  generationMode: 'non-stream',
  freeformBrief: '',
  selectedRuleIds: ['arena-trpg-lite'],
  primaryRuleId: 'arena-trpg-lite',
  questionnaireSelections: [selection],
  ...over,
});
const aiConfig = (executionPreference: 'client' | 'server') => window.localStorage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, JSON.stringify({
  version: 2,
  selection: { executionPreference, clientConnectionId: 'local' },
  hiddenPresetIds: [],
}));

// 预设竞态夹具：a/b 两个预设请求挂起，由用例控制完成次序（G3-r1/G3-r1-r1）。
const stubPresetRaceFetch = (deferreds: Map<string, () => void>, payloads: { a: unknown; b: unknown }) => {
  const racingIndex = {
    version: 1,
    presets: [
      { id: 'preset-a', kind: 'magical-girl', title: '预设A', path: '/questionnaires/presets/a.json' },
      { id: 'preset-b', kind: 'magical-girl', title: '预设B', path: '/questionnaires/presets/b.json' },
      presetIndex.presets[0],
    ],
  };
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url === '/languages.json') return Promise.resolve({ ok: true, json: async () => [] });
    if (url === '/questionnaires/presets/index.json') return Promise.resolve({ ok: true, json: async () => racingIndex });
    if (url === '/questionnaires/presets/a.json') {
      return new Promise((resolve) => deferreds.set('a', () => resolve({ ok: true, json: async () => payloads.a })));
    }
    if (url === '/questionnaires/presets/b.json') {
      return new Promise((resolve) => deferreds.set('b', () => resolve({ ok: true, json: async () => payloads.b })));
    }
    return Promise.resolve({ ok: true, json: async () => questionnaire });
  }));
};
const presetSelect = () => [...container.querySelectorAll('select')].find((item) =>
  [...item.options].some((option) => option.value === 'preset-a'))! as HTMLSelectElement;
const pickPreset = async (presetId: string) => {
  const select = presetSelect();
  await act(async () => {
    select.value = presetId;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
};
const setNativeValue = (element: HTMLElement, value: string) => {
  const proto = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
};
const storedSelectionIds = () => (JSON.parse(window.localStorage.getItem(CREATOR_DRAFT_KEY)!) as {
  questionnaireSelections?: { questionnaire: { id: string } }[];
}).questionnaireSelections?.map((item) => item.questionnaire.id) ?? [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); window.localStorage.clear();
  aiConfig('client');
  resetDesktopAiConfigStoreForTests();
  mocks.profiles.mockResolvedValue({ id: 'local', name: '本地模型', adapter: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', modelId: 'model' });
  mocks.execute.mockResolvedValue(completed('direct-local')); mocks.save.mockResolvedValue({ written: true });
  mocks.listen.mockImplementation(async () => vi.fn());
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url === '/languages.json') return { ok: true, json: async () => [] };
    if (url === '/questionnaires/presets/index.json') return { ok: true, json: async () => presetIndex };
    return { ok: true, json: async () => questionnaire };
  }));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.location.hash = '#/creator';
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const mount = async () => {
  const router = createDesktopRouter(); await router.load();
  await act(async () => root.render(<StrictMode><RouterProvider router={router} /></StrictMode>));
  await settle(); return router;
};

describe('Desktop /creator workbench (native adapter mock)', () => {
  it.each(['completed', 'cancelled', 'non-stream'] as const)('renders only active stream Markdown, preserves raw output and handles %s', async (ending) => {
    const markdown = '# 流式标题\n\n**逐步正文**\n\n[外链](https://example.com/read)\n\n![外图](https://example.com/image.png)\n\n[设置](/settings) [相对路径](settings) [同页](#title) `/encyclopedia/foo`';
    const reasoning = '仅限思考面板的推理';
    let finish!: (outcome: CreatorGenerationOutcome) => void;
    let emitPartial!: (text: string) => void;
    mocks.execute.mockImplementation((_options, _input, _intent, _signal, partial) => {
      emitPartial = partial;
      return new Promise((resolve) => { finish = resolve; });
    });
    window.localStorage.setItem(CREATOR_DRAFT_KEY, JSON.stringify(draft({ template: 'general', generationMode: 'stream', selectedRuleIds: [], primaryRuleId: null, freeformBrief: '流式测试' })));
    await mount();
    await click(ending === 'non-stream' ? '非流式' : '流式');
    await click('生成数据卡');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]![2]).toMatchObject({ generationMode: ending === 'non-stream' ? 'non-stream' : 'stream' });
    const fetchCount = vi.mocked(fetch).mock.calls.length;
    await act(async () => emitPartial('# 流式标题'));
    await act(async () => emitPartial(markdown));
    const preview = container.querySelector('[aria-label="流式正文预览"]');
    if (ending === 'non-stream') {
      expect(preview).toBeNull();
    } else {
      expect(preview?.querySelector('h1, h2, h3')?.textContent).toBe('流式标题');
      expect(preview?.querySelector('strong')?.textContent).toBe('逐步正文');
      expect(preview?.textContent).not.toContain(reasoning);
      expect(preview?.textContent).not.toContain('官方签名');
      expect(preview?.querySelector('img, audio, video, iframe, a[href]')).toBeNull();
    }
    expect(vi.mocked(fetch).mock.calls.length).toBe(fetchCount);
    const raw = [...container.querySelectorAll('details')].find((element) => element.querySelector('summary')?.textContent === '原始输出正文')!;
    expect(raw.querySelector('pre')?.textContent).toBe(markdown);
    expect(raw.open).toBe(ending === 'non-stream');
    expect(container.querySelector('[data-testid="result-signature-status"]')).toBeNull();
    expect(button('保存到本地卡库')).toBeUndefined();
    expect(mocks.save).not.toHaveBeenCalled();
    if (ending === 'completed') {
      await act(async () => finish({
        status: 'completed', mode: 'direct-local', cardKind: 'general',
        card: { templateId: '通用角色', name: '流式标题', content: markdown }, rawText: markdown,
        reasoning: { status: 'done', source: 'provider', text: reasoning },
      }));
      await settle();
      expect(container.querySelector('[aria-label="流式正文预览"]')).toBeNull();
      const result = container.querySelector('[data-testid="result-signature-status"]')!.parentElement!;
      expect(result.textContent).toContain('逐步正文');
      expect(result.textContent).not.toContain(reasoning);
      await act(async () => container.querySelector<HTMLButtonElement>('.ai-reasoning-panel button')!.click());
      expect(container.querySelector('.ai-reasoning-panel')?.textContent).toContain(reasoning);
      expect(raw.querySelector('pre')?.textContent).not.toContain(reasoning);
      expect(button('保存到本地卡库').matches(':disabled')).toBe(false);
      await click('保存到本地卡库');
      expect(mocks.save).toHaveBeenCalledTimes(1);
      expect(mocks.save.mock.calls[0]![0]).toMatchObject({ data: { content: markdown }, provenance: { kind: 'unsigned', execution: 'direct-local' } });
    } else {
      await click('取消生成');
      expect(mocks.execute.mock.calls[0]![3].aborted).toBe(true);
      await act(async () => finish({ status: 'cancelled', mode: 'direct-local', rawText: markdown, reason: 'aborted' }));
      await settle();
      expect(container.querySelector('[aria-label="流式正文预览"]')).toBeNull();
      expect(raw.open).toBe(true);
      expect(raw.querySelector('pre')?.textContent).toBe(markdown);
      expect(JSON.parse(window.localStorage.getItem(CREATOR_DRAFT_KEY)!).output).toMatchObject({ phase: 'cancelled', rawText: markdown });
      await click('非流式'); await click('流式');
      expect(container.querySelector('[aria-label="流式正文预览"]')).toBeNull();
      expect(mocks.execute).toHaveBeenCalledTimes(1);
      expect(mocks.save).not.toHaveBeenCalled();
    }
  });

  it('does not reinterpret restored raw output as an active Markdown stream after selecting stream', async () => {
    window.localStorage.setItem(CREATOR_DRAFT_KEY, JSON.stringify({
      ...draft({ template: 'general', generationMode: 'stream', selectedRuleIds: [], primaryRuleId: null, freeformBrief: '流式测试' }),
      output: { mode: 'direct-local', cardKind: 'general', card: null, rawText: '# 历史正文', phase: 'cancelled' },
    }));
    await mount(); await click('流式');
    expect(container.querySelector('[aria-label="流式正文预览"]')).toBeNull();
    expect([...container.querySelectorAll('pre')].some((element) => element.textContent === '# 历史正文')).toBe(true);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('injects the default preset on a fresh mount, then walks intro → questionnaire → direct generate → save', async () => {
    await mount();
    // 进页面即注入默认选择并落盘（残余草稿语义：非空选择集但无用户内容）。
    const stored = JSON.parse(window.localStorage.getItem(CREATOR_DRAFT_KEY)!) as { questionnaireSelections?: { source: string }[] };
    expect(stored.questionnaireSelections).toHaveLength(1);
    expect(stored.questionnaireSelections![0]!.source).toBe('preset');
    await click('开始回答问卷');
    expect(container.textContent).toContain('问题 1 /');
    // 侧栏模板选择器：默认 general 模板切到结构化 magical-girl（规则选择对账
    // 与默认问卷保留由效应链完成）。
    await clickText('魔法少女（结构化）');
    await click('非流式');
    // 快捷选项作答：写答案不走 textarea，覆盖 quickOption → updateAnswer 链路。
    await click('还没想好');
    await click('生成数据卡');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]![1]).toMatchObject({ template: 'magical-girl', language: 'zh-CN' });
    expect(mocks.execute.mock.calls[0]![1].buildRuleRequests).toEqual([{ ruleId: 'arena-trpg-lite', version: expect.any(String), inputs: expect.any(Object) }]);
    expect(mocks.execute.mock.calls[0]![2]).toMatchObject({ mode: 'direct-local', modelId: 'model' });
    expect([...container.querySelectorAll('h2.sr-only')].some((heading) => heading.textContent === '百合')).toBe(true);
    expect(container.querySelector('[data-testid="result-signature-status"]')?.textContent).toContain('未签名');
    // 原生性概览按通路如实投影（G3-r1）：direct 本来就不签名，不是「签名失败」。
    expect(container.textContent).toContain('当前执行通路不支持官方签名，结果为非原生');
    expect(container.textContent).not.toContain('签名失败');
    expect(button('保存到本地卡库').classList.contains('ui-web-generation-action--primary')).toBe(true);
    await click('保存到本地卡库');
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('已保存到本地卡库。');
  });

  it('keeps the result-overview snapshot across regeneration (G3-r1)', async () => {
    await mount();
    await click('开始回答问卷');
    await clickText('魔法少女（结构化）');
    await click('非流式');
    await click('还没想好');
    await click('生成数据卡');
    expect([...container.querySelectorAll('h2.sr-only')].some((heading) => heading.textContent === '百合')).toBe(true);
    expect(container.querySelector('[data-testid="result-signature-status"]')?.textContent).toContain('未签名');
    // 首次完成：侧栏按发起生成时的快照投影——题数与阶段如实。
    expect(container.textContent).toContain('创作完成');
    expect(container.textContent).toMatch(/共 \d+ 题，已进入结果阶段/);

    // 连续重新生成：执行器挂起期间旧结果卡已置空，刚记录的新快照不得被清掉。
    let resolveSecond: ((outcome: CreatorGenerationOutcome) => void) | undefined;
    mocks.execute.mockImplementation(() => new Promise<CreatorGenerationOutcome>((resolve) => { resolveSecond = resolve; }));
    await click('重新生成');
    await click('确定重新生成');
    expect(container.textContent).toContain('正在生成');
    await act(async () => resolveSecond!(completed('direct-local')));
    await settle();
    expect([...container.querySelectorAll('h2.sr-only')].some((heading) => heading.textContent === '百合')).toBe(true);
    expect(container.querySelector('[data-testid="result-signature-status"]')?.textContent).toContain('未签名');
    // 快照归属本次生成意图：完成后侧栏仍按新快照投影（修复前回落为无快照兜底文案）。
    expect(container.textContent).toContain('创作完成');
    expect(container.textContent).toMatch(/共 \d+ 题，已进入结果阶段/);
    expect(container.textContent).not.toContain('请以当前结果数据为准');
  });

  it('automatically restores a valid draft before loading defaults without dispatching generation', async () => {
    window.localStorage.setItem(CREATOR_DRAFT_KEY, JSON.stringify(draft()));
    await mount();
    expect(container.textContent).not.toContain('恢复草稿');
    expect(container.textContent).not.toContain('当前内容已保存或无待保存变更。');
    expect(container.querySelector('section[aria-label="草稿"]')).toBeNull();
    expect(container.querySelector('a.footer-link[href="#/"]')?.textContent).toBe('返回首页');
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === presetIndex.presets[0].path)).toBe(false);
    expect(container.textContent).toContain('问题 1 /');
    expect(button('生成数据卡').disabled).toBe(false);
    await click('生成数据卡');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]![1].answers).toHaveLength(1);
    expect([...container.querySelectorAll('h2.sr-only')].some((heading) => heading.textContent === '百合')).toBe(true);
    expect(container.querySelector('[data-testid="result-signature-status"]')?.textContent).toContain('未签名');
  });

  it('loads the default questionnaire for legacy restored answers with omitted selections without losing answers', async () => {
    const legacy = draft();
    delete (legacy as Record<string, unknown>).questionnaireSelections;
    window.localStorage.setItem(CREATOR_DRAFT_KEY, JSON.stringify(legacy));
    await mount();
    expect(container.textContent).toContain('问题 1 /');
    expect(container.textContent).not.toContain('当前没有可作答的题目');
    expect(button('开始回答问卷')).toBeUndefined();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === presetIndex.presets[0].path)).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(CREATOR_DRAFT_KEY)!).answers).toEqual(legacy.answers);
    expect(mocks.execute).not.toHaveBeenCalled();
    await click('生成数据卡');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]![1].answers).toEqual([expect.objectContaining({ answer: '善良' })]);
  });

  it('preserves explicitly empty restored selections instead of injecting a default questionnaire', async () => {
    window.localStorage.setItem(CREATOR_DRAFT_KEY, JSON.stringify(draft({ questionnaireSelections: [], freeformBrief: '只使用补充说明' })));
    await mount();
    expect(container.textContent).toContain('当前没有可作答的题目');
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === presetIndex.presets[0].path)).toBe(false);
    expect(storedSelectionIds()).toEqual([]);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('restores answers immediately but still waits for the native close guard before generation', async () => {
    const releases: (() => void)[] = [];
    mocks.listen.mockImplementation(() => new Promise<() => void>((resolve) => releases.push(() => resolve(vi.fn()))));
    window.localStorage.setItem(CREATOR_DRAFT_KEY, JSON.stringify(draft()));
    await mount();
    expect(container.textContent).toContain('问题 1 /');
    expect(button('恢复草稿')).toBeUndefined();
    expect(button('生成数据卡').disabled).toBe(true);
    await click('生成数据卡');
    expect(mocks.execute).not.toHaveBeenCalled();
    await act(async () => releases.forEach((release) => release()));
    await settle();
    expect(button('生成数据卡').disabled).toBe(false);
    await click('生成数据卡');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]![1].answers).toHaveLength(1);
  });

  it('keeps a residual default draft on the introduction without getting stuck loading', async () => {
    window.localStorage.setItem(CREATOR_DRAFT_KEY, JSON.stringify(draft({ answers: {} })));
    await mount();
    expect(button('开始回答问卷')).toBeTruthy();
    expect(button('恢复草稿')).toBeUndefined();
    expect(button('清除草稿')).toBeUndefined();
    expect(button('清空存档')).toBeUndefined();
    expect(mocks.execute).not.toHaveBeenCalled();
    const home = container.querySelector<HTMLAnchorElement>('a.footer-link[href="#/"]');
    expect(home?.textContent).toBe('返回首页');
    await click('开始回答问卷');
    expect(container.textContent).toContain('问题 1 /');
  });

  it('keeps a restored result reachable without any questionnaire and requires regeneration confirmation', async () => {
    window.localStorage.setItem(CREATOR_DRAFT_KEY, JSON.stringify(draft({
      answers: {},
      questionnaireSelections: [],
      output: { mode: 'direct-local', cardKind: 'magical-girl', card, rawText: JSON.stringify(card), phase: 'completed' },
    })));
    await mount();
    expect(container.textContent).toContain('百合');
    expect(container.textContent).not.toContain('当前没有可作答的题目');
    expect(container.textContent).not.toContain('已恢复草稿');
    expect(mocks.execute).not.toHaveBeenCalled();
    await click('重新生成');
    expect(container.querySelector('dialog[open]')?.textContent).toContain('当前结果尚未保存');
    await click('取消');
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(container.textContent).toContain('百合');
  });

  it('restores uncertain hosted work without replay and retains explicit repeat-cost confirmation', async () => {
    window.localStorage.setItem(CREATOR_DRAFT_KEY, JSON.stringify(draft({
      output: { mode: 'hosted-json', card: null, cardKind: 'magical-girl', rawText: '上次中断的正文', phase: 'uncertain' },
    })));
    await mount();
    expect(container.textContent).toContain('上次生成的服务器执行结果未能确认');
    expect(container.querySelector('pre')?.textContent).toBe('上次中断的正文');
    expect(mocks.execute).not.toHaveBeenCalled();
    await click('重新生成');
    expect(container.querySelector('dialog[open]')?.textContent).toContain('可能产生重复调用与费用');
    await click('取消');
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(container.querySelector('pre')?.textContent).toBe('上次中断的正文');
  });

  it('clears only answers through the collapsed Web-style action and preserves creator settings and results', async () => {
    const original = draft({
      freeformBrief: '保留这条补充说明',
      ruleInputsById: { 'arena-trpg-lite': { custom: 7 } },
      output: { mode: 'direct-local', cardKind: 'magical-girl', card, rawText: JSON.stringify(card), phase: 'completed' },
    });
    window.localStorage.setItem(CREATOR_DRAFT_KEY, JSON.stringify(original));
    await mount();
    expect(button('清除草稿')).toBeUndefined();
    expect(button('清空存档')).toBeUndefined();
    await clickText('一键填充答案');
    await click('清空存档');
    expect(JSON.parse(window.localStorage.getItem(CREATOR_DRAFT_KEY)!).answers).toEqual(original.answers);
    vi.mocked(window.confirm).mockReturnValue(true);
    await click('清空存档');
    const stored = JSON.parse(window.localStorage.getItem(CREATOR_DRAFT_KEY)!);
    expect(stored).toMatchObject({ ...original, answers: {} });
    expect(container.textContent).toContain('存档已清空！');
    expect(container.textContent).toContain('百合');
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('reports only an in-memory answer clear when quota prevents persistence and retains the original stored answers', async () => {
    const original = JSON.stringify(draft());
    window.localStorage.setItem(CREATOR_DRAFT_KEY, original);
    await mount();
    const originalSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === CREATOR_DRAFT_KEY) throw new Error('quota');
      originalSet.call(this, key, value);
    });
    await clickText('一键填充答案');
    vi.mocked(window.confirm).mockReturnValue(true);
    await click('清空存档');
    expect(window.localStorage.getItem(CREATOR_DRAFT_KEY)).toBe(original);
    expect(container.textContent).not.toContain('存档已清空！');
    expect(container.textContent).toContain('当前页面的答案已清空，但原存档仍保留。');
    expect(container.textContent).toContain('草稿写入失败');
    await click('生成数据卡');
    expect(mocks.execute.mock.calls[0]![1].answers).toEqual([]);
  });

  it('does not claim a successful stored clear or persisted preferences for memory-only work over corrupt storage', async () => {
    window.localStorage.setItem(CREATOR_DRAFT_KEY, '{broken');
    await mount();
    await click('开始回答问卷');
    await click('还没想好');
    await clickText('一键填充答案');
    vi.mocked(window.confirm).mockReturnValue(true);
    await click('清空存档');
    expect(window.localStorage.getItem(CREATOR_DRAFT_KEY)).toBe('{broken');
    expect(container.textContent).not.toContain('存档已清空！');
    expect(container.textContent).toContain('当前页面的答案已清空，但原存档仍保留。');
    await click('生成数据卡');
    expect(mocks.execute.mock.calls[0]![1].answers).toEqual([]);
    expect(container.textContent).not.toContain('偏好设置已保存在本机草稿中');
    expect(container.textContent).toContain('切换保存方式不会丢失生成结果。');
  });

  it('retains corrupt storage while allowing temporary work and guarding unsaved changes', async () => {
    window.localStorage.setItem(CREATOR_DRAFT_KEY, '{broken');
    await mount();
    expect(container.textContent).toContain('旧草稿无法读取');
    expect(button('重试保存草稿')).toBeUndefined();
    const beforeEdit = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(beforeEdit);
    expect(beforeEdit.defaultPrevented).toBe(false);
    await click('开始回答问卷');
    await clickText('魔法少女（结构化）');
    await click('非流式');
    await click('还没想好');
    expect(button('生成数据卡').disabled).toBe(false);
    await click('生成数据卡');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('百合');
    expect(window.localStorage.getItem(CREATOR_DRAFT_KEY)).toBe('{broken');
    const afterEdit = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(afterEdit);
    expect(afterEdit.defaultPrevented).toBe(true);
    await click('清除草稿');
    await click('保留草稿');
    expect(window.localStorage.getItem(CREATOR_DRAFT_KEY)).toBe('{broken');
    expect(container.textContent).toContain('百合');
    await click('清除草稿');
    expect(button('确认清除').classList.contains('ui-web-generation-action--destructive')).toBe(true);
    await click('确认清除');
    expect(container.textContent).not.toContain('旧草稿无法读取');
    expect(button('开始回答问卷')).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(CREATOR_DRAFT_KEY)!).answers).toEqual({});
    expect(storedSelectionIds()).toEqual(['magical-girl-default']);
  });

  it('allows confirmed departure after saving a memory-only result without touching corrupt stored data', async () => {
    window.localStorage.setItem(CREATOR_DRAFT_KEY, '{broken');
    const router = await mount();
    await click('开始回答问卷');
    await click('还没想好');
    await click('生成数据卡');
    await click('保存到本地卡库');
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('已保存到本地卡库。');
    const remove = vi.spyOn(Storage.prototype, 'removeItem');
    const write = vi.spyOn(Storage.prototype, 'setItem');
    await act(async () => { void router.navigate({ to: '/' }); });
    await settle();
    expect(router.state.location.pathname).toBe('/creator');
    expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining('确认放弃本页未保存的内容并离开'));
    vi.mocked(window.confirm).mockReturnValue(true);
    await act(async () => { void router.navigate({ to: '/' }); });
    await settle();
    expect(router.state.location.pathname).toBe('/');
    expect(window.localStorage.getItem(CREATOR_DRAFT_KEY)).toBe('{broken');
    expect(remove.mock.calls.some(([key]) => key === CREATOR_DRAFT_KEY)).toBe(false);
    expect(write.mock.calls.some(([key]) => key === CREATOR_DRAFT_KEY)).toBe(false);
  });

  it('keeps a failed corrupt-draft discard recoverable without resetting temporary work', async () => {
    window.localStorage.setItem(CREATOR_DRAFT_KEY, '{broken');
    await mount();
    await click('开始回答问卷');
    await clickText('魔法少女（结构化）');
    await click('非流式');
    await click('还没想好');
    await click('生成数据卡');
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('storage unavailable'); });
    await click('清除草稿');
    await click('确认清除');
    expect(container.textContent).toContain('清除草稿失败');
    expect(container.textContent).toContain('百合');
    expect(window.localStorage.getItem(CREATOR_DRAFT_KEY)).toBe('{broken');
    expect(button('保留草稿')).toBeTruthy();
  });

  it('shows a retry only on a real save failure and keeps navigation protected until it succeeds', async () => {
    window.localStorage.setItem(CREATOR_DRAFT_KEY, JSON.stringify(draft()));
    const router = await mount();
    const originalSet = Storage.prototype.setItem;
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === CREATOR_DRAFT_KEY) throw new Error('quota');
      originalSet.call(this, key, value);
    });
    await click('还没想好');
    expect(container.textContent).toContain('草稿写入失败');
    await act(async () => { void router.navigate({ to: '/' }); });
    await settle();
    expect(router.state.location.pathname).toBe('/creator');
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    write.mockRestore();
    await click('重试保存草稿');
    expect(container.textContent).not.toContain('草稿写入失败');
    expect(button('清除草稿')).toBeUndefined();
    await act(async () => { void router.navigate({ to: '/' }); });
    await settle();
    expect(router.state.location.pathname).toBe('/');
  });

  it('projects the shared hosted-json request body with build rules and native-signature eligibility', async () => {
    aiConfig('server');
    window.localStorage.setItem(CREATOR_DRAFT_KEY, JSON.stringify(draft({ freeformBrief: '想要百合主题' })));
    mocks.execute.mockResolvedValue(completed('hosted-json', { card: { ...card, signature: 'sig' } }));
    await mount(); await click('生成数据卡');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]![0].profileId).toBe('');
    expect(mocks.execute.mock.calls[0]![2]).toMatchObject({ mode: 'hosted-json' });
    const input = mocks.execute.mock.calls[0]![1];
    expect(input.template).toBe('magical-girl');
    expect(input.freeformBrief).toBe('想要百合主题');
    expect(input.primaryRuleId).toBe('arena-trpg-lite');
    expect(input.buildRuleRequests[0]).toMatchObject({ ruleId: 'arena-trpg-lite' });
    expect(input.hosted).toMatchObject({
      allowNativeSignature: true,
      selections: [{ source: 'preset', questionnaire: { id: 'magical-girl-default' } }],
    });
    // 新鲜 hosted-json 响应携带签名字段 → official-signed 标签与概览一致。
    expect(container.textContent).toContain('官方签名');
    expect(container.textContent).toContain('当前展示结果具备原生性');
  });

  it('projects the unsigned-remote pathway honestly in the result overview (G3-r1)', async () => {
    // direct-remote 也是无签名通路：概览记「不支持官方签名」，与标题「未签名」一致。
    mocks.profiles.mockResolvedValue({ id: 'local', name: '远端模型', adapter: 'openai-compatible', baseUrl: 'https://api.example.com/v1', modelId: 'model' });
    mocks.execute.mockResolvedValue(completed('direct-remote'));
    window.localStorage.setItem(CREATOR_DRAFT_KEY, JSON.stringify(draft()));
    await mount(); await click('生成数据卡');
    expect(mocks.execute.mock.calls[0]![2]).toMatchObject({ mode: 'direct-remote' });
    expect([...container.querySelectorAll('h2.sr-only')].some((heading) => heading.textContent === '百合')).toBe(true);
    expect(container.querySelector('[data-testid="result-signature-status"]')?.textContent).toContain('未签名');
    expect(container.textContent).toContain('当前执行通路不支持官方签名，结果为非原生');
    expect(container.textContent).not.toContain('签名失败');
  });

  it('describes a restored signed draft as unverified instead of signed (G3-r1)', async () => {
    // 草稿恢复的结果无本次生成快照：标题如实记「本机未验证」，
    // 概览回落到中性文案，不冒充「官方签名」也不说「签名失败」。
    window.localStorage.setItem(CREATOR_DRAFT_KEY, JSON.stringify(draft({
      output: {
        mode: 'hosted-json',
        cardKind: 'magical-girl',
        card: { ...card, signature: 'sig' },
        rawText: JSON.stringify(card),
        phase: 'completed',
      },
    })));
    await mount();
    expect([...container.querySelectorAll('h2.sr-only')].some((heading) => heading.textContent === '百合')).toBe(true);
    expect(container.querySelector('[data-testid="result-signature-status"]')?.textContent).toContain('含签名字段（本机未验证）');
    expect(container.querySelector('[data-testid="result-signature-status"]')?.textContent).not.toContain('官方签名');
    expect(container.textContent).toContain('请以当前结果数据为准');
  });

  it.each([
    ['direct-local', 'http://127.0.0.1:11434/v1', 'stream'],
    ['direct-local', 'http://127.0.0.1:11434/v1', 'non-stream'],
    ['direct-remote', 'https://model.example/v1', 'stream'],
    ['direct-remote', 'https://model.example/v1', 'non-stream'],
  ] as const)('dispatches %s (%s) with selected %s mode', async (mode, baseUrl, generationMode) => {
    mocks.profiles.mockResolvedValue({ id: 'local', name: '测试模型', adapter: 'openai-compatible', baseUrl, modelId: 'model' });
    window.localStorage.setItem(CREATOR_DRAFT_KEY, JSON.stringify(draft({ selectedRuleIds: [], primaryRuleId: null, freeformBrief: '巡夜人' })));
    await mount();
    expect(button('流式').matches(':disabled')).toBe(false);
    await click('流式');
    if (generationMode === 'non-stream') await click('非流式');
    const template = generationMode === 'stream' ? 'general' : 'magical-girl';
    const selectedLabel = generationMode === 'stream' ? '流式' : '非流式';
    await click('服务器'); await click('客户端');
    expect(button(selectedLabel).getAttribute('aria-pressed')).toBe('true');
    expect(JSON.parse(window.localStorage.getItem(CREATOR_DRAFT_KEY)!)).toMatchObject({ template, generationMode });
    await click('生成数据卡');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]![1]).toMatchObject({ template });
    expect(mocks.execute.mock.calls[0]![2]).toMatchObject({ mode, generationMode });
  });

  it('rejects a restored structured template in client stream mode without dispatch', async () => {
    window.localStorage.setItem(CREATOR_DRAFT_KEY, JSON.stringify(draft({ generationMode: 'stream' })));
    await mount(); await click('生成数据卡');
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(container.textContent).toContain('当前仅支持【通用角色卡（Markdown）】与【通用情景卡（Markdown）】使用流式创作');
    expect(JSON.parse(window.localStorage.getItem(CREATOR_DRAFT_KEY)!)).toMatchObject({ template: 'magical-girl', generationMode: 'stream' });
  });

  it('dispatches hosted-stream for stream templates on server execution', async () => {
    aiConfig('server');
    const generalCard = {
      templateId: GENERAL_CHARACTER_TEMPLATE_ID,
      name: '雾都巡夜人',
      content: '# 雾都巡夜人\n一名在雾中巡逻的少女。',
    };
    mocks.execute.mockResolvedValue(completed('hosted-stream', { card: generalCard, cardKind: 'general' }));
    window.localStorage.setItem(CREATOR_DRAFT_KEY, JSON.stringify(draft({ template: 'general', generationMode: 'stream' })));
    await mount(); await click('生成数据卡');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]![1].template).toBe('general');
    expect(mocks.execute.mock.calls[0]![2]).toMatchObject({ mode: 'hosted-stream' });
    expect([...container.querySelectorAll('h2.sr-only')].some((heading) => heading.textContent === '雾都巡夜人')).toBe(true);
    expect(container.querySelector('[data-testid="result-signature-status"]')?.textContent).toContain('未签名');
    // 流式通路不可携带官方签名标签；概览如实记「不支持签名」而非「签名失败」。
    expect(container.querySelector('[data-testid="result-signature-status"]')?.textContent).not.toContain('官方签名');
    expect(container.textContent).toContain('当前执行通路不支持官方签名，结果为非原生');
    expect(container.textContent).not.toContain('签名失败');
    await click('保存到本地卡库');
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0]![0]).toMatchObject({ cardType: 'character', title: '雾都巡夜人' });
  });

  it('restores drafts referencing removed build-rule presets without crashing (G3-r1)', async () => {
    // 旧版本/手工编辑的草稿可能引用已下架规则：渲染期过滤先于求值，
    // 对账效应再剔除失效项并回写草稿，页面保持可操作。
    window.localStorage.setItem(CREATOR_DRAFT_KEY, JSON.stringify(draft({
      selectedRuleIds: ['arena-trpg-lite', 'removed-rule'],
      primaryRuleId: 'removed-rule',
      ruleInputsById: { 'removed-rule': { ignored: true } },
    })));
    await mount();

    expect(container.textContent).toContain('问题 1 /');
    await settle();
    const stored = JSON.parse(window.localStorage.getItem(CREATOR_DRAFT_KEY)!) as {
      selectedRuleIds?: string[];
      primaryRuleId?: string | null;
    };
    expect(stored.selectedRuleIds).toEqual(['arena-trpg-lite']);
    expect(stored.primaryRuleId).toBe('arena-trpg-lite');
    expect(button('生成数据卡').disabled).toBe(false);
    await click('生成数据卡');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]![1].buildRuleRequests).toEqual([
      { ruleId: 'arena-trpg-lite', version: expect.any(String), inputs: expect.any(Object) },
    ]);
  });

  it('suppresses stale preset-load responses when manual adds race (G3-r1)', async () => {
    // 两个预设请求乱序返回：后发起的是较新意图，先到的旧响应不得覆盖当前选择集。
    const questionnaireA = { ...questionnaire, id: 'preset-a-questionnaire', title: '预设问卷A' };
    const questionnaireB = { ...questionnaire, id: 'preset-b-questionnaire', title: '预设问卷B' };
    const deferreds = new Map<string, () => void>();
    stubPresetRaceFetch(deferreds, { a: questionnaireA, b: questionnaireB });
    await mount();
    await click('开始回答问卷');
    await clickText('问卷设置');
    await pickPreset('preset-a');
    await pickPreset('preset-b');
    // 后到期的 B 是较新意图：先应用。
    await act(async () => deferreds.get('b')!());
    await settle();
    expect(storedSelectionIds()).toContain('preset-b-questionnaire');
    // 旧请求 A 晚到：已被 B 作废，不得覆盖/追加进当前选择集。
    await act(async () => deferreds.get('a')!());
    await settle();
    expect(storedSelectionIds()).not.toContain('preset-a-questionnaire');
    expect(storedSelectionIds()).toContain('preset-b-questionnaire');
  });

  it('appends every concurrent preset add under multi-questionnaire mode (G3-r1-r1)', async () => {
    // 多选追加保留每次有效的添加意图：A 未加载完再选 B 不取消 A，
    // 两请求各自生效、按完成序并入最新选择集（修复前 B 直接 abort A）。
    const questionnaireA = { ...questionnaire, id: 'preset-a-questionnaire', title: '预设问卷A' };
    const questionnaireB = { ...questionnaire, id: 'preset-b-questionnaire', title: '预设问卷B' };
    const deferreds = new Map<string, () => void>();
    stubPresetRaceFetch(deferreds, { a: questionnaireA, b: questionnaireB });
    window.localStorage.setItem(CREATOR_DRAFT_KEY, JSON.stringify(draft({ allowMultipleQuestionnaires: true })));
    await mount();

    await clickText('问卷设置');
    await pickPreset('preset-a');
    await pickPreset('preset-b');
    // 与发起序相反的完成序：B 先落地、A 后落地，两者都必须保留。
    await act(async () => deferreds.get('b')!());
    await settle();
    await act(async () => deferreds.get('a')!());
    await settle();
    expect(storedSelectionIds()).toContain('preset-a-questionnaire');
    expect(storedSelectionIds()).toContain('preset-b-questionnaire');
    expect(storedSelectionIds()).toContain('magical-girl-default');
  });

  it('drops a pending preset load once answers are cleared mid-flight (G3-r1-r1)', async () => {
    // 加载途中清除草稿：该请求不再适用，响应落地也不得把问卷加回来。
    const questionnaireA = { ...questionnaire, id: 'preset-a-questionnaire', title: '预设问卷A' };
    const deferreds = new Map<string, () => void>();
    stubPresetRaceFetch(deferreds, { a: questionnaireA, b: questionnaire });
    window.localStorage.setItem(CREATOR_DRAFT_KEY, JSON.stringify(draft()));
    await mount();

    await clickText('问卷设置');
    await pickPreset('preset-a');
    await clickText('一键填充答案');
    vi.mocked(window.confirm).mockReturnValue(true);
    await click('清空存档');
    await act(async () => deferreds.get('a')!());
    await settle();
    expect(storedSelectionIds()).not.toContain('preset-a-questionnaire');
  });

  it('drops a pending preset load across template switches, including switch-back (G3-r1-r1)', async () => {
    // 加载途中切模板再切回：往返两次推进世代，响应回到原模板时同样失效。
    const questionnaireA = { ...questionnaire, id: 'preset-a-questionnaire', title: '预设问卷A' };
    const deferreds = new Map<string, () => void>();
    stubPresetRaceFetch(deferreds, { a: questionnaireA, b: questionnaire });
    window.localStorage.setItem(CREATOR_DRAFT_KEY, JSON.stringify(draft()));
    await mount();

    await clickText('问卷设置');
    await pickPreset('preset-a');
    await clickText('残兽（结构化）');
    await clickText('魔法少女（结构化）');
    await click('非流式');
    await act(async () => deferreds.get('a')!());
    await settle();
    expect(storedSelectionIds()).not.toContain('preset-a-questionnaire');
  });

  it('keeps a newer local-questionnaire pick over a stale preset response in single mode (G3-r1-r1)', async () => {
    // 单选下改选本地问卷是更新的替换意图：迟到的预设响应不得把它顶回。
    const questionnaireA = { ...questionnaire, id: 'preset-a-questionnaire', title: '预设问卷A' };
    const localQuestionnaire = { ...questionnaire, id: 'local-upload-questionnaire', title: '本地问卷' };
    const deferreds = new Map<string, () => void>();
    stubPresetRaceFetch(deferreds, { a: questionnaireA, b: questionnaire });
    window.localStorage.setItem(CREATOR_DRAFT_KEY, JSON.stringify(draft()));
    await mount();

    await clickText('问卷设置');
    await pickPreset('preset-a');
    await clickText('粘贴导入 JSON');
    const textarea = [...container.querySelectorAll('textarea')].find(
      (item) => item.placeholder === '在此粘贴问卷 JSON',
    )!;
    await act(async () => {
      setNativeValue(textarea, JSON.stringify(localQuestionnaire));
    });
    await click('解析并载入');
    await act(async () => deferreds.get('a')!());
    await settle();
    expect(storedSelectionIds()).toContain('local-upload-questionnaire');
    expect(storedSelectionIds()).not.toContain('preset-a-questionnaire');
  });

  it('refuses the un-wired scenario template with an explanatory error instead of dispatching', async () => {
    aiConfig('server');
    window.localStorage.setItem(CREATOR_DRAFT_KEY, JSON.stringify(draft({ template: 'scenario' })));
    await mount();
    await click('生成数据卡');
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(container.textContent).toContain('「情景（结构化）」模板暂未接入生成通路，请选择其他创作模板。');
  });

  it('blocks generation while the saved system model has left the catalog', async () => {
    // D5.1-AIP-r1-r1：曾选系统模型被目录移除——解析层保留诊断值并告警，
    // 生成按钮禁用；即使绕过按钮状态派发，入口守卫也不触达执行器。
    window.localStorage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, JSON.stringify({
      version: 3,
      selection: {
        executionPreference: 'server',
        clientConnectionId: 'local',
        systemModelId: 'retired-model',
      },
      hiddenPresetIds: [],
      generationOverrides: {},
      modelsByProfileId: {},
    }));
    window.localStorage.setItem(CREATOR_DRAFT_KEY, JSON.stringify(draft()));
    await mount();
    expect(container.textContent).toContain('已不在支持列表中');
    expect(button('生成数据卡').disabled).toBe(true);
    button('生成数据卡').click();
    await settle();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
