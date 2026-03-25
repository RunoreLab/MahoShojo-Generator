import { z } from 'zod/v3';

export const SCENARIO_BATTLE_STORY_MIN_TOTAL_CHAPTERS = 1;
export const SCENARIO_BATTLE_STORY_MAX_TOTAL_CHAPTERS = 20;

export const ScenarioBattleStoryPlanModeSchema = z.enum(['suggested', 'fixed']);

export const ScenarioBattleStoryExtensionSchema = z
  .object({
    total_chapters: z
      .number()
      .int()
      .min(SCENARIO_BATTLE_STORY_MIN_TOTAL_CHAPTERS)
      .max(SCENARIO_BATTLE_STORY_MAX_TOTAL_CHAPTERS),
    plan_mode: ScenarioBattleStoryPlanModeSchema.default('suggested'),
  })
  .strict();

export type ScenarioBattleStoryPlanMode = z.infer<typeof ScenarioBattleStoryPlanModeSchema>;
export type ScenarioBattleStoryExtension = z.infer<typeof ScenarioBattleStoryExtensionSchema>;

export type ScenarioBattleStoryConfig = {
  totalChapters: number;
  planMode: ScenarioBattleStoryPlanMode;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

export const normalizeScenarioBattleStoryTotalChapters = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const normalized = Math.floor(value);
  if (normalized !== value) return null;
  if (
    normalized < SCENARIO_BATTLE_STORY_MIN_TOTAL_CHAPTERS ||
    normalized > SCENARIO_BATTLE_STORY_MAX_TOTAL_CHAPTERS
  ) {
    return null;
  }
  return normalized;
};

export const parseScenarioBattleStoryExtension = (
  input: unknown
): ScenarioBattleStoryExtension | null => {
  const parsed = ScenarioBattleStoryExtensionSchema.safeParse(input);
  if (!parsed.success) return null;
  return parsed.data;
};

export const readScenarioBattleStoryConfig = (
  card: unknown
): ScenarioBattleStoryConfig | null => {
  if (!isRecord(card)) return null;
  const parsed = parseScenarioBattleStoryExtension(card._battle_story);
  if (!parsed) return null;
  return {
    totalChapters: parsed.total_chapters,
    planMode: parsed.plan_mode,
  };
};

export const toScenarioBattleStoryExtension = (
  config: ScenarioBattleStoryConfig | null | undefined
): ScenarioBattleStoryExtension | undefined => {
  if (!config) return undefined;
  const totalChapters = normalizeScenarioBattleStoryTotalChapters(config.totalChapters);
  if (!totalChapters) return undefined;
  const parsedMode = ScenarioBattleStoryPlanModeSchema.safeParse(config.planMode);
  if (!parsedMode.success) return undefined;
  return {
    total_chapters: totalChapters,
    plan_mode: parsedMode.data,
  };
};
