export type BattleStorySessionAction = 'start' | 'continue' | 'branch' | 'rewrite';
export type BattleStoryChapterPlanSource = 'user' | 'scenario';
export type BattleStoryDraftChapterPlanMode = 'auto' | 'none' | 'custom';

export type BattleStorySessionSettings = {
  readArenaHistory: boolean;
  readArenaHistoryLimit?: number;
  isArenaHistoryUnlimited?: boolean;
  writeArenaHistory: boolean;
  readCurrentState: boolean;
  writeCurrentState: boolean;
  readNarrativeHistory: boolean;
  readNarrativeHistoryLimit?: number;
  isNarrativeHistoryUnlimited?: boolean;
  writeNarrativeHistory: boolean;
};

export type BattleStoryChapterPlan = {
  totalChapters: number;
  source: BattleStoryChapterPlanSource;
  locked: boolean;
};

export type BattleStoryChapterPlanLimit = Pick<BattleStoryChapterPlan, 'totalChapters'>;

export type BattleStoryPromptChapterPlanState = {
  totalChapters: number;
  currentChapterIndex: number;
  isFinalChapter: boolean;
  remainingChaptersIncludingCurrent: number;
  remainingChaptersAfterCurrent: number;
  positionLabel: string;
};

export type BattleStoryImpactDigestItem = {
  characterName: string;
  impact?: string;
  currentStateSummary?: string;
};

export type BattleStoryDeterministicDigest = {
  chapterTitle: string;
  winner?: string;
  officialConclusion?: string;
  bodyExcerpt?: string;
  impactDigest?: BattleStoryImpactDigestItem[];
};

export type BattleStoryPromptChapterInput = {
  id: string;
  index: number;
  title?: string;
  markdown: string;
  deterministicDigest?: BattleStoryDeterministicDigest;
};

export type BattleStoryPromptWindowItem = {
  chapterId: string;
  chapterIndex: number;
  title: string;
  mode: 'full' | 'digest';
  text: string;
  truncated: boolean;
};

export type BattleStoryPromptSectionKey =
  | 'seed'
  | 'chapter-plan'
  | 'current-state'
  | 'session-summary'
  | 'recent-window'
  | 'user-guidance';

export type BattleStoryPromptSection = {
  key: BattleStoryPromptSectionKey;
  title: string;
  text: string;
};

export type BattleStoryPromptContextInput = {
  source?: object;
  seed?: {
    combatants: unknown[];
    settings: BattleStorySessionSettings;
    [key: string]: unknown;
  } | null;
  chapterPlan?: BattleStoryChapterPlan | BattleStoryChapterPlanLimit | null;
  chapterIndex?: number;
  workingCombatants?: unknown[];
  sessionSummary?: string;
  recentChapters?: BattleStoryPromptChapterInput[];
  userGuidance?: string;
  maxRecentChapters?: number;
  maxFullChapterChars?: number;
  maxUserGuidanceChars?: number;
};

export type BattleStoryPromptContextResult = {
  chapterPlanState?: BattleStoryPromptChapterPlanState | null;
  normalizedUserGuidance: string;
  recentWindow: BattleStoryPromptWindowItem[];
  sections: BattleStoryPromptSection[];
  promptText: string;
};

export type BattleStoryGenerateNextRecentChapter = {
  id: string;
  index: number;
};

export type BattleStoryGenerateNextValidationInput = {
  action: BattleStorySessionAction;
  sourceChapterId?: string;
  chapterIndex?: number;
  chapterPlan?: BattleStoryChapterPlanLimit;
  recentChapters: BattleStoryGenerateNextRecentChapter[];
};

export type BattleStoryGenerateNextValidationResult =
  | { ok: true; chapterIndex: number }
  | { ok: false; error: string };

const DEFAULT_MAX_RECENT_CHAPTERS = 2;
const DEFAULT_MAX_FULL_CHAPTER_CHARS = 6_000;
const DEFAULT_MAX_USER_GUIDANCE_CHARS = 800;
const DEFAULT_ARENA_HISTORY_LIMIT = 3;
const DEFAULT_BODY_EXCERPT_CHARS = 240;
const DEFAULT_MAX_IMPACT_ITEMS = 8;
const MIN_TOTAL_CHAPTERS = 1;
const MAX_TOTAL_CHAPTERS = 20;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const normalizeText = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : ''
);

const normalizeScenarioTotalChapters = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.floor(value) !== value) {
    return null;
  }
  return value >= MIN_TOTAL_CHAPTERS && value <= MAX_TOTAL_CHAPTERS ? value : null;
};

const readScenarioPlan = (
  value: unknown,
): { totalChapters: number; planMode: 'suggested' | 'fixed' } | null => {
  if (!isRecord(value) || !isRecord(value._battle_story)) return null;
  const totalChapters = normalizeScenarioTotalChapters(value._battle_story.total_chapters);
  const planMode = value._battle_story.plan_mode === 'fixed'
    ? 'fixed'
    : value._battle_story.plan_mode === 'suggested' || value._battle_story.plan_mode === undefined
      ? 'suggested'
      : null;
  return totalChapters && planMode ? { totalChapters, planMode } : null;
};

export const normalizeBattleStoryTotalChapters = (value: unknown): number | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return normalizeScenarioTotalChapters(Number(trimmed));
  }
  return normalizeScenarioTotalChapters(value);
};

export const normalizeBattleStoryChapterPlan = (
  value: unknown,
): BattleStoryChapterPlan | null => {
  if (!isRecord(value)) return null;
  const totalChapters = normalizeBattleStoryTotalChapters(value.totalChapters);
  if (!totalChapters) return null;
  const source = value.source === 'scenario'
    ? 'scenario'
    : value.source === 'user'
      ? 'user'
      : null;
  return source ? { totalChapters, source, locked: value.locked === true } : null;
};

const resolvePlanTotal = (value: unknown): number | null => {
  const plan = normalizeBattleStoryChapterPlan(value);
  if (plan) return plan.totalChapters;
  return isRecord(value) ? normalizeBattleStoryTotalChapters(value.totalChapters) : null;
};

export const resolveBattleStoryInitialChapterPlan = (input: {
  scenario: unknown;
  userSelectionMode?: BattleStoryDraftChapterPlanMode;
  userDesiredTotalChapters?: unknown;
}): BattleStoryChapterPlan | null => {
  const scenarioPlan = readScenarioPlan(input.scenario);
  if (scenarioPlan?.planMode === 'fixed') {
    return { totalChapters: scenarioPlan.totalChapters, source: 'scenario', locked: true };
  }
  if (input.userSelectionMode === 'custom') {
    const totalChapters = normalizeBattleStoryTotalChapters(input.userDesiredTotalChapters);
    return totalChapters ? { totalChapters, source: 'user', locked: false } : null;
  }
  if (input.userSelectionMode === 'none') return null;
  return scenarioPlan?.planMode === 'suggested'
    ? { totalChapters: scenarioPlan.totalChapters, source: 'scenario', locked: false }
    : null;
};

export const resolveBattleStoryPromptChapterPlanState = (input: {
  chapterPlan?: BattleStoryChapterPlan | BattleStoryChapterPlanLimit | null;
  chapterIndex?: number;
}): BattleStoryPromptChapterPlanState | null => {
  const totalChapters = resolvePlanTotal(input.chapterPlan);
  const chapterIndex = typeof input.chapterIndex === 'number'
    ? Math.max(1, Math.floor(input.chapterIndex))
    : null;
  if (!totalChapters || !chapterIndex) return null;
  const isFinalChapter = chapterIndex >= totalChapters;
  return {
    totalChapters,
    currentChapterIndex: chapterIndex,
    isFinalChapter,
    remainingChaptersIncludingCurrent: Math.max(1, totalChapters - chapterIndex + 1),
    remainingChaptersAfterCurrent: Math.max(0, totalChapters - chapterIndex),
    positionLabel: totalChapters === 1
      ? '单章完结'
      : isFinalChapter
        ? '终章'
        : chapterIndex === 1
          ? '开篇章'
          : chapterIndex === totalChapters - 1
            ? '终局前章'
            : '中段推进章',
  };
};

export const isBattleStoryChapterPlanLimitReached = (input: {
  chapterPlan?: BattleStoryChapterPlan | null;
  completedChapterCount: number;
}): boolean => {
  const totalChapters = resolvePlanTotal(input.chapterPlan);
  return totalChapters
    ? Math.max(0, Math.floor(input.completedChapterCount)) >= totalChapters
    : false;
};

export const willBattleStoryChapterExceedPlan = (input: {
  chapterPlan?: BattleStoryChapterPlan | BattleStoryChapterPlanLimit | null;
  nextChapterIndex: number;
}): boolean => {
  const totalChapters = resolvePlanTotal(input.chapterPlan);
  return totalChapters
    ? Math.max(1, Math.floor(input.nextChapterIndex)) > totalChapters
    : false;
};

export const formatBattleStoryChapterProgress = (input: {
  completedChapterCount: number;
  chapterPlan?: BattleStoryChapterPlan | null;
}): string => {
  const plan = normalizeBattleStoryChapterPlan(input.chapterPlan);
  const completed = Math.max(0, Math.floor(input.completedChapterCount));
  return plan
    ? `${Math.min(completed, plan.totalChapters)} / ${plan.totalChapters}`
    : `${completed} 章`;
};

export const formatBattleStoryChapterPlanSource = (
  chapterPlan?: BattleStoryChapterPlan | null,
): string | null => {
  const plan = normalizeBattleStoryChapterPlan(chapterPlan);
  if (!plan) return null;
  return plan.source === 'scenario'
    ? plan.locked ? '情景卡固定' : '情景卡建议'
    : '用户设置';
};

export const validateBattleStoryGenerateNextInput = (
  input: BattleStoryGenerateNextValidationInput,
): BattleStoryGenerateNextValidationResult => {
  const chapters = [...input.recentChapters].sort((left, right) => left.index - right.index);
  const latest = chapters.at(-1) ?? null;
  const source = input.sourceChapterId
    ? chapters.find((chapter) => chapter.id === input.sourceChapterId) ?? null
    : null;
  if (input.action === 'start') {
    if (chapters.length > 0) return { ok: false, error: 'start 只允许用于空会话' };
    if (input.sourceChapterId) return { ok: false, error: 'start 不允许携带 sourceChapterId' };
    if (typeof input.chapterIndex === 'number' && input.chapterIndex !== 1) {
      return { ok: false, error: 'start 的 chapterIndex 必须为 1' };
    }
    return { ok: true, chapterIndex: 1 };
  }
  if (!latest) return { ok: false, error: `${input.action} 需要至少一章已有上下文` };
  if (input.action === 'continue') {
    const expected = latest.index + 1;
    if (input.sourceChapterId && input.sourceChapterId !== latest.id) {
      return { ok: false, error: 'continue 只能基于当前会话的最后一章继续' };
    }
    if (willBattleStoryChapterExceedPlan({ chapterPlan: input.chapterPlan, nextChapterIndex: expected })) {
      return { ok: false, error: `该会话已达到计划章节上限（共 ${input.chapterPlan?.totalChapters} 章）` };
    }
    return typeof input.chapterIndex === 'number' && input.chapterIndex !== expected
      ? { ok: false, error: `continue 的 chapterIndex 必须为 ${expected}` }
      : { ok: true, chapterIndex: expected };
  }
  if (input.action === 'branch') {
    if (!input.sourceChapterId) return { ok: false, error: 'branch 必须指定 sourceChapterId' };
    if (!source) return { ok: false, error: 'branch 的 sourceChapterId 不在当前上下文中' };
    const expected = source.index + 1;
    if (willBattleStoryChapterExceedPlan({ chapterPlan: input.chapterPlan, nextChapterIndex: expected })) {
      return { ok: false, error: `该会话已达到计划章节上限（共 ${input.chapterPlan?.totalChapters} 章）` };
    }
    return typeof input.chapterIndex === 'number' && input.chapterIndex !== expected
      ? { ok: false, error: `branch 的 chapterIndex 必须为 ${expected}` }
      : { ok: true, chapterIndex: expected };
  }
  if (!input.sourceChapterId) return { ok: false, error: 'rewrite 必须指定 sourceChapterId' };
  if (!source) return { ok: false, error: 'rewrite 的 sourceChapterId 不在当前上下文中' };
  if (source.id !== latest.id) {
    return { ok: false, error: 'rewrite 只允许重写当前会话的最后一章' };
  }
  return typeof input.chapterIndex === 'number' && input.chapterIndex !== latest.index
    ? { ok: false, error: `rewrite 的 chapterIndex 必须为 ${latest.index}` }
    : { ok: true, chapterIndex: latest.index };
};

const truncateText = (text: string, maxChars: number): { text: string; truncated: boolean } => (
  text.length <= maxChars
    ? { text, truncated: false }
    : { text: `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`, truncated: true }
);

const sanitizeStoryPromptValue = (
  value: unknown,
  options: { readArenaHistory: boolean; readCurrentState: boolean },
): unknown => {
  if (Array.isArray(value)) return value.map((entry) => sanitizeStoryPromptValue(entry, options));
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'creationInputs' || key === 'isPreset') continue;
    if (!options.readArenaHistory && key === 'arena_history') continue;
    if (!options.readCurrentState && key === 'current_state') continue;
    result[key === 'buildState' ? '角色参数' : key] = sanitizeStoryPromptValue(entry, options);
  }
  return result;
};

const resolveArenaHistoryReadLimit = (
  settings: BattleStorySessionSettings | null | undefined,
): number | null => {
  if (!settings?.readArenaHistory) return 0;
  if (settings.isArenaHistoryUnlimited === true) return null;
  return typeof settings.readArenaHistoryLimit === 'number'
    && Number.isFinite(settings.readArenaHistoryLimit)
    ? Math.max(1, Math.floor(settings.readArenaHistoryLimit))
    : DEFAULT_ARENA_HISTORY_LIMIT;
};

const limitArenaHistory = (
  value: unknown,
  settings: BattleStorySessionSettings | null | undefined,
): unknown => {
  if (Array.isArray(value)) return value.map((entry) => limitArenaHistory(entry, settings));
  if (!isRecord(value)) return value;
  const limit = resolveArenaHistoryReadLimit(settings);
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'arena_history' && isRecord(entry) && Array.isArray(entry.entries)
      && limit !== null && limit > 0 && entry.entries.length > limit) {
      result[key] = { ...entry, entries: entry.entries.slice(-limit) };
    } else {
      result[key] = limitArenaHistory(entry, settings);
    }
  }
  return result;
};

const sanitizeCombatant = (
  value: unknown,
  settings: BattleStorySessionSettings | null | undefined,
): unknown => {
  const sanitized = sanitizeStoryPromptValue(value, {
    readArenaHistory: settings?.readArenaHistory === true,
    readCurrentState: settings?.readCurrentState === true,
  });
  return settings?.readArenaHistory === true ? limitArenaHistory(sanitized, settings) : sanitized;
};

const safeJsonBlock = (value: unknown): string => {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return '"[unserializable]"';
  }
};

const digestText = (chapter: BattleStoryPromptChapterInput): string => {
  const digest = chapter.deterministicDigest;
  if (!digest) return `第 ${chapter.index} 章：${normalizeText(chapter.title) || '未命名章节'}`;
  const lines = [
    `第 ${chapter.index} 章：${digest.chapterTitle || normalizeText(chapter.title) || '未命名章节'}`,
  ];
  if (digest.winner) lines.push(`胜利者：${digest.winner}`);
  if (digest.officialConclusion) lines.push(`结论：${digest.officialConclusion}`);
  if (digest.bodyExcerpt) lines.push(`摘要：${digest.bodyExcerpt}`);
  if (digest.impactDigest?.length) {
    lines.push(`角色影响：${digest.impactDigest.map((item) => [
      item.characterName,
      item.impact ? `变化=${item.impact}` : '',
      item.currentStateSummary ? `状态=${item.currentStateSummary}` : '',
    ].filter(Boolean).join(' / ')).join('；')}`);
  }
  return lines.join('\n');
};

export const resolveBattleStoryRecentWindow = (input: {
  chapters?: BattleStoryPromptChapterInput[];
  maxRecentChapters?: number;
  maxFullChapterChars?: number;
}): BattleStoryPromptWindowItem[] => {
  const chapters = [...(input.chapters ?? [])].sort((left, right) => left.index - right.index);
  if (chapters.length === 0) return [];
  const maxRecent = Math.max(1, Math.floor(input.maxRecentChapters ?? DEFAULT_MAX_RECENT_CHAPTERS));
  const maxChars = Math.max(500, Math.floor(input.maxFullChapterChars ?? DEFAULT_MAX_FULL_CHAPTER_CHARS));
  const fullStart = Math.max(0, chapters.length - maxRecent);
  return chapters.map((chapter, index) => {
    const title = normalizeText(chapter.title)
      || chapter.deterministicDigest?.chapterTitle
      || `第 ${chapter.index} 章`;
    if (index < fullStart) {
      return {
        chapterId: chapter.id,
        chapterIndex: chapter.index,
        title,
        mode: 'digest',
        text: digestText(chapter),
        truncated: false,
      };
    }
    const full = normalizeText(chapter.markdown) || digestText(chapter);
    const bounded = truncateText(full, maxChars);
    return {
      chapterId: chapter.id,
      chapterIndex: chapter.index,
      title,
      mode: 'full',
      text: bounded.text,
      truncated: bounded.truncated,
    };
  });
};

export const buildBattleStoryPromptContext = (
  input: BattleStoryPromptContextInput,
): BattleStoryPromptContextResult => {
  const sections: BattleStoryPromptSection[] = [];
  const chapterPlanState = resolveBattleStoryPromptChapterPlanState({
    chapterPlan: input.chapterPlan,
    chapterIndex: input.chapterIndex,
  });
  const settings = input.seed?.settings;
  const seed = input.seed
    ? {
      ...input.seed,
      combatants: input.seed.combatants.map((combatant) => sanitizeCombatant(combatant, settings)),
    }
    : input.seed;
  const workingCombatants = (input.workingCombatants ?? [])
    .map((combatant) => sanitizeCombatant(combatant, settings));
  if (input.source || seed) {
    sections.push({
      key: 'seed',
      title: '固定种子层',
      text: safeJsonBlock({ source: input.source ?? null, seed: seed ?? null }),
    });
  }
  if (chapterPlanState) {
    sections.push({
      key: 'chapter-plan',
      title: '章节规划层',
      text: [
        `计划总章节数：${chapterPlanState.totalChapters}`,
        `当前要生成：第 ${chapterPlanState.currentChapterIndex} 章 / 共 ${chapterPlanState.totalChapters} 章`,
        `本章定位：${chapterPlanState.positionLabel}`,
        `剩余章节（含本章）：${chapterPlanState.remainingChaptersIncludingCurrent}`,
      ].join('\n'),
    });
  }
  if (workingCombatants.length > 0) {
    sections.push({ key: 'current-state', title: '当前角色状态层', text: safeJsonBlock(workingCombatants) });
  }
  const sessionSummary = normalizeText(input.sessionSummary);
  if (sessionSummary) {
    sections.push({ key: 'session-summary', title: '会话摘要层', text: sessionSummary });
  }
  const recentWindow = resolveBattleStoryRecentWindow({
    chapters: input.recentChapters,
    maxRecentChapters: input.maxRecentChapters,
    maxFullChapterChars: input.maxFullChapterChars,
  });
  if (recentWindow.length > 0) {
    sections.push({
      key: 'recent-window',
      title: '最近章节窗口层',
      text: recentWindow.map((item) => [
        `### 第 ${item.chapterIndex} 章 ${item.title}（${item.mode === 'full' ? '全文' : '摘要'}）`,
        item.truncated ? `${item.text}\n\n[本章内容已按上下文预算截断]` : item.text,
      ].join('\n')).join('\n\n'),
    });
  }
  const normalizedUserGuidance = truncateText(
    normalizeText(input.userGuidance),
    Math.max(120, Math.floor(input.maxUserGuidanceChars ?? DEFAULT_MAX_USER_GUIDANCE_CHARS)),
  ).text;
  if (normalizedUserGuidance) {
    sections.push({ key: 'user-guidance', title: '本轮用户引导层', text: normalizedUserGuidance });
  }
  return {
    chapterPlanState,
    normalizedUserGuidance,
    recentWindow,
    sections,
    promptText: sections.map((section) => `## ${section.title}\n${section.text}`).join('\n\n'),
  };
};

const actionInstruction = (input: {
  action: BattleStorySessionAction;
  chapterIndex: number;
  sourceChapterId?: string;
}): string => {
  if (input.action === 'rewrite') {
    return `当前任务是重写第 ${input.chapterIndex} 章。请保持前文章节已经成立的事实不变，只重写当前章节的展开、措辞与结果呈现。${input.sourceChapterId ? `被重写章节 ID：${input.sourceChapterId}。` : ''}`;
  }
  if (input.action === 'branch') {
    return `当前任务是从既有故事中分支续写第 ${input.chapterIndex} 章。请把分支点之前的内容视为既定事实，并在其后发展出新的走向。${input.sourceChapterId ? `分支来源章节 ID：${input.sourceChapterId}。` : ''}`;
  }
  if (input.action === 'continue') {
    return `当前任务是续写第 ${input.chapterIndex} 章。请承接既有章节与角色状态，不要把前文重新从头概述一遍。`;
  }
  return `当前任务是生成连续战报会话的首章（第 ${input.chapterIndex} 章）。请建立清晰的冲突、局势与角色状态变化，为后续章节留出延展空间。`;
};

export const buildBattleStoryInternalGuidance = (input: {
  action: BattleStorySessionAction;
  chapterIndex: number;
  sourceChapterId?: string;
  chapterPlan?: BattleStoryChapterPlan | BattleStoryChapterPlanLimit | null;
  context: BattleStoryPromptContextResult;
}): string => {
  const state = input.context.chapterPlanState ?? resolveBattleStoryPromptChapterPlanState(input);
  const planInstruction = state
    ? state.isFinalChapter
      ? `本会话计划共 ${state.totalChapters} 章，当前正在生成第 ${state.currentChapterIndex} 章。本章是终章。请完成主线收束，交代主要冲突结果与角色余波，不要再强行留下“下一章继续”的空钩子。`
      : `本会话计划共 ${state.totalChapters} 章，当前正在生成第 ${state.currentChapterIndex} 章。本章不是终章。请推进主线，但不要提前把整条故事直接写到最终结局；结尾需要留下可供下一章承接的明确变化、悬念或阶段结果。`
    : '';
  return [
    '你当前正在生成“连续战报会话”的一个章节。',
    '以下上下文全部属于既定事实，只能在此基础上继续发展，不得否定、覆盖或随意改写。',
    actionInstruction(input),
    planInstruction,
    '要求：延续角色当前状态、保留已经发生的关键结果、避免机械复述上下文、正文必须仍然是一份可独立阅读的战报。',
    input.context.promptText,
  ].filter(Boolean).join('\n\n');
};

const digestBlock = (digest: BattleStoryDeterministicDigest, index: number): string => {
  const lines = [`### 第 ${index} 章：${normalizeText(digest.chapterTitle) || `第 ${index} 章`}`];
  if (digest.winner) lines.push(`胜利者：${digest.winner}`);
  if (digest.officialConclusion) lines.push(`结论：${digest.officialConclusion}`);
  if (digest.bodyExcerpt) lines.push(`剧情摘要：${digest.bodyExcerpt}`);
  if (digest.impactDigest?.length) {
    lines.push(`角色变化：${digest.impactDigest.map((item) => [
      item.characterName,
      item.impact ? `变化=${item.impact}` : '',
      item.currentStateSummary ? `状态=${item.currentStateSummary}` : '',
    ].filter(Boolean).join(' / ')).join('；')}`);
  }
  return lines.join('\n');
};

export const buildBattleStorySummaryPrompt = (input: {
  previousSummary?: string;
  digests: Array<BattleStoryDeterministicDigest & { index: number }>;
  language: string;
}): string => [
  `请使用【${normalizeText(input.language) || 'zh-CN'}】生成一段“连续战报会话摘要”。`,
  '要求：只总结输入中已经出现的事实，不得编造新剧情；需要保留主线推进、胜负趋势、角色状态变化与仍未解决的矛盾；输出为一段供后续续写使用的紧凑摘要，不要写标题，不要写项目符号。',
  normalizeText(input.previousSummary) ? `【已有摘要】\n${normalizeText(input.previousSummary)}` : '',
  `【新增章节摘要材料】\n${input.digests.map((digest) => digestBlock(digest, digest.index)).join('\n\n')}`,
].filter(Boolean).join('\n\n');

export const buildBattleStorySummaryFallback = (input: {
  previousSummary?: string;
  digests: Array<BattleStoryDeterministicDigest & { index: number }>;
}): string => [
  normalizeText(input.previousSummary),
  input.digests.map((digest) => [
    `第${digest.index}章`,
    digest.chapterTitle,
    digest.winner ? `胜者：${digest.winner}` : '',
    digest.officialConclusion
      ? `结果：${digest.officialConclusion}`
      : digest.bodyExcerpt ? `经过：${digest.bodyExcerpt}` : '',
  ].filter(Boolean).join('，')).join('；'),
].filter(Boolean).join('；');

const stripMetaComments = (markdown: string): string => markdown
  .replace(/<!---*\s*(?:MAHOSHOJO_ARENA_META|MAHOSHOJO_META|MAHOSHOJO_STREAM_META|MAHOSHOJO_TELEMETRY_META)\b[\s\S]*?-->/giu, '')
  .trimEnd();

const stripInlineMarkdown = (input: string): string => input
  .replace(/<!--[\s\S]*?-->/gu, ' ')
  .replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
  .replace(/[`*_~>#]/gu, ' ')
  .replace(/^\s*[-+*]\s+/gmu, '')
  .replace(/\s+/gu, ' ')
  .trim();

const readNestedText = (root: unknown, path: string[]): string => {
  let cursor = root;
  for (const key of path) {
    if (!isRecord(cursor)) return '';
    cursor = cursor[key];
  }
  return normalizeText(cursor);
};

const normalizeImpactDigest = (
  impacts: unknown,
  rosterOrder?: string[],
  maxItems = DEFAULT_MAX_IMPACT_ITEMS,
): BattleStoryImpactDigestItem[] | undefined => {
  if (!Array.isArray(impacts)) return undefined;
  const token = (value: string): string => value.replace(/\s+/gu, '').toLowerCase();
  const entries = new Map<string, BattleStoryImpactDigestItem>();
  for (const raw of impacts) {
    if (!isRecord(raw)) continue;
    const characterName = normalizeText(raw.characterName ?? raw.name ?? raw.character ?? raw.character_name);
    if (!characterName) continue;
    const previous = entries.get(token(characterName));
    const impact = normalizeText(raw.impact) || previous?.impact;
    const currentStateSummary = normalizeText(raw.currentStateSummary ?? raw.current_state_summary)
      || previous?.currentStateSummary;
    entries.set(token(characterName), {
      characterName: previous?.characterName ?? characterName,
      ...(impact ? { impact } : {}),
      ...(currentStateSummary ? { currentStateSummary } : {}),
    });
  }
  const order = new Map((rosterOrder ?? []).map((name, index) => [token(name), index]));
  const result = [...entries.values()].sort((left, right) => {
    const leftIndex = order.get(token(left.characterName)) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = order.get(token(right.characterName)) ?? Number.MAX_SAFE_INTEGER;
    return leftIndex !== rightIndex
      ? leftIndex - rightIndex
      : left.characterName.localeCompare(right.characterName, 'zh-Hans-CN');
  }).slice(0, maxItems);
  return result.length > 0 ? result : undefined;
};

export const buildBattleStoryDeterministicDigest = (input: {
  markdown: string;
  reportJson?: Record<string, unknown> | null;
  impacts?: unknown;
  rosterOrder?: string[];
  chapterIndex?: number;
  bodyExcerptMaxChars?: number;
  maxImpactItems?: number;
}): BattleStoryDeterministicDigest => {
  const markdown = stripMetaComments(input.markdown);
  const report = isRecord(input.reportJson) ? input.reportJson : {};
  const title = markdown.split(/\r?\n/gu).flatMap((line) => {
    const match = line.trim().match(/^#{1,6}\s*(.+)$/u);
    return match?.[1] ? [match[1].trim()] : [];
  })[0] ?? '';
  const bodyLines: string[] = [];
  let seenTitle = false;
  for (const raw of markdown.split(/\r?\n/gu)) {
    const line = raw.trim();
    if (/^#{1,6}\s+/u.test(line)) {
      if (!seenTitle) {
        seenTitle = true;
        continue;
      }
      break;
    }
    if (line) bodyLines.push(line);
  }
  const body = stripInlineMarkdown(bodyLines.join('\n')) || stripInlineMarkdown(markdown);
  const bodyExcerpt = body
    ? truncateText(
      body,
      Math.max(80, Math.floor(input.bodyExcerptMaxChars ?? DEFAULT_BODY_EXCERPT_CHARS)),
    ).text
    : '';
  const winner = readNestedText(report, ['officialReport', 'winner'])
    || readNestedText(report, ['report', 'winner']);
  const conclusion = readNestedText(report, ['officialReport', 'conclusion'])
    || readNestedText(report, ['officialConclusion']);
  const impacts = normalizeImpactDigest(
    input.impacts,
    input.rosterOrder,
    Math.max(1, Math.floor(input.maxImpactItems ?? DEFAULT_MAX_IMPACT_ITEMS)),
  );
  return {
    chapterTitle: title
      || readNestedText(report, ['headline'])
      || readNestedText(report, ['report', 'headline'])
      || `第 ${Math.max(1, Math.floor(input.chapterIndex ?? 1))} 章`,
    ...(winner ? { winner } : {}),
    ...(conclusion ? { officialConclusion: conclusion } : {}),
    ...(bodyExcerpt ? { bodyExcerpt } : {}),
    ...(impacts ? { impactDigest: impacts } : {}),
  };
};
