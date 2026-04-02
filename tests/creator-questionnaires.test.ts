import { describe, expect, test } from 'bun:test';

import {
  buildCreatorQuestionnaireAnswerItems,
  buildCreatorQuestionnaireItems,
  buildCreatorQuestionnaireRequestData,
  createCreatorQuestionnaireSelectionFromParsed,
  removeCreatorQuestionnaireAnswersForSelection,
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

const duplicateImportedSelection: CreatorQuestionnaireSelection = {
  source: 'upload',
  presetId: null,
  selectionId: `${questionnaire.id}::duplicate`,
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
          questionnaireSourceId: 'creator-q-1',
          title: '背景问卷',
        },
      ],
      questionnaireAnswers: [
        {
          questionnaireId: 'creator-q-1',
          questionnaireSourceId: 'creator-q-1',
          questionnaireTitle: '背景问卷',
          questionId: 'identity',
          question: '你是谁？',
          answer: '夜巡者',
        },
        {
          questionnaireId: 'creator-q-1',
          questionnaireSourceId: 'creator-q-1',
          questionnaireTitle: '背景问卷',
          questionId: 'goal',
          question: '你想守护什么？',
          answer: '守护图书馆',
        },
      ],
    });
  });

  test('createCreatorQuestionnaireSelectionFromParsed supports upload questionnaire imports', () => {
    const selection = createCreatorQuestionnaireSelectionFromParsed({
      source: 'upload',
      parsed: {
        kind: 'magical-girl',
        title: '上传问卷',
        questions: ['你的名字是？'],
      },
      fallbackKind: 'magical-girl',
      fallbackId: 'creator-upload',
      fallbackTitle: '上传问卷',
      nativeAllowed: false,
    });

    expect(selection).toEqual(
      expect.objectContaining({
        source: 'upload',
        presetId: null,
        questionnaire: expect.objectContaining({
          id: 'creator-upload',
          title: '上传问卷',
        }),
      })
    );
  });

  test('createCreatorQuestionnaireSelectionFromParsed supports pasted questionnaire json', () => {
    const selection = createCreatorQuestionnaireSelectionFromParsed({
      source: 'upload',
      parsed: {
        kind: 'magical-girl',
        id: 'creator-paste',
        title: '粘贴问卷',
        questions: ['你的愿望是什么？'],
      },
      fallbackKind: 'magical-girl',
      fallbackId: 'creator-paste-fallback',
      fallbackTitle: '未命名问卷',
      nativeAllowed: false,
    });

    expect(selection.questionnaire.id).toBe('creator-paste');
    expect(selection.questionnaire.title).toBe('粘贴问卷');
  });

  test('createCreatorQuestionnaireSelectionFromParsed preserves explicit selection ids for draft restore', () => {
    const selection = createCreatorQuestionnaireSelectionFromParsed({
      source: 'upload',
      parsed: {
        kind: 'magical-girl',
        id: 'creator-restore',
        title: '恢复问卷',
        questions: ['你的秘密基地在哪里？'],
      },
      fallbackKind: 'magical-girl',
      fallbackId: 'creator-restore-fallback',
      fallbackTitle: '恢复问卷',
      nativeAllowed: false,
      selectionId: 'creator-restore::draft',
    });

    expect(selection.selectionId).toBe('creator-restore::draft');
    expect(selection.questionnaire.id).toBe('creator-restore');
  });

  test('removeCreatorQuestionnaireAnswersForSelection only removes the targeted duplicate instance', () => {
    const answersByKey = {
      'creator-q-1::identity': '原始实例',
      'creator-q-1::goal': '原始目标',
      'creator-q-1::duplicate::identity': '重复实例',
      'creator-q-1::duplicate::goal': '重复目标',
    };

    expect(
      removeCreatorQuestionnaireAnswersForSelection(answersByKey, selection)
    ).toEqual({
      'creator-q-1::duplicate::identity': '重复实例',
      'creator-q-1::duplicate::goal': '重复目标',
    });
  });

  test('buildCreatorQuestionnaireRequestData preserves selection-level questionnaire ids for duplicate imports', () => {
    const questionnaireItems = buildCreatorQuestionnaireItems([
      selection,
      duplicateImportedSelection,
    ]);
    const questionnaireAnswers = buildCreatorQuestionnaireAnswerItems(
      questionnaireItems,
      {
        'creator-q-1::identity': '原始实例',
        'creator-q-1::duplicate::identity': '重复实例',
      }
    );

    expect(
      buildCreatorQuestionnaireRequestData(
        [selection, duplicateImportedSelection],
        questionnaireAnswers
      )
    ).toEqual({
      questionnaires: [
        {
          questionnaireId: 'creator-q-1',
          questionnaireSourceId: 'creator-q-1',
          title: '背景问卷',
        },
        {
          questionnaireId: 'creator-q-1::duplicate',
          questionnaireSourceId: 'creator-q-1',
          title: '背景问卷',
        },
      ],
      questionnaireAnswers: [
        {
          questionnaireId: 'creator-q-1',
          questionnaireSourceId: 'creator-q-1',
          questionnaireTitle: '背景问卷',
          questionId: 'identity',
          question: '你是谁？',
          answer: '原始实例',
        },
        {
          questionnaireId: 'creator-q-1::duplicate',
          questionnaireSourceId: 'creator-q-1',
          questionnaireTitle: '背景问卷',
          questionId: 'identity',
          question: '你是谁？',
          answer: '重复实例',
        },
      ],
    });
  });
});
