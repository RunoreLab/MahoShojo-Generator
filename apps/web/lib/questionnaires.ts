// 问卷定义/流程的领域运行时已迁入共享域层（D5.0e）：@mahoshojo/domain/questionnaire-definition。
// 本文件保留原路径：既有调用点无需改 import；站点素材（logo 预设）仍属 Web 资产。

import {
  buildQuestionnaireAnswerLookup,
  normalizeUserAnswers,
  resolveQuestionnaireAnswerTarget,
  type QuestionnaireAnswerItem,
  type QuestionnaireAnswerLookup,
  type QuestionnaireAnswerMatchInput,
  type QuestionnaireAnswerMatchTarget,
} from '@mahoshojo/domain/questionnaire';

export {
  buildQuestionnaireAnswerLookup,
  normalizeUserAnswers,
  resolveQuestionnaireAnswerTarget,
};
export type {
  QuestionnaireAnswerItem,
  QuestionnaireAnswerLookup,
  QuestionnaireAnswerMatchInput,
  QuestionnaireAnswerMatchTarget,
};

export {
  buildQuestionKey,
  buildQuestionnaireFlow,
  collectQuestionnaireFlowAnswerItems,
  collectStoredQuestionnaireAnswerItems,
  MAX_QUESTIONNAIRE_IMPORT_BYTES,
  normalizeQuestionnaireDefinition,
  parseQuestionnaireDataCardPayload,
  resolveQuestionnaireReferences,
  sanitizeQuestionnaireLogoUrl,
} from '@mahoshojo/domain/questionnaire-definition';
export type {
  QuestionnaireCondition,
  QuestionnaireConditionOperator,
  QuestionnaireDefinition,
  QuestionnaireJumpRule,
  QuestionnaireKind,
  QuestionnaireOption,
  QuestionnairePresetEntry,
  QuestionnaireQuestion,
  QuestionnaireQuestionRef,
  StoredQuestionnaireAnswerItem,
} from '@mahoshojo/domain/questionnaire-definition';

export { DEFAULT_QUESTIONNAIRE_LOGO_BY_KIND, QUESTIONNAIRE_LOGO_PRESETS, type QuestionnaireLogoPreset } from '@mahoshojo/domain/questionnaire-logo';

export {
  compactQuestionnaireAnswerItems,
  extractQuestionTextsFromUserAnswers,
  formatQuestionnaireAnswers,
} from '@mahoshojo/domain/questionnaire';
