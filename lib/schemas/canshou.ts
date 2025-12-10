import { z } from 'zod/v3';
import { CurrentStateSchema } from './current-state';
import { AdjudicatorEventSchema } from './adjudicator';

const keyList = [
  'name',
  'appearance',
  'materialAndSkin',
  'featuresAndAppendages',
  'coreConcept',
  'coreEmotion',
  'evolutionStage',
  'attackMethod',
  'specialAbility',
  'origin',
  'birthEnvironment',
  'researcherNotes',
  'templateId',
  'userAnswers',
  'signature',
  'arena_history',
  'current_state',
  'isPreset',
  'adjudicationEvents'
];
// 残兽数据卡的 Zod Schema
export const CanshouSchema = z.object({
  name: z.string(),
  appearance: z.string().optional(),
  materialAndSkin: z.string().optional(),
  featuresAndAppendages: z.string().optional(),
  coreConcept: z.string().optional(),
  coreEmotion: z.string().optional(),
  evolutionStage: z.string().optional(),
  attackMethod: z.string().optional(),
  specialAbility: z.string().optional(),
  origin: z.string().optional(),
  birthEnvironment: z.string().optional(),
  researcherNotes: z.string().optional(),
  templateId: z.string().optional(),
  userAnswers: z.union([z.record(z.string()), z.array(z.string())]).optional(),
  isPreset: z.boolean().optional(),
  signature: z.string().optional(),
  adjudicationEvents: z.array(AdjudicatorEventSchema).optional(),
  current_state: CurrentStateSchema.optional(),
  arena_history: z.object({
    attributes: z.object({
      world_line_id: z.string().optional(),
      created_at: z.string().optional(),
      updated_at: z.string().optional(),
      sublimation_count: z.number().optional(),
      last_sublimation_at: z.string().nullable().optional(),
    }).optional(),
    entries: z.array(z.object({
      id: z.number().optional(),
      type: z.string().optional(),
      title: z.string().optional(),
      participants: z.array(z.string()).optional(),
      winner: z.string().optional(),
      impact: z.string().optional(),
      metadata: z.object({
        user_guidance: z.string().nullable().optional(),
        scenario_title: z.string().nullable().optional(),
        non_native_data_involved: z.boolean().optional(),
      }).optional(),
    })),
  }).optional(),
}).catchall(z.unknown())
  .superRefine((data, ctx) => {
    for (const key in data) {
      if (!keyList.includes(key) && !key.startsWith('_')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `该属性不该存在: ${key}`
        });
      }
    }
  });

export type CanshouData = z.infer<typeof CanshouSchema>;
