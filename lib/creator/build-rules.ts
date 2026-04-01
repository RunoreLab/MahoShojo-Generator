import type {
  BuildRulePreset,
  BuildRulePresetIndex,
  BuildRulePresetIndexEntry,
} from './types';

import arenaTrpgLitePresetJson from '../../public/build-rules/presets/arena-trpg-lite.json';
import presetIndexJson from '../../public/build-rules/presets/index.json';

type RawPresetIndex =
  | BuildRulePresetIndex
  | {
      presets?: BuildRulePresetIndexEntry[];
    };

const rawPresetIndex = presetIndexJson as RawPresetIndex;

const PRESET_INDEX: BuildRulePresetIndex = Array.isArray(rawPresetIndex)
  ? rawPresetIndex
  : rawPresetIndex.presets ?? [];

const PRESET_MAP: Record<string, BuildRulePreset> = {
  'arena-trpg-lite': arenaTrpgLitePresetJson as BuildRulePreset,
};

export function loadBuildRulePresetIndex(): BuildRulePresetIndex {
  return PRESET_INDEX;
}

export function loadBuildRulePresetById(presetId: string): BuildRulePreset {
  const preset = PRESET_MAP[presetId];
  if (!preset) {
    const availablePresets = Object.keys(PRESET_MAP).join(', ') || 'none';
    throw new Error(
      `Build rule preset "${presetId}" is not available. Registered presets: ${availablePresets}.`
    );
  }

  return preset;
}
