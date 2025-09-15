import { CanshouSchema, type CanshouData } from './canshou';
import { MagicalGirlSchema, type MagicalGirlData } from './magical-girl';
import { ScenarioSchema, type ScenarioData } from './scenario';

export type DataCardType = 'character' | 'scenario' | 'canshou';
export type DataCardData = CanshouData | MagicalGirlData | ScenarioData;

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
    // 含有 name 属性，可能是残兽格式
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
    `魔法少女格式: ${magicalGirlResult.error?.message || '未知错误'}`,
    `情景格式: ${scenarioResult.error?.message || '未知错误'}`
  ];

  return {
    success: false,
    error: `无效的文件格式。请确保是有效的角色或情景文件。\\n\\n详细错误信息:\\n${errors.join('\\n')}`
  };
}

// 导出各个 schema 供其他地方使用
export { CanshouSchema, MagicalGirlSchema, ScenarioSchema };
export type { CanshouData, MagicalGirlData, ScenarioData };