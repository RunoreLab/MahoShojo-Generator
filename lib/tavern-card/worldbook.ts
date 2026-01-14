import type { TavernScenarioFragment } from './scenario';

type LorebookPosition = 'before_char' | 'after_char';

type LorebookSelectiveLogic = 0 | 1;

type LorebookEntryExtensions = {
  position: number;
  exclude_recursion: boolean;
  display_index: number;
  probability: number;
  useProbability: boolean;
  depth: number;
  selectiveLogic: LorebookSelectiveLogic;
  outlet_name: string;
  group: string;
  group_override: boolean;
  group_weight: number;
  prevent_recursion: boolean;
  delay_until_recursion: boolean;
  scan_depth: number;
  match_whole_words: boolean;
  use_group_scoring: boolean;
  case_sensitive: boolean;
  automation_id: string;
  role: number;
  vectorized: boolean;
  sticky: number;
  cooldown: number;
  delay: number;
  match_persona_description: boolean;
  match_character_description: boolean;
  match_character_personality: boolean;
  match_character_depth_prompt: boolean;
  match_scenario: boolean;
  match_creator_notes: boolean;
  triggers: unknown[];
  ignore_budget: boolean;
};

type LorebookEntry = {
  id: number;
  keys: string[];
  secondary_keys: string[];
  comment: string;
  content: string;
  constant: boolean;
  selective: boolean;
  insertion_order: number;
  enabled: boolean;
  position: LorebookPosition;
  use_regex: boolean;
  extensions: LorebookEntryExtensions;
};

export type TavernCharacterBook = {
  name: string;
  entries: LorebookEntry[];
};

const normalizeLines = (value: string): string => value.replace(/\r\n/g, '\n').trim();

const truncateText = (value: string, maxChars: number): string => {
  const trimmed = value.trim();
  if (!maxChars || trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}\n...[已截断]`;
};

const positionToExtension = (position: LorebookPosition): number => {
  if (position === 'before_char') return 0;
  return 1;
};

const buildDefaultExtensions = (id: number, position: LorebookPosition): LorebookEntryExtensions => {
  return {
    position: positionToExtension(position),
    exclude_recursion: true,
    display_index: id,
    probability: 100,
    useProbability: true,
    depth: 4,
    selectiveLogic: 0,
    outlet_name: '',
    group: '',
    group_override: false,
    group_weight: 100,
    prevent_recursion: false,
    delay_until_recursion: false,
    scan_depth: 2,
    match_whole_words: false,
    use_group_scoring: false,
    case_sensitive: false,
    automation_id: '',
    role: 0,
    vectorized: false,
    sticky: 0,
    cooldown: 0,
    delay: 0,
    match_persona_description: true,
    match_character_description: true,
    match_character_personality: true,
    match_character_depth_prompt: true,
    match_scenario: true,
    match_creator_notes: true,
    triggers: [],
    ignore_budget: false,
  };
};

const buildEntry = (params: {
  id: number;
  comment: string;
  content: string;
  keys?: string[];
  constant?: boolean;
  insertionOrder?: number;
  position?: LorebookPosition;
  useRegex?: boolean;
}): LorebookEntry => {
  const position = params.position ?? 'before_char';
  const constant = params.constant ?? false;
  const content = normalizeLines(params.content);
  return {
    id: params.id,
    keys: params.keys ? params.keys.filter(Boolean) : [],
    secondary_keys: [],
    comment: params.comment.trim() || `条目 ${params.id + 1}`,
    content,
    constant,
    selective: true,
    insertion_order: params.insertionOrder ?? params.id + 1,
    enabled: true,
    position,
    use_regex: params.useRegex ?? false,
    extensions: buildDefaultExtensions(params.id, position),
  };
};

export const DEFAULT_ARENA_WORLDBOOK_NAME = '魔法少女竞技场 A.R.E.N.A.';

export const buildArenaDefaultScenario = (): string => {
  return normalizeLines(`
【舞台】魔法少女竞技场 A.R.E.N.A.
这里既是“对战/战报”的舞台，也是“赛前赛后/休息区/采访间/观众席”的叙事空间。

【你的身份】{{user}}：观众 / 记者 / 临时工作人员 / 挑战者（任选其一，也可自定）
【她的身份】{{char}}：角色本人（保持角色设定与口吻）

你可以从闲聊开始，也可以直接进入：赛后采访、复盘战斗、羁绊/黑历史、或一段全新的箱庭情景。
`);
};

const buildArenaCoreEntries = (maxEntryChars: number): Array<Omit<LorebookEntry, 'id' | 'insertion_order' | 'extensions'> & { id?: never }> => {
  const entries: Array<Omit<LorebookEntry, 'id' | 'insertion_order' | 'extensions'> & { id?: never }> = [];

  entries.push({
    keys: [],
    secondary_keys: [],
    comment: 'A.R.E.N.A. 总览（常驻）',
    content: truncateText(
      normalizeLines(`
A.R.E.N.A.（魔法少女竞技场）是一个以“对战/战报/直播/访谈”为外壳的叙事舞台。
- 参演者可能是魔法少女、残兽或其它角色。
- 观众会在弹幕与论坛讨论；记者会把战报写成“新闻”。
- 设施管理员维护场地与秩序，必要时会插话纠偏。
`),
      maxEntryChars
    ),
    constant: true,
    selective: true,
    enabled: true,
    position: 'before_char',
    use_regex: false,
  });

  entries.push({
    keys: ['A.R.E.N.A', '竞技场', 'Arena', '战报', '排位', 'PVP', '观战', '弹幕'],
    secondary_keys: [],
    comment: '观众/新闻与“战报口吻”',
    content: truncateText(
      normalizeLines(`
当出现“观众/弹幕/记者/战报”语境时，可以用更像直播/论坛的叙事：
- 弹幕口吻：短句、吐槽、起外号、刷梗。
- 新闻口吻：标题党 + 正文复盘 + 引用“匿名观众/论坛帖子”的片段。
`),
      maxEntryChars
    ),
    constant: false,
    selective: true,
    enabled: true,
    position: 'before_char',
    use_regex: false,
  });

  entries.push({
    keys: ['魔装', 'Magic Construct', '奇境', '结界', 'Wonderland', '繁开', 'Blooming', '残兽'],
    secondary_keys: [],
    comment: '术语速记（魔装/奇境/繁开/残兽）',
    content: truncateText(
      normalizeLines(`
术语速记：
- 魔装（Magic Construct）：魔法少女的武装/能力载体。
- 奇境规则（Wonderland Rule）：在一定范围内生效的规则/结界倾向。
- 繁开（Blooming）：觉醒/爆发形态，能力与装束会进化。
- 残兽：畸变的“怪物型”存在，常作为对手/宿敌。
`),
      maxEntryChars
    ),
    constant: false,
    selective: true,
    enabled: true,
    position: 'before_char',
    use_regex: false,
  });

  entries.push({
    keys: ['设施管理员', '管理员', '银莲'],
    secondary_keys: [],
    comment: '设施管理员（银莲）',
    content: truncateText(
      normalizeLines(`
设施管理员（常被称作“银莲”）负责 A.R.E.N.A. 的日常维护：修复场地、处理投诉、维持秩序。
她对混乱与过度复杂的“规则漏洞”深恶痛绝，但也会在关键时刻给出务实的建议。
`),
      maxEntryChars
    ),
    constant: false,
    selective: true,
    enabled: true,
    position: 'before_char',
    use_regex: false,
  });

  entries.push({
    keys: ['雪绒', '雪沫', '百香果茶', '大道至简', '破繁归真'],
    secondary_keys: [],
    comment: '雪绒/雪沫（竞技场梗）',
    content: truncateText(
      normalizeLines(`
雪绒（真名：雪沫）曾是竞技场早期“三幻神”之一，擅长把复杂机制“简化”到失效。
她爱百香果茶（无糖+椰果），讨厌复杂计划，嘴硬心软。
著名黑历史：曾被一只“普通的大鹅”追着啄，满场乱跑。
`),
      maxEntryChars
    ),
    constant: false,
    selective: true,
    enabled: true,
    position: 'before_char',
    use_regex: false,
  });

  entries.push({
    keys: ['鹅', '大鹅', '竞技场之鹅事件'],
    secondary_keys: [],
    comment: '竞技场之鹅事件',
    content: truncateText(
      normalizeLines(`
“竞技场之鹅事件”：一只误入竞技场的健康大鹅，攻击方式简单纯粹（拧你大腿/追着你啄）。
因为它“没有任何花哨机制”，反而让一些擅长拆机制的能力吃瘪，成为长期流传的梗。
`),
      maxEntryChars
    ),
    constant: false,
    selective: true,
    enabled: true,
    position: 'before_char',
    use_regex: false,
  });

  return entries;
};

export function buildArenaWorldbook(options?: {
  includeCore?: boolean;
  scenarioFragments?: TavernScenarioFragment[];
  maxEntryChars?: number;
}): TavernCharacterBook {
  const includeCore = options?.includeCore !== false;
  const scenarioFragments = options?.scenarioFragments ?? [];
  const maxEntryChars = options?.maxEntryChars ?? 6_000;

  const entries: LorebookEntry[] = [];
  let nextId = 0;

  if (includeCore) {
    const core = buildArenaCoreEntries(maxEntryChars);
    for (const item of core) {
      entries.push(
        buildEntry({
          id: nextId,
          comment: item.comment,
          content: item.content,
          keys: item.keys,
          constant: item.constant,
          insertionOrder: nextId + 1,
          position: item.position,
          useRegex: item.use_regex,
        })
      );
      nextId += 1;
    }
  }

  for (const fragment of scenarioFragments) {
    entries.push(
      buildEntry({
        id: nextId,
        comment: `附加情景：${fragment.title}`,
        content: truncateText(fragment.content, maxEntryChars),
        keys: [],
        constant: true,
        insertionOrder: nextId + 1,
        position: 'before_char',
      })
    );
    nextId += 1;
  }

  return { name: DEFAULT_ARENA_WORLDBOOK_NAME, entries };
}

