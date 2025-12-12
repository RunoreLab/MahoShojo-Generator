'use client';

import {
  getCombatantDisplayName,
  inferCombatantType,
  isLegacyAdjudicatorFormat,
  validateCanshouData,
  validateGeneralCharacterData,
  validateMagicalGirlData,
} from './characterValidator';

import { MAX_COMBATANTS, CombatantData } from '../types';

export interface ParseOptions {
  existingCount: number;
  onWarn?: (message: string) => void;
  onError?: (message: string) => void;
  onAdjudicationEvents?: (events: unknown, label: string) => void;
  verifyOrigin?: (payload: any) => Promise<boolean>;
}

const readJsonArray = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    const sanitized = `[${text.trim().replace(/}\s*{/g, '},{')}]`;
    return JSON.parse(sanitized);
  }
};

export const parseCombatantsFromText = async (text: string, options: ParseOptions): Promise<CombatantData[]> => {
  const parsed = readJsonArray(text);
  const dataArray = Array.isArray(parsed) ? parsed : [parsed];

  if (dataArray.length + options.existingCount > MAX_COMBATANTS) {
    throw new Error(`队伍将超出 ${MAX_COMBATANTS} 位上限！`);
  }

  const combatants: CombatantData[] = [];

  for (const item of dataArray) {
    const type = inferCombatantType(item);
    const label = getCombatantDisplayName(item);
    let validationResult;

    try {
      if (type === 'magical-girl') {
        validationResult = validateMagicalGirlData(item);
      } else if (type === 'canshou') {
        validationResult = validateCanshouData(item);
      } else {
        validationResult = validateGeneralCharacterData(item);
      }

      if (!validationResult.success) {
        throw new Error(validationResult.errors?.[0] || '格式验证失败');
      }

      validationResult.warnings?.forEach((warning) => options.onWarn?.(`✔️ 文件 "${label}"：${warning}`));

      if (Array.isArray((item as Record<string, unknown>).adjudicationEvents)) {
        const events = (item as Record<string, unknown>).adjudicationEvents as unknown[];
        if (isLegacyAdjudicatorFormat(events as any[])) {
          options.onWarn?.(`⚠️ 文件 "${label}" 包含旧版随机事件，已忽略。`);
        } else {
          options.onAdjudicationEvents?.(events, label);
        }
      }

      const isValid = options.verifyOrigin ? await options.verifyOrigin(item) : false;
      const wasCorrected = Boolean(validationResult.warnings?.length);
      combatants.push({
        type,
        data: validationResult.data ?? item,
        filename: label,
        isValid,
        isPreset: false,
        isNonStandard: false,
        wasCorrected,
      });
    } catch (error) {
      if (item && (item.codename || item.name || item.content)) {
        options.onWarn?.(`✔️ 文件 "${label}" 格式不完全规范，已通过兼容模式加载。`);
        combatants.push({
          type,
          data: item,
          filename: label,
          isValid: false,
          isPreset: false,
          isNonStandard: true,
        });
      } else {
        options.onError?.(error instanceof Error ? error.message : '未知错误');
        throw error;
      }
    }
  }

  return combatants;
};
