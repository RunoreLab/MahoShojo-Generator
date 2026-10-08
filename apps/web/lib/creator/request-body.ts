import {
  buildCreatorGenerationRequestBody,
  type CreatorGenerationRequestBody,
} from '@mahoshojo/domain/creator/request-body';
import type { CreatorTemplateId } from '@mahoshojo/domain/creator/templates';
import type { BuildRuleRequestInput } from '@mahoshojo/domain/creator/types';
import type { QuestionnaireAnswerItem } from '@mahoshojo/domain/questionnaire';
import type { QuestionnaireSelection } from '@mahoshojo/domain/questionnaire-selection';

import type { CustomProviderPayload } from '@/lib/ai/custom-provider';

/**
 * `/api/creator/generate(-stream)` 提交请求体装配（G3-r1 共源收口）：
 * 业务字段走 domain `buildCreatorGenerationRequestBody`（与 Desktop hosted
 * 通路同一函数、同一键序），Web 特有的 `customProvider`（BYOK 凭据）
 * 由本层在展开后追加——Desktop 渲染进程不承担该字段。
 */
export type WebCreatorGenerationRequestBody = CreatorGenerationRequestBody & {
  customProvider: CustomProviderPayload | undefined;
};

export const buildWebCreatorGenerationRequestBody = (input: {
  template: CreatorTemplateId;
  freeformBrief: string;
  answers: readonly QuestionnaireAnswerItem[];
  selections: readonly QuestionnaireSelection[];
  allowNativeSignature: boolean;
  language: string;
  buildRules: readonly BuildRuleRequestInput[];
  primaryRuleId: string | null;
  customProvider: CustomProviderPayload | undefined;
}): WebCreatorGenerationRequestBody => ({
  ...buildCreatorGenerationRequestBody(input),
  customProvider: input.customProvider,
});
