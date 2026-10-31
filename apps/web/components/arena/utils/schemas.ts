import { z } from 'zod/v3';
import {
  BATTLE_REPORT_CARD_WIDTH_MAX,
  BATTLE_REPORT_CARD_WIDTH_MIN,
} from './battleReportCardWidth';

export { ArenaScenarioSchema as ScenarioSchema } from '@mahoshojo/domain/arena-scenario';

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
  streamTransport: z.preprocess(
    (value) => value === 'plain-stream' ? 'sse' : value,
    z.literal('sse').default('sse'),
  ),
  battleReportCardWidthMode: z.enum(['auto', 'manual']).optional(),
  battleReportCardWidthPx: z.number().min(BATTLE_REPORT_CARD_WIDTH_MIN).max(BATTLE_REPORT_CARD_WIDTH_MAX).optional(),
});

export const StoryPreferencesSchema = z.object({
  selectedLanguage: z.string().min(1, '请选择语言'),
  userGuidance: z.string().max(200, '提示语不应超过 200 字').optional(),
});

export type BattleSettingsFormValues = z.infer<typeof BattleSettingsSchema>;
export type StoryPreferencesFormValues = z.infer<typeof StoryPreferencesSchema>;
