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
    description: '【娱乐】指令系情景，适合娱乐/博弈/羁绊。',
    filename: 'S01_queen_will.json',
    template: 'general-scenario',
  },
  {
    title: '竞技场：多维战区-人之战场',
    description: '【战斗】多战场随机竞技，体术与规则推测并重；高复杂度。',
    filename: 'S02_multiverse_human_arena.json',
    template: 'scenario',
  },
  {
    title: '公平竞技场：魔法少女的试炼 v1.1',
    description: '【战斗】原作风格的公平竞技试炼，强调能力隐藏与试探；高难度/现实向。',
    filename: 'S03_arena_original_v1_1.json',
    template: 'scenario',
  },
  {
    title: '拳愿八角笼：原始搏斗竞技 v3',
    description: '【战斗】擂台锦标赛风格，强调肉搏与读招推测；高难度、牺牲风险。',
    filename: 'S04_kengan_gold_tournament_v3.json',
    template: 'scenario',
  },
  {
    title: '镜中凡俗 v2',
    description: '【模拟养成】失去魔力后的长线日常，含适应度/SAN/结局分支；需多轮存档推进。',
    filename: 'S05_mirror_mundane_v2.json',
    template: 'scenario',
  },
  {
    title: '魔法少女综合评估日',
    description: '【评估】评估流程驱动，要求结构化输出（JSON/Markdown）；长 prompt 注意上下文开销。',
    filename: 'S06_magical_girl_assessment_day.json',
    template: 'scenario',
  },
  {
    title: 'Galgame攻略难度分析报告',
    description: '【评估】提供攻略难度评分与攻略策略建议；娱乐向的评估情景。',
    filename: 'S07_galgame_difficulty_analysis.json',
    template: 'scenario',
  },
  {
    title: 'A[LI]CE_MSG角色卡评价与创作指导-日常篇',
    description: '【创作者工具】非 RP，用于角色卡评价/创作指导。',
    filename: 'S08_alice_msg_review_daily.json',
    template: 'scenario',
  },
  {
    title: '安可的番剧鉴赏会 v3',
    description: '【日常】角色档案鉴赏 + 番剧/特摄定位，最终输出鉴定报告与吐槽。',
    filename: 'S09_anko_anime_review_v3.json',
    template: 'scenario',
  },
  {
    title: '不变身魔法少女的日常直播 v3.1',
    description: '【日常】直播经营与成长循环，含阶段/目标/健康等系统化规则。',
    filename: 'S10_everyday_streaming_v3_1.json',
    template: 'scenario',
  },
  {
    title: '蜉蝣BOSS战 v1',
    description: '【BOSS战】“绝对公平”的残酷模拟训练；五章制推进并生成后日谈。',
    filename: 'S11_mayfly_bossfight_v1.json',
    template: 'scenario',
  },
  {
    title: '元对话：与系统核心的质询 v4.2',
    description: '【工具】系统核心元对话（Q/A 档案式），适合设定研讨与安全协议质询。',
    filename: 'S12_system_core_meta_dialogue_v4_2.json',
    template: 'scenario',
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

