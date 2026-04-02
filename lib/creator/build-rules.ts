import presetIndexJson from '@/public/build-rules/presets/index.json';
import arenaTrpgLiteJson from '@/public/build-rules/presets/arena-trpg-lite.json';

import type { BuildRulePreset, BuildRulePresetIndex } from './types';

const BUILD_RULE_PRESET_INDEX = presetIndexJson.presets as BuildRulePresetIndex;

const BUILD_RULE_PRESET_MAP: Record<string, BuildRulePreset> = {
  'arena-trpg-lite': arenaTrpgLiteJson as BuildRulePreset,
};

export function loadBuildRulePresetIndex(): BuildRulePresetIndex {
  return BUILD_RULE_PRESET_INDEX;
}

export function tryLoadBuildRulePresetById(id: string): BuildRulePreset | null {
  const normalizedId = typeof id === 'string' ? id.trim() : '';
  if (!normalizedId) return null;
  return BUILD_RULE_PRESET_MAP[normalizedId] ?? null;
}

export function loadBuildRulePresetById(id: string): BuildRulePreset {
  const preset = tryLoadBuildRulePresetById(id);
  if (!preset) {
    throw new Error(`BUILD_RULE_PRESET_NOT_FOUND:${id}`);
  }
  return preset;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function createDefaultBuildRuleInputs(ruleId: string): Record<string, unknown> {
  const preset = loadBuildRulePresetById(ruleId) as unknown as Record<string, unknown>;
  const budgets = isRecord(preset.budgets) ? preset.budgets : null;
  const attributePointsByLevel = budgets && isRecord(budgets.attributePointsByLevel)
    ? (budgets.attributePointsByLevel as Record<string, unknown>)
    : null;
  const seedBudgetRaw = attributePointsByLevel?.seed;
  const seedBudget = typeof seedBudgetRaw === 'number' && Number.isFinite(seedBudgetRaw) ? Math.trunc(seedBudgetRaw) : 280;

  const blocks = Array.isArray(preset.blocks) ? preset.blocks : [];
  const coreAttributesBlock = blocks.find((item) => isRecord(item) && item.id === 'coreAttributes');
  const fields =
    coreAttributesBlock && isRecord(coreAttributesBlock) && Array.isArray(coreAttributesBlock.fields)
      ? coreAttributesBlock.fields.filter(isRecord)
      : [];
  const attributeFieldIds = fields
    .map((field) => (typeof field.id === 'string' ? field.id.trim() : ''))
    .filter(Boolean);

  const defaultAttributeValue = attributeFieldIds.length > 0 ? Math.floor(seedBudget / attributeFieldIds.length) : 40;
  const coreAttributes = Object.fromEntries(
    attributeFieldIds.map((fieldId) => [fieldId, defaultAttributeValue])
  );

  return {
    powerLevel: 'seed',
    coreAttributes,
    specialties: [],
  };
}
