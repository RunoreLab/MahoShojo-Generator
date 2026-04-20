import { describe, expect, it } from 'bun:test';

import { GeneralScenarioSchema } from '@/lib/schemas/general-scenario';
import {
  SCENARIO_PRESET_LIST,
  getScenarioPresetByFilename,
  normalizeScenarioPresetFilename,
} from '@/lib/scenario-presets';
import wastetraceEncounter from '@/public/scenario-presets/S13_wastetrace_encounter.json';
import wastetraceRouteFailure from '@/public/scenario-presets/S14_wastetrace_route_failure.json';
import wastetraceBlockadeBreakout from '@/public/scenario-presets/S15_wastetrace_blockade_breakout.json';

const WASTETRACE_PRESETS = [
  {
    filename: 'S13_wastetrace_encounter.json',
    title: '废土行迹·偶遇：同路人未必同行',
    payload: wastetraceEncounter,
  },
  {
    filename: 'S14_wastetrace_route_failure.json',
    title: '废土行迹·调查探索：路标失效之后',
    payload: wastetraceRouteFailure,
  },
  {
    filename: 'S15_wastetrace_blockade_breakout.json',
    title: '废土行迹·战斗冲突：封路与突围',
    payload: wastetraceBlockadeBreakout,
  },
] as const;

describe('scenario presets', () => {
  it('废土行迹预设情景已注册为通用情景卡', () => {
    for (const expected of WASTETRACE_PRESETS) {
      const preset = SCENARIO_PRESET_LIST.find((item) => item.filename === expected.filename);

      expect(preset).toEqual(expect.objectContaining({
        filename: expected.filename,
        title: expected.title,
        template: 'general-scenario',
      }));
      expect(preset?.description).toContain('【');
      expect(getScenarioPresetByFilename(expected.filename)?.title).toBe(expected.title);
      expect(normalizeScenarioPresetFilename(expected.filename.replace(/\.json$/, ''))).toBe(expected.filename);
    }
  });

  it('废土行迹预设情景 JSON 满足通用情景格式', () => {
    for (const expected of WASTETRACE_PRESETS) {
      const parsed = GeneralScenarioSchema.parse(expected.payload);

      expect(parsed.templateId).toBe('通用情景');
      expect(parsed.title).toBe(expected.title);
      expect(parsed.content).toContain('# ');
      expect(parsed.content).toContain('废土行迹');
      expect(parsed.content).toContain('使用提示');
    }
  });
});
