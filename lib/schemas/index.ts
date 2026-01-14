import { CanshouSchema, type CanshouData } from './canshou';
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
import { NarrativeHistorySchema, type NarrativeHistoryData } from './narrative-history';

export type DataCardType = 'character' | 'canshou' | 'general' | 'scenario' | 'history';
export type DataCardData = CanshouData | MagicalGirlData | GeneralCharacterData | ScenarioData | GeneralScenarioData | NarrativeHistoryData;

export type TemplateId =
  | typeof GENERAL_CHARACTER_TEMPLATE_ID
  | typeof GENERAL_SCENARIO_TEMPLATE_ID
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

const MAGICAL_SIGNATURE_KEYS = ['magicConstruct', 'wonderlandRule', 'blooming', 'analysis'] as const;
const CANSHOU_SIGNATURE_KEYS = [
  'materialAndSkin',
  'featuresAndAppendages',
  'coreConcept',
  'coreEmotion',
  'evolutionStage',
  'attackMethod',
  'specialAbility',
  'origin',
  'birthEnvironment',
  'researcherNotes',
  'appearance'
] as const;

export type CharacterKind = 'magical-girl' | 'canshou' | 'general' | 'unknown';

/**
 * 根据字段特征推断角色类型，用于补全 templateId 或容错解析。
 * 推断顺序：显式模板 > 通用角色 content 字段 > 魔法少女特征 > 残兽特征 > 名字兜底通用角色。
 */
export function inferCharacterKind(data: unknown): CharacterKind {
  if (!data || typeof data !== 'object') return 'unknown';
  const record = data as Record<string, unknown>;

  const templateId = typeof record.templateId === 'string' ? record.templateId : undefined;
  if (templateId === GENERAL_CHARACTER_TEMPLATE_ID) return 'general';
  if (templateId === GENERAL_SCENARIO_TEMPLATE_ID) return 'unknown';
  if (templateId && MAGICAL_GIRL_TEMPLATE_IDS.has(templateId)) return 'magical-girl';
  if (templateId && CANSHOU_TEMPLATE_IDS.has(templateId)) return 'canshou';

  if (typeof record.content === 'string') return 'general';

  const hasMagicalSignature =
    typeof record.codename === 'string' ||
    MAGICAL_SIGNATURE_KEYS.some(key => record[key] !== undefined);
  if (hasMagicalSignature) return 'magical-girl';

  const hasCanshouSignature =
    typeof record.name === 'string' &&
    !record.codename &&
    CANSHOU_SIGNATURE_KEYS.some(key => record[key] !== undefined);
  if (hasCanshouSignature) return 'canshou';

  if (typeof record.name === 'string' && !record.codename) {
    // 缺少 templateId 且信息稀少时，优先视为通用角色而非残兽。
    return 'general';
  }

  return 'unknown';
}

/**
 * 为缺失 templateId 的旧数据补充模板标记。
 */
export function inferTemplateId(record: Record<string, unknown>): TemplateId {
  const kind = inferCharacterKind(record);
  if (kind === 'magical-girl') {
    const hasConstruct = record && typeof (record as any).magicConstruct !== 'undefined';
    return hasConstruct
      ? '魔法少女/心之花/魔法少女（问卷生成）'
      : '魔法少女/心之花/魔法少女（名字生成）';
  }
  if (kind === 'canshou') return '魔法少女/心之花/残兽（问卷生成）';
  if (kind === 'general') return GENERAL_CHARACTER_TEMPLATE_ID;
  return '魔法少女/心之花/未知';
}

export function isMagicalGirl(data: unknown): data is MagicalGirlData {
  return inferCharacterKind(data) === 'magical-girl';
}

export function isCanshou(data: unknown): data is CanshouData {
  return inferCharacterKind(data) === 'canshou';
}

export function isGeneralCharacter(data: unknown): data is GeneralCharacterData {
  if (!data || typeof data !== 'object') return false;
  const record = data as Record<string, unknown>;
  return record.templateId === GENERAL_CHARACTER_TEMPLATE_ID && typeof record.name === 'string' && typeof record.content === 'string';
}

export function isGeneralScenario(data: unknown): data is GeneralScenarioData {
  if (!data || typeof data !== 'object') return false;
  const record = data as Record<string, unknown>;

  if (record.templateId !== GENERAL_SCENARIO_TEMPLATE_ID) return false;
  if (typeof record.content !== 'string') return false;

  if (typeof record.title === 'string') return true;

  // 兼容旧版通用情景卡：name -> title（原地升级，便于后续逻辑统一读取 title）
  if (typeof record.name === 'string') {
    record.title = record.name;
    delete record.name;
    return true;
  }

  return false;
}

export function isScenarioCard(data: unknown): data is ScenarioData {
  if (!data || typeof data !== 'object') return false;
  const record = data as Record<string, unknown>;
  if (typeof record.title !== 'string') return false;
  if (record.templateId === GENERAL_CHARACTER_TEMPLATE_ID) return false;
  if (record.templateId === GENERAL_SCENARIO_TEMPLATE_ID) return false;
  if (record.templateId === 'narrative-history') return false;
  return typeof record.elements === 'object' && record.elements !== null;
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
  CanshouSchema,
  MagicalGirlSchema,
  ScenarioSchema,
  GeneralCharacterSchema,
  GeneralScenarioSchema,
  NarrativeHistorySchema,
  GENERAL_CHARACTER_TEMPLATE_ID,
  GENERAL_SCENARIO_TEMPLATE_ID,
};
export type { CanshouData, MagicalGirlData, GeneralCharacterData, ScenarioData, GeneralScenarioData, NarrativeHistoryData };
