import { z } from 'zod/v3';
import { GENERAL_SCENARIO_TEMPLATE_ID } from '@/lib/schemas';

const StructuredScenarioSchema = z
  .object({
    title: z.string().min(1, '缺少 title'),
    elements: z.any(),
  })
  .passthrough();

const GeneralScenarioSchema = z
  .preprocess((input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
    const record = input as Record<string, unknown>;
    if (typeof record.title === 'string') return input;
    if (typeof record.name === 'string') {
      const { name: legacyName, ...rest } = record;
      return {
        ...rest,
        title: legacyName,
      };
    }
    return input;
  }, z
    .object({
      templateId: z.literal(GENERAL_SCENARIO_TEMPLATE_ID),
      title: z.string().min(1, '缺少 title'),
      content: z.string(),
    })
    .passthrough());

export const ScenarioSchema = z.union([StructuredScenarioSchema, GeneralScenarioSchema]);

export const BattleSettingsSchema = z.object({
  readArenaHistory: z.boolean(),
  readArenaHistoryLimit: z.number().min(1).max(999),
  isArenaHistoryUnlimited: z.boolean(),
  writeArenaHistory: z.boolean(),
  readCurrentState: z.boolean(),
  writeCurrentState: z.boolean(),
  readNarrativeHistory: z.boolean(),
  readNarrativeHistoryLimit: z.number().min(1).max(999),
  isNarrativeHistoryUnlimited: z.boolean(),
  writeNarrativeHistory: z.boolean(),
  streamTransport: z.enum(['sse', 'plain-stream']).default('sse'),
});

export const StoryPreferencesSchema = z.object({
  selectedLevel: z.string(),
  selectedLanguage: z.string().min(1, '请选择语言'),
  userGuidance: z.string().max(200, '提示语不应超过 200 字').optional(),
});

export type BattleSettingsFormValues = z.infer<typeof BattleSettingsSchema>;
export type StoryPreferencesFormValues = z.infer<typeof StoryPreferencesSchema>;
