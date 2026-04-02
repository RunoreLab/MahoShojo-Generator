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
