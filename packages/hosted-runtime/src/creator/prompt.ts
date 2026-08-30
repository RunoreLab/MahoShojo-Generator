import type {
  CreatorQuestionnaireAnswer,
  CreatorQuestionnaireRef,
  CreatorRequestInput,
} from './types';

const normalizeFreeformBrief = (freeformBrief?: string | null): string =>
  typeof freeformBrief === 'string' ? freeformBrief.trim() : '';

const summarizeQuestionnaireList = (questionnaires: CreatorQuestionnaireRef[]): string => {
  if (questionnaires.length === 0) {
    return '';
  }

  return questionnaires
    .map((questionnaire, index) => questionnaire.title ?? questionnaire.questionnaireId ?? `问卷 ${index + 1}`)
    .join('、');
};

const summarizeQuestionnaireAnswers = (answers: CreatorQuestionnaireAnswer[]): string => {
  if (answers.length === 0) {
    return '';
  }

  return answers
    .map((answer, index) => {
      const label = answer.questionnaireId ?? `问卷 ${index + 1}`;
      const question = typeof answer.question === 'string' ? answer.question.trim() : '';
      const content = typeof answer.answer === 'string' ? answer.answer.trim() : '';
      if (question && content) {
        return `- [${label}] ${question}: ${content}`;
      }
      if (content) {
        return `- [${label}] ${content}`;
      }
      return '';
    })
    .filter((line) => line.length > 0)
    .join('\n');
};

export function buildCreatorUserIntent(input: Pick<CreatorRequestInput, 'freeformBrief'>): string {
  return normalizeFreeformBrief(input.freeformBrief);
}

export function summarizeQuestionnaires(
  questionnaires: CreatorQuestionnaireRef[],
  questionnaireAnswers: CreatorQuestionnaireAnswer[] = []
): string {
  const sections: string[] = [];
  const questionnaireList = summarizeQuestionnaireList(questionnaires);
  if (questionnaireList) {
    sections.push(`已选问卷：${questionnaireList}`);
  }

  const answers = summarizeQuestionnaireAnswers(questionnaireAnswers);
  if (answers) {
    sections.push(`问卷回答：\n${answers}`);
  }

  return sections.join('\n\n');
}
