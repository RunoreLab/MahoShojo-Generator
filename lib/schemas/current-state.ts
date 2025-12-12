import { z } from 'zod/v3';

export const CurrentStateFieldSchema = z.object({
  id: z.string(),
  label: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean']),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

export const CurrentStateSchema = z.object({
  summary: z.string().default(''),
  fields: z.array(CurrentStateFieldSchema).default([]),
  updated_at: z.string().nullable().optional(),
});

export type CurrentStateData = z.infer<typeof CurrentStateSchema>;
