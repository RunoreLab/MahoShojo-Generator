import presetIndexJson from '@/public/build-rules/presets/index.json';
import arenaTrpgLiteJson from '@/public/build-rules/presets/arena-trpg-lite.json';
import coc7eLiteJson from '@/public/build-rules/presets/coc-7e-lite.json';
import dnd5eLiteJson from '@/public/build-rules/presets/dnd-5e-lite.json';
import terrorinfinityFxV137Json from '@/public/build-rules/presets/terrorinfinity-fx-v137.json';

import type { BuildRulePreset, BuildRulePresetIndex } from './types';

const BUILD_RULE_PRESET_INDEX = presetIndexJson.presets as BuildRulePresetIndex;

const BUILD_RULE_PRESET_MAP: Record<string, BuildRulePreset> = {
  'arena-trpg-lite': arenaTrpgLiteJson as BuildRulePreset,
  'dnd-5e-lite': dnd5eLiteJson as BuildRulePreset,
  'coc-7e-lite': coc7eLiteJson as BuildRulePreset,
  'terrorinfinity-fx-v137': terrorinfinityFxV137Json as BuildRulePreset,
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

const getPointBuyDefaultValue = (preset: Record<string, unknown>, fieldCount: number): number => {
  const budgets = isRecord(preset.budgets) ? preset.budgets : null;
  const attributePointsByLevel = budgets && isRecord(budgets.attributePointsByLevel)
    ? (budgets.attributePointsByLevel as Record<string, unknown>)
    : null;
  const seedBudgetRaw = attributePointsByLevel?.seed;
  const seedBudget = typeof seedBudgetRaw === 'number' && Number.isFinite(seedBudgetRaw) ? Math.trunc(seedBudgetRaw) : 280;

  return fieldCount > 0 ? Math.floor(seedBudget / fieldCount) : 40;
};

export function createDefaultBuildRuleInputs(ruleId: string): Record<string, unknown> {
  const preset = loadBuildRulePresetById(ruleId) as unknown as Record<string, unknown>;
  const blocks = Array.isArray(preset.blocks) ? preset.blocks : [];
  const defaults: Array<[string, unknown]> = [];

  for (const block of blocks) {
    if (!isRecord(block)) continue;
    const blockId = typeof block.id === 'string' ? block.id.trim() : '';
    if (!blockId) continue;

    if (block.type === 'select') {
      const defaultValue = typeof block.defaultValue === 'string' && block.defaultValue.trim()
        ? block.defaultValue.trim()
        : Array.isArray(block.options)
          ? block.options
              .filter(isRecord)
              .map((option) => (typeof option.value === 'string' ? option.value.trim() : ''))
              .find(Boolean) ?? ''
          : '';
      defaults.push([blockId, defaultValue]);
      continue;
    }

    if (block.type === 'multi-select') {
      defaults.push([blockId, []]);
      continue;
    }

    if (block.type === 'point-buy' || block.type === 'stat-array' || block.type === 'number-group') {
      const fields = Array.isArray(block.fields) ? block.fields.filter(isRecord) : [];
      const defaultValue = block.type === 'point-buy' ? getPointBuyDefaultValue(preset, fields.length) : 0;
      const groupValue = Object.fromEntries(
        fields.map((field) => {
          const fieldId = typeof field.id === 'string' ? field.id.trim() : '';
          const fieldDefaultValue =
            typeof field.defaultValue === 'number' && Number.isFinite(field.defaultValue)
              ? Math.trunc(field.defaultValue)
              : defaultValue;
          return [fieldId, fieldDefaultValue];
        })
      );
      defaults.push([blockId, groupValue]);
      continue;
    }
  }

  return Object.fromEntries(defaults);
}
