import type {
  CreatorPromptInput,
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

/**
 * 创作约束文本：自由说明 + 主规则事实 + 补充规则事实（D5.1-G3 上移共源）。
 * 结构化生成时注入宿主 prompt 的 `creatorPromptText` 槽位；
 * hosted / web / desktop 三侧共用同一份投影。
 */
export function buildCreatorPromptText(input: CreatorPromptInput): string {
  const sections: string[] = [];
  if (input.userIntent) {
    sections.push(`【创作补充要求】\n${input.userIntent}`);
  }
  if (input.buildRuleProjection.primary) {
    sections.push(`【主规则事实】\n${input.buildRuleProjection.primary.summary}`);
  }
  if (input.buildRuleProjection.references.length > 0) {
    sections.push(
      `【补充规则事实】\n${input.buildRuleProjection.references
        .map((reference) => reference.summary)
        .join('\n\n')}`,
    );
  }
  return sections.join('\n\n');
}
