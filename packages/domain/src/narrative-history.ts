import { z } from 'zod/v3';

/**
 * 「叙事历史」数据卡 payload schema（D5.0e 自 apps/web/lib/schemas 迁入）。
 *
 * 与 `questionnaire.ts` 里的 QuestionnaireSchema 一同参与数据卡类型判定：
 * `validateDataCard` 的多 schema 判定顺序中叙事历史排在问卷之前，因此
 * 「是不是问卷」的完整判定需要两个 schema 都可达（见 questionnaire-card）。
 */

export const NarrativeHistoryEntrySchema = z
  .object({
    id: z.string(),
    title: z.string(),
    content: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .catchall(z.unknown());

export const NarrativeHistorySchema = z
  .object({
    templateId: z.literal('narrative-history'),
    version: z.literal(1),
    title: z.string().optional(),
    updatedAt: z.string(),
    entries: z.array(NarrativeHistoryEntrySchema),
  })
  .catchall(z.unknown());

export type NarrativeHistoryData = z.infer<typeof NarrativeHistorySchema>;
