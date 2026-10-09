// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { buildUnsignedMagicalGirlDetailsCard } from '@mahoshojo/ai-core/magical-girl-details-generation';
import { buildUnsignedCanshouCard } from '@mahoshojo/ai-core/canshou-generation';
import { resetDesktopCloudSessionStoreForTests } from '../src/features/account/use-desktop-cloud-session';
import { resetDesktopAiConfigStoreForTests } from '../src/features/ai-config/use-desktop-ai-config';
import { DESKTOP_AI_CONFIG_STORAGE_KEY } from '../src/features/ai-config/desktop-ai-config-store';
import { createInitialSublimationDraft } from '../src/features/sublimation/session';
import { validateFreeCard } from '../src/features/free/generation';
import { validateCreatorResultCard } from '../src/features/creator/generation';
import { validateScenarioCard } from '../src/features/scenario/generation';
import { normalizeCanshouResultCard } from '../src/features/canshou/generation';
import { validateSublimationCard } from '../src/features/sublimation/generation';
import { createDesktopRouter } from '../src/app/router';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), execute: vi.fn(), save: vi.fn(), listen: vi.fn(), profiles: vi.fn(), readAttachments: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, isTauri: () => true }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: mocks.listen }) }));
vi.mock('@mahoshojo/ui-web/free', async (original) => ({ ...await original<object>(), readFreeAttachmentFiles: mocks.readAttachments }));
vi.mock('../src/platform/provider-profile-bridge', () => ({ listProviderProfileIds: async () => ['local'], getProviderProfile: mocks.profiles }));
vi.mock('../src/platform/local-card-bridge', () => ({ IpcLocalCardRepository: class { putIfAbsent = mocks.save; } }));
vi.mock('../src/features/canshou/generation', async (original) => ({ ...await original<object>(), executeCanshouGeneration: mocks.execute }));
vi.mock('../src/features/free/generation', async (original) => ({ ...await original<object>(), executeFreeGeneration: mocks.execute }));
vi.mock('../src/features/creator/generation', async (original) => ({ ...await original<object>(), executeCreatorGeneration: mocks.execute }));
vi.mock('../src/features/scenario/generation', async (original) => ({ ...await original<object>(), executeScenarioGeneration: mocks.execute }));
vi.mock('../src/features/sublimation/generation', async (original) => ({ ...await original<object>(), executeSublimationGeneration: mocks.execute }));

const magical = buildUnsignedMagicalGirlDetailsCard({ codename: '已完成少女', appearance: { outfit: '礼服', accessories: '', colorScheme: '', overallLook: '' }, magicConstruct: { name: '', form: '', basicAbilities: [], description: '' }, wonderlandRule: { name: '', description: '', tendency: '', activation: '' }, blooming: { name: '', evolvedAbilities: [], evolvedForm: '', evolvedOutfit: '', powerLevel: '' }, analysis: { personalityAnalysis: '', abilityReasoning: '', coreTraits: [], predictionBasis: '', background: { belief: '', bonds: '' } } }, []);
const canshou = buildUnsignedCanshouCard({ name: '已完成残兽', coreConcept: '回声', coreEmotion: '孤独', evolutionStage: '幼年期', appearance: '雾', materialAndSkin: '雾', featuresAndAppendages: '风铃', attackMethod: '回声', specialAbility: '重现', origin: '巢穴', birthEnvironment: '空洞', researcherNotes: '观察' }, []);
const cards = {
  'magical-girl': magical,
  canshou,
  general: { templateId: '通用角色', name: '已完成角色', content: '# 完整角色\n\n结果正文' },
  scenario: { title: '已完成情景', scenario_type: '采访', description: '雨后采访', elements: { scene: { time: '傍晚', place: '天台', features: '积水' }, roles: [], events: '采访', atmosphere: '安静', development: ['和解'] }, metadata: { created_at: '2026-01-01T00:00:00.000Z' } },
  'general-scenario': { templateId: '通用情景', title: '已完成通用情景', content: '# 完整情景\n\n结果正文' },
};
type Kind = keyof typeof cards;
type Page = 'details' | 'canshou' | 'free' | 'creator' | 'scenario' | 'sublimation';
type Mode = 'stream' | 'non-stream';
const matrix: { page: Page; kind: Kind; mode: Mode }[] = [
  { page: 'canshou', kind: 'canshou', mode: 'non-stream' }, { page: 'canshou', kind: 'general', mode: 'stream' },
  ...(['magical-girl', 'canshou', 'general', 'scenario', 'general-scenario'] as const).map((kind) => ({ page: 'free' as const, kind, mode: 'non-stream' as const })),
  ...(['general', 'general-scenario'] as const).map((kind) => ({ page: 'free' as const, kind, mode: 'stream' as const })),
  ...(['magical-girl', 'canshou', 'general', 'general-scenario'] as const).map((kind) => ({ page: 'creator' as const, kind, mode: 'non-stream' as const })),
  ...(['general', 'general-scenario'] as const).map((kind) => ({ page: 'creator' as const, kind, mode: 'stream' as const })),
  { page: 'scenario', kind: 'scenario', mode: 'non-stream' }, { page: 'scenario', kind: 'general-scenario', mode: 'stream' },
  ...(['magical-girl', 'canshou', 'general'] as const).map((kind) => ({ page: 'sublimation' as const, kind, mode: 'non-stream' as const })),
  { page: 'sublimation', kind: 'general', mode: 'stream' },
];
const questionnaire = { id: 'cloud-test', kind: 'magical-girl', title: '输入问卷不可上传', questions: [{ id: 'q', question: '输入问题', type: 'text' }], nativeAllowed: false };
const draftFor = (page: Page, kind: Kind, mode: Mode) => {
  if (page === 'free') return { schemaId: kind, generationMode: mode, prompt: '输入提示词不可上传', selectedLanguage: 'zh-CN' };
  if (page === 'scenario') return { answers: { '故事发生的场景是怎样的？': '输入答案不可上传' }, fieldsToKeepEmpty: [], scenarioTitleHint: '输入标题不可上传', generationMode: mode, selectedLanguage: 'zh-CN', generalScenarioDraft: { templateId: '通用情景', title: '独立编辑器', content: '编辑器内容不可上传' } };
  if (page === 'sublimation') return { ...createInitialSublimationDraft(), originalData: cards.general, targetTemplate: kind, generationMode: mode, userGuidance: '输入引导不可上传', loreText: '输入Lore不可上传' };
  return { answers: { 'preset:cloud-test::q': '输入答案不可上传' }, language: 'zh-CN', template: kind, generationMode: mode, freeformBrief: '输入说明不可上传', selectedRuleIds: [], primaryRuleId: '', questionnaireSelections: [{ source: 'preset', selectionId: 'preset:cloud-test', questionnaire: { ...questionnaire, kind: page === 'canshou' ? 'canshou' : 'magical-girl' } }] };
};
let root: Root; let container: HTMLDivElement; let closeHandlers: ((event: { preventDefault: () => void }) => void)[];
let finish: (response: unknown) => void;
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)); });
const button = (text: string) => [...document.querySelectorAll('button')].find((node) => node.textContent?.trim() === text)!;
const click = async (text: string) => { expect(button(text), text).toBeTruthy(); await act(async () => button(text).click()); await flush(); };
const writes = () => mocks.invoke.mock.calls.filter(([command, args]) => command === 'cloud_card_library_request' && args.request.routeId === 'data-cards.create');
const resultData = (kind: Kind) => ({ ...cards[kind], futureExtension: { unknown: ['keep', { nested: true }] }, _author: { input: 'preserve existing fields' } });
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); window.localStorage.clear(); resetDesktopCloudSessionStoreForTests(); closeHandlers = [];
  window.localStorage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, JSON.stringify({ version: 2, selection: { executionPreference: 'client', clientConnectionId: 'local' }, hiddenPresetIds: [] }));
  resetDesktopAiConfigStoreForTests();
  mocks.profiles.mockResolvedValue({ id: 'local', name: '本地模型', adapter: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', modelId: 'model' });
  mocks.save.mockResolvedValue({ written: true });
  mocks.readAttachments.mockReset().mockResolvedValue({ added: [], skipped: 0 });
  mocks.listen.mockImplementation(async (handler) => { closeHandlers.push(handler); return vi.fn(); });
  mocks.invoke.mockImplementation(async (command, args) => {
    const account = { userId: 7, username: 'mock-user' }; const sessionExpiresAt = '2099-01-01T00:00:00.000Z';
    if (command === 'cloud_cached_account') return { account, sessionExpiresAt };
    if (command === 'cloud_auth_status') return { state: 'active', account, sessionExpiresAt };
    if (command === 'cloud_card_library_request') {
      if (args.request.routeId === 'user-capacity.query') return { status: 200, body: { success: true, capacity: 10, usedSlots: 0 } };
      if (args.request.routeId === 'data-cards.create') return new Promise((resolve) => { finish = resolve; });
    }
  });
  vi.stubGlobal('fetch', vi.fn(async (url) => ({ ok: true, json: async () => String(url).includes('languages') ? [{ code: 'zh-CN', name: '简体中文' }] : String(url).includes('index') ? { presets: [] } : questionnaire })));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  HTMLDialogElement.prototype.showModal = function () { this.open = true; }; HTMLDialogElement.prototype.close = function () { this.open = false; };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const mount = async (page: Page) => { window.location.hash = `#/${page}`; const router = createDesktopRouter(); await router.load(); await act(async () => root.render(<StrictMode><RouterProvider router={router} /></StrictMode>)); await flush(); return router; };

describe('all actual generator hosts reuse the private completed-result save', () => {
  it.each(matrix.flatMap((row) => [false, true].map((restored) => ({ ...row, restored }))))('$page $kind $mode restored=$restored saves complete actual result with correct type and guarded lifecycle', async ({ page, kind, mode, restored }) => {
    const data = resultData(kind);
    // The existing family owns completion normalization; save must preserve that full
    // completed snapshot rather than reconstructing it from current controls or raw output.
    const validate = { details: validateFreeCard, free: validateFreeCard, creator: validateCreatorResultCard, scenario: validateScenarioCard, canshou: (kind: Kind, data: unknown) => kind === 'canshou' ? normalizeCanshouResultCard(data) : validateFreeCard('general', data), sublimation: validateSublimationCard }[page];
    const completedData = validate(kind as never, data);
    const output = { phase: 'completed', mode: 'direct-local', cardKind: kind, card: data, rawText: JSON.stringify(data) };
    mocks.execute.mockResolvedValue({ ...output, status: 'completed' });
    const input = draftFor(page, kind, mode);
    if (page === 'scenario' && !restored) input.generalScenarioDraft = undefined;
    window.localStorage.setItem(`mahoshojo.desktop.${page}.draft.v1`, JSON.stringify({ version: 1, ...input, ...(restored ? { output } : {}) }));
    const router = await mount(page);
    if (!restored) {
      if (page === 'canshou') {
        if (mode === 'stream') await click('流式');
        const final = container.querySelector<HTMLButtonElement>('[aria-label="问卷翻页操作"] button:last-child');
        expect(final).toBeTruthy(); await act(async () => final!.click()); await flush();
      } else await click(page === 'scenario' ? '生成情景' : page === 'sublimation' ? '开始升华' : '生成数据卡');
      expect(mocks.execute).toHaveBeenCalledTimes(1);
    } else expect(mocks.execute).not.toHaveBeenCalled();
    expect(button('保存到云端')).toBeTruthy(); expect(writes()).toHaveLength(0);
    // Editable input changes after completion never decide the completed card's cloud type.
    if (page === 'free') {
      const select = container.querySelector<HTMLSelectElement>('[aria-label="选择 Schema"]')!;
      await act(async () => { select.value = kind === 'general-scenario' ? 'general' : 'general-scenario'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    }
    if (page === 'creator') {
      const targetLabel = kind === 'general-scenario' ? '通用角色' : '通用情景';
      const control = [...container.querySelectorAll<HTMLButtonElement>('button[data-creator-surface="subpanel"]')].find((node) => node.querySelector('span')?.textContent?.startsWith(targetLabel));
      expect(control).toBeTruthy(); await act(async () => control!.click()); await flush();
    }
    await click('保存到云端');
    const generationCount = mocks.execute.mock.calls.length;
    const regenerate = button(page === 'sublimation' ? '重新升华' : '重新生成');
    const clear = button('清除草稿');
    await act(async () => { button('保存').click(); button('保存').click(); regenerate?.click(); clear?.click(); }); await flush();
    expect(writes()).toHaveLength(1); expect(mocks.execute).toHaveBeenCalledTimes(generationCount);
    expect(writes()[0][1].request).toEqual({ routeId: 'data-cards.create', expectedUserId: 7, body: { type: kind === 'scenario' || kind === 'general-scenario' ? 'scenario' : 'character', name: kind === 'magical-girl' ? '已完成少女' : kind === 'canshou' ? '已完成残兽' : kind === 'general' ? '已完成角色' : kind === 'scenario' ? '已完成情景' : '已完成通用情景', description: kind === 'scenario' || kind === 'general-scenario' ? '情景数据卡' : '角色数据卡', data: completedData, isPublic: 0 } });
    expect(button('保存到本地卡库').disabled).toBe(true);
    await act(async () => { void router.navigate({ to: '/' }); }); await flush(); expect(router.state.location.pathname).toBe(`/${page}`);
    const preventDefault = vi.fn(); await act(async () => { closeHandlers.forEach((handler) => handler({ preventDefault })); }); expect(preventDefault).toHaveBeenCalled();
    await act(async () => finish({ status: 500, body: { error: 'after insert' } })); await flush();
    expect(document.body.textContent).toContain('服务器可能已创建副本'); expect(button('保存').disabled).toBe(true);
    await click('取消'); await click('保存到云端'); expect(writes()).toHaveLength(1); expect(button('保存').disabled).toBe(true);
    expect(mocks.save).not.toHaveBeenCalled(); expect(button('保存到本地卡库').disabled).toBe(false);
    if (page === 'scenario') expect([...document.querySelectorAll('button')].filter((node) => node.textContent === '保存到云端')).toHaveLength(1);
  });
  it('creator keeps the completed card when confirm-clear and cloud submit occur in one tick', async () => {
    const data = resultData('general');
    window.localStorage.setItem('mahoshojo.desktop.creator.draft.v1', JSON.stringify({ version: 1, ...draftFor('creator', 'general', 'non-stream'), output: { phase: 'completed', mode: 'direct-local', cardKind: 'general', card: data, rawText: '' } }));
    await mount('creator');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const control = [...container.querySelectorAll<HTMLButtonElement>('button[data-creator-surface="subpanel"]')].find((node) => node.querySelector('span')?.textContent?.startsWith('通用情景'))!;
    await act(async () => control.click()); await flush();
    await click('清除草稿'); const clear = button('确认清除'); expect(clear).toBeTruthy();
    await click('保存到云端');
    await act(async () => { button('保存').click(); clear.click(); }); await flush();
    expect(writes()).toHaveLength(1); expect(button('保存到本地卡库')).toBeTruthy();
    await act(async () => finish({ status: 400, body: { error: 'mock refusal' } })); await flush();
    expect(document.body.textContent).toContain('mock refusal'); expect(button('保存到本地卡库')).toBeTruthy(); expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('free attachment read generations clear synchronously and never release a newer read', async () => {
    const data = resultData('general');
    window.localStorage.setItem('mahoshojo.desktop.free.draft.v1', JSON.stringify({ version: 1, ...draftFor('free', 'general', 'non-stream'), output: { phase: 'completed', mode: 'direct-local', cardKind: 'general', card: data, rawText: '' } }));
    await mount('free');
    let finishA!: (value: unknown) => void; let finishB!: (value: unknown) => void;
    mocks.readAttachments.mockReturnValueOnce(new Promise((resolve) => { finishA = resolve; })).mockReturnValueOnce(new Promise((resolve) => { finishB = resolve; }));
    const input = container.querySelector<HTMLInputElement>('[aria-label="参考附件"] input[type=file]')!;
    const read = async () => { await act(async () => { Object.defineProperty(input, 'files', { configurable: true, value: [new File(['input'], 'input.txt')] }); input.dispatchEvent(new Event('change', { bubbles: true })); }); await flush(); };
    await read(); expect(button('保存到云端').disabled).toBe(true);
    await click('清空附件'); await click('保存到云端'); expect(button('保存')).toBeTruthy(); await click('取消');
    await read(); await act(async () => finishA({ added: [], skipped: 0 })); await flush();
    expect(button('保存到云端').disabled).toBe(true); expect(document.body.textContent).toContain('正在读取附件');
    await click('清空附件'); await click('保存到云端');
    await act(async () => { button('保存').click(); input.dispatchEvent(new Event('change', { bubbles: true })); }); await flush();
    expect(writes()).toHaveLength(1); expect(mocks.readAttachments).toHaveBeenCalledTimes(2);
    await act(async () => { finishB({ added: [], skipped: 0 }); finish({ status: 201, body: { success: true, id: 'copy', ownerUserId: 7, accountFenceVersion: 1 } }); }); await flush();
    expect(writes()[0][1].request.body.data).toEqual(data); expect(document.body.textContent).toContain('已保存到云端');
  });
  it('sublimation blocks same-tick source import and discard without sending input or lore', async () => {
    const data = resultData('general'); const key = 'mahoshojo.desktop.sublimation.draft.v1';
    window.localStorage.setItem(key, JSON.stringify({ version: 1, ...draftFor('sublimation', 'general', 'non-stream'), output: { phase: 'completed', mode: 'direct-local', cardKind: 'general', card: data, rawText: '' } }));
    await mount('sublimation');
    const text = container.querySelector<HTMLTextAreaElement>('#source-json')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(text, JSON.stringify({ templateId: '通用角色', name: '不应替换', content: '新素材' })); text.dispatchEvent(new Event('input', { bubbles: true })); });
    await click('保存到云端');
    await act(async () => { button('保存').click(); button('从文本加载设定').click(); button('清除草稿').click(); }); await flush();
    expect(writes()).toHaveLength(1); expect(writes()[0][1].request.body.data).toEqual(data);
    expect(JSON.parse(window.localStorage.getItem(key)!).originalData).toEqual(cards.general);
    expect(button('保存到本地卡库')).toBeTruthy(); expect(mocks.execute).not.toHaveBeenCalled();
    await act(async () => finish({ status: 400, body: { error: 'mock refusal' } })); await flush();
    expect(button('保存到本地卡库')).toBeTruthy();
  });

  it.each(['details', 'canshou', 'free', 'creator', 'scenario', 'sublimation'] as const)('%s never offers cloud save for a restored non-completed output carrying a card', async (page) => {
    const kind = page === 'scenario' ? 'general-scenario' : 'general';
    window.localStorage.setItem(`mahoshojo.desktop.${page}.draft.v1`, JSON.stringify({ version: 1, ...draftFor(page, kind, 'stream'), output: { phase: 'uncertain', mode: 'direct-local', cardKind: kind, card: resultData(kind), rawText: 'partial' } }));
    await mount(page);
    expect(button('保存到云端')).toBeUndefined(); expect(writes()).toHaveLength(0); expect(mocks.execute).not.toHaveBeenCalled();
  });

});
