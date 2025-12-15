import { inferTemplate } from '@/lib/data-card-converter';
import { GeneralCharacterSchema } from '@/lib/schemas';

import { CombatantType } from '../types';
import { CanshouSchema, MagicalGirlSchema } from '@/lib/schemas';

const MAGICAL_GIRL_CORE_FIELDS = {
  appearance: ['outfit', 'accessories', 'colorScheme', 'overallLook'],
  magicConstruct: ['name', 'form', 'basicAbilities', 'description'],
  wonderlandRule: ['name', 'description', 'tendency', 'activation'],
  blooming: ['name', 'evolvedAbilities', 'evolvedForm', 'evolvedOutfit', 'powerLevel'],
  analysis: ['personalityAnalysis', 'abilityReasoning', 'coreTraits', 'predictionBasis'],
};

export interface ValidationResult<T = any> {
  success: boolean;
  data?: T;
  warnings?: string[];
  errors?: string[];
}

export const getCombatantDisplayName = (data: any): string => {
  if (!data) return '未命名';
  return data.codename || data.name || data.title || '未命名';
};

export const inferCombatantType = (data: any): CombatantType => {
  const template = inferTemplate(data);
  switch (template) {
    case 'magical-girl':
      return 'magical-girl';
    case 'canshou':
      return 'canshou';
    case 'general':
      return 'general-character';
    default:
      if (data?.codename) return 'magical-girl';
      if (data?.name) return 'canshou';
      return 'general-character';
  }
};

const cloneData = <T>(data: T): T => JSON.parse(JSON.stringify(data));

export const normalizeMagicalGirlStructure = (payload: any): { normalized: any; warnings: string[] } => {
  const normalized = cloneData(payload);
  const warnings: string[] = [];

  if (normalized.name && !normalized.codename) {
    normalized.codename = normalized.name;
  }

  for (const key of Object.keys(MAGICAL_GIRL_CORE_FIELDS)) {
    if (normalized[key] === undefined) {
      const subKeys = MAGICAL_GIRL_CORE_FIELDS[key as keyof typeof MAGICAL_GIRL_CORE_FIELDS];
      const allExist = subKeys.every((child) => normalized[child] !== undefined);
      if (allExist) {
        warnings.push(`检测到缺失的顶层 "${key}"，子字段已被自动整理。`);
        normalized[key] = {};
        subKeys.forEach((child) => {
          normalized[key][child] = normalized[child];
          delete normalized[child];
        });
      }
    }
  }

  return { normalized, warnings };
};

const formatIssues = (issues: Array<{ message?: string }>): string[] =>
  issues.map((issue) => issue.message || '格式校验失败');

export const validateMagicalGirlData = (data: any): ValidationResult => {
  const { normalized, warnings } = normalizeMagicalGirlStructure(data);
  const result = MagicalGirlSchema.safeParse(normalized);
  if (!result.success) {
    return {
      success: false,
      errors: formatIssues(result.error.issues),
      warnings,
    };
  }

  return {
    success: true,
    data: result.data,
    warnings,
  };
};

export const validateCanshouData = (data: any): ValidationResult => {
  const result = CanshouSchema.safeParse(data);
  if (!result.success) {
    return {
      success: false,
      errors: formatIssues(result.error.issues),
    };
  }
  return {
    success: true,
    data: result.data,
  };
};

export const validateGeneralCharacterData = (data: any): ValidationResult => {
  const result = GeneralCharacterSchema.safeParse(data);
  if (!result.success) {
    return {
      success: false,
      errors: formatIssues(result.error.issues),
    };
  }
  return {
    success: true,
    data: result.data,
  };
};

export const isLegacyAdjudicatorFormat = (events: any[]): boolean => {
  if (!Array.isArray(events) || events.length === 0) {
    return false;
  }
  const firstEvent = events[0];
  return (
    typeof firstEvent === 'object' &&
    firstEvent !== null &&
    typeof firstEvent.event === 'string' &&
    typeof firstEvent.probability === 'number' &&
    typeof firstEvent.type === 'undefined'
  );
};
