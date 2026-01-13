import { z } from 'zod/v3';
import { GENERAL_SCENARIO_TEMPLATE_ID } from '@/lib/schemas';

const StructuredScenarioSchema = z
  .object({
    title: z.string().min(1, '缺少 title'),
    elements: z.any(),
  })
  .passthrough();

const GeneralScenarioSchema = z
  .object({
    templateId: z.literal(GENERAL_SCENARIO_TEMPLATE_ID),
    name: z.string().min(1, '缺少 name'),
    content: z.string(),
  })
  .passthrough();

export const ScenarioSchema = z.union([StructuredScenarioSchema, GeneralScenarioSchema]);

export const BattleSettingsSchema = z.object({
  readArenaHistory: z.boolean(),
  readArenaHistoryLimit: z.number().min(1).max(999),
  isArenaHistoryUnlimited: z.boolean(),
  writeArenaHistory: z.boolean(),
  readCurrentState: z.boolean(),
  writeCurrentState: z.boolean(),
  readNarrativeHistory: z.boolean(),
  writeNarrativeHistory: z.boolean(),
});

export const StoryPreferencesSchema = z.object({
  selectedLevel: z.string(),
  selectedLanguage: z.string().min(1, '请选择语言'),
  userGuidance: z.string().max(200, '提示语不应超过 200 字').optional(),
});

export type BattleSettingsFormValues = z.infer<typeof BattleSettingsSchema>;
export type StoryPreferencesFormValues = z.infer<typeof StoryPreferencesSchema>;
