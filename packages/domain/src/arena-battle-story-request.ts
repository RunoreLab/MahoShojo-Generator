import { z } from 'zod/v3';
import { ARENA_CANONICAL_CAPABILITIES, ARENA_CANONICAL_RESOURCE_LIMITS } from '@mahoshojo/contracts/arena-capabilities';
import {
  buildBattleStoryInternalGuidance, buildBattleStoryPromptContext,
  normalizeBattleStoryTotalChapters, validateBattleStoryGenerateNextInput,
  type BattleStorySessionSettings, type BattleStorySessionAction,
  type BattleStoryChapterPlan, type BattleStoryChapterPlanLimit,
  type BattleStoryPromptChapterInput, type BattleStoryPromptWindowItem,
} from './arena-battle-story-session';

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

/** The existing Hosted session seed, without provider, credentials or draft-only fields. */
export type BattleStoryArenaSeed = {
  combatants: unknown[];
  mode: 'classic' | 'kizuna' | 'daily' | 'scenario';
  language: string;
  storyLength: 'default' | 'short' | 'standard' | 'detailed' | 'long';
  customStoryLength?: string;
  scenario?: Record<string, unknown> | null;
  auxScenarios?: Record<string, unknown>[];
  materials?: unknown[];
  adjudicationEvents?: unknown[];
  questionnaires?: Array<{ id: string; title: string; kind: 'magical-girl' | 'canshou'; useLore?: boolean; loreMarkdown?: string }>;
  settings: BattleStorySessionSettings;
};

const isStoryCombatants = (value: unknown): value is unknown[] => Array.isArray(value)
  && value.length >= 1 && value.length <= ARENA_CANONICAL_CAPABILITIES.maxCombatants
  && value.every((entry) => isRecord(entry) && isRecord(entry.data));
const isOptionalString = (value: unknown): boolean => value === undefined || typeof value === 'string';
const isOptionalBoolean = (value: unknown): boolean => value === undefined || typeof value === 'boolean';
const isOptionalReadLimit = (value: unknown): boolean => value === undefined
  || typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 999;
const isStorySeed = (value: unknown): value is BattleStoryArenaSeed => {
  if (!isRecord(value) || !isStoryCombatants(value.combatants) || !isRecord(value.settings)) return false;
  const settings = value.settings;
  if (typeof value.mode !== 'string' || !['classic', 'kizuna', 'daily', 'scenario'].includes(value.mode)
    || typeof value.storyLength !== 'string' || !['default', 'short', 'standard', 'detailed', 'long'].includes(value.storyLength)
    || typeof value.language !== 'string' || !isOptionalString(value.customStoryLength)
    || !['readArenaHistory', 'writeArenaHistory', 'readCurrentState', 'writeCurrentState', 'readNarrativeHistory', 'writeNarrativeHistory']
      .every((key) => typeof settings[key] === 'boolean')
    || !isOptionalBoolean(settings.isArenaHistoryUnlimited) || !isOptionalBoolean(settings.isNarrativeHistoryUnlimited)
    || !isOptionalReadLimit(settings.readArenaHistoryLimit) || !isOptionalReadLimit(settings.readNarrativeHistoryLimit)
    || value.scenario !== undefined && value.scenario !== null && !isRecord(value.scenario)) return false;
  for (const key of ['auxScenarios', 'materials', 'questionnaires']) {
    if (value[key] !== undefined && (!Array.isArray(value[key]) || value[key].length > ARENA_CANONICAL_CAPABILITIES.maxReferenceItemsSanity)) return false;
  }
  if (Array.isArray(value.auxScenarios) && !value.auxScenarios.every(isRecord)) return false;
  if (value.adjudicationEvents !== undefined && (!Array.isArray(value.adjudicationEvents)
    || value.adjudicationEvents.length > ARENA_CANONICAL_RESOURCE_LIMITS.maxAdjudicationEvents)) return false;
  return !Array.isArray(value.questionnaires) || value.questionnaires.every((entry) => isRecord(entry)
    && typeof entry.id === 'string' && entry.id.length > 0 && typeof entry.title === 'string' && entry.title.length > 0
    && typeof entry.kind === 'string' && ['magical-girl', 'canshou'].includes(entry.kind) && isOptionalBoolean(entry.useLore) && isOptionalString(entry.loreMarkdown));
};

/** A non-cloning semantic check for persisted seed carriers, before large input preflight. */
export const BattleStoryArenaSeedSchema = z.custom<BattleStoryArenaSeed>(isStorySeed, '连续故事种子无效');

export type BattleStoryArenaRequestInput = {
  action: BattleStorySessionAction;
  sourceChapterId?: string;
  chapterIndex?: number;
  chapterPlan?: BattleStoryChapterPlan | BattleStoryChapterPlanLimit | null;
  seed: BattleStoryArenaSeed;
  chapterContext: {
    workingCombatants: unknown[];
    sessionSummary?: string;
  } & (
    | { recentChapters: BattleStoryPromptChapterInput[]; recentWindow?: never }
    | { recentWindow: BattleStoryPromptWindowItem[]; recentChapters?: never }
  );
  userGuidance?: string;
};

const resolveStoryReadLimit = (enabled: boolean, limit: number | undefined, unlimited: boolean | undefined, fallback: number): number | null | undefined => (
  !enabled ? undefined : unlimited === true ? null
    : typeof limit === 'number' && Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : fallback
);

/** Business field projection used by the Hosted authority wrapper as well as the pure constructor.
 * This does not confer authority: ordinary draft/request projections must never call it with user text.
 */
export const projectBattleStoryArenaPayload = (input: Pick<BattleStoryArenaRequestInput, 'seed' | 'chapterContext' | 'userGuidance'>, internalGuidance: string) => ({
  combatants: input.chapterContext.workingCombatants,
  mode: input.seed.mode,
  userGuidance: input.userGuidance,
  internalGuidance,
  scenario: input.seed.scenario ?? undefined,
  auxScenarios: input.seed.auxScenarios,
  materials: input.seed.materials,
  adjudicationEvents: input.seed.adjudicationEvents,
  language: input.seed.language,
  readArenaHistory: input.seed.settings.readArenaHistory,
  arenaHistoryReadLimit: resolveStoryReadLimit(input.seed.settings.readArenaHistory, input.seed.settings.readArenaHistoryLimit, input.seed.settings.isArenaHistoryUnlimited, 3),
  writeArenaHistory: input.seed.settings.writeArenaHistory,
  readCurrentState: input.seed.settings.readCurrentState,
  writeCurrentState: input.seed.settings.writeCurrentState,
  readNarrativeHistory: input.seed.settings.readNarrativeHistory,
  narrativeHistoryReadLimit: resolveStoryReadLimit(input.seed.settings.readNarrativeHistory, input.seed.settings.readNarrativeHistoryLimit, input.seed.settings.isNarrativeHistoryUnlimited, 10),
  writeNarrativeHistory: input.seed.settings.writeNarrativeHistory,
  storyLength: input.seed.storyLength,
  customStoryLength: input.seed.customStoryLength,
  questionnaires: input.seed.questionnaires,
  forceStreamMeta: true,
});

/** Pure continuous-chapter semantics. Signing and dispatch remain host-owned. */
export const buildBattleStoryArenaRequest = (input: BattleStoryArenaRequestInput) => {
  BattleStoryArenaSeedSchema.parse(input.seed);
  if (!['start', 'continue', 'branch', 'rewrite'].includes(input.action)
    || input.chapterIndex !== undefined && (!Number.isSafeInteger(input.chapterIndex) || input.chapterIndex < 1)
    || input.sourceChapterId !== undefined && (typeof input.sourceChapterId !== 'string' || !input.sourceChapterId)
    || input.chapterPlan != null && (!isRecord(input.chapterPlan) || normalizeBattleStoryTotalChapters(input.chapterPlan.totalChapters) === null)
    || !isRecord(input.chapterContext) || !isStoryCombatants(input.chapterContext.workingCombatants)
    || !isOptionalString(input.chapterContext.sessionSummary) || !isOptionalString(input.userGuidance)) throw new Error('连续故事章节输入无效');
  const recent = input.chapterContext.recentWindow;
  if (recent !== undefined && input.chapterContext.recentChapters !== undefined) throw new Error('连续故事上下文只能使用一种章节投影');
  if (recent !== undefined && (!Array.isArray(recent) || recent.some((item) => !isRecord(item)))
    || input.chapterContext.recentChapters !== undefined && (!Array.isArray(input.chapterContext.recentChapters)
      || input.chapterContext.recentChapters.some((item) => !isRecord(item) || typeof item.markdown !== 'string'))) throw new Error('连续故事章节窗口无效');
  const chapters = recent?.map((item) => ({ id: item.chapterId, index: item.chapterIndex })) ?? input.chapterContext.recentChapters ?? [];
  if (chapters.length > 12 || chapters.some((item) => typeof item.id !== 'string' || !item.id || !Number.isSafeInteger(item.index) || item.index < 1)) throw new Error('连续故事章节窗口无效');
  if (recent?.some((item) => typeof item.title !== 'string' || typeof item.text !== 'string'
    || !['digest', 'full'].includes(item.mode) || typeof item.truncated !== 'boolean')) throw new Error('连续故事章节投影无效');
  const validation = validateBattleStoryGenerateNextInput({
    action: input.action, sourceChapterId: input.sourceChapterId, chapterIndex: input.chapterIndex,
    chapterPlan: input.chapterPlan ?? undefined, recentChapters: chapters,
  });
  if (!validation.ok) throw new Error(validation.error);
  const context = buildBattleStoryPromptContext({
    baseContext: 'arena-provided', chapterPlan: input.chapterPlan, chapterIndex: validation.chapterIndex,
    sessionSummary: input.chapterContext.sessionSummary, recentWindow: recent,
    recentChapters: input.chapterContext.recentChapters, userGuidance: input.userGuidance,
  });
  return projectBattleStoryArenaPayload(input, buildBattleStoryInternalGuidance({
    action: input.action, chapterIndex: validation.chapterIndex, sourceChapterId: input.sourceChapterId,
    chapterPlan: input.chapterPlan, context,
  }));
};

