import { z } from 'zod/v3';

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
