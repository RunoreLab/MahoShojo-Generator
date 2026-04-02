import type {
  CreatorQuestionnaireAnswer,
  CreatorQuestionnaireRef,
} from './types';

import {
  buildQuestionKey,
  type QuestionnaireDefinition,
  type QuestionnaireQuestion,
} from '@/lib/questionnaires';

export interface CreatorQuestionnaireSelection {
  source: 'preset';
  presetId: string;
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
        questionnaireId: item.questionnaireId,
        questionnaireTitle: item.questionnaireTitle,
        questionId: item.question.id,
        question: item.question.question,
        answer,
      },
    ];
  });

export const buildCreatorQuestionnaireRequestData = (
  selectedQuestionnaires: readonly CreatorQuestionnaireSelection[],
  questionnaireAnswers: readonly CreatorQuestionnaireAnswer[]
): {
  questionnaires: CreatorQuestionnaireRef[];
  questionnaireAnswers: CreatorQuestionnaireAnswer[];
} => ({
  questionnaires: selectedQuestionnaires.map((selection) => ({
    questionnaireId: selection.questionnaire.id,
    title: selection.questionnaire.title,
  })),
  questionnaireAnswers: [...questionnaireAnswers],
});
