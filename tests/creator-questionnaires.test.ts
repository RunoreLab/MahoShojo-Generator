import { describe, expect, test } from 'bun:test';

import {
  buildCreatorQuestionnaireAnswerItems,
  buildCreatorQuestionnaireItems,
  buildCreatorQuestionnaireRequestData,
  type CreatorQuestionnaireSelection,
} from '@/lib/creator/questionnaires';
import {
  buildQuestionnaireFlow,
  normalizeQuestionnaireDefinition,
  resolveQuestionnaireReferences,
} from '@/lib/questionnaires';

const questionnaire = normalizeQuestionnaireDefinition({
  id: 'creator-q-1',
  kind: 'magical-girl',
  title: '背景问卷',
  questions: [
    {
      id: 'identity',
      question: '你是谁？',
      required: true,
    },
    {
      id: 'goal',
      question: '你想守护什么？',
      required: false,
    },
  ],
});

if (!questionnaire) {
  throw new Error('failed to create test questionnaire');
}

const selection: CreatorQuestionnaireSelection = {
  source: 'preset',
  presetId: 'magical-girl-default',
  selectionId: questionnaire.id,
  questionnaire,
};

describe('creator questionnaire helpers', () => {
  test('buildCreatorQuestionnaireItems creates stable question keys from selected questionnaires', () => {
    expect(buildCreatorQuestionnaireItems([selection])).toEqual([
      expect.objectContaining({
        key: 'creator-q-1::identity',
        questionnaireId: 'creator-q-1',
        questionnaireTitle: '背景问卷',
      }),
      expect.objectContaining({
        key: 'creator-q-1::goal',
        questionnaireId: 'creator-q-1',
        questionnaireTitle: '背景问卷',
      }),
    ]);
  });

  test('buildCreatorQuestionnaireRequestData returns questionnaire refs and answered items', () => {
    const questionnaireItems = buildCreatorQuestionnaireItems([selection]);
    const resolvedItems = resolveQuestionnaireReferences(questionnaireItems);
    const { flow } = buildQuestionnaireFlow(resolvedItems, {
      'creator-q-1::identity': '夜巡者',
      'creator-q-1::goal': '守护图书馆',
    });
    const questionnaireAnswers = buildCreatorQuestionnaireAnswerItems(flow, {
      'creator-q-1::identity': '夜巡者',
      'creator-q-1::goal': '守护图书馆',
    });

    expect(
      buildCreatorQuestionnaireRequestData([selection], questionnaireAnswers)
    ).toEqual({
      questionnaires: [
        {
          questionnaireId: 'creator-q-1',
          title: '背景问卷',
        },
      ],
      questionnaireAnswers: [
        {
          questionnaireId: 'creator-q-1',
          questionnaireTitle: '背景问卷',
          questionId: 'identity',
          question: '你是谁？',
          answer: '夜巡者',
        },
        {
          questionnaireId: 'creator-q-1',
          questionnaireTitle: '背景问卷',
          questionId: 'goal',
          question: '你想守护什么？',
          answer: '守护图书馆',
        },
      ],
    });
  });
});
