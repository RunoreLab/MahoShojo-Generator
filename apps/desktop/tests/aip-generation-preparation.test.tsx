// @vitest-environment jsdom
// Actual routes, sessions and shared preparation; only native IO/executor are mocked.
import { buildUnsignedMagicalGirlDetailsCard } from '@mahoshojo/ai-core/magical-girl-details-generation';
import { buildUnsignedCanshouCard } from '@mahoshojo/ai-core/canshou-generation';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesktopRouter } from '../src/app/router';
import { DESKTOP_AI_CONFIG_STORAGE_KEY } from '../src/features/ai-config/desktop-ai-config-store';
import { getDesktopAiConfigStore, resetDesktopAiConfigStoreForTests } from '../src/features/ai-config/use-desktop-ai-config';
import { DETAILS_DRAFT_KEY } from '../src/features/details/session';
import { CANSHOU_DRAFT_KEY } from '../src/features/canshou/session';
import { CREATOR_DRAFT_KEY } from '../src/features/creator/session';
import { FREE_DRAFT_KEY } from '../src/features/free/session';
import { SCENARIO_DRAFT_KEY } from '../src/features/scenario/session';
const mocks = vi.hoisted(() => ({ execute: vi.fn(), invoke: vi.fn(), profiles: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, isTauri: () => true }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: async () => () => undefined }) }));
vi.mock('../src/platform/provider-profile-bridge', () => ({ listProviderProfileIds: async () => ['legacy'], getProviderProfile: mocks.profiles }));
vi.mock('../src/features/details/generation', async (original) => ({ ...await original<object>(), executeDetailsGeneration: mocks.execute }));
vi.mock('../src/features/canshou/generation', async (original) => ({ ...await original<object>(), executeCanshouGeneration: mocks.execute }));
vi.mock('../src/features/creator/generation', async (original) => ({ ...await original<object>(), executeCreatorGeneration: mocks.execute }));
vi.mock('../src/features/free/generation', async (original) => ({ ...await original<object>(), executeFreeGeneration: mocks.execute }));
vi.mock('../src/features/scenario/generation', async (original) => ({ ...await original<object>(), executeScenarioGeneration: mocks.execute }));
const routes = ['details', 'canshou', 'creator', 'free', 'scenario'] as const;
type Page = typeof routes[number];
let root: Root | undefined;
let container: HTMLDivElement;
let releaseSave: () => void;
let presence = false;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });
const button = (name: string) => [...container.querySelectorAll('button')].find((item) => item.textContent === name);
const click = async (name: string) => { expect(button(name), name).toBeTruthy(); await act(async () => button(name)!.click()); await settle(); };
const generateLabel = (page: Page) => page === 'details' || page === 'canshou' ? '发送问卷并生成' : page === 'scenario' ? '生成情景' : '生成数据卡';
const questionnaire = (page: Page) => ({ id: 'test', kind: page === 'canshou' ? 'canshou' : 'magical-girl', title: '准备测试问卷', nativeAllowed: true, questions: [{ id: 'q', question: '描述' }] });
function seedDraft(page: Page) {
  const shared = { version: 1, answers: { 'preset:test::q': '测试回答' }, language: 'zh-CN', questionnaireSelections: [{ source: 'preset', selectionId: 'preset:test', questionnaire: questionnaire(page) }] };
  const drafts: Record<Page, [string, unknown]> = {
    details: [DETAILS_DRAFT_KEY, shared], canshou: [CANSHOU_DRAFT_KEY, shared],
    creator: [CREATOR_DRAFT_KEY, { ...shared, template: 'magical-girl', generationMode: 'non-stream', freeformBrief: '', selectedRuleIds: ['arena-trpg-lite'], primaryRuleId: 'arena-trpg-lite' }],
    free: [FREE_DRAFT_KEY, { version: 1, schemaId: 'general', generationMode: 'non-stream', prompt: '测试角色', selectedLanguage: 'zh-CN' }],
    scenario: [SCENARIO_DRAFT_KEY, { version: 1, answers: { '故事发生的场景是怎样的？': '测试天台' }, fieldsToKeepEmpty: [], scenarioTitleHint: '', generationMode: 'non-stream', selectedLanguage: 'zh-CN' }],
  };
  window.localStorage.setItem(drafts[page][0], JSON.stringify(drafts[page][1]));
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); window.localStorage.clear(); presence = false;
  mocks.profiles.mockResolvedValue({ version: 1, id: 'legacy', name: '旧连接', adapter: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', modelId: 'm'.repeat(256), createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' });
  mocks.execute.mockResolvedValue({ status: 'cancelled', mode: 'direct-local' });
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === 'set_provider_secret') await new Promise<void>((resolve) => { releaseSave = resolve; });
    if (command === 'has_provider_secret') return presence;
    return undefined;
  });
  window.localStorage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, JSON.stringify({ version: 3, selection: { executionPreference: 'client', clientConnectionId: 'legacy' }, hiddenPresetIds: [], generationOverrides: {}, modelsByProfileId: {} }));
  resetDesktopAiConfigStoreForTests();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { if (root) act(() => root!.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function mount(page: Page, target: 'preset' | 'system' | 'legacy' = 'preset') {
  seedDraft(page); window.location.hash = `#/${page}`;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => ({ ok: true, json: async () => String(input).includes('languages') ? [{ code: 'zh-CN', name: '简体中文' }] : String(input).includes('index.json') ? { version: 1, presets: [] } : questionnaire(page) })));
  const router = createDesktopRouter(); await router.load();
  await act(async () => root!.render(<StrictMode><RouterProvider router={router} /></StrictMode>)); await settle();
  await click('恢复草稿');
  const store = getDesktopAiConfigStore();
  await act(async () => {
    if (target === 'system') { store.selectExecutionLocation('server'); store.selectProviderTarget({ kind: 'system' }); }
    if (target === 'preset') { store.selectProviderTarget({ kind: 'preset', providerId: 'deepseek' }); store.setPresetKeyDraft('deepseek', 'synthetic-test-value'); }
  }); await settle(); return store;
}
async function finishSave(readable = true) { presence = readable; await act(async () => releaseSave()); await settle(); }
describe('five real routes prepare provider credentials before dispatch', () => {
  it.each(routes)('%s waits for set + has and dispatches a stable preset only once', async (page) => {
    await mount(page); const generate = button(generateLabel(page))!; expect(generate?.disabled).toBe(false);
    await act(async () => { generate.click(); generate.click(); }); await settle();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'set_provider_secret')).toHaveLength(1);
    await finishSave(); expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]![0]).toMatchObject({ profileId: '', providerTarget: { kind: 'preset', providerId: 'deepseek' } });
    expect(window.localStorage.getItem(DESKTOP_AI_CONFIG_STORAGE_KEY)).not.toContain('synthetic-test-value');
  });
  it.each(routes)('%s blocks dispatch after saved Key readback fails', async (page) => {
    await mount(page); await click(generateLabel(page)); await finishSave(false);
    expect(mocks.execute).not.toHaveBeenCalled(); expect(container.textContent).toContain('凭据保存后无法确认');
  });
  it.each(routes)('%s cancels pending preparation on unmount', async (page) => {
    await mount(page); await click(generateLabel(page)); act(() => root!.unmount()); root = undefined;
    await finishSave(); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each(routes)('%s system generation needs no Key', async (page) => {
    await mount(page, 'system'); await click(generateLabel(page)); expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'set_provider_secret')).toHaveLength(0);
    expect(mocks.execute.mock.calls[0]![0]).toMatchObject({ providerTarget: { kind: 'system' } });
  });
  it('keeps a legacy custom 256-character model usable without re-registration', async () => {
    await mount('free', 'legacy'); await click('生成数据卡'); expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]![2]).toMatchObject({ modelId: 'm'.repeat(256) });
  });
  it('freezes location, target and Key while preparation is pending', async () => {
    const store = await mount('free'); await click('生成数据卡');
    expect(() => store.setPresetKeyDraft('deepseek', 'replacement')).toThrow();
    expect(() => store.selectExecutionLocation('server')).toThrow('生成期间');
    expect(() => store.selectProviderTarget({ kind: 'preset', providerId: 'openai' })).toThrow('生成期间');
    await finishSave(); expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]![0]).toMatchObject({ providerTarget: { kind: 'preset', providerId: 'deepseek' } });
  });
  it.each(routes)('%s server BYOK uses the preset and inline model without creating a Profile', async (page) => {
    const store = await mount(page);
    await act(async () => {
      store.selectExecutionLocation('server');
      store.selectProviderTarget({ kind: 'preset', providerId: 'deepseek' });
      store.useInlineModel('  test-custom-model  ');
    });
    await click(generateLabel(page)); await finishSave();
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]![0]).toMatchObject({ profileId: '', providerTarget: { kind: 'preset', providerId: 'deepseek' } });
    expect(mocks.execute.mock.calls[0]![2]).toMatchObject({ modelId: 'test-custom-model' });
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'save_provider_profile')).toBe(false);
  });
  it.each(routes)('%s exposes cancellation while the Key save is still pending', async (page) => {
    const store = await mount(page);
    await click(generateLabel(page));
    expect(mocks.execute).not.toHaveBeenCalled();
    await click('取消准备');
    expect(container.textContent).toContain('尚未派发的生成已取消');
    expect(button('取消准备')).toBeUndefined();
    await finishSave();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(store.getSnapshot().generationActive).toBe(false);
    expect(store.getSnapshot().presetSecretStatus.deepseek).toBe('present');
  });

  it.each(['details', 'canshou', 'creator'] as const)('%s keeps preparation cancellation accessible while displaying its previous result', async (page) => {
    const store = await mount(page);
    const card = page === 'canshou' ? buildUnsignedCanshouCard({
      name: '测试残兽', coreConcept: '回声', coreEmotion: '孤独', evolutionStage: '幼年期',
      appearance: '雾', materialAndSkin: '雾', featuresAndAppendages: '尾', attackMethod: '回声',
      specialAbility: '重现', origin: '巢穴', birthEnvironment: '地下', researcherNotes: '观察',
    }, [{ question: '描述', answer: '测试' }]) : buildUnsignedMagicalGirlDetailsCard({
      codename: '测试魔法少女', appearance: { outfit: '礼服', accessories: '', colorScheme: '', overallLook: '' },
      magicConstruct: { name: '', form: '', basicAbilities: [], description: '' },
      wonderlandRule: { name: '', description: '', tendency: '', activation: '' },
      blooming: { name: '', evolvedAbilities: [], evolvedForm: '', evolvedOutfit: '', powerLevel: '' },
      analysis: { personalityAnalysis: '', abilityReasoning: '', coreTraits: [], predictionBasis: '', background: { belief: '', bonds: '' } },
    }, [{ question: '描述', answer: '测试' }]);
    const title = page === 'canshou' ? '测试残兽' : '测试魔法少女';
    mocks.execute.mockResolvedValue({ status: 'completed', mode: 'direct-remote', card, cardKind: page === 'canshou' ? 'canshou' : 'magical-girl', rawText: JSON.stringify(card) });
    await click(generateLabel(page)); await finishSave();
    expect(container.textContent).toContain(title);
    await act(async () => store.setPresetKeyDraft('deepseek', 'replacement-test-key'));
    await click('重新生成'); await click('确定重新生成');
    expect(container.textContent).toContain(title);
    await click('取消准备'); await finishSave();
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(title);
  });

  it('explicit preparation cancellation prevents dispatch after the late native success', async () => {
    const store = await mount('free'); await click('生成数据卡');
    await act(async () => store.cancelPreparingGeneration()); await finishSave();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(store.getSnapshot().generationActive).toBe(false);
  });
  it('SecretStore unavailable blocks generation and preserves the retry draft', async () => {
    const store = await mount('free');
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'set_provider_secret') throw { code: 'secret-store-unavailable', message: 'credential store unavailable' };
      return false;
    });
    await click('生成数据卡'); expect(mocks.execute).not.toHaveBeenCalled();
    expect(store.getPresetKeyDraft('deepseek')).toBe('synthetic-test-value');
    expect(store.getSnapshot().generationActive).toBe(false);
  });

});
