import { z } from 'zod/v3';

import { GENERAL_CHARACTER_TEMPLATE_ID, GENERAL_SCENARIO_TEMPLATE_ID, type DataCardTemplate } from './data-cards';
import { ScenarioBattleStoryExtensionSchema } from './scenario-battle-story';

// 五模板数据卡 payload schema（D5.1-P2-r5-r1 自 apps/web/lib/schemas 迁入）。
//
// 这些是数据卡 `data` 正文的领域形状，跨 runtime 共用：Web `data-card-converter`
// 与 Desktop 角色管理在模板转换结果上跑同一道 `parse` 门禁，「非法结构即抛」
// 的失败路径两端一致。schema 本体逐字等价于 Web 原实现——迁移不改校验语义。
// 注意各 schema 均为 catchall passthrough：parse 只做校验不做裁剪，且不包含
// 「读即升级」副作用（通用情景 name→title 的兼容升级属于 `isGeneralScenarioCard`）。

export const AdjudicatorEventSchema: z.ZodType<any> = z.lazy(() => z.object({
  id: z.string().optional(),
  description: z.string().optional(),
  type: z.enum(['binary', 'custom']).optional(),
  probability: z.number().min(0).max(100).optional(),
  onSuccess: z.object({ event: AdjudicatorEventSchema }).optional(),
  onFailure: z.object({ event: AdjudicatorEventSchema }).optional(),
  outcomes: z.array(z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    probability: z.number().min(0).max(100).optional(),
    chainedEvent: z.object({ event: AdjudicatorEventSchema }).optional()
  })).optional()
}));

export const CreatorBuildRuleSnapshotSchema = z.object({
  ruleId: z.string(),
  version: z.string().optional(),
  blockResults: z.record(z.unknown()).default({}),
  derived: z.record(z.unknown()).default({}),
  validationSummary: z.record(z.unknown()).default({}),
});

export const CreationInputsSchema = z.object({
  template: z.string(),
  freeformBrief: z.string().nullable().optional(),
  questionnaires: z.array(z.unknown()).default([]),
  questionnaireAnswers: z.array(z.unknown()).default([]),
  buildRules: z.array(CreatorBuildRuleSnapshotSchema).default([]),
  primaryRuleId: z.string().nullable().optional(),
});

export const BuildStateSchema = z.object({
  primaryRuleId: z.string().nullable().optional(),
  rules: z.array(CreatorBuildRuleSnapshotSchema).default([]),
});

export type CreatorBuildRuleSnapshot = z.infer<typeof CreatorBuildRuleSnapshotSchema>;
export type CreationInputs = z.infer<typeof CreationInputsSchema>;
export type BuildState = z.infer<typeof BuildStateSchema>;

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

const QuestionnaireAnswerItemSchema = z.object({
  question: z.string(),
  answer: z.string(),
  questionId: z.string().optional(),
  questionnaireId: z.string().optional(),
  questionnaireTitle: z.string().optional(),
});

const MAGICAL_GIRL_KEYS = [
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
  'adjudicationEvents',
  'creationInputs',
  'buildState',
];

const CANSHOU_KEYS = [
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
  'adjudicationEvents',
  'creationInputs',
  'buildState',
];

const userAnswersShape = () => z.union([
  z.array(z.string()),
  z.array(QuestionnaireAnswerItemSchema),
  z.record(z.union([
    z.string(),
    z.object({
      question: z.string().optional(),
      answer: z.string().optional(),
      value: z.string().optional(),
      questionId: z.string().optional(),
      questionnaireId: z.string().optional(),
      questionnaireTitle: z.string().optional(),
    }),
  ])),
]);

const arenaHistoryEntrySchema = z.object({
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
});

// 共享预览读取现有契约；新增出口不改变卡片校验或持久化语义。
export { arenaHistoryEntrySchema as ArenaHistoryEntrySchema };

const arenaHistoryAttributesSchema = z.object({
  world_line_id: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  sublimation_count: z.number().optional(),
  last_sublimation_at: z.string().nullable().optional(),
}).optional();

const arenaHistoryEntryArray = z.array(arenaHistoryEntrySchema);

// 两类角色卡的 arena_history 共用同一形状，但 `entries` 必填性在旧实现中不同：
// Canshou 只要出现 arena_history 就必须带 entries；MagicalGirl 的 entries 本就
// optional。保持为两个显式 schema 而不是 boolean 参数化——条件返回会把 entries
// 推导成 union，造成「运行时 required、编译期 optional」的类型漂移（D5.1-P2-r5-r3）。
const magicalGirlArenaHistorySchema = z.object({
  attributes: arenaHistoryAttributesSchema,
  entries: arenaHistoryEntryArray.optional(),
}).optional();

const canshouArenaHistorySchema = z.object({
  attributes: arenaHistoryAttributesSchema,
  entries: arenaHistoryEntryArray,
}).optional();

const rejectUnknownTopLevelKeys = (allowedKeys: readonly string[]) =>
  (data: Record<string, unknown>, ctx: z.RefinementCtx) => {
    for (const key in data) {
      if (!allowedKeys.includes(key) && !key.startsWith('_')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `该属性不该存在: ${key}`
        });
      }
    }
  };

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
  userAnswers: userAnswersShape().optional(),
  signature: z.string().optional(),
  isPreset: z.boolean().optional(),
  current_state: CurrentStateSchema.optional(),
  creationInputs: CreationInputsSchema.optional(),
  buildState: BuildStateSchema.optional(),
  arena_history: magicalGirlArenaHistorySchema,
  adjudicationEvents: z.array(AdjudicatorEventSchema).optional(),
}).catchall(z.unknown())
  .superRefine(rejectUnknownTopLevelKeys(MAGICAL_GIRL_KEYS));

export type MagicalGirlData = z.infer<typeof MagicalGirlSchema>;

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
  userAnswers: userAnswersShape().optional(),
  isPreset: z.boolean().optional(),
  signature: z.string().optional(),
  adjudicationEvents: z.array(AdjudicatorEventSchema).optional(),
  current_state: CurrentStateSchema.optional(),
  creationInputs: CreationInputsSchema.optional(),
  buildState: BuildStateSchema.optional(),
  arena_history: canshouArenaHistorySchema,
}).catchall(z.unknown())
  .superRefine(rejectUnknownTopLevelKeys(CANSHOU_KEYS));

export type CanshouData = z.infer<typeof CanshouSchema>;

/**
 * 通用角色数据卡的 Zod Schema
 * - templateId 固定为 “通用角色”
 * - name 为角色名
 * - content 使用 Markdown 或其他自由文本，承载角色设定
 * 允许携带额外字段以兼容未来扩展（如签名、作者信息等）
 */
export const GeneralCharacterSchema = z.object({
  templateId: z.literal(GENERAL_CHARACTER_TEMPLATE_ID).default(GENERAL_CHARACTER_TEMPLATE_ID),
  name: z.string(),
  content: z.string(),
  current_state: CurrentStateSchema.optional(),
}).catchall(z.unknown());

export type GeneralCharacterData = z.infer<typeof GeneralCharacterSchema>;

/**
 * 通用情景数据卡的 Zod Schema
 * - templateId 固定为 “通用情景”
 * - title 为情景名（与问卷生成情景卡保持一致）
 * - content 使用 Markdown 或其他自由文本，承载情景设定
 * 兼容旧字段：允许使用 name 作为 title 的旧别名（解析时会归一化为 title）。
 * 允许携带额外字段以兼容未来扩展（如签名、作者信息等）
 */
const normalizeGeneralScenarioInput = (input: unknown) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;

  const name = typeof record.name === 'string' ? record.name : undefined;
  const title = typeof record.title === 'string' ? record.title : undefined;

  if (!name) return input;

  const rest = { ...record };
  delete rest.name;
  return {
    ...rest,
    title: title ?? name,
  };
};

export const GeneralScenarioSchema = z.preprocess(
  normalizeGeneralScenarioInput,
  z.object({
    templateId: z.literal(GENERAL_SCENARIO_TEMPLATE_ID).default(GENERAL_SCENARIO_TEMPLATE_ID),
    title: z.string(),
    content: z.string(),
    _battle_story: ScenarioBattleStoryExtensionSchema.optional(),
  }).catchall(z.unknown())
);

export type GeneralScenarioData = z.infer<typeof GeneralScenarioSchema>;

const SCENARIO_KEYS = [
  'title',
  'scenario_type',
  'description',
  'elements',
  'metadata',
  'adjudicationEvents',
  'creationInputs',
  'buildState',
  '_battle_story',
];

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
  creationInputs: CreationInputsSchema.optional(),
  buildState: BuildStateSchema.optional(),
  _battle_story: ScenarioBattleStoryExtensionSchema.optional(),
}).catchall(z.unknown())
  .superRefine(rejectUnknownTopLevelKeys(SCENARIO_KEYS));

export type ScenarioData = z.infer<typeof ScenarioSchema>;

export type DataCardSchemaByTemplate = {
  'magical-girl': MagicalGirlData;
  canshou: CanshouData;
  general: GeneralCharacterData;
  scenario: ScenarioData;
  'general-scenario': GeneralScenarioData;
};

/**
 * 按目标模板跑 schema 门禁：与 Web `data-card-converter` 的 `Schema.parse` 同一组
 * schema，非法结构即抛。`sublimation` 的转换实现自身不做 zod 校验，调用方需要
 * 「转换结果必须过 schema」的语义时经此入口收口。
 */
export const parseDataCardByTemplate = <T extends DataCardTemplate>(
  template: T,
  data: unknown,
): DataCardSchemaByTemplate[T] => {
  switch (template) {
    case 'magical-girl':
      return MagicalGirlSchema.parse(data) as DataCardSchemaByTemplate[T];
    case 'canshou':
      return CanshouSchema.parse(data) as DataCardSchemaByTemplate[T];
    case 'general':
      return GeneralCharacterSchema.parse(data) as DataCardSchemaByTemplate[T];
    case 'scenario':
      return ScenarioSchema.parse(data) as DataCardSchemaByTemplate[T];
    case 'general-scenario':
      return GeneralScenarioSchema.parse(data) as DataCardSchemaByTemplate[T];
  }
};
