import { z } from 'zod';

// 魔法少女数据卡的 Zod Schema
export const MagicalGirlSchema = z.object({
  codename: z.string(),
  appearance: z.object({
    outfit: z.string(),
    accessories: z.string(),
    colorScheme: z.string(),
    overallLook: z.string(),
  }),
  magicConstruct: z.object({
    name: z.string(),
    form: z.string(),
    basicAbilities: z.array(z.string()),
    description: z.string(),
  }),
  wonderlandRule: z.object({
    name: z.string(),
    description: z.string(),
    tendency: z.string(),
    activation: z.string(),
  }).optional(),
  blooming: z.object({
    name: z.string(),
    evolvedAbilities: z.array(z.string()),
    evolvedForm: z.string(),
    evolvedOutfit: z.string(),
    powerLevel: z.string(),
  }),
  analysis: z.object({
    personalityAnalysis: z.string(),
    abilityReasoning: z.string(),
    coreTraits: z.array(z.string()),
    predictionBasis: z.string(),
    background: z.object({
      belief: z.string(),
      bonds: z.string(),
    }),
  }),
  templateId: z.string().optional(),
  userAnswers: z.array(z.string()).optional(),
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
      if (!['codename', 'appearance', 'magicConstruct', 'wonderlandRule', 'blooming', 'analysis', 'templateId', 'userAnswers', 'signature', 'arena_history'].includes(key) && !key.startsWith('_')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `该属性不该存在: ${key}`
        });
      }
    }
  });

export type MagicalGirlData = z.infer<typeof MagicalGirlSchema>;