import { z } from 'zod/v3';
import { AdjudicatorEventSchema } from './adjudicator';
import { ScenarioBattleStoryExtensionSchema } from '@/lib/scenario-battle-story';

// 情景数据卡的 Zod Schema
export const ScenarioSchema = z.object({
  title: z.string(),
  scenario_type: z.string().optional(),
  description: z.string().optional(),
  elements: z.object({
    scene: z.object({
      time: z.string().optional(),
      place: z.string().optional(),
      features: z.string().optional(),
    }).optional(),
    roles: z.array(z.object({
      name: z.string().optional(),
      description: z.string().optional(),
    })).optional(),
    events: z.string().optional(),
    atmosphere: z.string().optional(),
    development: z.array(z.string()).optional(),
  }),
  metadata: z.object({
    created_at: z.string().optional(),
    signature: z.string().optional(),
  }).optional(),
  adjudicationEvents: z.array(AdjudicatorEventSchema).optional(),
  _battle_story: ScenarioBattleStoryExtensionSchema.optional(),
}).catchall(z.unknown())
  .superRefine((data, ctx) => {
    const allowedKeys = ['title', 'scenario_type', 'description', 'elements', 'metadata', 'adjudicationEvents', '_battle_story'];
    for (const key in data) {
      if (!allowedKeys.includes(key) && !key.startsWith('_')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `该属性不该存在: ${key}`
        });
      }
    }
  });

export type ScenarioData = z.infer<typeof ScenarioSchema>;
