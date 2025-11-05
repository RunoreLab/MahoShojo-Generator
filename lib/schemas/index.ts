import { CanshouSchema, type CanshouData } from './canshou';
import { MagicalGirlSchema, type MagicalGirlData } from './magical-girl';
import { ScenarioSchema, type ScenarioData } from './scenario';
import {
  GeneralCharacterSchema,
  type GeneralCharacterData,
  GENERAL_CHARACTER_TEMPLATE_ID
} from './general-character';

export type DataCardType = 'character' | 'canshou' | 'general' | 'scenario';
export type DataCardData = CanshouData | MagicalGirlData | GeneralCharacterData | ScenarioData;

export type TemplateId =
  | typeof GENERAL_CHARACTER_TEMPLATE_ID
  | '魔法少女/心之花/魔法少女（问卷生成）'
  | '魔法少女/心之花/魔法少女（名字生成）'
  | '魔法少女/心之花/残兽（问卷生成）'
  | '魔法少女/心之花/未知'
  | (string & {});

const MAGICAL_GIRL_TEMPLATE_IDS = new Set<string>([
  '魔法少女/心之花/魔法少女（问卷生成）',
  '魔法少女/心之花/魔法少女（名字生成）',
  '魔法少女/心之花/未知'
]);

const CANSHOU_TEMPLATE_IDS = new Set<string>([
  '魔法少女/心之花/残兽（问卷生成）'
]);

export function isMagicalGirl(data: unknown): data is MagicalGirlData {
  if (!data || typeof data !== 'object') return false;

  const record = data as Record<string, unknown>;
  const templateId = typeof record.templateId === 'string' ? record.templateId : undefined;
  if (templateId && MAGICAL_GIRL_TEMPLATE_IDS.has(templateId)) {
    return true;
  }

  return typeof record.codename === 'string';
}

export function isCanshou(data: unknown): data is CanshouData {
  if (!data || typeof data !== 'object') return false;

  const record = data as Record<string, unknown>;
  const templateId = typeof record.templateId === 'string' ? record.templateId : undefined;
  if (templateId && CANSHOU_TEMPLATE_IDS.has(templateId)) {
    return true;
  }

  return typeof record.name === 'string' && !record.codename;
}

export function isGeneralCharacter(data: unknown): data is GeneralCharacterData {
  if (!data || typeof data !== 'object') return false;
  const record = data as Record<string, unknown>;
  return record.templateId === GENERAL_CHARACTER_TEMPLATE_ID && typeof record.name === 'string' && typeof record.content === 'string';
}

export function isScenarioCard(data: unknown): data is ScenarioData {
  if (!data || typeof data !== 'object') return false;
  const record = data as Record<string, unknown>;
  return typeof record.title === 'string' && record.templateId !== GENERAL_CHARACTER_TEMPLATE_ID;
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

  if (contentObj.name) {
    // 含有 name 属性，可能是残兽或通用角色格式
    if (contentObj.templateId === GENERAL_CHARACTER_TEMPLATE_ID || typeof contentObj.content === 'string') {
      return {
        success: false,
        error: `通用角色格式验证失败: ${generalResult.error?.message || '未知错误'}`
      };
    }
    return {
      success: false,
      error: `残兽格式验证失败: ${canshouResult.error?.message || '未知错误'}`
    };
  }
  
  if (contentObj.codename) {
    // 含有 codename 属性，可能是魔法少女格式
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
    `残兽格式: ${canshouResult.error?.message || '未知错误'}`,
    `通用角色格式: ${generalResult.error?.message || '未知错误'}`,
    `魔法少女格式: ${magicalGirlResult.error?.message || '未知错误'}`,
    `情景格式: ${scenarioResult.error?.message || '未知错误'}`
  ];

  return {
    success: false,
    error: `无效的文件格式。请确保是有效的角色或情景文件。\\n\\n详细错误信息:\\n${errors.join('\\n')}`
  };
}

// 导出各个 schema 供其他地方使用
export { CanshouSchema, MagicalGirlSchema, ScenarioSchema, GeneralCharacterSchema, GENERAL_CHARACTER_TEMPLATE_ID };
export type { CanshouData, MagicalGirlData, GeneralCharacterData, ScenarioData };
