import { z } from 'zod';

// 残兽数据卡的 Zod Schema
export const CanshouSchema = z.object({
  name: z.string(),
  appearance: z.string(),
  materialAndSkin: z.string(),
  featuresAndAppendages: z.string(),
  coreConcept: z.string(),
  coreEmotion: z.string(),
  evolutionStage: z.string(),
  attackMethod: z.string(),
  specialAbility: z.string(),
  origin: z.string(),
  birthEnvironment: z.string(),
  researcherNotes: z.string(),
  templateId: z.string().optional(),
  userAnswers: z.record(z.string()).optional(),
  signature: z.string().optional(),
  arena_history: z.object({
    attributes: z.object({
      world_line_id: z.string(),
      created_at: z.string(),
      updated_at: z.string(),
      sublimation_count: z.number(),
      last_sublimation_at: z.string().nullable(),
    }),
    entries: z.array(z.object({
      id: z.number(),
      type: z.string(),
      title: z.string(),
      participants: z.array(z.string()),
      winner: z.string(),
      impact: z.string(),
      metadata: z.object({
        user_guidance: z.string().nullable(),
        scenario_title: z.string().nullable(),
        non_native_data_involved: z.boolean(),
      }),
    })),
  }).optional(),
}).catchall(z.unknown())
  .superRefine((data, ctx) => {
    for (const key in data) {
      if (!['name', 'appearance', 'materialAndSkin', 'featuresAndAppendages', 'coreConcept', 'coreEmotion', 'evolutionStage', 'attackMethod', 'specialAbility', 'origin', 'birthEnvironment', 'researcherNotes', 'templateId', 'userAnswers', 'signature', 'arena_history'].includes(key) && !key.startsWith('_')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `该属性不该存在: ${key}`
        });
      }
    }
  });

export type CanshouData = z.infer<typeof CanshouSchema>;