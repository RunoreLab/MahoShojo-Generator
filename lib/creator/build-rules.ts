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
      presets?: BuildRulePresetIndex;
    };

const PRESET_REGISTRY: readonly BuildRulePreset[] = [
  arenaTrpgLitePresetJson as BuildRulePreset,
];

const PRESET_MAP: Record<string, BuildRulePreset> = PRESET_REGISTRY.reduce(
  (records, preset) => {
    records[preset.id] = preset;
    return records;
  },
  {} as Record<string, BuildRulePreset>
);

const derivedIndex = PRESET_REGISTRY.map((preset) => ({
  id: preset.id,
  title: preset.title ?? '',
  version: preset.version,
})) as BuildRulePresetIndex;

const rawIndex = presetIndexJson as RawPresetIndex;
const fileIndexEntries: BuildRulePresetIndex = Array.isArray(rawIndex)
  ? rawIndex
  : rawIndex.presets ?? [];

const fileIndexLookup = new Map<string, BuildRulePresetIndexEntry>();
fileIndexEntries.forEach((entry) => {
  fileIndexLookup.set(entry.id, entry);
});

derivedIndex.forEach((entry) => {
  if (!fileIndexLookup.has(entry.id)) {
    throw new Error(
      `Build rule preset "${entry.id}" is registered but missing from public/build-rules/presets/index.json`
    );
  }
});

fileIndexEntries.forEach((entry) => {
  const preset = PRESET_MAP[entry.id];
  if (!preset) {
    throw new Error(
      `Index entry for build rule preset "${entry.id}" has no corresponding preset file.`
    );
  }

  if (preset.version !== entry.version) {
    throw new Error(
      `Version mismatch for preset "${entry.id}": index.json reports ${entry.version} but preset file reports ${preset.version}.`
    );
  }

  if (entry.title && preset.title && entry.title !== preset.title) {
    throw new Error(
      `Title mismatch for preset "${entry.id}": index.json reports "${entry.title}" but preset file reports "${preset.title}".`
    );
  }
});

const clonePreset = (preset: BuildRulePreset): BuildRulePreset => {
  if (typeof structuredClone === 'function') {
    return structuredClone(preset) as BuildRulePreset;
  }
  return JSON.parse(JSON.stringify(preset)) as BuildRulePreset;
};

export function loadBuildRulePresetIndex(): BuildRulePresetIndex {
  return derivedIndex.map((entry) => ({ ...entry })) as BuildRulePresetIndex;
}

export function loadBuildRulePresetById(presetId: string): BuildRulePreset {
  const preset = PRESET_MAP[presetId];
  if (!preset) {
    const availablePresets = Object.keys(PRESET_MAP).join(', ') || 'none';
    throw new Error(
      `Build rule preset "${presetId}" is not available. Registered presets: ${availablePresets}.`
    );
  }

  return clonePreset(preset);
}
