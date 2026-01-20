export type ScenarioPresetTemplate = 'scenario' | 'general-scenario';

export interface ScenarioPreset {
  title: string;
  description: string;
  filename: string;
  template: ScenarioPresetTemplate;
}

// 预设情景列表（Edge Runtime 无法读取文件系统，因此使用静态列表作为单一真相来源）。
export const SCENARIO_PRESET_LIST: ScenarioPreset[] = [
  {
    title: '谨遵女王之意（A.R.E.N.A.）',
    description: '指令系情景：任性的女王、荒诞的指令与挠痒痒的刑罚。适合娱乐/博弈/羁绊。',
    filename: 'S01_queen_will.json',
    template: 'general-scenario',
  },
];

const SCENARIO_PRESET_FILENAME_SET = new Set(SCENARIO_PRESET_LIST.map((preset) => preset.filename));

export const normalizeScenarioPresetFilename = (input: string): string => {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) throw new Error('缺少预设情景文件名');

  // 防止 path traversal / 非法路径（public/scenario-presets 下只允许文件名）
  if (raw.includes('/') || raw.includes('\\') || raw.includes('..') || raw.includes('?') || raw.includes('#')) {
    throw new Error('预设情景文件名非法');
  }

  const withExt = raw.toLowerCase().endsWith('.json') ? raw : `${raw}.json`;
  if (!/^[a-zA-Z0-9._-]+\.json$/.test(withExt)) {
    throw new Error('预设情景文件名非法');
  }

  if (!SCENARIO_PRESET_FILENAME_SET.has(withExt)) {
    throw new Error('未知的预设情景');
  }

  return withExt;
};

export const getScenarioPresetByFilename = (input: string): ScenarioPreset | null => {
  try {
    const filename = normalizeScenarioPresetFilename(input);
    return SCENARIO_PRESET_LIST.find((preset) => preset.filename === filename) ?? null;
  } catch {
    return null;
  }
};

