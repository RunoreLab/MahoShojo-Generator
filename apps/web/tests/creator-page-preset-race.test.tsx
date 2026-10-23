// @vitest-environment jsdom

// Web /creator 预设手动加载竞态契约（G3-r1-r1 收口，与 Desktop creator-page 同口径）。
// 真实渲染 CreatorPage 与共享控件，只在网络 fetch、next/navigation 与云端模态这类
// 真实边界打桩，锁定「按用户操作意图而非按网络请求次序处理」的语义：
// - 单选 latest-wins：乱序到达的旧响应不得覆盖较新意图；
// - 多选追加保留意图：并发请求互不取消、各自并入最新选择集；
// - 清空存档/切模板（含切回）/单选下改选本地问卷，都让在途预设请求失效。

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  routerPush: vi.fn(),
  routerReplace: vi.fn(),
  routerRefresh: vi.fn(),
  routerBack: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mocks.routerPush,
    replace: mocks.routerReplace,
    refresh: mocks.routerRefresh,
    back: mocks.routerBack,
  }),
  usePathname: () => '/creator',
  useSearchParams: () => new URLSearchParams(),
}));

// 云端保存是账号/数据卡边界，与页面契约无关，收成最小占位按钮。
vi.mock('@/components/SaveToCloudButton', () => ({
  __esModule: true,
  default: ({ buttonText }: { buttonText?: string }) => (
    <button type="button">{buttonText ?? '保存到云端'}</button>
  ),
}));

// 云端问卷选择器/数据卡详情是数据卡会话边界：页面级契约不进入，占位以免内部取数。
vi.mock('@/components/BattleDataModal', () => ({ __esModule: true, default: () => null }));
vi.mock('@/components/DataCardDetailsModal', () => ({ __esModule: true, default: () => null }));

const DETAILS_PREFERENCE_KEY = 'mahoshojo.details.preferences.v1';

const makeQuestionnaire = (id: string, title: string) => ({
  id,
  kind: 'magical-girl',
  title,
  description: `${title}说明`,
  nativeAllowed: true,
  questions: [
    { id: `${id}-q1`, question: `${title}问题一`, type: 'text', maxLength: 120 },
    { id: `${id}-q2`, question: `${title}问题二`, type: 'text', maxLength: 120 },
  ],
});

const DEFAULT_QUESTIONNAIRE = makeQuestionnaire('mg-default', '默认问卷');
const QUESTIONNAIRE_A = makeQuestionnaire('preset-a-questionnaire', '预设问卷A');
const QUESTIONNAIRE_B = makeQuestionnaire('preset-b-questionnaire', '预设问卷B');
const LOCAL_QUESTIONNAIRE = makeQuestionnaire('local-upload-questionnaire', '本地粘贴问卷');

const PRESET_INDEX = {
  version: 1,
  presets: [
    { id: 'preset-a', kind: 'magical-girl', title: '预设A', path: '/questionnaires/presets/a.json' },
    { id: 'preset-b', kind: 'magical-girl', title: '预设B', path: '/questionnaires/presets/b.json' },
    {
      id: 'mg-default',
      kind: 'magical-girl',
      title: '默认问卷',
      path: '/questionnaires/presets/mg-default.json',
      isDefault: true,
    },
  ],
};

const LANGUAGES = [
  { code: 'zh-CN', name: '简体中文' },
  { code: 'en', name: 'English' },
];

const jsonResponse = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// a/b 两个预设请求挂起，由用例显式 resolve 控制完成次序；其余问卷路径即时返回。
const deferreds = new Map<string, () => void>();
const fetchMock = vi.fn((input: unknown): Promise<Response> => {
  const url = typeof input === 'string' ? input : (input as Request).url;
  if (url.endsWith('/languages.json')) return Promise.resolve(jsonResponse(LANGUAGES));
  if (url === '/questionnaires/presets/index.json') return Promise.resolve(jsonResponse(PRESET_INDEX));
  if (url === '/questionnaires/presets/a.json') {
    return new Promise((resolve) => deferreds.set('a', () => resolve(jsonResponse(QUESTIONNAIRE_A))));
  }
  if (url === '/questionnaires/presets/b.json') {
    return new Promise((resolve) => deferreds.set('b', () => resolve(jsonResponse(QUESTIONNAIRE_B))));
  }
  if (url === '/questionnaires/presets/mg-default.json') return Promise.resolve(jsonResponse(DEFAULT_QUESTIONNAIRE));
  if (url === '/api/auth/verify') return Promise.resolve(jsonResponse({ success: false }));
  if (url === '/api/ai/channel-availability') return Promise.resolve(jsonResponse({ entries: [] }));
  return Promise.resolve(jsonResponse({ message: `unmocked fetch: ${url}` }, 404));
});

let root: Root;
let container: HTMLDivElement;

const settle = (ms = 160) => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, ms));
});

const findButton = (text: string) =>
  [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(text));

const clickButton = async (text: string, settleMs = 160) => {
  const target = findButton(text);
  expect(target, `按钮「${text}」应存在`).toBeTruthy();
  await act(async () => {
    target!.click();
  });
  await settle(settleMs);
};

const setNativeValue = (element: HTMLElement, value: string) => {
  const proto = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
  element.dispatchEvent(
    new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
  );
};

const mountPage = async () => {
  const { CreatorPage } = await import('@/components/creation/CreatorPage');
  await act(async () => {
    root.render(<CreatorPage />);
  });
  await settle();
};

const startQuestionnaire = async () => {
  await clickButton('开始回答问卷');
};

const presetSelect = () => [...container.querySelectorAll('select')].find((item) =>
  [...item.options].some((option) => option.value === 'preset-a'));

const pickPreset = async (presetId: string) => {
  const select = presetSelect();
  expect(select, '预设下拉应存在').toBeTruthy();
  await act(async () => {
    setNativeValue(select!, presetId);
  });
};

const storedSelectionIds = () => {
  const raw = window.localStorage.getItem(DETAILS_PREFERENCE_KEY);
  if (!raw) return [] as string[];
  const selections = (JSON.parse(raw) as {
    questionnaireSelections?: { questionnaire: { id: string } }[];
  }).questionnaireSelections ?? [];
  return selections.map((item) => item.questionnaire.id);
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  deferreds.clear();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Web CreatorPage 高级语言与预设加载', () => {
  it.each([
    ['magical-girl', '魔法少女（结构化）'], ['canshou', '残兽（结构化）'],
    ['general', '通用角色卡（Markdown）'], ['general-scenario', '通用情景卡（Markdown）'],
  ] as const)('keeps %s follow-up controls bound to the completed result across template changes', async (kind, templateLabel) => {
    const structured = kind === 'magical-girl' || kind === 'canshou';
    window.localStorage.setItem(DETAILS_PREFERENCE_KEY, JSON.stringify({ generationMode: structured ? 'non-stream' : 'stream' }));
    const generated = { codename: '旧角色', name: '旧残兽', appearance: {}, magicConstruct: { basicAbilities: [] },
      wonderlandRule: {}, blooming: { evolvedAbilities: [] }, analysis: { coreTraits: [], background: {} } };
    const request = vi.fn((input: unknown) => {
      const url = String(input);
      if (url.includes('/api/creator/generate')) return Promise.resolve(structured
        ? jsonResponse(generated) : new Response(kind === 'general-scenario' ? '# 简报\\n\\n---\\n\\n## 任务\\n记录星轨。' : '# 旧结果\n\n原始正文', { headers: { 'Content-Type': 'text/plain' } }));
      if (url === '/questionnaires/presets/mg-default.json') return Promise.resolve(jsonResponse({ ...DEFAULT_QUESTIONNAIRE, nativeAllowed: false }));
      return fetchMock(input);
    });
    vi.stubGlobal('fetch', request);
    await mountPage(); await startQuestionnaire();
    await clickButton(templateLabel);
    await clickButton('还没想好', 400); await clickButton('还没想好', 400);
    if (kind === 'general-scenario') {
      await clickButton('按换行预览');
      expect([...container.querySelectorAll('h3')].some((heading) => heading.textContent === '任务')).toBe(true);
      await clickButton('恢复原文预览');
      expect([...container.querySelectorAll('h3')].some((heading) => heading.textContent === '任务')).toBe(false);
    }
    const checkResultControls = () => {
      expect(container.querySelector('[aria-label="继续创作"] a[href="/battle"]')?.textContent).toContain(
        kind === 'general-scenario' ? '把这个情景投入故事' : kind === 'canshou' ? '让它大闹一场' : '让她大闹一场');
      expect(container.textContent!.includes('设定长图保存方式')).toBe(structured);
      expect([...container.querySelectorAll('button')].some(button => button.textContent!.includes('设定说明'))).toBe(kind === 'magical-girl');
    };
    checkResultControls();
    await clickButton(structured ? (kind === 'canshou' ? '魔法少女（结构化）' : '残兽（结构化）')
      : (kind === 'general' ? '通用情景卡（Markdown）' : '通用角色卡（Markdown）'));
    checkResultControls();
    await clickButton('高级生成'); await clickButton(structured ? '流式' : '非流式');
    checkResultControls();
    expect(request.mock.calls.filter(([input]) => String(input).includes('/api/creator/generate'))).toHaveLength(1);
  });

  it('keeps the shared language disclosure before generation settings and persists its value and expansion', async () => {
    await mountPage();
    await clickButton('高级生成');
    const section = container.querySelector('[data-creator-advanced-card="language"]')!;
    const toggle = section.querySelector('button')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(section.querySelector('select')).toBeNull();
    const mode = container.querySelector('[data-creator-advanced-card="generation-mode"]')!;
    expect(section.compareDocumentPosition(mode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await clickButton('生成语言');
    const select = section.querySelector<HTMLSelectElement>('select[aria-label="生成语言"]')!;
    await act(async () => setNativeValue(select, 'en'));
    await clickButton('生成语言');
    expect(JSON.parse(window.localStorage.getItem(DETAILS_PREFERENCE_KEY)!)).toMatchObject({ selectedLanguage: 'en', showLanguageSection: false });
    await clickButton('生成语言');
    expect(section.querySelector<HTMLSelectElement>('select')!.value).toBe('en');
    expect(JSON.parse(window.localStorage.getItem(DETAILS_PREFERENCE_KEY)!)).toMatchObject({ selectedLanguage: 'en', showLanguageSection: true });
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/creator/generate'))).toBe(false);
  });

  it.each([true, false])('restores the existing language preference with expanded=%s', async (expanded) => {
    window.localStorage.setItem(DETAILS_PREFERENCE_KEY, JSON.stringify({ selectedLanguage: 'en', showLanguageSection: expanded }));
    await mountPage();
    await clickButton('高级生成');
    const section = container.querySelector('[data-creator-advanced-card="language"]')!;
    expect(section.querySelector('button')!.getAttribute('aria-expanded')).toBe(String(expanded));
    if (!expanded) await clickButton('生成语言');
    expect(section.querySelector<HTMLSelectElement>('select')!.value).toBe('en');
  });

  it('sends the chosen language through the actual Creator request and locks it while pending', async () => {
    window.localStorage.setItem(DETAILS_PREFERENCE_KEY, JSON.stringify({ generationMode: 'non-stream', showLanguageSection: true }));
    let finish: ((response: Response) => void) | undefined;
    const request = vi.fn((input: unknown, init?: RequestInit) => {
      if (String(input).includes('/api/creator/generate')) return new Promise<Response>((resolve) => { finish = resolve; });
      return fetchMock(input);
    });
    vi.stubGlobal('fetch', request);
    await mountPage();
    await startQuestionnaire();
    await clickButton('高级生成');
    const language = container.querySelector<HTMLSelectElement>('select[aria-label="生成语言"]')!;
    await act(async () => setNativeValue(language, 'en'));
    await clickButton('还没想好', 400);
    await clickButton('还没想好');
    const generationCalls = request.mock.calls.filter(([input]) => String(input).includes('/api/creator/generate'));
    expect(generationCalls).toHaveLength(1);
    expect(JSON.parse(generationCalls[0]![1]!.body as string)).toMatchObject({ language: 'en' });
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="生成语言"]')!.disabled).toBe(true);
    await act(async () => finish!(jsonResponse({ error: '测试请求结束' }, 400)));
    await settle();
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="生成语言"]')!.disabled).toBe(false);
  });

  it('suppresses stale preset-load responses when manual adds race in single mode', async () => {
    // 单选 latest-wins：B 后发起是较新意图；迟到的 A 不得覆盖/追加。
    await mountPage();
    await startQuestionnaire();
    await clickButton('问卷设置');
    await pickPreset('preset-a');
    await pickPreset('preset-b');
    await act(async () => deferreds.get('b')!());
    await settle();
    expect(storedSelectionIds()).toContain('preset-b-questionnaire');
    await act(async () => deferreds.get('a')!());
    await settle();
    expect(storedSelectionIds()).not.toContain('preset-a-questionnaire');
    expect(storedSelectionIds()).toContain('preset-b-questionnaire');
  });

  it('appends every concurrent preset add under multi-questionnaire mode', async () => {
    // 多选追加保留意图：A 未加载完再选 B 不取消 A，乱序完成后两者都必须保留。
    window.localStorage.setItem(DETAILS_PREFERENCE_KEY, JSON.stringify({ allowMultipleQuestionnaires: true }));
    await mountPage();
    await startQuestionnaire();
    await clickButton('问卷设置');
    await pickPreset('preset-a');
    await pickPreset('preset-b');
    // 与发起序相反的完成序。
    await act(async () => deferreds.get('b')!());
    await settle();
    await act(async () => deferreds.get('a')!());
    await settle();
    expect(storedSelectionIds()).toContain('preset-a-questionnaire');
    expect(storedSelectionIds()).toContain('preset-b-questionnaire');
    expect(storedSelectionIds()).toContain('mg-default');
  });

  it('drops a pending preset load once the draft is cleared mid-flight', async () => {
    // 加载途中清空存档：该请求不再适用，响应落地不得写回。
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await mountPage();
    await startQuestionnaire();
    await clickButton('问卷设置');
    await pickPreset('preset-a');
    await clickButton('一键填充答案');
    await clickButton('清空存档');
    await act(async () => deferreds.get('a')!());
    await settle();
    expect(storedSelectionIds()).not.toContain('preset-a-questionnaire');
    expect(storedSelectionIds()).toContain('mg-default');
  });

  it('drops a pending preset load across template switches, including switch-back', async () => {
    // 加载途中切模板再切回：往返两次推进世代，响应回到原模板时同样失效。
    await mountPage();
    await startQuestionnaire();
    await clickButton('问卷设置');
    await pickPreset('preset-a');
    await clickButton('通用情景卡（Markdown）');
    await clickButton('通用角色卡（Markdown）');
    await act(async () => deferreds.get('a')!());
    await settle();
    expect(storedSelectionIds()).not.toContain('preset-a-questionnaire');
  });

  it('keeps a newer local-questionnaire pick over a stale preset response in single mode', async () => {
    // 单选下粘贴导入本地问卷是更新的替换意图：迟到的预设响应不得把它顶回。
    await mountPage();
    await startQuestionnaire();
    await clickButton('问卷设置');
    await pickPreset('preset-a');
    await clickButton('粘贴导入 JSON');
    const textarea = [...container.querySelectorAll('textarea')].find(
      (item) => item.placeholder === '在此粘贴问卷 JSON',
    );
    expect(textarea, '粘贴导入 textarea 应存在').toBeTruthy();
    await act(async () => {
      setNativeValue(textarea!, JSON.stringify(LOCAL_QUESTIONNAIRE));
    });
    await clickButton('解析并载入');
    await act(async () => deferreds.get('a')!());
    await settle();
    expect(storedSelectionIds()).toContain('local-upload-questionnaire');
    expect(storedSelectionIds()).not.toContain('preset-a-questionnaire');
  });
});
