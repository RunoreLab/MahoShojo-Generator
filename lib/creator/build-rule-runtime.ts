import { loadBuildRulePresetById } from './build-rules';

import type { BuildRuleRuntimeResult, BuildRuleValidationSummary } from './types';

type BuildRuleRuntimeInput = {
  ruleId: string;
  inputs: Record<string, unknown>;
};

type PresetField = {
  id: string;
  label?: string;
};

type SpecialtyItem = {
  id: string;
  label: string;
  cost: number;
  groupId: string;
  groupLabel: string;
  description?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asFiniteInteger = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.trunc(value);
};

const getBlock = (preset: Record<string, unknown>, blockId: string): Record<string, unknown> | null => {
  const blocks = Array.isArray(preset.blocks) ? preset.blocks : [];
  const block = blocks.find((item) => isRecord(item) && item.id === blockId);
  return isRecord(block) ? block : null;
};

const getPowerLevel = (preset: Record<string, unknown>, rawValue: unknown): string => {
  const powerLevelBlock = getBlock(preset, 'powerLevel');
  const options = Array.isArray(powerLevelBlock?.options) ? powerLevelBlock.options : [];
  const defaultValue =
    typeof powerLevelBlock?.defaultValue === 'string' && powerLevelBlock.defaultValue.trim()
      ? powerLevelBlock.defaultValue.trim()
      : 'seed';
  const allowed = new Set(
    options
      .filter(isRecord)
      .map((item) => (typeof item.value === 'string' ? item.value.trim() : ''))
      .filter(Boolean)
  );
  const candidate = typeof rawValue === 'string' ? rawValue.trim() : '';
  return candidate && allowed.has(candidate) ? candidate : defaultValue;
};

const getCoreAttributeFields = (preset: Record<string, unknown>): PresetField[] => {
  const block = getBlock(preset, 'coreAttributes');
  const fields = Array.isArray(block?.fields) ? block.fields : [];
  return fields
    .filter(isRecord)
    .map((field) => ({
      id: typeof field.id === 'string' ? field.id.trim() : '',
      label: typeof field.label === 'string' ? field.label.trim() : undefined,
    }))
    .filter((field) => field.id);
};

const normalizeCoreAttributes = (
  preset: Record<string, unknown>,
  rawValue: unknown
): {
  normalized: Record<string, number>;
  issues: string[];
  missingRequiredBlockKeys: string[];
  used: number;
} => {
  const block = getBlock(preset, 'coreAttributes');
  const fields = getCoreAttributeFields(preset);
  const minPerStat = asFiniteInteger(block?.minPerStat) ?? 10;
  const maxPerStat = asFiniteInteger(block?.maxPerStat) ?? 80;
  const rawRecord = isRecord(rawValue) ? rawValue : null;

  const normalized: Record<string, number> = {};
  const issues: string[] = [];
  const missingRequiredBlockKeys: string[] = [];

  if (!rawRecord) {
    missingRequiredBlockKeys.push('coreAttributes');
    issues.push('缺少核心属性输入');
  }

  for (const field of fields) {
    const value = rawRecord ? asFiniteInteger(rawRecord[field.id]) : null;
    if (value === null) {
      normalized[field.id] = 0;
      if (rawRecord) {
        issues.push(`核心属性 ${field.id} 缺失或不是有效数字`);
      }
      continue;
    }

    normalized[field.id] = value;
    if (value < minPerStat || value > maxPerStat) {
      issues.push(`核心属性 ${field.id} 超出允许范围（${minPerStat}-${maxPerStat}）`);
    }
  }

  const used = Object.values(normalized).reduce((sum, value) => sum + value, 0);
  return { normalized, issues, missingRequiredBlockKeys, used };
};

const getSpecialtyItems = (preset: Record<string, unknown>): SpecialtyItem[] => {
  const block = getBlock(preset, 'specialties');
  const groups = Array.isArray(block?.groups) ? block.groups : [];
  const items: SpecialtyItem[] = [];

  groups.filter(isRecord).forEach((group) => {
    const groupId = typeof group.id === 'string' ? group.id.trim() : '';
    const groupLabel = typeof group.label === 'string' ? group.label.trim() : groupId;
    const groupItems = Array.isArray(group.items) ? group.items : [];

    groupItems.filter(isRecord).forEach((item) => {
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      const label = typeof item.label === 'string' ? item.label.trim() : id;
      const cost = asFiniteInteger(item.cost) ?? 0;
      if (!id) return;
      items.push({
        id,
        label,
        cost,
        groupId,
        groupLabel,
        description: typeof item.description === 'string' ? item.description.trim() : undefined,
      });
    });
  });

  return items;
};

const normalizeSpecialties = (
  preset: Record<string, unknown>,
  rawValue: unknown
): {
  normalized: string[];
  issues: string[];
  used: number;
} => {
  const allItems = getSpecialtyItems(preset);
  const itemMap = new Map(allItems.map((item) => [item.id, item]));
  const rawList = Array.isArray(rawValue) ? rawValue : [];
  const normalized = Array.from(
    new Set(
      rawList
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
    )
  );

  const issues: string[] = [];
  let used = 0;
  for (const specialtyId of normalized) {
    const item = itemMap.get(specialtyId);
    if (!item) {
      issues.push(`未知专长：${specialtyId}`);
      continue;
    }
    used += item.cost;
  }

  return { normalized, issues, used };
};

const getBudgetLimit = (
  preset: Record<string, unknown>,
  tableKey: 'attributePointsByLevel' | 'specialtyPointsByLevel',
  powerLevel: string
): number | null => {
  const budgets = isRecord(preset.budgets) ? preset.budgets : null;
  const table = budgets && isRecord(budgets[tableKey]) ? (budgets[tableKey] as Record<string, unknown>) : null;
  if (!table) return null;
  const raw = table[powerLevel];
  if (raw === null) return null;
  return asFiniteInteger(raw);
};

const buildValidationSummary = (args: {
  issues: string[];
  missingRequiredBlockKeys: string[];
  attributePointsUsed: number;
  attributePointsLimit: number | null;
  specialtyPointsUsed: number;
  specialtyPointsLimit: number | null;
}): BuildRuleValidationSummary => {
  const {
    issues,
    missingRequiredBlockKeys,
    attributePointsUsed,
    attributePointsLimit,
    specialtyPointsUsed,
    specialtyPointsLimit,
  } = args;

  return {
    valid: issues.length === 0 && missingRequiredBlockKeys.length === 0,
    issues,
    missingRequiredBlockKeys,
    budget: {
      attributePointsUsed,
      attributePointsLimit,
      specialtyPointsUsed,
      specialtyPointsLimit,
    },
  };
};

export function evaluateBuildRuleState({ ruleId, inputs }: BuildRuleRuntimeInput): BuildRuleRuntimeResult {
  const preset = loadBuildRulePresetById(ruleId) as unknown as Record<string, unknown>;
  const powerLevel = getPowerLevel(preset, inputs.powerLevel);

  const coreAttributes = normalizeCoreAttributes(preset, inputs.coreAttributes);
  const specialties = normalizeSpecialties(preset, inputs.specialties);

  const attributePointsLimit = getBudgetLimit(preset, 'attributePointsByLevel', powerLevel);
  const specialtyPointsLimit = getBudgetLimit(preset, 'specialtyPointsByLevel', powerLevel);

  const issues = [...coreAttributes.issues, ...specialties.issues];
  if (attributePointsLimit !== null && coreAttributes.used > attributePointsLimit) {
    issues.push(`属性点超出预算：已使用 ${coreAttributes.used} / 上限 ${attributePointsLimit}`);
  }
  if (specialtyPointsLimit !== null && specialties.used > specialtyPointsLimit) {
    issues.push(`专长点超出预算：已使用 ${specialties.used} / 上限 ${specialtyPointsLimit}`);
  }

  const STR = coreAttributes.normalized.STR ?? 0;
  const CON = coreAttributes.normalized.CON ?? 0;
  const MAG = coreAttributes.normalized.MAG ?? 0;
  const WILL = coreAttributes.normalized.WILL ?? 0;

  return {
    ruleId,
    version: typeof preset.version === 'string' ? preset.version : '1.0.0',
    blockResults: {
      powerLevel,
      coreAttributes: coreAttributes.normalized,
      specialties: specialties.normalized,
    },
    derived: {
      HP: Math.ceil((STR + CON) / 10),
      MP: Math.ceil(MAG / 4),
      Radiance: Math.ceil(WILL / 5),
    },
    validationSummary: buildValidationSummary({
      issues,
      missingRequiredBlockKeys: coreAttributes.missingRequiredBlockKeys,
      attributePointsUsed: coreAttributes.used,
      attributePointsLimit,
      specialtyPointsUsed: specialties.used,
      specialtyPointsLimit,
    }),
  };
}
