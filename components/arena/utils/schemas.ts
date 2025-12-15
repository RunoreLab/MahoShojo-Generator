import { z } from 'zod/v3';

export const ScenarioSchema = z
  .object({
    title: z.string().min(1, '缺少 title'),
    elements: z.any(),
  })
  .passthrough();

export const BattleSettingsSchema = z.object({
  readArenaHistory: z.boolean(),
  readArenaHistoryLimit: z.number().min(1).max(999),
  isArenaHistoryUnlimited: z.boolean(),
  writeArenaHistory: z.boolean(),
  readCurrentState: z.boolean(),
  writeCurrentState: z.boolean(),
});

export const StoryPreferencesSchema = z.object({
  selectedLevel: z.string(),
  selectedLanguage: z.string().min(1, '请选择语言'),
  userGuidance: z.string().max(50, '提示语不应超过 50 字').optional(),
});

export type BattleSettingsFormValues = z.infer<typeof BattleSettingsSchema>;
export type StoryPreferencesFormValues = z.infer<typeof StoryPreferencesSchema>;
