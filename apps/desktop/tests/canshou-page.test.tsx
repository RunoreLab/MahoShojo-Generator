// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuestionnaireQuestion } from '@mahoshojo/domain/questionnaire-definition';
import { buildUnsignedCanshouCard } from '@mahoshojo/ai-core/canshou-generation';
import type { CanshouGenerationOutcome } from '../src/features/canshou/generation';
import { CANSHOU_DRAFT_KEY } from '../src/features/canshou/session';
import { builtinSelectionId } from '../src/features/canshou/questionnaire';
import { resetDesktopAiConfigStoreForTests } from '../src/features/ai-config/use-desktop-ai-config';
import { DESKTOP_AI_CONFIG_STORAGE_KEY } from '../src/features/ai-config/desktop-ai-config-store';
import { createDesktopRouter } from '../src/app/router';
import { describeRegenerateConfirm } from '../src/app/canshou-page';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), save: vi.fn(), listen: vi.fn(), profiles: vi.fn(), scrollResult: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: mocks.listen }) }));
vi.mock('../src/features/canshou/generation', async (original) => ({ ...await original<object>(), executeCanshouGeneration: mocks.execute }));
vi.mock('../src/platform/provider-profile-bridge', () => ({ listProviderProfileIds: async () => ['local'], getProviderProfile: mocks.profiles }));
vi.mock('../src/platform/local-card-bridge', () => ({ IpcLocalCardRepository: class { putIfAbsent = mocks.save; } }));

const questionnaire = JSON.parse(readFileSync(resolve(process.cwd(), '../../content/questionnaires/presets/canshou-default.json'), 'utf8'));
const card = buildUnsignedCanshouCard({
  name: '巢穴回声', coreConcept: '思念成兽', coreEmotion: '孤独', evolutionStage: '幼年期',
  appearance: '雾状表皮', materialAndSkin: '雾', featuresAndAppendages: '风铃尾',
  attackMethod: '回声震荡', specialAbility: '声音重现', origin: '废弃巢穴',
  birthEnvironment: '地下空洞', researcherNotes: '观察',
}, [{ question: '起源？', answer: '巢穴' }]);
const completed: CanshouGenerationOutcome = {
  status: 'completed', mode: 'direct-local', card, cardKind: 'canshou', rawText: JSON.stringify(card),
  result: { status: 'completed', contractVersion: 1, requestId: 'r', mode: 'direct-local', output: { text: JSON.stringify(card) }, finishReason: 'stop' },
};
let root: Root;
let container: HTMLDivElement;
let close: (event: { preventDefault: () => void }) => void;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 120)); });
const button = (name: string) => [...container.querySelectorAll('button')].find((item) => item.textContent === name)!;
const click = async (name: string) => { await act(async () => button(name).click()); await settle(); };
const draft = () => ({
  version: 1,
  answers: { [`${builtinSelectionId(questionnaire.id)}::${questionnaire.questions[0].id}`]: '巢穴' },
  language: '简体中文',
});
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); window.localStorage.clear();
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
  HTMLElement.prototype.scrollIntoView = mocks.scrollResult;
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.location.hash = '#/canshou';
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const mount = async () => {
  const router = createDesktopRouter(); await router.load();
  await act(async () => root.render(<StrictMode><RouterProvider router={router} /></StrictMode>));
  await settle(); return router;
};

const storeStepQuestionnaire = (questions: QuestionnaireQuestion[], answers: Record<string, string> = {}) => {
  window.localStorage.setItem(CANSHOU_DRAFT_KEY, JSON.stringify({
    version: 1, language: '简体中文',
    answers: Object.fromEntries(Object.entries(answers).map(([id, value]) => [`preset:steps::${id}`, value])),
    questionnaireSelections: [{
      source: 'preset', selectionId: 'preset:steps',
      questionnaire: { id: 'steps', kind: 'canshou', title: '逐题测试', nativeAllowed: true, questions },
    }],
  }));
};
const fillCurrentAnswer = async (value: string) => {
  const textarea = container.querySelector<HTMLTextAreaElement>('.ui-web-questionnaire-answer-input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('Desktop Canshou real route and session UI (native adapter mock)', () => {

  it('fills suggestions without advancing and follows updated displayIf/jump flow through option submission', async () => {
    storeStepQuestionnaire([
      { id: 'prelude', question: '后来显现的前题', displayIf: { questionId: 'gate', operator: 'equals', value: '展开分支' } },
      { id: 'gate', question: '选择路线', options: ['展开分支'], suggestions: ['文字灵感'] },
      { id: 'branch', question: '条件分支', options: ['转到末题'], displayIf: { questionId: 'gate', operator: 'equals', value: '展开分支' }, jump: { when: { questionId: 'branch', operator: 'notEmpty' }, to: 'last' } },
      { id: 'middle', question: '跳过的题' },
      { id: 'last', question: '收尾选项', options: ['结束调查'], maxLength: 2, jump: { when: { questionId: 'last', operator: 'notEmpty' }, toEnd: true } },
      { id: 'tail', question: '跳过的尾题' },
    ], { middle: '旧中题回答', tail: '旧尾题回答' });
    await mount(); await click('恢复草稿');
    await click('文字灵感');
    expect(container.querySelector('.ui-web-questionnaire-answer-input')?.getAttribute('aria-label')).toBe('选择路线');
    expect(container.querySelector<HTMLTextAreaElement>('.ui-web-questionnaire-answer-input')?.value).toBe('文字灵感');
    expect(mocks.execute).not.toHaveBeenCalled();
    await click('展开分支');
    expect(container.querySelector('.ui-web-questionnaire-answer-input')?.getAttribute('aria-label')).toBe('条件分支');
    await click('转到末题');
    expect(container.querySelector('.ui-web-questionnaire-answer-input')?.getAttribute('aria-label')).toBe('收尾选项');
    expect(mocks.execute).not.toHaveBeenCalled();
    await click('结束调查');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]![1]).toMatchObject({
      answers: [
        { question: '选择路线', answer: '展开分支' },
        { question: '条件分支', answer: '转到末题' },
        { question: '收尾选项', answer: '结束调查' },
      ],
      hosted: { allowNativeSignature: false },
    });
  });

  it('keeps the current required question gated and lets optional Next skip through final generation', async () => {
    storeStepQuestionnaire([
      { id: 'required', question: '必答题', required: true },
      { id: 'optional', question: '选答题' },
      { id: 'last', question: '末题' },
    ]);
    await mount(); await click('恢复草稿');
    expect(button('下一题').disabled).toBe(true);
    await click('下一题');
    expect(container.textContent).toContain('第 1 / 3 题');
    expect(mocks.execute).not.toHaveBeenCalled();
    await fillCurrentAnswer('  必答内容  '); await click('下一题');
    await click('跳过并继续');
    expect(button('跳过并生成').disabled).toBe(false);
    await click('跳过并生成');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]![1].answers).toEqual([expect.objectContaining({ question: '必答题', answer: '必答内容' })]);
  });

  it('requires at least one answer at the final step without adding a whole-questionnaire required gate', async () => {
    storeStepQuestionnaire([
      { id: 'required', question: '此前的必答题', required: true },
      { id: 'last', question: '末题' },
    ]);
    await mount(); await click('恢复草稿'); await click('2');
    await click('跳过并生成');
    expect(container.textContent).toContain('请至少填写一题后再生成。');
    expect(mocks.execute).not.toHaveBeenCalled();
    await fillCurrentAnswer('末题回答'); await click('生成');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]![1].answers).toEqual([expect.objectContaining({ question: '末题', answer: '末题回答' })]);
  });

  it.each(['option', 'next'] as const)('synchronously locks repeated final %s submission to one request', async (entry) => {
    storeStepQuestionnaire([{ id: 'last', question: '末题', options: ['推荐回答'] }]);
    let finish!: (outcome: CanshouGenerationOutcome) => void;
    mocks.execute.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await mount(); await click('恢复草稿');
    if (entry === 'next') await fillCurrentAnswer('文本回答');
    const submit = button(entry === 'option' ? '推荐回答' : '生成');
    await act(async () => { submit.click(); submit.click(); });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]![1]).toMatchObject({
      answers: [{ question: '末题', answer: entry === 'option' ? '推荐回答' : '文本回答' }],
      hosted: { allowNativeSignature: true },
    });
    await act(async () => finish(completed));
  });

  it.each(['option', 'next'] as const)('keeps final %s regeneration behind unsaved and uncertain confirmations, including cancel', async (entry) => {
    storeStepQuestionnaire([{ id: 'last', question: '末题', options: ['推荐回答'] }], { last: '原回答' });
    await mount(); await click('恢复草稿'); await click('发送问卷并生成');
    await click('返回编辑答案');
    const submit = () => click(entry === 'option' ? '推荐回答' : '生成');
    await submit();
    expect(container.querySelector('dialog')?.open).toBe(true);
    expect(container.querySelector('dialog')?.textContent).toContain('尚未保存到本地卡库');
    await click('取消');
    expect(container.querySelector('dialog')?.open).toBe(false);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    mocks.execute.mockResolvedValueOnce({
      status: 'uncertain', mode: 'hosted-json', rawText: '未确认正文', message: '无法确认服务器执行结果',
    } satisfies CanshouGenerationOutcome);
    await submit(); await click('确定重新生成');
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    await submit();
    expect(container.querySelector('dialog')?.open).toBe(true);
    expect(container.querySelector('dialog')?.textContent).toContain('重复调用与费用');
    expect(container.querySelector('dialog')?.textContent).not.toContain('保存后重新生成');
    await click('取消');
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('未确认正文');
  });

  it('keeps final option and Next behind draft restoration and native guard readiness', async () => {
    storeStepQuestionnaire([{ id: 'last', question: '末题', options: ['推荐回答'] }]);
    let ready!: (release: () => void) => void;
    mocks.listen.mockImplementation(() => new Promise((resolve) => { ready = resolve; }));
    await mount();
    const pendingFieldset = container.querySelector<HTMLFieldSetElement>('fieldset');
    expect(pendingFieldset?.disabled).toBe(true);
    expect(container.querySelectorAll('.container > .card > fieldset')).toHaveLength(3);
    expect([...container.querySelectorAll<HTMLFieldSetElement>('.container > .card > fieldset')].every((fieldset) => fieldset.disabled)).toBe(true);
    expect(mocks.execute).not.toHaveBeenCalled();
    await click('恢复草稿');
    expect(button('推荐回答').closest('fieldset')?.disabled).toBe(true);
    expect(container.querySelectorAll('.container > .card > fieldset')).toHaveLength(3);
    expect([...container.querySelectorAll<HTMLFieldSetElement>('.container > .card > fieldset')].every((fieldset) => fieldset.disabled)).toBe(true);
    await click('推荐回答'); await click('跳过并生成');
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>('.ui-web-questionnaire-answer-input')?.value).toBe('');
    await act(async () => ready(vi.fn())); await settle();
    await click('推荐回答');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it('keeps final option and Next generation blocked when the client Provider cannot load', async () => {
    storeStepQuestionnaire([{ id: 'last', question: '末题', options: ['推荐回答'] }]);
    mocks.profiles.mockRejectedValue(new Error('profile unavailable'));
    await mount(); await click('恢复草稿'); await click('推荐回答');
    expect(container.querySelector<HTMLTextAreaElement>('.ui-web-questionnaire-answer-input')?.value).toBe('推荐回答');
    await click('生成');
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('keeps the themed brand and description when starting the questionnaire', async () => {
    await mount();
    const logo = container.querySelector('img[alt="残兽调查"]');
    expect(logo).toBeTruthy();
    expect(logo?.closest('.card')?.firstElementChild?.contains(logo)).toBe(true);
    expect(container.querySelector('[aria-label="介绍"]')?.contains(logo)).toBe(false);
    expect(logo?.closest('header')?.textContent).toContain(questionnaire.description);
    await click('开始调查');
    expect(container.querySelector('[aria-label="介绍"]')).toBeNull();
    expect(container.querySelector('img[alt="残兽调查"]')).toBe(logo);
    expect(container.querySelector('.theme-image-light')?.getAttribute('src')).toBe('/beast-logo.svg');
    expect(container.querySelector('.theme-image-dark')?.getAttribute('src')).toBe('/beast-logo-white.svg');
    expect(container.querySelector('textarea')).toBeTruthy();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('orders the questionnaire sections like Web and keeps the restored language fallback when expanded', async () => {
    window.localStorage.setItem(CANSHOU_DRAFT_KEY, JSON.stringify({ ...draft(), language: '草稿语言' }));
    await mount(); await click('恢复草稿');
    const languageToggle = [...container.querySelectorAll('button')].find((item) => item.textContent?.startsWith('生成语言'))!;
    expect(languageToggle.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('select[aria-label="生成语言"]')).toBeNull();
    const source = container.querySelector('[aria-label="问卷来源"]')!;
    const orderedSections = [
      container.querySelector('#question-navigator-select'),
      source,
      container.querySelector('.ui-web-questionnaire-answer-input'),
      languageToggle,
      container.querySelector('legend'),
      [...container.querySelectorAll('button')].find((item) => item.textContent?.startsWith('一键填充答案')),
      [...container.querySelectorAll('button')].find((item) => item.textContent?.startsWith('答案概览')),
      button('下载 TXT'),
    ];
    for (let index = 1; index < orderedSections.length; index += 1) {
      expect(orderedSections[index - 1]).toBeTruthy();
      expect(orderedSections[index]).toBeTruthy();
      expect(orderedSections[index - 1]!.compareDocumentPosition(orderedSections[index]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(source.classList.contains('border')).toBe(false);
    expect(source.classList.contains('p-4')).toBe(false);
    await act(async () => languageToggle.click());
    expect(languageToggle.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="生成语言"]')?.value).toBe('草稿语言');
    await act(async () => languageToggle.click());
    await act(async () => languageToggle.click());
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="生成语言"]')?.value).toBe('草稿语言');
    expect(JSON.parse(window.localStorage.getItem(CANSHOU_DRAFT_KEY)!).language).toBe('草稿语言');
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('uses loaded language values without changing draft or generation semantics', async () => {
    window.localStorage.setItem(CANSHOU_DRAFT_KEY, JSON.stringify({ ...draft(), language: 'en' }));
    vi.mocked(fetch).mockImplementation(async (input) => ({
      ok: true,
      json: async () => String(input) === '/languages.json'
        ? [{ code: 'en', name: 'English' }, { code: 'ja', name: '日本語' }]
        : questionnaire,
    } as Response));
    await mount(); await click('恢复草稿');
    const languageToggle = [...container.querySelectorAll('button')].find((item) => item.textContent?.startsWith('生成语言'))!;
    await act(async () => languageToggle.click());
    const language = container.querySelector<HTMLSelectElement>('select[aria-label="生成语言"]')!;
    expect(language.value).toBe('en');
    await act(async () => {
      language.value = 'ja';
      language.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(JSON.parse(window.localStorage.getItem(CANSHOU_DRAFT_KEY)!).language).toBe('ja');
    await act(async () => languageToggle.click());
    await act(async () => languageToggle.click());
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="生成语言"]')?.value).toBe('ja');
    await click('发送问卷并生成');
    expect(mocks.execute.mock.calls[0]![1].language).toBe('ja');
  });

  it('keeps reordered navigation, question, language, source and Provider controls disabled while generating', async () => {
    window.localStorage.setItem(CANSHOU_DRAFT_KEY, JSON.stringify(draft()));
    let finish!: (outcome: CanshouGenerationOutcome) => void;
    mocks.execute.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await mount(); await click('恢复草稿');
    const languageToggle = [...container.querySelectorAll('button')].find((item) => item.textContent?.startsWith('生成语言'))!;
    const sourceToggle = container.querySelector<HTMLButtonElement>('[aria-label="问卷来源"] button')!;
    await act(async () => { languageToggle.click(); sourceToggle.click(); });
    const controls = [
      button('2'),
      container.querySelector('#question-navigator-select'),
      container.querySelector('.ui-web-questionnaire-answer-input'),
      languageToggle,
      container.querySelector('select[aria-label="生成语言"]'),
      container.querySelector('button[role="combobox"]'),
      button('从问卷数据卡选择'),
    ];
    for (const control of controls) {
      expect(control).toBeTruthy();
      expect(control!.matches(':disabled')).toBe(false);
    }
    await click('发送问卷并生成');
    for (const control of controls) expect(control!.matches(':disabled')).toBe(true);
    await act(async () => { button('2').click(); languageToggle.click(); });
    expect(container.textContent).toContain(`第 1 / ${questionnaire.questions.length} 题`);
    expect(languageToggle.getAttribute('aria-expanded')).toBe('true');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    await act(async () => finish(completed));
    expect(container.querySelector('.ui-web-questionnaire-answer-input')).toBeNull();
    expect(container.querySelector('[aria-label="生成结果"]')).toBeTruthy();
    await click('返回编辑答案');
    expect(container.querySelector('.ui-web-questionnaire-answer-input')?.matches(':disabled')).toBe(false);
    expect(container.querySelector('select[aria-label="生成语言"]')?.matches(':disabled')).toBe(false);
    expect(container.querySelector('button[role="combobox"]')?.matches(':disabled')).toBe(false);
  });

  it('shows rounded progress, effective soft limits and skip guidance only for optional questions', async () => {
    const custom = {
      id: 'answer-hints', kind: 'canshou', title: '作答提示问卷', description: 'd',
      questions: [
        { id: 'required', question: '必答档案设定', required: true, maxLength: 4 },
        { id: 'optional', question: '选答档案设定', required: false, maxLength: 800 },
        { id: 'default', question: '默认上限设定', required: false },
      ],
    };
    window.localStorage.setItem(CANSHOU_DRAFT_KEY, JSON.stringify({
      version: 1, language: '简体中文', answers: { 'preset:answer-hints::required': '初始答案' },
      questionnaireSelections: [{ source: 'preset', questionnaire: custom, selectionId: 'preset:answer-hints' }],
    }));
    await mount(); await click('恢复草稿');
    expect(container.textContent).toContain('进度 33%');
    expect(container.textContent).toContain('请基于您构想的虚拟档案回答，并确保内容符合公序良俗，请勿使用任何真实信息。');
    expect(container.textContent).not.toContain('其他题目可以跳过');
    expect(container.textContent).not.toContain('本题可跳过');
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="必答档案设定"]')!;
    expect(textarea.hasAttribute('maxlength')).toBe(false);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '  保留超限回答  ');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(textarea.value).toBe('  保留超限回答  ');
    expect(container.textContent).toContain('有效字数：6/4');
    expect(container.textContent).toContain('回答超过建议长度，仍可生成未签名残兽档案。');
    await click('下一题');
    expect(container.textContent).toContain('进度 67%');
    expect(container.textContent).toContain('有效字数：0/500');
    expect(container.textContent).toContain('本题可跳过，不作答将不会记录');
    await click('跳过并继续');
    expect(container.textContent).toContain('进度 100%');
    expect(container.textContent).toContain('有效字数：0/500');
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('shows only the new result, saves it and preserves the session while editing without scrolling again', async () => {
    window.localStorage.setItem(CANSHOU_DRAFT_KEY, JSON.stringify(draft()));
    await mount();
    expect(container.querySelector('[data-testid="page-canshou"]')).toBeTruthy();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(button('发送问卷并生成').disabled).toBe(true);
    const logo = container.querySelector('img[alt="残兽调查"]');
    expect(logo).toBeTruthy();
    await click('恢复草稿');
    expect(container.querySelector('img[alt="残兽调查"]')).toBe(logo);
    expect(container.querySelector('textarea')?.value).toBe('巢穴');
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: window.innerHeight + 1 } as DOMRect);
    await click('发送问卷并生成');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]![2]).toMatchObject({ mode: 'direct-local', modelId: 'model' });
    expect(container.textContent).toContain('巢穴回声 · 未签名');
    expect(container.textContent).toContain('雾状表皮');
    expect(container.querySelector('.ui-web-questionnaire-answer-input')).toBeNull();
    expect(container.querySelector('[aria-label="问卷来源"]')).toBeNull();
    expect(container.querySelector('[aria-label="介绍"]')).toBeNull();
    expect(container.querySelector('.container > .card')?.contains(container.querySelector('[aria-label="生成结果"]'))).toBe(true);
    expect(mocks.scrollResult).toHaveBeenCalledTimes(1);
    await click('保存到本地卡库');
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('已保存到本地卡库。');
    const savedDraft = window.localStorage.getItem(CANSHOU_DRAFT_KEY);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const remove = vi.spyOn(Storage.prototype, 'removeItem');
    const viewToggle = button('返回编辑答案');
    viewToggle.focus();
    await click('返回编辑答案');
    expect(button('查看当前结果')).toBe(viewToggle);
    expect(document.activeElement).toBe(viewToggle);
    expect(container.querySelector('[aria-label="生成结果"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('.ui-web-questionnaire-answer-input')?.value).toBe('巢穴');
    await click('查看当前结果');
    expect(button('返回编辑答案')).toBe(viewToggle);
    expect(document.activeElement).toBe(viewToggle);
    expect(container.querySelector('.ui-web-questionnaire-answer-input')).toBeNull();
    expect(container.textContent).toContain('巢穴回声 · 未签名');
    expect(container.textContent).toContain('已保存到本地卡库。');
    expect(button('保存到本地卡库').disabled).toBe(true);
    expect(window.localStorage.getItem(CANSHOU_DRAFT_KEY)).toBe(savedDraft);
    expect(write.mock.calls.filter(([key]) => key === CANSHOU_DRAFT_KEY)).toHaveLength(0);
    expect(remove).not.toHaveBeenCalled();
    await click('返回编辑答案'); await fillCurrentAnswer('编辑后的巢穴'); await click('查看当前结果');
    const editedDraft = JSON.parse(window.localStorage.getItem(CANSHOU_DRAFT_KEY)!);
    expect(Object.values(editedDraft.answers)).toContain('编辑后的巢穴');
    expect(editedDraft.output).toEqual(JSON.parse(savedDraft!).output);
    expect(container.textContent).toContain('已保存到本地卡库。');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.scrollResult).toHaveBeenCalledTimes(1);
    await click('返回编辑答案'); await click('重新生成');
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(mocks.execute.mock.calls[1]![1].answers[0].answer).toBe('编辑后的巢穴');
    expect(container.querySelector('[aria-label="生成结果"]')).toBeTruthy();
    expect(container.querySelector('.ui-web-questionnaire-answer-input')).toBeNull();
    expect(mocks.scrollResult).toHaveBeenCalledTimes(2);
  });

  it('quick random produces an unsigned canshou card without invoking the model', async () => {
    await mount();
    await click('快速随机生成');
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(container.textContent).toContain('未签名');
    expect(container.textContent).toContain('保存到本地卡库');
    expect(container.querySelector('[aria-label="生成结果"]')).toBeTruthy();
    expect(container.querySelector('.ui-web-questionnaire-answer-input')).toBeNull();
    expect(container.querySelector('[aria-label="介绍"]')).toBeNull();
    await click('返回编辑答案');
    expect(container.querySelector('.ui-web-questionnaire-answer-input')).toBeTruthy();
    expect(container.querySelector('[aria-label="介绍"]')).toBeNull();
    await click('查看当前结果');
    // 本机即时产出落草稿为 completed——恢复后不自动重生成。
    expect(JSON.parse(window.localStorage.getItem(CANSHOU_DRAFT_KEY)!).output.phase).toBe('completed');
  });

  it('keeps result regeneration behind unsaved and uncertain confirmations without dispatch on cancel', async () => {
    window.localStorage.setItem(CANSHOU_DRAFT_KEY, JSON.stringify(draft()));
    await mount(); await click('恢复草稿'); await click('发送问卷并生成');
    const savedDraft = window.localStorage.getItem(CANSHOU_DRAFT_KEY);
    await click('重新生成');
    expect(container.querySelector('dialog')?.open).toBe(true);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    await click('取消');
    expect(container.querySelector('dialog')?.open).toBe(false);
    expect(window.localStorage.getItem(CANSHOU_DRAFT_KEY)).toBe(savedDraft);
    expect(container.querySelector('[aria-label="生成结果"]')?.textContent).toContain('巢穴回声');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    mocks.execute.mockResolvedValueOnce({ status: 'uncertain', mode: 'hosted-json', rawText: '未确认正文', message: '无法确认服务器执行结果' } satisfies CanshouGenerationOutcome);
    await click('重新生成'); await click('确定重新生成');
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.ui-web-questionnaire-answer-input')).toBeTruthy();
    expect(container.querySelector('[aria-label="生成结果"]')).toBeNull();
    await click('重新生成');
    expect(container.querySelector('dialog')?.open).toBe(true);
    expect(container.querySelector('dialog')?.textContent).toContain('重复调用与费用');
    await click('取消');
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('未确认正文');
    expect(JSON.parse(window.localStorage.getItem(CANSHOU_DRAFT_KEY)!).answers).toEqual(draft().answers);
  });

  it('keeps the result and answers after save-before-regeneration fails, including editing and returning', async () => {
    window.localStorage.setItem(CANSHOU_DRAFT_KEY, JSON.stringify(draft()));
    mocks.save.mockRejectedValueOnce(new Error('disk unavailable'));
    await mount(); await click('恢复草稿'); await click('发送问卷并生成');
    const savedDraft = window.localStorage.getItem(CANSHOU_DRAFT_KEY);
    await click('重新生成'); await click('保存后重新生成');
    expect(container.querySelector('dialog')?.open).toBe(true);
    expect(container.querySelector('dialog')?.textContent).toContain('保存到本地卡库失败');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    await click('取消'); await click('返回编辑答案');
    expect(container.querySelector<HTMLTextAreaElement>('.ui-web-questionnaire-answer-input')?.value).toBe('巢穴');
    await click('查看当前结果');
    expect(container.querySelector('[aria-label="生成结果"]')?.textContent).toContain('巢穴回声');
    expect(container.querySelector('[aria-label="生成结果"]')?.textContent).toContain('保存到本地卡库失败');
    expect(button('保存到本地卡库').disabled).toBe(false);
    expect(window.localStorage.getItem(CANSHOU_DRAFT_KEY)).toBe(savedDraft);
    await click('保存到本地卡库');
    expect(container.textContent).toContain('已保存到本地卡库。');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it('restores a completed draft directly to its result without dispatch and keeps draft clearing available', async () => {
    window.localStorage.setItem(CANSHOU_DRAFT_KEY, JSON.stringify({
      ...draft(), output: { mode: 'direct-local', phase: 'completed', cardKind: 'canshou', card, rawText: completed.rawText },
    }));
    await mount();
    expect(container.querySelector('[aria-label="生成结果"]')).toBeNull();
    await click('恢复草稿');
    expect(container.querySelector('[aria-label="生成结果"]')?.textContent).toContain('巢穴回声');
    expect(container.querySelector('.ui-web-questionnaire-answer-input')).toBeNull();
    expect(container.textContent).toContain(completed.rawText);
    const savedDraft = window.localStorage.getItem(CANSHOU_DRAFT_KEY);
    await click('返回编辑答案');
    expect(container.querySelector<HTMLTextAreaElement>('.ui-web-questionnaire-answer-input')?.value).toBe('巢穴');
    await click('查看当前结果'); await click('清除草稿'); await click('保留草稿');
    expect(window.localStorage.getItem(CANSHOU_DRAFT_KEY)).toBe(savedDraft);
    expect(container.querySelector('[aria-label="生成结果"]')).toBeTruthy();
    await click('清除草稿'); await click('确认清除');
    expect(container.querySelector('[aria-label="生成结果"]')).toBeNull();
    expect(container.querySelector('[aria-label="介绍"]')).toBeTruthy();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each(['failed', 'cancelled', 'uncertain'] as const)('restores %s output without a card to editable answers and visible residue', async (phase) => {
    window.localStorage.setItem(CANSHOU_DRAFT_KEY, JSON.stringify({
      ...draft(), output: { mode: 'hosted-json', phase, card: null, rawText: '上次中断的正文' },
    }));
    await mount(); await click('恢复草稿');
    expect(container.querySelector('[aria-label="生成结果"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('.ui-web-questionnaire-answer-input')?.value).toBe('巢穴');
    expect(container.querySelector('details:has(> pre)')?.hasAttribute('open')).toBe(true);
    expect(container.textContent).toContain('上次中断的正文');
    expect(mocks.execute).not.toHaveBeenCalled();
    await fillCurrentAnswer('继续作答');
    expect(JSON.parse(window.localStorage.getItem(CANSHOU_DRAFT_KEY)!).output.rawText).toBe('上次中断的正文');
  });

  it('uncertain phase gates regeneration behind explicit confirm copy', () => {
    const uncertainGenerate = describeRegenerateConfirm('generate', 'uncertain');
    expect(uncertainGenerate.description).toContain('重复调用');
    const uncertainRandom = describeRegenerateConfirm('quick-random', 'uncertain');
    expect(uncertainRandom.title).toBe('重新随机生成？');
    expect(uncertainRandom.description).toContain('不产生费用');
    const unsaved = describeRegenerateConfirm('generate', 'unsaved');
    expect(unsaved.description).toContain('尚未保存');
  });

  it.each(['questionnaire', 'result'] as const)('keeps cancellation available when generating from the %s and retains partial output', async (entry) => {
    window.localStorage.setItem(CANSHOU_DRAFT_KEY, JSON.stringify(draft()));
    let finish!: (outcome: CanshouGenerationOutcome) => void;
    await mount(); await click('恢复草稿');
    if (entry === 'result') await click('发送问卷并生成');
    mocks.execute.mockImplementation((_o, _i, _t, _s, partial) => { partial('半截残兽正文'); return new Promise((resolve) => { finish = resolve; }); });
    if (entry === 'result') { await click('重新生成'); await click('确定重新生成'); }
    else await click('发送问卷并生成');
    expect(container.querySelector('[aria-label="生成结果"]')).toBeNull();
    expect(button('取消生成').disabled).toBe(false);
    await click('取消生成');
    expect(mocks.execute.mock.lastCall![3].aborted).toBe(true);
    await act(async () => finish({ status: 'cancelled', mode: 'direct-local', rawText: '半截残兽正文', reason: 'aborted' }));
    expect(container.textContent).toContain('半截残兽正文');
    expect(container.querySelector<HTMLTextAreaElement>('.ui-web-questionnaire-answer-input')?.value).toBe('巢穴');
    expect(JSON.parse(window.localStorage.getItem(CANSHOU_DRAFT_KEY)!).output.rawText).toBe('半截残兽正文');
  });

  it('guards native close while generating and flushes on pagehide', async () => {
    window.localStorage.setItem(CANSHOU_DRAFT_KEY, JSON.stringify(draft()));
    let finish!: (outcome: CanshouGenerationOutcome) => void;
    mocks.execute.mockImplementation((_o, _i, _t, _s, partial) => { partial('刷新前正文'); return new Promise((resolve) => { finish = resolve; }); });
    await mount(); await click('恢复草稿'); await click('发送问卷并生成');
    const preventDefault = vi.fn();
    vi.mocked(window.confirm).mockReturnValue(true);
    await act(async () => close({ preventDefault }));
    expect(mocks.execute.mock.calls[0]![3].aborted).toBe(true);
    await act(async () => finish({ status: 'cancelled', mode: 'direct-local', rawText: '刷新前正文', reason: 'aborted' }));
  });
});
