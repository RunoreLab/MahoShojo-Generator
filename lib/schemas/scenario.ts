import { z } from 'zod';

// 情景数据卡的 Zod Schema
export const ScenarioSchema = z.object({
  title: z.string(),
  scenario_type: z.string(),
  description: z.string(),
  elements: z.object({
    scene: z.object({
      time: z.string(),
      place: z.string(),
      features: z.string(),
    }),
    roles: z.array(z.object({
      name: z.string(),
      description: z.string(),
    })),
    events: z.string(),
    atmosphere: z.string(),
    development: z.array(z.string()),
  }),
  metadata: z.object({
    created_at: z.string(),
    signature: z.string(),
  }).optional(),
}).catchall(z.unknown())
  .superRefine((data, ctx) => {
    for (const key in data) {
      if (!['title', 'scenario_type', 'description', 'elements', 'metadata'].includes(key) && !key.startsWith('_')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `该属性不该存在: ${key}`
        });
      }
    }
  });

export type ScenarioData = z.infer<typeof ScenarioSchema>;