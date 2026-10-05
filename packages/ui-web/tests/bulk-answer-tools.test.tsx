// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { BulkAnswerTools } from '../src/details-controls/index';
import type { QuestionnaireAnswerMatchTarget } from '@mahoshojo/domain/questionnaire';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(() => act(() => root.unmount()));

const render = (node: ReactNode) => act(() => root.render(node));

const targets: QuestionnaireAnswerMatchTarget[] = [
  { key: 'q::1', index: 0, question: '第一题', questionId: 'MG-1' },
  { key: 'q::2', index: 1, question: '第二题', questionId: 'MG-2' },
];

const setTextarea = async (value: string) => {
  const textarea = container.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('BulkAnswerTools shared handlers', () => {
  test('bulk fill parses Q/A text, applies by visible index and reports stats', async () => {
    const onApply = vi.fn();
    const onInfo = vi.fn();
    render(
      <BulkAnswerTools
        targets={targets}
        answersByKey={{}}
        onApplyAnswers={onApply}
        onInfo={onInfo}
        open
      />,
    );
    await setTextarea('Q1: 第一题\nA: 守护\nQ2: 第二题\nA: 蓝');
    await act(async () => {
      [...container.querySelectorAll('button')].find((b) => b.textContent === '填充')!.click();
    });
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]![0]).toMatchObject({ 'q::1': '守护', 'q::2': '蓝' });
    expect(onInfo.mock.calls[0]![0]).toContain('成功填充了 2 个答案');
  });

  test('bulk fill reports unrecognized input via onError and keeps state', async () => {
    const onApply = vi.fn();
    const onError = vi.fn();
    render(
      <BulkAnswerTools
        targets={targets}
        answersByKey={{}}
        onApplyAnswers={onApply}
        onError={onError}
        open
      />,
    );
    await setTextarea('   ');
    await act(async () => {
      [...container.querySelectorAll('button')].find((b) => b.textContent === '填充')!.click();
    });
    expect(onApply).not.toHaveBeenCalled();
    expect(onError.mock.calls[0]![0]).toContain('未识别到可填充的答案');
  });

  test('character card import applies entries through file input with merge mode', async () => {
    const onApply = vi.fn();
    const onInfo = vi.fn();
    render(
      <BulkAnswerTools
        targets={targets}
        answersByKey={{ 'q::1': '已有答案' }}
        onApplyAnswers={onApply}
        onInfo={onInfo}
        open
      />,
    );
    const file = new File(
      [JSON.stringify({ userAnswers: [{ question: '第一题', answer: '导入答案' }, { question: '第二题', answer: '第二答案' }] })],
      'card.json',
      { type: 'application/json' },
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onApply).toHaveBeenCalledTimes(1);
    // 默认 fill-empty：已有答案保留，空题导入。
    expect(onApply.mock.calls[0]![0]).toMatchObject({ 'q::1': '已有答案', 'q::2': '第二答案' });
    expect(onInfo.mock.calls[0]![0]).toContain('已从角色卡 userAnswers导入问卷答案');
  });
});
