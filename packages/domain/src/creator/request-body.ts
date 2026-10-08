import type { QuestionnaireAnswerItem } from '../questionnaire';
import {
  buildQuestionnaireGenerationRequestFields,
  type QuestionnaireGenerationQuestionnaireField,
  type QuestionnaireGenerationSelectionField,
  type QuestionnaireSelection,
} from '../questionnaire-selection';

import type { CreatorTemplateId } from './templates';
import type { BuildRuleRequestInput } from './types';

/**
 * `/api/creator/generate(-stream)` 业务请求体的共源组装（D5.1-G3）。
 *
 * Web 与 Desktop hosted 通路都从同一组输入产出同一 JSON 投影——键序固定为
 * template → freeformBrief → answers → questionnaireSelections → questionnaires
 * → allowNativeSignature → language → buildRules → primaryRuleId，
 * 与 Web CreatorPage 提交段保持逐键对拍。宿主特有字段（如 Web 的
 * `customProvider`）由调用方在展开后追加，本函数不承担。
 *
 * `primaryRuleId` 与 Web 一致始终显式携带（无规则时为 `null`）：服务端
 * 校验区分 null/undefined/string，缺 `undefined` 字段语义与 Web 不同。
 */
export interface CreatorGenerationRequestBody {
  template: CreatorTemplateId;
  freeformBrief: string;
  answers: QuestionnaireAnswerItem[];
  questionnaireSelections: QuestionnaireGenerationSelectionField[];
  questionnaires: QuestionnaireGenerationQuestionnaireField[];
  allowNativeSignature: boolean;
  language: string;
  buildRules: BuildRuleRequestInput[];
  primaryRuleId: string | null;
}

export const buildCreatorGenerationRequestBody = (input: {
  template: CreatorTemplateId;
  freeformBrief: string;
  answers: readonly QuestionnaireAnswerItem[];
  selections: readonly QuestionnaireSelection[];
  allowNativeSignature: boolean;
  language: string;
  buildRules: readonly BuildRuleRequestInput[];
  primaryRuleId: string | null;
}): CreatorGenerationRequestBody => ({
  template: input.template,
  freeformBrief: input.freeformBrief,
  answers: input.answers.map((answer) => ({ ...answer })),
  ...buildQuestionnaireGenerationRequestFields(input.selections),
  allowNativeSignature: input.allowNativeSignature === true,
  language: input.language,
  buildRules: input.buildRules.map((rule) => ({
    ruleId: rule.ruleId,
    ...(rule.version !== undefined ? { version: rule.version } : {}),
    inputs: { ...rule.inputs },
  })),
  primaryRuleId: input.primaryRuleId,
});
