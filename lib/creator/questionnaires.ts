import type {
  CreatorQuestionnaireAnswer,
  CreatorQuestionnaireRef,
} from './types';

import {
  buildQuestionKey,
  normalizeQuestionnaireDefinition,
  type QuestionnaireDefinition,
  type QuestionnaireKind,
  type QuestionnaireQuestion,
} from '@/lib/questionnaires';

export type CreatorQuestionnaireSelectionSource = 'preset' | 'upload';

export interface CreatorQuestionnaireSelection {
  source: CreatorQuestionnaireSelectionSource;
  presetId: string | null;
  selectionId: string;
  questionnaire: QuestionnaireDefinition;
}

export interface CreatorQuestionnaireContextItem {
  key: string;
  questionnaireId: string;
  questionnaireScopeId: string;
  questionnaireTitle: string;
  indexInQuestionnaire: number;
  question: QuestionnaireQuestion;
}

export interface CreateCreatorQuestionnaireSelectionFromParsedParams {
  source: CreatorQuestionnaireSelectionSource;
  parsed: unknown;
  fallbackKind: QuestionnaireKind;
  fallbackId: string;
  fallbackTitle: string;
  nativeAllowed: boolean | null;
  presetId?: string | null;
  selectionId?: string | null;
}

export const createCreatorQuestionnaireSelectionFromParsed = ({
  source,
  parsed,
  fallbackKind,
  fallbackId,
  fallbackTitle,
  nativeAllowed,
  presetId = null,
  selectionId = null,
}: CreateCreatorQuestionnaireSelectionFromParsedParams): CreatorQuestionnaireSelection => {
  const normalized = normalizeQuestionnaireDefinition(parsed, {
    fallbackKind,
    fallbackId,
    fallbackTitle,
    nativeAllowed,
  });

  if (!normalized) {
    throw new Error(
      source === 'preset' ? '预设问卷解析失败' : '问卷 JSON 无法识别，请检查格式'
    );
  }

  return {
    source,
    presetId,
    selectionId:
      typeof selectionId === 'string' && selectionId.trim().length > 0
        ? selectionId.trim()
        : normalized.id,
    questionnaire: normalized,
  };
};

export const buildCreatorQuestionnaireItems = (
  selectedQuestionnaires: readonly CreatorQuestionnaireSelection[]
): CreatorQuestionnaireContextItem[] =>
  selectedQuestionnaires.flatMap((selection) =>
    selection.questionnaire.questions.map((question, index) => ({
      key: buildQuestionKey(selection.selectionId, question.id, index),
      questionnaireId: selection.questionnaire.id,
      questionnaireScopeId: selection.selectionId,
      questionnaireTitle: selection.questionnaire.title,
      indexInQuestionnaire: index,
      question,
    }))
  );

export const buildCreatorQuestionnaireAnswerItems = (
  flow: readonly CreatorQuestionnaireContextItem[],
  answersByKey: Record<string, string>
): CreatorQuestionnaireAnswer[] =>
  flow.flatMap((item) => {
    const answer = answersByKey[item.key];
    if (typeof answer !== 'string' || answer.trim().length === 0) {
      return [];
    }

    return [
      {
        questionnaireId: item.questionnaireScopeId,
        questionnaireSourceId: item.questionnaireId,
        questionnaireTitle: item.questionnaireTitle,
        questionId: item.question.id,
        question: item.question.question,
        answer,
      },
    ];
  });

export const removeCreatorQuestionnaireAnswersForSelection = (
  answersByKey: Record<string, string>,
  selection: Pick<CreatorQuestionnaireSelection, 'selectionId' | 'questionnaire'>
): Record<string, string> => {
  const selectionKeys = new Set(
    selection.questionnaire.questions.map((question, index) =>
      buildQuestionKey(selection.selectionId, question.id, index)
    )
  );

  return Object.fromEntries(
    Object.entries(answersByKey).filter(([key]) => !selectionKeys.has(key))
  );
};

export const buildCreatorQuestionnaireRequestData = (
  selectedQuestionnaires: readonly CreatorQuestionnaireSelection[],
  questionnaireAnswers: readonly CreatorQuestionnaireAnswer[]
): {
  questionnaires: CreatorQuestionnaireRef[];
  questionnaireAnswers: CreatorQuestionnaireAnswer[];
} => ({
  questionnaires: selectedQuestionnaires.map((selection) => ({
    questionnaireId: selection.selectionId,
    questionnaireSourceId: selection.questionnaire.id,
    title: selection.questionnaire.title,
  })),
  questionnaireAnswers: [...questionnaireAnswers],
});
