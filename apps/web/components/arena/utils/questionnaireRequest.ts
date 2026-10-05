import type { QuestionnaireSelection } from '../types';

/** 单人和多人共用的请求投影：缺省字段不写入对象，兼容严格 JSON 校验。 */
export const buildArenaQuestionnaireRequest = (selections: readonly QuestionnaireSelection[]) => ({
  questionnaireSelections: selections.length > 0 ? selections.map((selection) => ({
    source: selection.source,
    kind: selection.questionnaire.kind,
    ...(selection.source === 'preset' ? { presetId: selection.questionnaire.id } : {}),
    ...(selection.source === 'database' && selection.dataCardId !== undefined
      ? { dataCardId: selection.dataCardId } : {}),
    ...(selection.useLore === false ? { useLore: false } : {}),
  })) : undefined,
  questionnaires: selections.length > 0 ? selections.map((selection) => ({
    id: selection.questionnaire.id,
    title: selection.questionnaire.title,
    kind: selection.questionnaire.kind,
    ...(selection.useLore === false ? { useLore: false } : {}),
    ...(selection.questionnaire.loreMarkdown != null
      ? { loreMarkdown: selection.questionnaire.loreMarkdown } : {}),
  })) : undefined,
});
