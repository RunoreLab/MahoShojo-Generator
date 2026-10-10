import { describe, expect, it } from 'vitest';

import { PRESET_LIST } from '@mahoshojo/domain/presets';
import {
  SCENARIO_PRESET_LIST,
  getScenarioPresetByFilename,
  normalizeScenarioPresetFilename,
} from '@mahoshojo/domain/scenario-presets';

describe('shared Arena preset catalogs', () => {
  it('keeps picker identities and types without promoting legacy static URLs', () => {
    expect(PRESET_LIST.length).toBeGreaterThan(30);
    expect(new Set(PRESET_LIST.map((preset) => preset.filename)).size).toBe(PRESET_LIST.length);
    expect(PRESET_LIST.some((preset) => preset.filename === 'M01_centaurea.json' && preset.type === 'magical-girl')).toBe(true);
    expect(PRESET_LIST.some((preset) => preset.filename === 'C01_egg.json' && preset.type === 'canshou')).toBe(true);
    expect(PRESET_LIST.some((preset) => preset.filename.endsWith('_legacy.json') || preset.filename === 'M00_white_lily.json')).toBe(false);
    expect(SCENARIO_PRESET_LIST.some((preset) => preset.filename === 'S01_queen_will.json' && preset.template === 'general-scenario')).toBe(true);
  });

  it('preserves scenario filename trimming, optional extension and lookup identity', () => {
    for (const preset of SCENARIO_PRESET_LIST) {
      expect(normalizeScenarioPresetFilename(` ${preset.filename} `)).toBe(preset.filename);
      expect(normalizeScenarioPresetFilename(preset.filename.slice(0, -5))).toBe(preset.filename);
      expect(getScenarioPresetByFilename(preset.filename)).toBe(preset);
    }
  });

  it('rejects traversal, URL fragments, malformed and unknown filenames with the existing errors', () => {
    expect(() => normalizeScenarioPresetFilename('')).toThrow('缺少预设情景文件名');
    for (const input of ['../S01_queen_will', '/S01_queen_will', 'dir\\S01_queen_will', 'S01_queen_will?x', 'S01_queen_will#x', '%53', '名称', 'S01_queen_will.JSON']) {
      expect(() => normalizeScenarioPresetFilename(input)).toThrow('预设情景文件名非法');
      expect(getScenarioPresetByFilename(input)).toBeNull();
    }
    for (const input of ['unknown', 's01_queen_will.json']) {
      expect(() => normalizeScenarioPresetFilename(input)).toThrow('未知的预设情景');
      expect(getScenarioPresetByFilename(input)).toBeNull();
    }
  });
});
