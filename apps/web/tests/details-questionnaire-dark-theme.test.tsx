import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';

import {
  DETAILS_QUESTIONNAIRE_THEME,
  QuestionnaireQuestionPanel,
} from '@/components/questionnaire/QuestionnaireQuestionPanel';

test('details questionnaire panel uses local dark-mode surface classes', () => {
  const html = renderToStaticMarkup(
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
      answer=""
      answerLength={0}
      prevLabel="返回上题"
      nextButtonContent="下一题"
      onPrev={() => {}}
      onNext={() => {}}
    />
  );

  expect(html).toContain('bg-white/90');
  expect(html).toContain('details-questionnaire-surface');
  expect(html).toContain('details-questionnaire-action');
  expect(html).toContain('details-questionnaire-choice');
});
