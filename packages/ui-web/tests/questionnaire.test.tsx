// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test } from 'vitest';

import {
  DETAILS_QUESTIONNAIRE_THEME,
  QuestionnaireQuestionPanel,
} from '../src/questionnaire/index';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(() => act(() => root.unmount()));

const render = (node: ReactNode) => act(() => root.render(node));

test('details questionnaire panel retains its shared dark-theme classes and answer controls', () => {
  render(
    <QuestionnaireQuestionPanel
      theme={DETAILS_QUESTIONNAIRE_THEME}
      progressLabel="问题 1 / 1"
      progressPercent={100}
      questionText="你的愿望是什么？"
      noticeText="请作答"
      isRequired={false}
      skipText="可跳过"
      quickOptions={['跳过']}
      options={[{ value: 'a', label: '选项 A' }]}
      optionsHintText="选择一个答案"
      suggestions={['灵感']}
      showTextInput
      answer="答案"
      answerLength={2}
      prevLabel="返回上题"
      nextButtonContent="下一题"
      onPrev={() => {}}
      onNext={() => {}}
    />,
  );
  const html = container.innerHTML;

  expect(html).toContain('bg-white/90');
  expect(html).toContain('details-questionnaire-surface');
  expect(html).toContain('details-questionnaire-action');
  expect(html).toContain('details-questionnaire-choice');
  expect(html).toContain('<textarea class="input-field min-h-[6rem] resize-y">答案</textarea>');
  expect(html).toContain('返回上题');
  expect(html).toContain('下一题');
});
