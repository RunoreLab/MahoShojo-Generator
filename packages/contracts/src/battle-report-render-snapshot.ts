import { z } from 'zod';

import { jsonUtf8ByteLength } from './wire-size';

export const MAX_BATTLE_REPORT_RENDER_SNAPSHOT_BYTES = 48 * 1_024;
export const MAX_BATTLE_REPORT_ADJUDICATION_RESULTS = 2_100;

export const BattleReportAdjudicationResultSchema = z.object({
  depth: z.number().int().min(0).max(20),
  description: z.string().max(2_000),
  type: z.enum(['binary', 'custom']),
  roll: z.number().int().min(1).max(100),
  outcome: z.string().max(2_000),
  details: z.string().max(2_000),
}).strict();

export type BattleReportAdjudicationResult = z.infer<typeof BattleReportAdjudicationResultSchema>;

export const BattleReportRenderSnapshotV1Schema = z.object({
  version: z.literal(1),
  reporterInfo: z.object({
    name: z.string().max(300),
    publication: z.string().max(300),
  }).strict().optional(),
  userGuidance: z.string().max(32_768).optional(),
  characterGuidances: z.array(z.object({
    characterName: z.string().max(300),
    guidance: z.string().max(100),
  }).strict()).max(32).optional(),
  adjudicationResults: z.array(BattleReportAdjudicationResultSchema)
    .max(MAX_BATTLE_REPORT_ADJUDICATION_RESULTS)
    .optional(),
  narrativeHistoryReadCount: z.number().int().nonnegative().max(1_000_000).optional(),
}).strict().superRefine((snapshot, context) => {
  if (jsonUtf8ByteLength(snapshot) <= MAX_BATTLE_REPORT_RENDER_SNAPSHOT_BYTES) return;
  context.addIssue({
    code: 'too_big',
    maximum: MAX_BATTLE_REPORT_RENDER_SNAPSHOT_BYTES,
    origin: 'object',
    inclusive: true,
    message: `battle report render snapshot must not exceed ${MAX_BATTLE_REPORT_RENDER_SNAPSHOT_BYTES} UTF-8 bytes`,
  });
});

export type BattleReportRenderSnapshotV1 = z.infer<typeof BattleReportRenderSnapshotV1Schema>;

export const parseBattleReportRenderSnapshotV1 = (
  input: unknown,
): BattleReportRenderSnapshotV1 | null => {
  const parsed = BattleReportRenderSnapshotV1Schema.safeParse(input);
  return parsed.success ? parsed.data : null;
};
