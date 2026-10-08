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
    // 快捷选项作答：写答案不走 textarea，覆盖 quickOption → updateAnswer 链路。
    await click('还没想好');
    await click('生成数据卡');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]![1]).toMatchObject({ template: 'magical-girl', language: 'zh-CN' });
    expect(mocks.execute.mock.calls[0]![1].buildRuleRequests).toEqual([{ ruleId: 'arena-trpg-lite', version: expect.any(String), inputs: expect.any(Object) }]);
    expect(mocks.execute.mock.calls[0]![2]).toMatchObject({ mode: 'direct-local', modelId: 'model' });
    expect(container.textContent).toContain('百合 · 未签名');
    await click('保存到本地卡库');
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('已保存到本地卡库。');
  });

  it('keeps the result-overview snapshot across regeneration (G3-r1)', async () => {
    await mount();
    await click('开始回答问卷');
    await clickText('魔法少女（结构化）');
    await click('还没想好');
    await click('生成数据卡');
    expect(container.textContent).toContain('百合 · 未签名');
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
    expect(container.textContent).toContain('百合 · 未签名');
    // 快照归属本次生成意图：完成后侧栏仍按新快照投影（修复前回落为无快照兜底文案）。
    expect(container.textContent).toContain('创作完成');
    expect(container.textContent).toMatch(/共 \d+ 题，已进入结果阶段/);
    expect(container.textContent).not.toContain('请以当前结果数据为准');
  });

  it('gates generation on pending restore until the draft is explicitly restored', async () => {
    window.localStorage.setItem(CREATOR_DRAFT_KEY, JSON.stringify(draft()));
    await mount();
    // 待恢复期间选择集未就绪：停在状态页并如实说明，不出现可用的生成键。
    expect(container.textContent).toContain('发现上次草稿，请选择恢复或清除。');
    expect(container.textContent).toContain('草稿待处理，请先选择恢复或清除。');
    expect([...container.querySelectorAll('button')].some((item) => item.textContent === '生成数据卡' || item.textContent === '直接生成')).toBe(false);
    await click('恢复草稿');
    expect(container.textContent).toContain('问题 1 /');
    expect(button('生成数据卡').disabled).toBe(false);
    await click('生成数据卡');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]![1].answers).toHaveLength(1);
    expect(container.textContent).toContain('百合 · 未签名');
  });

  it('projects the shared hosted-json request body with build rules and native-signature eligibility', async () => {
    aiConfig('server');
    window.localStorage.setItem(CREATOR_DRAFT_KEY, JSON.stringify(draft({ freeformBrief: '想要百合主题' })));
    mocks.execute.mockResolvedValue(completed('hosted-json', { card: { ...card, signature: 'sig' } }));
    await mount(); await click('恢复草稿'); await click('生成数据卡');
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
    // 新鲜 hosted-json 响应携带签名字段 → official-signed 标签。
    expect(container.textContent).toContain('官方签名');
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
    await mount(); await click('恢复草稿'); await click('生成数据卡');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]![1].template).toBe('general');
    expect(mocks.execute.mock.calls[0]![2]).toMatchObject({ mode: 'hosted-stream' });
    expect(container.textContent).toContain('雾都巡夜人');
    // 流式通路不可携带官方签名标签。
    expect(container.textContent).not.toContain('官方签名');
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
    await click('恢复草稿');
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

  it('refuses the un-wired scenario template with an explanatory error instead of dispatching', async () => {
    aiConfig('server');
    window.localStorage.setItem(CREATOR_DRAFT_KEY, JSON.stringify(draft({ template: 'scenario' })));
    await mount(); await click('恢复草稿');
    await click('生成数据卡');
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(container.textContent).toContain('「情景（结构化）」模板暂未接入生成通路，请选择其他创作模板。');
  });
});
