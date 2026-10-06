import { CanshouSchema, type CanshouData } from './canshou';
import {
  BuildStateSchema,
  CreationInputsSchema,
  type BuildState,
  type CreationInputs,
} from './creator-metadata';
import { MagicalGirlSchema, type MagicalGirlData } from './magical-girl';
import { ScenarioSchema, type ScenarioData } from './scenario';
import {
  GeneralCharacterSchema,
  type GeneralCharacterData,
  GENERAL_CHARACTER_TEMPLATE_ID
} from './general-character';
import {
  GeneralScenarioSchema,
  type GeneralScenarioData,
  GENERAL_SCENARIO_TEMPLATE_ID,
} from './general-scenario';
import { NarrativeHistorySchema, type NarrativeHistoryData } from '@mahoshojo/domain/narrative-history';
import { QuestionnaireSchema, type QuestionnaireData } from '@mahoshojo/domain/questionnaire';
import {
  inferCharacterKind,
  inferTemplateId,
  isGeneralCharacterCard,
  isGeneralScenarioCard,
  isScenarioCard as isScenarioCardRecord,
  type CharacterKind,
  type DataCardTemplateId,
} from '@mahoshojo/domain/data-cards';

export type DataCardType = 'character' | 'canshou' | 'general' | 'scenario' | 'history' | 'questionnaire';
export type DataCardData =
  | CanshouData
  | MagicalGirlData
  | GeneralCharacterData
  | ScenarioData
  | GeneralScenarioData
  | NarrativeHistoryData
  | QuestionnaireData;

export type TemplateId = DataCardTemplateId;
export type { CharacterKind };

export function isMagicalGirl(data: unknown): data is MagicalGirlData {
  return inferCharacterKind(data) === 'magical-girl';
}

export function isCanshou(data: unknown): data is CanshouData {
  return inferCharacterKind(data) === 'canshou';
}

export function isGeneralCharacter(data: unknown): data is GeneralCharacterData {
  return isGeneralCharacterCard(data);
}

export function isGeneralScenario(data: unknown): data is GeneralScenarioData {
  // 结构化判定（含 legacy name->title 原地升级语义）由 `@mahoshojo/domain/data-cards` 持有。
  return isGeneralScenarioCard(data);
}

export function isScenarioCard(data: unknown): data is ScenarioData {
  return isScenarioCardRecord(data);
}

export interface ValidationResult {
  success: boolean;
  data?: DataCardData;
  error?: string;
  type?: DataCardType;
}

/**
 * 验证上传的文件内容是否符合指定格式
 * @param content - JSON 内容
 * @returns 验证结果
 */
export function validateDataCard(content: unknown): ValidationResult {
  if (!content || typeof content !== 'object') {
    return {
      success: false,
      error: '无效的文件内容'
    };
  }

  // 尝试验证叙事历史格式（需要优先于情景，因为二者都可能带 title）
  const narrativeHistoryResult = NarrativeHistorySchema.safeParse(content);
  if (narrativeHistoryResult.success) {
    return {
      success: true,
      data: narrativeHistoryResult.data,
      type: 'history'
    };
  }

  // 尝试验证问卷格式
  const questionnaireResult = QuestionnaireSchema.safeParse(content);
  if (questionnaireResult.success) {
    return {
      success: true,
      data: questionnaireResult.data,
      type: 'questionnaire',
    };
  }

  // 尝试验证残兽格式
  const canshouResult = CanshouSchema.safeParse(content);
  if (canshouResult.success) {
    return {
      success: true,
      data: canshouResult.data,
      type: 'canshou'
    };
  }

  // 尝试验证魔法少女格式
  const magicalGirlResult = MagicalGirlSchema.safeParse(content);
  if (magicalGirlResult.success) {
    return {
      success: true,
      data: magicalGirlResult.data,
      type: 'character'
    };
  }

  // 尝试验证通用角色格式
  const generalResult = GeneralCharacterSchema.safeParse(content);
  if (generalResult.success) {
    return {
      success: true,
      data: generalResult.data,
      type: 'general'
    };
  }

  // 尝试验证通用情景格式（仍归类为 scenario 数据卡）
  const generalScenarioResult = GeneralScenarioSchema.safeParse(content);
  if (generalScenarioResult.success) {
    return {
      success: true,
      data: generalScenarioResult.data,
      type: 'scenario'
    };
  }

  // 尝试验证情景格式
  const scenarioResult = ScenarioSchema.safeParse(content);
  if (scenarioResult.success) {
    return {
      success: true,
      data: scenarioResult.data,
      type: 'scenario'
    };
  }

  // 所有验证都失败，根据内容推断文件类型并返回对应错误
  const contentObj = content as any;
  const inferredKind = inferCharacterKind(contentObj);

  if (contentObj?.templateId === 'narrative-history') {
    return {
      success: false,
      error: `叙事历史格式验证失败: ${narrativeHistoryResult.error?.message || '未知错误'}`
    };
  }

  if (contentObj?.templateId === GENERAL_SCENARIO_TEMPLATE_ID) {
    return {
      success: false,
      error: `通用情景格式验证失败: ${generalScenarioResult.error?.message || '未知错误'}`
    };
  }

  if (inferredKind === 'general') {
    return {
      success: false,
      error: `通用角色格式验证失败: ${generalResult.error?.message || '未知错误'}`
    };
  }

  if (inferredKind === 'canshou') {
    return {
      success: false,
      error: `残兽格式验证失败: ${canshouResult.error?.message || '未知错误'}`
    };
  }

  if (inferredKind === 'magical-girl' || contentObj.codename) {
    return {
      success: false,
      error: `魔法少女格式验证失败: ${magicalGirlResult.error?.message || '未知错误'}`
    };
  }
  
  if (contentObj.title) {
    // 含有 title 属性，可能是情景格式
    return {
      success: false,
      error: `情景格式验证失败: ${scenarioResult.error?.message || '未知错误'}`
    };
  }

  // 无法判断文件类型，返回所有错误信息
  const errors = [
    `叙事历史格式: ${narrativeHistoryResult.error?.message || '未知错误'}`,
    `残兽格式: ${canshouResult.error?.message || '未知错误'}`,
    `通用角色格式: ${generalResult.error?.message || '未知错误'}`,
    `魔法少女格式: ${magicalGirlResult.error?.message || '未知错误'}`,
    `通用情景格式: ${generalScenarioResult.error?.message || '未知错误'}`,
    `情景格式: ${scenarioResult.error?.message || '未知错误'}`
  ];

  return {
    success: false,
    error: `无效的文件格式。请确保是有效的角色或情景文件。\\n\\n详细错误信息:\\n${errors.join('\\n')}`
  };
}

// 导出各个 schema 供其他地方使用
export {
  inferCharacterKind,
  inferTemplateId,
  CanshouSchema,
  MagicalGirlSchema,
  ScenarioSchema,
  CreationInputsSchema,
  BuildStateSchema,
  GeneralCharacterSchema,
  GeneralScenarioSchema,
  NarrativeHistorySchema,
  GENERAL_CHARACTER_TEMPLATE_ID,
  GENERAL_SCENARIO_TEMPLATE_ID,
};
export type {
  CanshouData,
  MagicalGirlData,
  GeneralCharacterData,
  ScenarioData,
  GeneralScenarioData,
  NarrativeHistoryData,
  CreationInputs,
  BuildState,
};
