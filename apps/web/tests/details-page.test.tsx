// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { magicalQuestionnaire } from '@/lib/questionnaire-presets';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/details',
  useSearchParams: () => new URLSearchParams(),
}));

// 只隔离账号/云端卡库边界，真实渲染页面、品牌外壳与问卷控件。
vi.mock('@/components/SaveToCloudButton', () => ({ default: () => null }));
vi.mock('@/components/BattleDataModal', () => ({ default: () => null }));
vi.mock('@/components/DataCardDetailsModal', () => ({ default: () => null }));

let container: HTMLDivElement;
let root: Root;
const jsonResponse = (data: unknown) => new Response(JSON.stringify(data), {
  headers: { 'Content-Type': 'application/json' },
});
const fetchMock = vi.fn(async (input: unknown) => {
  const url = typeof input === 'string' ? input : (input as Request).url;
  if (url.endsWith('/languages.json')) return jsonResponse([{ code: 'zh-CN', name: '简体中文' }]);
  if (url === '/questionnaires/presets/index.json') return jsonResponse({ presets: [{
    id: magicalQuestionnaire.id,
    kind: 'magical-girl',
    title: magicalQuestionnaire.title,
    path: '/questionnaires/presets/magical-girl-default.json',
    isDefault: true,
  }] });
  if (url === '/questionnaires/presets/magical-girl-default.json') return jsonResponse(magicalQuestionnaire);
  if (url === '/api/auth/verify') return jsonResponse({ success: false });
  if (url === '/api/ai/channel-availability') return jsonResponse({ entries: [] });
  throw new Error(`unexpected fetch: ${url}`);
});

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
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

describe('Web DetailsPage 常驻品牌（真实共享控件）', () => {
  it.each([false, true])('开始答题后保留品牌，已有草稿：%s', async (withDraft) => {
    if (withDraft) {
      const firstQuestion = magicalQuestionnaire.questions[0]!;
      window.localStorage.setItem('magicalGirlAnswersDraft', JSON.stringify({
        version: 3,
        answerEntries: [{
          key: `${magicalQuestionnaire.id}::${firstQuestion.id}`,
          question: firstQuestion.question,
          questionId: firstQuestion.id,
          questionnaireId: magicalQuestionnaire.id,
          answer: '保留草稿回答',
        }],
      }));
    }
    const { DetailsPage } = await import('@/components/creation/DetailsPage');
    await act(async () => root.render(<DetailsPage />));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 160)); });
    const logo = container.querySelector('img[alt="Questionnaire Logo"]');
    expect(logo).toBeTruthy();
    expect(logo?.closest('.card')?.firstElementChild?.contains(logo)).toBe(true);
    expect(container.querySelector('h1')?.textContent).toBe('魔法少女问卷生成');
    const start = [...container.querySelectorAll('button')].find((button) => button.textContent === '开始回答问卷');
    expect(start).toBeTruthy();
    await act(async () => start!.click());
    expect(container.querySelector('img[alt="Questionnaire Logo"]')).toBe(logo);
    expect(container.querySelectorAll('img[alt="Questionnaire Logo"]')).toHaveLength(1);
    expect(container.querySelector('textarea.ui-web-questionnaire-answer-input')?.getAttribute('aria-label')).toBe(magicalQuestionnaire.questions[0]!.question);
    expect(container.querySelector<HTMLTextAreaElement>('textarea.ui-web-questionnaire-answer-input')?.value).toBe(withDraft ? '保留草稿回答' : '');
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/generate-'))).toBe(false);
  });
});
