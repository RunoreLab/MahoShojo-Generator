import {
  normalizeCreatorRequestError,
  validateCreatorRequest,
} from './server';
import type { CreatorRequestInput } from './types';

const CREATOR_CLIENT_VALIDATION_MESSAGES: Record<string, string> = {
  FREEFORM_BRIEF_REQUIRED: '至少填写自由文本、问卷或车卡规则中的一种输入。',
  PRIMARY_RULE_REQUIRED: '已选择车卡规则时必须指定一套主规则。',
  PRIMARY_RULE_NOT_SELECTED: '主规则必须来自当前已启用的车卡规则。',
  RULE_TEMPLATE_UNSUPPORTED: '当前输出模板不支持所选车卡规则。',
  QUESTIONNAIRE_REQUIRED_FOR_RULE: '当前规则必须至少搭配一套问卷才能生成。',
  PRIMARY_RULE_INELIGIBLE: '当前主规则不能作为结构化主规则，请重新选择。',
  BUILD_RULE_VALIDATION_FAILED:
    '车卡规则还有未修正项，请先完成必填项并处理预算问题。',
  BUILD_RULE_PRESET_NOT_FOUND: '所选车卡规则预设不存在，无法继续生成。',
};

export function getCreatorClientValidationMessage(
  input: CreatorRequestInput
): string | null {
  try {
    validateCreatorRequest(input);
    return null;
  } catch (error) {
    const normalized = normalizeCreatorRequestError(error);
    if (!normalized) {
      return '当前输入无效，请检查后重试。';
    }
    return (
      CREATOR_CLIENT_VALIDATION_MESSAGES[normalized.code] ??
      '当前输入无效，请检查后重试。'
    );
  }
}
