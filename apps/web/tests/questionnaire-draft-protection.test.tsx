// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }), usePathname: () => '/details', useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} href={href} onClick={(event) => { if (!event.defaultPrevented) { event.preventDefault(); mocks.push(href); } }}>{children}</a> }));
vi.mock('@/components/SaveToCloudButton', () => ({ default: () => <button>保存到云端</button> }));
vi.mock('@/components/BattleDataModal', () => ({ default: () => null }));
vi.mock('@/components/DataCardDetailsModal', () => ({ default: () => null }));
vi.mock('@/lib/sensitive-word-filter', () => ({ quickCheck: async () => ({ hasSensitiveWords: false }) }));

const magicalCard = {
  codename: '保留结果', appearance: { outfit: '礼服', accessories: '', colorScheme: '', overallLook: '' },
  magicConstruct: { name: '', form: '', basicAbilities: [], description: '' },
  wonderlandRule: { name: '', description: '', tendency: '', activation: '' },
  blooming: { name: '', evolvedAbilities: [], evolvedForm: '', evolvedOutfit: '', powerLevel: '' },
  analysis: { personalityAnalysis: '', abilityReasoning: '', coreTraits: [], predictionBasis: '', background: { belief: '', bonds: '' } },
  userAnswers: [{ question: '角色想法', answer: '新的回答' }],
};
const beastCard = { name: '保留结果', coreConcept: '思念', coreEmotion: '孤独', evolutionStage: '幼年期', appearance: '雾', materialAndSkin: '雾', featuresAndAppendages: '', attackMethod: '', specialAbility: '', origin: '', birthEnvironment: '', researcherNotes: '', userAnswers: magicalCard.userAnswers };
const pages = ['Details', 'Canshou', 'Creator'] as const;
type Page = typeof pages[number];
let page: Page;
let root: Root;
let container: HTMLDivElement;
let calls: string[];
const key = () => page === 'Canshou' ? 'canshouAnswersDraft' : 'magicalGirlAnswersDraft';
const questionnaire = () => ({ id: 'draft-guard', title: '草稿保护问卷', description: '测试', kind: page === 'Canshou' ? 'canshou' : 'magical-girl', nativeAllowed: true, questions: [{ id: 'q1', question: '角色想法', type: 'text' }] });
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
const button = (text: string) => [...container.querySelectorAll('button')].find((node) => node.textContent?.includes(text));
const click = async (text: string) => { expect(button(text), text).toBeTruthy(); await act(async () => button(text)!.click()); await settle(); };
const input = () => container.querySelector<HTMLTextAreaElement>('.ui-web-questionnaire-answer-input')!;
const typeAnswer = async (value: string) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input(), value); input().dispatchEvent(new Event('input', { bubbles: true })); }); await settle(); };
const home = () => [...container.querySelectorAll<HTMLAnchorElement>('a[href]')].find((node) => node.getAttribute('href') === '/' && node.textContent === '返回首页')!;
const clearAnswers = async () => { if (!button('清空存档')) await click('一键填充答案'); await click('清空存档'); };
const mount = async () => {
  window.history.replaceState({}, '', `/${page.toLowerCase()}`);
  window.localStorage.setItem(page === 'Canshou' ? 'mahoshojo.canshou.preferences.v1' : 'mahoshojo.details.preferences.v1', JSON.stringify({ generationMode: 'non-stream', showBulkFillSection: true }));
  const { [page + 'Page']: PageComponent } = await import(`../components/creation/${page}Page.tsx`);
  await act(async () => root.render(<PageComponent />)); await settle();
};
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); window.localStorage.clear(); calls = [];
  vi.spyOn(window, 'confirm').mockReturnValue(false); vi.spyOn(window, 'alert').mockImplementation(() => {});
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.endsWith('/languages.json')) return response([{ code: 'zh-CN', name: '简体中文' }]);
    if (url === '/questionnaires/presets/index.json') return response({ presets: [{ ...questionnaire(), path: '/questionnaires/presets/guard.json', isDefault: true }] });
    if (url === '/questionnaires/presets/guard.json') return response(questionnaire());
    if (init?.method === 'POST' && (url.includes('/generate') || url.includes('/creator/'))) { calls.push(url); return response({ data: page === 'Canshou' ? beastCard : magicalCard, aiMeta: null }); }
    if (url === '/api/auth/verify') return response({ success: false });
    if (url === '/api/ai/channel-availability') return response({ entries: [] });
    return response({});
  }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe.each(pages)('%s Web answer-draft protection', (targetPage) => {
  beforeEach(() => { page = targetPage; });
  it.each(['{broken raw\n', '{"version":99,"answerEntries":[]}', '{"unrecognized":{"valuable":"keep"}}'])('preserves unreadable bytes %s without locking editing or deleting on empty autosave', async (raw) => {
    window.localStorage.setItem(key(), raw); await mount();
    expect(window.localStorage.getItem(key())).toBe(raw);
    expect(container.textContent).toContain('旧问卷存档无法读取');
    const pristine = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(pristine); expect(pristine.defaultPrevented).toBe(false);
    await click(page === 'Canshou' ? '开始调查' : '开始回答问卷');
    await typeAnswer('新的回答');
    expect(input().value).toBe('新的回答'); expect(window.localStorage.getItem(key())).toBe(raw);
    const dirty = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(dirty); expect(dirty.defaultPrevented).toBe(true);
    await act(async () => home().click()); expect(mocks.push).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockReturnValue(true);
    await clearAnswers();
    expect(input().value).toBe(''); expect(window.localStorage.getItem(key())).toBe(raw);
    expect(window.alert).not.toHaveBeenCalledWith('存档已清空！');
    await typeAnswer('新的回答');
    await act(async () => home().click()); expect(mocks.push).toHaveBeenCalledWith('/');
  });

  it('generates from memory-only answers and keeps a fresh result guarded even after clearing answers', async () => {
    const raw = '{broken raw'; window.localStorage.setItem(key(), raw); await mount();
    await click(page === 'Canshou' ? '开始调查' : '开始回答问卷'); await typeAnswer('新的回答');
    const submit = container.querySelector<HTMLButtonElement>('[aria-label="问卷翻页操作"] button:last-child')!;
    expect(submit.disabled).toBe(false); await act(async () => submit.click()); await settle(); await settle();
    expect(calls).toHaveLength(1); expect(container.textContent).toContain('保留结果');
    if (page !== 'Canshou') { vi.mocked(window.confirm).mockReturnValue(true); await clearAnswers(); expect(input().value).toBe(''); }
    expect(container.textContent).toContain('保留结果'); expect(window.localStorage.getItem(key())).toBe(raw);
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
    vi.mocked(window.confirm).mockReturnValue(false); mocks.push.mockClear();
    await act(async () => home().click()); expect(mocks.push).not.toHaveBeenCalled();
  });

  it('guards deletion of the final restored answer when autosave removal fails, then clears protection only after successful retry', async () => {
    window.localStorage.setItem(key(), JSON.stringify({ version: 3, answerEntries: [{ key: 'draft-guard::q1', question: '角色想法', questionId: 'q1', questionnaireId: 'draft-guard', answer: '合法旧回答' }] }));
    await mount(); await click(page === 'Canshou' ? '开始调查' : '开始回答问卷');
    expect(input().value).toBe('合法旧回答');
    const saved = window.localStorage.getItem(key()); const originalRemove = Storage.prototype.removeItem;
    const failedRemoval = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, name) {
      if (name === key()) throw new Error('disk');
      return originalRemove.call(this, name);
    });
    await typeAnswer('');
    expect(input().value).toBe(''); expect(window.localStorage.getItem(key())).toBe(saved);
    expect(container.textContent).toContain('问卷存档写入失败');
    const dirty = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(dirty); expect(dirty.defaultPrevented).toBe(true);
    await act(async () => home().click()); expect(mocks.push).not.toHaveBeenCalled();
    failedRemoval.mockRestore(); vi.mocked(window.confirm).mockReturnValue(true); await clearAnswers();
    expect(window.localStorage.getItem(key())).toBeNull(); expect(input().value).toBe('');
    const clean = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(clean); expect(clean.defaultPrevented).toBe(false);
  });

  it('keeps write-failed answers dirty until an actual successful save, without blocking generation controls', async () => {
    await mount(); await click(page === 'Canshou' ? '开始调查' : '开始回答问卷');
    const originalSet = Storage.prototype.setItem;
    const failWrite = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, name, value) {
      if (name === key()) throw new Error('quota');
      return originalSet.call(this, name, value);
    });
    await typeAnswer('写入失败的回答');
    expect(window.localStorage.getItem(key())).toBeNull(); expect(input().value).toBe('写入失败的回答');
    expect(container.textContent).toContain('问卷存档写入失败');
    expect(container.textContent).not.toContain('已自动保存于');
    expect(container.querySelector<HTMLButtonElement>('[aria-label="问卷翻页操作"] button:last-child')!.disabled).toBe(false);
    const dirty = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(dirty); expect(dirty.defaultPrevented).toBe(true);
    failWrite.mockRestore(); await typeAnswer('现在保存成功');
    expect(window.localStorage.getItem(key())).toContain('现在保存成功');
    expect(container.textContent).not.toContain('问卷存档写入失败');
    const clean = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(clean); expect(clean.defaultPrevented).toBe(false);
  });

  it('does not trap a pristine empty page when its initial empty cleanup cannot persist', async () => {
    const originalRemove = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, name) {
      if (name === key()) throw new Error('disk');
      return originalRemove.call(this, name);
    });
    await mount();
    expect(container.textContent).toContain('问卷存档写入失败');
    const pristine = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(pristine); expect(pristine.defaultPrevented).toBe(false);
  });

  it('restores the existing v3 answer format and reports a failed clear without losing answers', async () => {
    window.localStorage.setItem(key(), JSON.stringify({ version: 3, answerEntries: [{ key: 'draft-guard::q1', question: '角色想法', questionId: 'q1', questionnaireId: 'draft-guard', answer: '合法回答' }] }));
    await mount(); await click(page === 'Canshou' ? '开始调查' : '开始回答问卷');
    expect(input().value).toBe('合法回答'); expect(container.textContent).not.toContain('旧问卷存档无法读取');
    const saved = window.localStorage.getItem(key()); const remove = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, name) { if (name === key()) throw new Error('disk'); return remove.call(this, name); });
    vi.mocked(window.confirm).mockReturnValue(true); await clearAnswers();
    expect(input().value).toBe('合法回答'); expect(window.localStorage.getItem(key())).toBe(saved);
    expect(container.textContent).toContain('清空存档失败'); expect(window.alert).not.toHaveBeenCalledWith('存档已清空！');
  });
});
