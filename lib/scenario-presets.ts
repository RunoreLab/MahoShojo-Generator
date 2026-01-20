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
    title: '通用情景（留白模板）',
    description: '只包含标题与 Markdown 内容的通用情景卡，适合快速改写与二次创作。',
    filename: 'U_SCN_blank.json',
    template: 'general-scenario',
  },
  {
    title: '谨遵女王之意（A.R.E.N.A.）',
    description: '指令系通用情景：荒诞的精确、强制的秩序与代价回执。适合悬疑/博弈/羁绊。',
    filename: 'S01_queen_will.json',
    template: 'general-scenario',
  },
  {
    title: '小城市的魔法少女：不变身直播',
    description: '偏日常/轻喜剧：直播间日常忽然变调，观众、压力与突发事件同时到来。',
    filename: 'S02_small_town_live.json',
    template: 'general-scenario',
  },
  {
    title: '废弃军工厂的追逐战',
    description: '结构化情景：工业废墟追逐/潜入/解谜，强调地形与节奏控制。',
    filename: 'S03_abandoned_factory_chase.json',
    template: 'scenario',
  },
  {
    title: '雨林神殿的低语',
    description: '结构化情景：雨林遗迹探索，机关、误导信息与阵营不明的低语。',
    filename: 'S04_rainforest_temple_whispers.json',
    template: 'scenario',
  },
  {
    title: '安可小姐的番剧鉴赏会',
    description: '通用情景：魔法茶会的观影/闲聊局，适合多人互动、日常与小冲突。',
    filename: 'S05_anime_screening_tea_party.json',
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

