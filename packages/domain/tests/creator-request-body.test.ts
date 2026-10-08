import { describe, expect, it } from 'vitest';

import { buildCreatorGenerationRequestBody } from '../src/creator/request-body';
import type { QuestionnaireSelection } from '../src/questionnaire-selection';
import type { QuestionnaireDefinition } from '../src/questionnaire-definition';

const questionnaire: QuestionnaireDefinition = {
  id: 'magical-girl-default',
  title: '魔法少女默认问卷',
  kind: 'magical-girl',
  questions: [
    {
      id: 'q-name',
      question: '你的代号是什么？',
      required: true,
      maxLength: 40,
    },
  ],
};

const selection: QuestionnaireSelection = {
  source: 'preset',
  questionnaire,
  selectionId: 'sel-1',
};

const answers = [
  {
    question: '你的代号是什么？',
    answer: '星尘',
    questionId: 'q-name',
    questionnaireId: 'magical-girl-default',
    questionnaireTitle: '魔法少女默认问卷',
  },
];

describe('buildCreatorGenerationRequestBody（D5.1-G3 请求体共源投影）', () => {
  it('产出与 Web CreatorPage 提交段逐键一致的 canonical body', () => {
    const body = buildCreatorGenerationRequestBody({
      template: 'magical-girl',
      freeformBrief: '偏向治愈系',
      answers,
      selections: [selection],
      allowNativeSignature: true,
      language: '中文',
      buildRules: [
        {
          ruleId: 'arena-trpg-lite',
          version: '1.0.0',
          inputs: { role: 'supporter' },
        },
      ],
      primaryRuleId: 'arena-trpg-lite',
    });

    // 序列化往返比较：断言的是线路上的 JSON 形态（undefined 一律省略）。
    expect(JSON.parse(JSON.stringify(body))).toEqual({
      template: 'magical-girl',
      freeformBrief: '偏向治愈系',
      answers,
      questionnaireSelections: [
        {
          source: 'preset',
          kind: 'magical-girl',
          presetId: 'magical-girl-default',
        },
      ],
      questionnaires: [
        {
          id: 'magical-girl-default',
          title: '魔法少女默认问卷',
          kind: 'magical-girl',
          questions: [
            {
              id: 'q-name',
              question: '你的代号是什么？',
              required: true,
              maxLength: 40,
            },
          ],
        },
      ],
      allowNativeSignature: true,
      language: '中文',
      buildRules: [
        {
          ruleId: 'arena-trpg-lite',
          version: '1.0.0',
          inputs: { role: 'supporter' },
        },
      ],
      primaryRuleId: 'arena-trpg-lite',
    });
  });

  it('无规则时 primaryRuleId 显式携带 null（与 Web 提交语义一致）', () => {
    const body = buildCreatorGenerationRequestBody({
      template: 'general',
      freeformBrief: '',
      answers: [],
      selections: [],
      allowNativeSignature: false,
      language: '中文',
      buildRules: [],
      primaryRuleId: null,
    });

    expect(Object.keys(body)).toEqual([
      'template',
      'freeformBrief',
      'answers',
      'questionnaireSelections',
      'questionnaires',
      'allowNativeSignature',
      'language',
      'buildRules',
      'primaryRuleId',
    ]);
    expect(JSON.parse(JSON.stringify(body)).primaryRuleId).toBeNull();
  });
});
