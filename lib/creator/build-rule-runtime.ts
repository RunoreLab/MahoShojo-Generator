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

const getBlocks = (preset: Record<string, unknown>): Record<string, unknown>[] => {
  const blocks = Array.isArray(preset.blocks) ? preset.blocks : [];
  return blocks.filter(isRecord);
};

const getSelectValue = (block: Record<string, unknown>, rawValue: unknown): string => {
  const options = Array.isArray(block.options) ? block.options : [];
  const defaultValue =
    typeof block.defaultValue === 'string' && block.defaultValue.trim()
      ? block.defaultValue.trim()
      : options
          .filter(isRecord)
          .map((item) => (typeof item.value === 'string' ? item.value.trim() : ''))
          .find(Boolean) ?? '';
  const allowed = new Set(
    options
      .filter(isRecord)
      .map((item) => (typeof item.value === 'string' ? item.value.trim() : ''))
      .filter(Boolean)
  );
  const candidate = typeof rawValue === 'string' ? rawValue.trim() : '';

  return candidate && allowed.has(candidate) ? candidate : defaultValue;
};

const getSelectedOption = (block: Record<string, unknown>, value: string): Record<string, unknown> | null => {
  const options = Array.isArray(block.options) ? block.options : [];
  const option = options.find((item) => isRecord(item) && item.value === value);
  return isRecord(option) ? option : null;
};

const asIntegerLike = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number.parseInt(value.trim(), 10);
  return null;
};

const resolveCocBuildAndDamageBonus = (strength: number, size: number): { build: number; damageBonus: string } => {
  const total = strength + size;
  if (total <= 64) return { build: -2, damageBonus: '-2' };
  if (total <= 84) return { build: -1, damageBonus: '-1' };
  if (total <= 124) return { build: 0, damageBonus: '0' };
  if (total <= 164) return { build: 1, damageBonus: '1d4' };
  if (total <= 204) return { build: 2, damageBonus: '1d6' };
  return { build: 3, damageBonus: '2d6' };
};

const getPowerLevel = (preset: Record<string, unknown>, rawValue: unknown): string => {
  const powerLevelBlock = getBlock(preset, 'powerLevel');
  if (!powerLevelBlock) return 'seed';
  return getSelectValue(powerLevelBlock, rawValue) || 'seed';
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

const normalizeNumericGroupBlock = (
  block: Record<string, unknown>,
  rawValue: unknown
): {
  normalized: Record<string, number>;
  issues: string[];
  missingRequiredBlockKeys: string[];
} => {
  const blockId = typeof block.id === 'string' ? block.id.trim() : 'unknown-block';
  const fields = Array.isArray(block.fields) ? block.fields.filter(isRecord) : [];
  const rawRecord = isRecord(rawValue) ? rawValue : null;

  const normalized: Record<string, number> = {};
  const issues: string[] = [];
  const missingRequiredBlockKeys: string[] = [];

  if (!rawRecord) {
    missingRequiredBlockKeys.push(blockId);
    issues.push(`缺少 ${blockId} 输入`);
  }

  for (const field of fields) {
    const fieldId = typeof field.id === 'string' ? field.id.trim() : '';
    if (!fieldId) continue;

    const value = rawRecord ? asFiniteInteger(rawRecord[fieldId]) : null;
    const min = asFiniteInteger(field.min);
    const max = asFiniteInteger(field.max);

    if (value === null) {
      normalized[fieldId] = 0;
      if (rawRecord) {
        issues.push(`${blockId}.${fieldId} 缺失或不是有效数字`);
      }
      continue;
    }

    normalized[fieldId] = value;

    if (min !== null && value < min) {
      issues.push(`${blockId}.${fieldId} 低于允许范围（最小 ${min}）`);
    }
    if (max !== null && value > max) {
      issues.push(`${blockId}.${fieldId} 超出允许范围（最大 ${max}）`);
    }
  }

  return { normalized, issues, missingRequiredBlockKeys };
};

const normalizeGenericMultiSelectBlock = (
  block: Record<string, unknown>,
  rawValue: unknown
): {
  normalized: string[];
  issues: string[];
} => {
  const blockId = typeof block.id === 'string' ? block.id.trim() : 'multi-select';
  const groups = Array.isArray(block.groups) ? block.groups : [];
  const allowedValues = new Set(
    groups
      .filter(isRecord)
      .flatMap((group) => (Array.isArray(group.items) ? group.items : []))
      .filter(isRecord)
      .map((item) => (typeof item.id === 'string' ? item.id.trim() : ''))
      .filter(Boolean)
  );
  const rawList = Array.isArray(rawValue) ? rawValue : [];
  const normalized = Array.from(
    new Set(
      rawList
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
    )
  );
  const issues = normalized
    .filter((item) => !allowedValues.has(item))
    .map((item) => `${blockId} 中存在未知选项：${item}`);

  return {
    normalized: normalized.filter((item) => allowedValues.has(item)),
    issues,
  };
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

const evaluateGenericBuildRuleState = (
  preset: Record<string, unknown>,
  ruleId: string,
  inputs: Record<string, unknown>
): BuildRuleRuntimeResult => {
  const blockResults: Record<string, unknown> = {};
  const issues: string[] = [];
  const missingRequiredBlockKeys: string[] = [];

  for (const block of getBlocks(preset)) {
    const blockId = typeof block.id === 'string' ? block.id.trim() : '';
    if (!blockId) continue;

    if (block.type === 'select') {
      blockResults[blockId] = getSelectValue(block, inputs[blockId]);
      continue;
    }

    if (block.type === 'stat-array' || block.type === 'number-group') {
      const normalizedBlock = normalizeNumericGroupBlock(block, inputs[blockId]);
      blockResults[blockId] = normalizedBlock.normalized;
      issues.push(...normalizedBlock.issues);
      missingRequiredBlockKeys.push(...normalizedBlock.missingRequiredBlockKeys);
      continue;
    }

    if (block.type === 'multi-select') {
      const normalizedBlock = normalizeGenericMultiSelectBlock(block, inputs[blockId]);
      blockResults[blockId] = normalizedBlock.normalized;
      issues.push(...normalizedBlock.issues);
      continue;
    }
  }

  const derived: Record<string, unknown> = {};
  if (ruleId === 'dnd-5e-lite') {
    const level = asIntegerLike(blockResults.level) ?? 1;
    const classBlock = getBlock(preset, 'class');
    const selectedClass = classBlock && typeof blockResults.class === 'string'
      ? getSelectedOption(classBlock, blockResults.class)
      : null;
    const classMeta = selectedClass && isRecord(selectedClass.meta) ? selectedClass.meta : null;
    const abilityScores = isRecord(blockResults.abilityScores) ? blockResults.abilityScores : {};
    const abilityModifiers = Object.fromEntries(
      ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map((abilityKey) => {
        const score = asFiniteInteger(abilityScores[abilityKey]) ?? 0;
        return [abilityKey, Math.floor((score - 10) / 2)];
      })
    );
    derived.proficiencyBonus = Math.ceil(level / 4) + 1;
    derived.abilityModifiers = abilityModifiers;
    derived.hitDie = typeof classMeta?.hitDie === 'string' ? classMeta.hitDie : null;
    derived.spellcastingKind = typeof classMeta?.spellcastingKind === 'string' ? classMeta.spellcastingKind : 'none';
  }
  if (ruleId === 'coc-7e-lite') {
    const coreAttributes = isRecord(blockResults.coreAttributes) ? blockResults.coreAttributes : {};
    const strength = asFiniteInteger(coreAttributes.STR) ?? 0;
    const constitution = asFiniteInteger(coreAttributes.CON) ?? 0;
    const size = asFiniteInteger(coreAttributes.SIZ) ?? 0;
    const power = asFiniteInteger(coreAttributes.POW) ?? 0;
    const { build, damageBonus } = resolveCocBuildAndDamageBonus(strength, size);

    derived.SAN = power;
    derived.HP = Math.floor((constitution + size) / 10);
    derived.MP = Math.floor(power / 5);
    derived.Build = build;
    derived.DamageBonus = damageBonus;
  }

  return {
    ruleId,
    version: typeof preset.version === 'string' ? preset.version : '1.0.0',
    blockResults,
    derived,
    validationSummary: buildValidationSummary({
      issues,
      missingRequiredBlockKeys,
      attributePointsUsed: 0,
      attributePointsLimit: null,
      specialtyPointsUsed: 0,
      specialtyPointsLimit: null,
    }),
  };
};

export function evaluateBuildRuleState({ ruleId, inputs }: BuildRuleRuntimeInput): BuildRuleRuntimeResult {
  const preset = loadBuildRulePresetById(ruleId) as unknown as Record<string, unknown>;
  if (ruleId !== 'arena-trpg-lite') {
    return evaluateGenericBuildRuleState(preset, ruleId, inputs);
  }

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
