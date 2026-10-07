// @vitest-environment jsdom

// Web /canshou 页面级行为契约（D5.1-G1 r1 收口）。
// 真实渲染 CanshouPage 与全部共享控件（问卷选择/题面板/导航/批量填充/答案概览/
// 保存偏好/Lore 面板均不 mock），只在网络 fetch、next/navigation 与云端保存入口
// 这类真实边界打桩，锁定「迁移到 ui-web 共享组件后 Web 页面行为不回退」的契约：
// 多问卷+Lore、allQuestionTargets/mergedQuestionTargets 批量填充语义、
// 条件题隐藏后的答案概览行为、保存偏好持久化、服务器生成路径、
// 生成中锁定/手动停止以及残兽特有锚点。

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { canshouQuestionnaire } from '@/lib/questionnaire-presets';

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
  usePathname: () => '/canshou',
  useSearchParams: () => new URLSearchParams(),
}));

// 云端保存是账号/数据卡边界（打开会话模态、调用 /api/data-cards），
// 与页面契约无关，收成最小占位按钮。
vi.mock('@/components/SaveToCloudButton', () => ({
  __esModule: true,
  default: ({ buttonText }: { buttonText?: string }) => (
    <button type="button">{buttonText ?? '保存到云端'}</button>
  ),
}));

const DRAFT_KEY = 'canshouAnswersDraft';
const PREF_KEY = 'mahoshojo.canshou.preferences.v1';

// 默认问卷 fixture 从仓库根 content/ 权威源导入：public/ 副本是构建期生成物，
// 测试与 lint 流程里并不存在（MONO-006，见 lib/questionnaire-presets.ts）。
const DEFAULT_QUESTIONNAIRE = canshouQuestionnaire as {
  id: string;
  title: string;
  description: string;
  questions: Array<{ id: string; question: string }>;
};

// 第二份预设：带 loreMarkdown（进「设定（Lore）注入」列表）+ 一道跨问卷条件题
// extraLarva 仅在 canshou-default::evolutionStage == '卵' 时进入可见流序。
const EXTRA_QUESTIONNAIRE = {
  id: 'canshou-lore-extra',
  kind: 'canshou',
  title: '间界补遗问卷',
  description: '补遗问卷（含 Lore 与条件题）',
  nativeAllowed: true,
  loreMarkdown: '补遗设定：间界残兽多栖息于回声巢穴，卵期怕光。',
  questions: [
    { id: 'extraHabitat', question: '补遗：栖息地？', type: 'text', maxLength: 120 },
    {
      id: 'extraLarva',
      question: '补遗：卵期的特殊表现？',
      type: 'text',
      maxLength: 120,
      displayIf: {
        questionId: 'evolutionStage',
        questionnaireId: 'canshou-default',
        operator: 'equals',
        value: '卵',
      },
    },
  ],
};

const PRESET_INDEX = {
  presets: [
    {
      id: 'canshou-default',
      kind: 'canshou',
      title: '研究院残兽调查',
      description: '前进吧，残兽！',
      path: '/questionnaires/presets/canshou-default.json',
      isDefault: true,
    },
    {
      id: 'canshou-lore-extra',
      kind: 'canshou',
      title: '间界补遗问卷',
      description: '补遗问卷',
      path: '/questionnaires/presets/canshou-lore-extra.json',
    },
  ],
};

const LANGUAGES = [
  { code: 'zh-CN', name: '简体中文' },
  { code: 'en', name: 'English' },
];

const CANSHOU_RESULT = {
  name: '巢穴回声',
  coreConcept: '思念成兽',
  coreEmotion: '孤独',
  evolutionStage: '幼年期',
  appearance: '雾状表皮',
  materialAndSkin: '湿雾',
  featuresAndAppendages: '风铃尾',
  attackMethod: '回声震荡',
  specialAbility: '声音重现',
  origin: '废弃巢穴',
  birthEnvironment: '地下空洞',
  researcherNotes: '观察记录',
  templateId: '魔法少女/心之器：残兽（问卷生成）',
};

type FetchCall = {
  url: string;
  init: RequestInit | undefined;
};

let fetchCalls: FetchCall[];
let streamResponder: (init: RequestInit | undefined) => Response;

const jsonResponse = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const fetchMock = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : (input as Request).url;
  fetchCalls.push({ url, init });
  if (url.endsWith('/languages.json')) return jsonResponse(LANGUAGES);
  if (url === '/questionnaires/presets/index.json') return jsonResponse(PRESET_INDEX);
  if (url === '/questionnaires/presets/canshou-default.json') return jsonResponse(DEFAULT_QUESTIONNAIRE);
  if (url === '/questionnaires/presets/canshou-lore-extra.json') return jsonResponse(EXTRA_QUESTIONNAIRE);
  if (url === '/api/auth/verify') return jsonResponse({ success: false });
  if (url === '/api/ai/channel-availability') return jsonResponse({ entries: [] });
  if (url === '/api/generate-canshou-stream?format=sse') return streamResponder(init);
  if (url === '/api/generate-canshou') return jsonResponse({ data: CANSHOU_RESULT, aiMeta: null });
  return jsonResponse({ message: `unmocked fetch: ${url}` }, 404);
});

let root: Root;
let container: HTMLDivElement;

const settle = (ms = 160) => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, ms));
});

const findButton = (text: string, scope: ParentNode = container) =>
  [...scope.querySelectorAll('button')].find((item) => item.textContent?.includes(text));

const findButtonExact = (text: string, scope: ParentNode = container) =>
  [...scope.querySelectorAll('button')].find((item) => item.textContent?.trim() === text);

const clickButton = async (text: string, settleMs = 160, scope: ParentNode = container) => {
  const target = findButton(text, scope);
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

const navigatorSelect = () =>
  container.querySelector<HTMLSelectElement>('#question-navigator-select');

const jumpToQuestion = async (key: string) => {
  const select = navigatorSelect();
  expect(select, '题号导航 select 应存在').toBeTruthy();
  await act(async () => {
    setNativeValue(select!, key);
  });
  await settle();
};

const answerTextarea = () =>
  container.querySelector<HTMLTextAreaElement>('textarea.ui-web-questionnaire-answer-input');

const typeCurrentAnswer = async (value: string) => {
  const textarea = answerTextarea();
  expect(textarea, '当前题 textarea 应存在').toBeTruthy();
  await act(async () => {
    setNativeValue(textarea!, value);
  });
  await settle();
};

const mountPage = async () => {
  const { CanshouPage } = await import('@/components/creation/CanshouPage');
  await act(async () => {
    root.render(<CanshouPage />);
  });
  await settle();
};

const startQuestionnaire = async () => {
  await clickButton('开始调查');
};

const selectPreset = async (presetId: string) => {
  const select = [...container.querySelectorAll('select')].find(
    (item) => [...item.options].some((option) => option.value === presetId),
  );
  expect(select, `预设下拉应包含 ${presetId}`).toBeTruthy();
  await act(async () => {
    setNativeValue(select!, presetId);
  });
  await settle();
};

const generationCalls = (path: string) =>
  fetchCalls.filter((call) => call.url === path && call.init?.method === 'POST');

const progressText = () => {
  const node = [...container.querySelectorAll('span')].find((item) =>
    /^问题 \d+ \/ \d+$/.test(item.textContent ?? ''),
  );
  return node?.textContent ?? null;
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  fetchCalls = [];
  // 默认流式桩：发送一个 markdown 块后保持打开，由用例控制 abort/收尾。
  streamResponder = () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('event: done\ndata: {}\n\n'),
        );
        controller.close();
      },
    });
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };
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

describe('Web CanshouPage 页面级行为契约（真实共享控件）', () => {
  it('默认问卷装载、草稿恢复与残兽页面锚点', async () => {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({
      version: 3,
      answersByKey: { 'canshou-default::coreConcept': '回声巢穴' },
      answerEntries: [{
        key: 'canshou-default::coreConcept',
        question: DEFAULT_QUESTIONNAIRE.questions[0]!.question,
        answer: '回声巢穴',
        questionId: 'coreConcept',
        questionnaireId: 'canshou-default',
      }],
    }));

    await mountPage();
    await startQuestionnaire();

    // 残兽特有锚点：logo 图与默认问卷描述文案。
    expect(container.querySelector('img[alt="残兽调查"]')).toBeTruthy();
    expect(container.textContent).toContain('前进吧，残兽！');
    expect(progressText()).toBe('问题 1 / 10');

    // v3 草稿按 composite key 恢复到当前题输入框。
    const textarea = answerTextarea();
    expect(textarea?.getAttribute('aria-label')).toBe('残兽的核心概念是什么？');
    expect(textarea?.value).toBe('回声巢穴');
    expect(container.textContent).toContain('已自动保存于');
  });

  it('多问卷选择叠加第二份问卷：Lore 注入可停用、可移除', async () => {
    window.localStorage.setItem(PREF_KEY, JSON.stringify({
      showQuestionnaireSettings: true,
      allowMultipleQuestionnaires: true,
    }));

    await mountPage();
    await startQuestionnaire();

    // 默认预设无 loreMarkdown：设定区显示空态。
    expect(container.textContent).toContain('暂无设定来源');
    expect(container.textContent).toContain('研究院残兽调查');
    expect(progressText()).toBe('问题 1 / 10');

    // 追加第二份预设：题目并入可见流序，且进入 Lore 注入列表。
    await selectPreset('canshou-lore-extra');
    await clickButton('问卷设置');
    expect(container.textContent).toContain('间界补遗问卷');
    expect(container.textContent).toContain('设定：启用');
    expect(progressText()).toBe('问题 1 / 11');

    // 停用 Lore 注入：meta 翻转为「设定：关闭」，题目仍在。
    const loreToggle = [...container.querySelectorAll('label')].find((label) =>
      label.textContent?.includes('使用设定'),
    )?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(loreToggle, '「使用设定」开关应存在').toBeTruthy();
    await act(async () => {
      loreToggle!.click();
    });
    await settle();
    expect(container.textContent).toContain('设定：关闭');
    expect(progressText()).toBe('问题 1 / 11');

    // 移除第二份问卷：恢复单问卷 10 题。
    // 「移除」落在该问卷子卡的 actions 区（entryTitle 父级的兄弟节点），按归属定位。
    const extraTitle = [...container.querySelectorAll('div')].find(
      (node) => node.textContent?.trim() === '间界补遗问卷',
    );
    const extraSubcard = extraTitle?.parentElement?.parentElement;
    const removeButton = [...(extraSubcard?.querySelectorAll('button') ?? [])].find(
      (item) => item.textContent?.trim() === '移除',
    );
    expect(removeButton, '第二份问卷的「移除」按钮应存在').toBeTruthy();
    await act(async () => {
      removeButton!.click();
    });
    await settle();
    expect(progressText()).toBe('问题 1 / 10');
  });

  it('批量填充按可见流序回落；含元数据条目可写隐藏题但不进概览', async () => {
    window.localStorage.setItem(PREF_KEY, JSON.stringify({
      showQuestionnaireSettings: true,
      allowMultipleQuestionnaires: true,
      showBulkFillSection: true,
      showAnswerReview: true,
    }));

    await mountPage();
    await startQuestionnaire();
    await selectPreset('canshou-lore-extra');
    await clickButton('问卷设置');

    const visibleCountBefore = mergedCount();
    expect(visibleCountBefore).toBe(11);

    // 批量填充：第 0 条带 questionId/questionnaireId 命中 displayIf 隐藏题；
    // 第 1 条无元数据按「可见流序」回落到 mergedQuestions[1]（coreEmotion），
    // 而不是按 allQuestionTargets 全集序位。
    const bulkTextarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder*="在此处粘贴所有答案"]',
    );
    expect(bulkTextarea, '批量填充 textarea 应存在').toBeTruthy();
    await act(async () => {
      setNativeValue(bulkTextarea!, JSON.stringify([
        { questionId: 'extraLarva', questionnaireId: 'canshou-lore-extra', answer: '卵期会发出荧光' },
        '逐行回落答案',
      ]));
    });
    await act(async () => {
      findButtonExact('填充')!.click();
    });
    await settle();
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('成功填充了 2 个答案'));

    // 隐藏题答案写入草稿 answersByKey（持久化保留），但答案概览只列可见题。
    const saved = JSON.parse(window.localStorage.getItem(DRAFT_KEY)!) as {
      answersByKey: Record<string, string>;
    };
    expect(saved.answersByKey['canshou-lore-extra::extraLarva']).toBe('卵期会发出荧光');
    expect(saved.answersByKey['canshou-default::coreEmotion']).toBe('逐行回落答案');

    const review = reviewListContainer();
    expect(review.textContent).toContain('逐行回落答案');
    expect(review.textContent).not.toContain('卵期会发出荧光');

    // 答「卵」使隐藏题进入可见流序：概览随即列出该题与已写答案。
    await jumpToQuestion('canshou-default::evolutionStage');
    await clickButton('卵', 420);
    expect(progressText()).toBe('问题 4 / 12');
    expect(reviewListContainer().textContent).toContain('卵期会发出荧光');

    // 改答其他阶段：隐藏题退出可见流序与概览，草稿仍保留其答案。
    await jumpToQuestion('canshou-default::evolutionStage');
    await clickButton('蠖', 420);
    expect(progressText()).toContain('/ 11');
    expect(reviewListContainer().textContent).not.toContain('卵期会发出荧光');
    const savedAfter = JSON.parse(window.localStorage.getItem(DRAFT_KEY)!) as {
      answersByKey: Record<string, string>;
    };
    expect(savedAfter.answersByKey['canshou-lore-extra::extraLarva']).toBe('卵期会发出荧光');
  });

  it('提交走 /api/generate-canshou 服务器路径，结果区保留残兽锚点与保存偏好', async () => {
    await mountPage();
    await startQuestionnaire();
    await typeCurrentAnswer('回声筑巢的幼体');

    await jumpToQuestion('canshou-default::birthEnvironment');
    await clickButton('跳过并生成', 400);

    const calls = generationCalls('/api/generate-canshou');
    expect(calls).toHaveLength(1);
    const headers = new Headers(calls[0]!.init?.headers);
    expect(headers.get('x-mahoshojo-ai-meta')).toBe('1');

    const body = JSON.parse(String(calls[0]!.init?.body)) as Record<string, any>;
    expect(body.language).toBe('zh-CN');
    expect(body.allowNativeSignature).toBe(true);
    expect(body.questionnaireSelections).toEqual([
      { source: 'preset', kind: 'canshou', presetId: 'canshou-default' },
    ]);
    expect(body.questionnaires[0].id).toBe('canshou-default');
    expect(body.answers).toEqual([
      expect.objectContaining({
        questionId: 'coreConcept',
        questionnaireId: 'canshou-default',
        answer: '回声筑巢的幼体',
      }),
    ]);

    // 结果区：结构化残兽卡 + Lore 折叠 + 保存偏好面板 + 竞技场入口。
    expect(container.textContent).toContain('巢穴回声');
    expect(container.textContent).toContain('思念成兽');
    expect(container.textContent).toContain('前往竞技场，让它大闹一场');
    // 生成成功即进入默认通道 60s 冷却，重生成入口显式锁为「冷却中」。
    expect(container.textContent).toMatch(/冷却中 \(\d+s\)/);

    await clickButton('残兽设定说明');
    const { CANSHOU_LORE } = await import('@mahoshojo/domain/canshou-lore');
    expect(container.textContent).toContain(CANSHOU_LORE.trim().split('\n')[0]);

    // 保存偏好切换写回 CANSHOU_PREFERENCE_KEY。
    await clickButton('长按保存弹窗');
    const prefs = JSON.parse(window.localStorage.getItem(PREF_KEY)!) as Record<string, unknown>;
    expect(prefs.imageSaveMode).toBe('modal');
    await clickButton('复制原始数据');
    const prefs2 = JSON.parse(window.localStorage.getItem(PREF_KEY)!) as Record<string, unknown>;
    expect(prefs2.jsonSaveMode).toBe('text');
  });

  it('流式生成在途锁定编辑入口并可手动停止，保留部分输出', async () => {
    window.localStorage.setItem(PREF_KEY, JSON.stringify({ generationMode: 'stream' }));

    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    streamResponder = (init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
          controller.enqueue(new TextEncoder().encode(
            'event: markdown\ndata: {"chunk":"名字：残响兽\\n\\n半截残兽正文"}\n\n',
          ));
        },
      });
      init?.signal?.addEventListener('abort', () => {
        try {
          streamController.error(new DOMException('The operation was aborted.', 'AbortError'));
        } catch {
          // 流已被错误化时忽略重复 abort。
        }
      });
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    };

    await mountPage();
    await startQuestionnaire();
    await typeCurrentAnswer('回声筑巢的幼体');
    await jumpToQuestion('canshou-default::birthEnvironment');
    await clickButton('跳过并生成', 220);

    const calls = generationCalls('/api/generate-canshou-stream?format=sse');
    expect(calls).toHaveLength(1);
    expect(new Headers(calls[0]!.init?.headers).get('Accept')).toBe('text/event-stream');
    expect(calls[0]!.init?.signal?.aborted).toBe(false);

    // 生成中锁定：步进按钮禁用（重复点击不再发请求）、停止按钮可见、部分输出已渲染。
    const nextButton = findButton('生成中...');
    expect(nextButton?.disabled).toBe(true);
    expect(container.querySelector('button[aria-label="停止生成"]')).toBeTruthy();
    expect(container.textContent).toContain('残响兽');
    await act(async () => {
      nextButton!.click();
    });
    await settle();
    expect(generationCalls('/api/generate-canshou-stream?format=sse')).toHaveLength(1);

    // 手动停止：abort 透传到 fetch signal，页面给出可继续保存的提示并保留部分输出。
    await clickButton('停止生成', 320);
    expect(calls[0]!.init?.signal?.aborted).toBe(true);
    expect(container.textContent).toContain('已手动停止生成。当前内容可能不完整，但可继续保存。');
    expect(container.textContent).toContain('残响兽');
    expect(container.textContent).toContain('半截残兽正文');
  });

  it('未作答任何题目时不发起生成请求并提示', async () => {
    await mountPage();
    await startQuestionnaire();
    await jumpToQuestion('canshou-default::birthEnvironment');
    await clickButton('跳过并生成', 300);

    expect(generationCalls('/api/generate-canshou')).toHaveLength(0);
    expect(container.textContent).toContain('请至少填写一题后再生成');
  });
});

function mergedCount(): number | null {
  const match = /问题 \d+ \/ (\d+)/.exec(
    [...container.querySelectorAll('span')].find((item) =>
      /^问题 \d+ \/ \d+$/.test(item.textContent ?? ''),
    )?.textContent ?? '',
  );
  return match ? Number(match[1]) : null;
}

function reviewListContainer(): HTMLElement {
  const toggle = findButton('答案概览');
  const card = toggle?.closest('div');
  expect(card, '答案概览容器应存在').toBeTruthy();
  return card as HTMLElement;
}
