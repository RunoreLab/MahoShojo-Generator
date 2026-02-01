import { z } from 'zod/v3';
import { CurrentStateSchema } from './current-state';
import { AdjudicatorEventSchema } from './adjudicator';

const keyList = [
  'codename',
  'appearance',
  'magicConstruct',
  'wonderlandRule',
  'blooming',
  'analysis',
  'templateId',
  'userAnswers',
  'signature',
  'arena_history',
  'current_state',
  'isPreset',
  'adjudicationEvents'
];

// 魔法少女数据卡的 Zod Schema
export const MagicalGirlSchema = z.object({
  codename: z.string(),
  appearance: z.object({
    outfit: z.string().optional(),
    accessories: z.string().optional(),
    colorScheme: z.string().optional(),
    overallLook: z.string().optional(),
  }).optional(),
  magicConstruct: z.object({
    name: z.string().optional(),
    form: z.string().optional(),
    basicAbilities: z.array(z.string()).optional(),
    description: z.string().optional(),
  }).optional(),
  wonderlandRule: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    tendency: z.string().optional(),
    activation: z.string().optional(),
  }).optional(),
  blooming: z.object({
    name: z.string().optional(),
    evolvedAbilities: z.array(z.string()).optional(),
    evolvedForm: z.string().optional(),
    evolvedOutfit: z.string().optional(),
    powerLevel: z.string().optional(),
  }).optional(),
  analysis: z.object({
    personalityAnalysis: z.string().optional(),
    abilityReasoning: z.string().optional(),
    coreTraits: z.array(z.string()).optional(),
    predictionBasis: z.string().optional(),
    background: z.object({
      belief: z.string().optional(),
      bonds: z.string().optional(),
    }).optional(),
  }).optional(),
  templateId: z.string().optional(),
  userAnswers: z.union([
    z.array(z.string()),
    z.array(z.object({
      question: z.string(),
      answer: z.string(),
      questionId: z.string().optional(),
      questionnaireId: z.string().optional(),
      questionnaireTitle: z.string().optional(),
    })),
    z.record(z.string()),
  ]).optional(),
  signature: z.string().optional(),
  isPreset: z.boolean().optional(),
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
      id: z.number().optional() || z.string().optional(),
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
    })).optional(),
  }).optional(),
  adjudicationEvents: z.array(AdjudicatorEventSchema).optional(),
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

export type MagicalGirlData = z.infer<typeof MagicalGirlSchema>;
