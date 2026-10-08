import { z } from 'zod/v3';

import {
  GENERAL_CHARACTER_TEMPLATE_ID,
  GENERAL_SCENARIO_TEMPLATE_ID,
} from '@mahoshojo/domain/data-cards';

import {
  formatReferenceAttachmentsForPrompt,
  type AITextAttachment,
} from './reference-attachments';

export const FREE_GENERATION_SCHEMA_IDS = [
  'magical-girl',
  'canshou',
  'scenario',
  'general',
  'general-scenario',
] as const;

export type FreeSchemaId = (typeof FREE_GENERATION_SCHEMA_IDS)[number];

export const FREE_STREAM_SCHEMA_IDS = ['general', 'general-scenario'] as const;

export type FreeStreamSchemaId = (typeof FREE_STREAM_SCHEMA_IDS)[number];

export type FreeGenerationInput = {
  prompt: string;
  language: string;
  attachments: AITextAttachment[];
};

export type FreeStructuredPromptInput = FreeGenerationInput & {
  schema: FreeSchemaId;
};

export type FreeStreamPromptInput = FreeGenerationInput & {
  schema: FreeStreamSchemaId;
};

const FreeMagicalGirlSchema = z.object({
  codename: z.string().describe('代号：建议使用花名/称号。'),
  appearance: z.object({
    outfit: z.string().describe('变身后的服装与衣装描述。若无明确要求可返回空字符串。'),
    accessories: z.string().describe('饰品细节。若无明确要求可返回空字符串。'),
    colorScheme: z.string().describe('主色调/配色方案。若无明确要求可返回空字符串。'),
    overallLook: z.string().describe('整体外观风格（发色/瞳色/体型/神态等）。若无明确要求可返回空字符串。'),
  }).describe('外观信息。'),
  magicConstruct: z.object({
    name: z.string().describe('魔装名称。若无明确要求可返回空字符串。'),
    form: z.string().describe('魔装形态/外观。若无明确要求可返回空字符串。'),
    basicAbilities: z.array(z.string()).describe('魔装基础能力列表。若无明确要求可返回空数组。'),
    description: z.string().describe('魔装详细描述与特色。若无明确要求可返回空字符串。'),
  }).describe('魔力构装（魔装）。'),
  wonderlandRule: z.object({
    name: z.string().describe('奇境规则名称。若无明确要求可返回空字符串。'),
    description: z.string().describe('规则内容与效果。若无明确要求可返回空字符串。'),
    tendency: z.string().describe('规则倾向类型。若无明确要求可返回空字符串。'),
    activation: z.string().describe('规则触发条件/方式。若无明确要求可返回空字符串。'),
  }).describe('奇境规则。'),
  blooming: z.object({
    name: z.string().describe('繁开状态名称。若无明确要求可返回空字符串。'),
    evolvedAbilities: z.array(z.string()).describe('繁开后的进化能力列表。若无明确要求可返回空数组。'),
    evolvedForm: z.string().describe('繁开后的魔装形态变化。若无明确要求可返回空字符串。'),
    evolvedOutfit: z.string().describe('繁开后的衣装样式。若无明确要求可返回空字符串。'),
    powerLevel: z.string().describe('繁开状态力量等级描述。若无明确要求可返回空字符串。'),
  }).describe('繁开形态。'),
  analysis: z.object({
    personalityAnalysis: z.string().describe('性格分析。若无明确要求可返回空字符串。'),
    abilityReasoning: z.string().describe('能力设定依据/推理。若无明确要求可返回空字符串。'),
    coreTraits: z.array(z.string()).describe('核心特质关键词列表。若无明确要求可返回空数组。'),
    predictionBasis: z.string().describe('预测依据/补充信息。若无明确要求可返回空字符串。'),
    background: z.object({
      belief: z.string().describe('信念/愿望/理念。若无明确要求可返回空字符串。'),
      bonds: z.string().describe('羁绊/关系。若无明确要求可返回空字符串。'),
    }).optional().describe('背景故事（可选）。'),
  }).describe('分析与背景。'),
});

const FreeCanshouSchema = z.object({
  name: z.string().describe('残兽名称。'),
  appearance: z.string().describe('外貌形态描述。若无明确要求可返回空字符串。'),
  materialAndSkin: z.string().describe('材质与表皮描述。若无明确要求可返回空字符串。'),
  featuresAndAppendages: z.string().describe('特征与附肢描述。若无明确要求可返回空字符串。'),
  coreConcept: z.string().describe('核心概念。若无明确要求可返回空字符串。'),
  coreEmotion: z.string().describe('核心情绪/欲望。若无明确要求可返回空字符串。'),
  evolutionStage: z.string().describe('进化阶段。若无明确要求可返回空字符串。'),
  attackMethod: z.string().describe('主要攻击方式。若无明确要求可返回空字符串。'),
  specialAbility: z.string().describe('特殊能力与机制。若无明确要求可返回空字符串。'),
  origin: z.string().describe('起源故事。若无明确要求可返回空字符串。'),
  birthEnvironment: z.string().describe('诞生环境。若无明确要求可返回空字符串。'),
  researcherNotes: z.string().describe('研究员分析/警告/备注。若无明确要求可返回空字符串。'),
});

const FreeScenarioSchema = z.object({
  title: z.string().describe('情景标题。'),
  scenario_type: z.string().describe('情景类型（如：日常/调查/竞技/采访等）。若无明确要求可返回空字符串。'),
  description: z.string().describe('情景简短描述。若无明确要求可返回空字符串。'),
  elements: z.object({
    scene: z.object({
      time: z.string().describe('故事发生时间。若无明确要求可返回空字符串。'),
      place: z.string().describe('故事发生地点。若无明确要求可返回空字符串。'),
      features: z.string().describe('环境特征与陈设。若无明确要求可返回空字符串。'),
    }).describe('场景信息。'),
    roles: z.array(z.object({
      name: z.string().describe('角色名称/身份。'),
      description: z.string().describe('角色设定/目标/行为准则。'),
    })).describe('预设 NPC 列表；如不需要可返回空数组。'),
    events: z.string().describe('核心事件（发生什么、冲突点、互动目标）。若无明确要求可返回空字符串。'),
    atmosphere: z.string().describe('整体氛围。若无明确要求可返回空字符串。'),
    development: z.array(z.string()).describe('发展方向列表；如不需要可返回空数组。'),
  }).describe('情景要素。'),
});

const FreeGeneralCharacterSchema = z.object({
  name: z.string().describe('角色名。'),
  content: z.string().describe('角色设定正文（建议 Markdown）。'),
});

const FreeGeneralScenarioSchema = z.object({
  title: z.string().describe('情景名。'),
  content: z.string().describe('情景设定正文（建议 Markdown）。'),
});

export const buildFreeFieldGuide = (schemaId: FreeSchemaId): string => {
  switch (schemaId) {
    case 'magical-girl':
      return `
字段含义（魔法少女数据卡）：
- codename：代号（建议花名/称号）。
- appearance：外观（可选）。
  - outfit：服装与衣装。
  - accessories：饰品细节。
  - colorScheme：主色调/配色方案。
  - overallLook：整体外观（发色/瞳色/体型/气质等）。
- magicConstruct：魔装（可选）。
  - name：名字。
  - form：形态/外观。
  - basicAbilities：基础能力列表（字符串数组）。
  - description：描述与特色。
- wonderlandRule：奇境规则（可选）。
  - name：名称。
  - description：规则内容。
  - tendency：倾向。
  - activation：触发方式/条件。
- blooming：繁开（可选）。
  - name：繁开形态名。
  - evolvedAbilities：进化能力列表（字符串数组）。
  - evolvedForm：进化后的魔装形态。
  - evolvedOutfit：进化后的衣装。
  - powerLevel：力量等级描述。
- analysis：分析（可选）。
  - personalityAnalysis：性格分析。
  - abilityReasoning：能力设定依据/推理。
  - coreTraits：核心特质（字符串数组）。
  - predictionBasis：预测依据。
  - background：背景（可选）。
    - belief：信念/愿望/理念。
    - bonds：羁绊/关系。
- templateId：模板标识（自由生成会被标记为“自由生成”来源）。
- signature：原生签名（自由生成禁止输出）。
`.trim();
    case 'canshou':
      return `
字段含义（残兽数据卡）：
- name：名称。
- appearance：外观（可选）。
- materialAndSkin：材质与皮肤（可选）。
- featuresAndAppendages：特征与附肢（可选）。
- coreConcept：核心概念（可选）。
- coreEmotion：核心情绪（可选）。
- evolutionStage：进化阶段（可选）。
- attackMethod：攻击方式（可选）。
- specialAbility：特殊能力（可选）。
- origin：起源（可选）。
- birthEnvironment：诞生环境（可选）。
- researcherNotes：研究员备注（可选）。
- templateId：模板标识（自由生成会被标记为“自由生成”来源）。
- signature：原生签名（自由生成禁止输出）。
`.trim();
    case 'scenario':
      return `
字段含义（结构化情景数据卡）：
- title：情景标题（必需）。
- scenario_type：情景类型（可选）。
- description：简短描述（可选）。
- elements：情景要素（必需）。
  - scene：场景（可选）。
    - time：时间（可选）。
    - place：地点（可选）。
    - features：环境特征（可选）。
  - roles：预设角色/NPC（可选数组）。
    - name：名称/身份（可选）。
    - description：设定/目标/行为准则（可选）。
  - events：核心事件（可选）。
  - atmosphere：整体氛围（可选）。
  - development：发展方向（可选字符串数组）。
- metadata：元信息（可选）。
  - created_at：创建时间（可选）。
  - signature：原生签名（自由生成禁止输出）。
`.trim();
    case 'general':
      return `
字段含义（通用角色数据卡）：
- templateId：固定为 "通用角色"。
- name：角色名。
- content：角色设定正文（建议 Markdown）。
- current_state：当前状态（可选）。
`.trim();
    case 'general-scenario':
      return `
字段含义（通用情景数据卡）：
- templateId：固定为 "通用情景"。
- title：情景名。
- content：情景设定正文（建议 Markdown）。
`.trim();
  }
};

export const FREE_GENERATION_SCHEMAS: Record<FreeSchemaId, z.ZodType> = {
  'magical-girl': FreeMagicalGirlSchema,
  canshou: FreeCanshouSchema,
  scenario: FreeScenarioSchema,
  general: FreeGeneralCharacterSchema,
  'general-scenario': FreeGeneralScenarioSchema,
};

export const isFreeStreamSchemaId = (schemaId: FreeSchemaId): schemaId is FreeStreamSchemaId =>
  (FREE_STREAM_SCHEMA_IDS as readonly string[]).includes(schemaId);

export const FREE_GENERATION_SYSTEM_PROMPT = '你的任务是创作具有指定数据结构的内容。';
export const FREE_GENERATION_TEMPERATURE = 0.7;
export const FREE_GENERATION_TASK_NAME = '自由生成数据卡';
export const FREE_STREAM_TEMPERATURE = 0.75;

export const buildFreeStructuredPrompt = (input: FreeStructuredPromptInput): string => `
请严格按照我指定的 Schema 输出一个 JSON 对象（只输出 JSON，不要输出解释）。
你必须遵守 Schema 的字段名与数据类型；不要创建 Schema 中不存在的字段。
你必须输出 Schema 中的【全部字段】（包含嵌套对象中的字段）。如果用户没有提供信息，请使用空字符串 "" 或空数组 [] 作为占位，不要省略对象结构。
内容语言：请使用【${input.language}】撰写所有自然语言字段。

${buildFreeFieldGuide(input.schema)}

${formatReferenceAttachmentsForPrompt(input.attachments)}

用户提示词：
${input.prompt}
`.trim();

export const createFreeGenerationConfig = (schemaId: FreeSchemaId) => ({
  systemPrompt: FREE_GENERATION_SYSTEM_PROMPT,
  temperature: FREE_GENERATION_TEMPERATURE,
  promptBuilder: (input: FreeGenerationInput): string =>
    buildFreeStructuredPrompt({ schema: schemaId, ...input }),
  schema: FREE_GENERATION_SCHEMAS[schemaId],
  taskName: FREE_GENERATION_TASK_NAME,
});

export const buildFreeStreamPrompt = (input: FreeStreamPromptInput): string => {
  const attachmentsSection = formatReferenceAttachmentsForPrompt(input.attachments);
  if (input.schema === 'general') {
    return `
你将根据【用户提示词】生成一份【通用角色卡】的正文内容。

输出要求：
1) 必须使用【${input.language}】创作。
2) 必须直接输出 Markdown 正文，不要输出任何解释。
3) 第 1 行必须是一级标题（以 "# " 开头），写角色名或代号，不超过 30 字。
4) 在开头 20 行内，尽量给出明确字段（若无法推断可写“未指定”）：
   - 代号：...
   - 名字：...
5) 正文建议包含：外观、性格、能力与限制、背景与动机、关系与羁绊、战斗风格、常用台词/行为准则（可选）。

${attachmentsSection}

【用户提示词】
${input.prompt}
`.trim();
  }

  return `
你将根据【用户提示词】生成一份【通用情景卡】的正文内容。

输出要求：
1) 必须使用【${input.language}】创作。
2) 必须直接输出 Markdown 正文，不要输出任何解释。
3) 第 1 行必须是一级标题（以 "# " 开头），写情景标题，不超过 30 字。
4) 在开头 20 行内，尽量给出明确字段（若无法推断可写“未指定”）：
   - 标题：...
5) 正文建议包含：场景概览、时间、地点、环境特征、预设 NPC（可选）、核心事件、整体氛围、发展方向（多条）。

${attachmentsSection}

【用户提示词】
${input.prompt}
`.trim();
};

export const validateFreeOutput = (
  input: { schemaId: FreeSchemaId; data: unknown },
): unknown => {
  const parsed = FREE_GENERATION_SCHEMAS[input.schemaId].parse(input.data) as Record<string, unknown>;
  switch (input.schemaId) {
    case 'magical-girl':
      return {
        ...parsed,
        templateId: '魔法少女/心之花/魔法少女（自由生成）',
      };
    case 'canshou':
      return {
        ...parsed,
        templateId: '魔法少女/心之花/残兽（自由生成）',
      };
    case 'general':
      return { ...parsed, templateId: GENERAL_CHARACTER_TEMPLATE_ID };
    case 'general-scenario':
      return { ...parsed, templateId: GENERAL_SCENARIO_TEMPLATE_ID };
    case 'scenario': {
      const record = input.data as { metadata?: { created_at?: unknown } };
      return {
        ...parsed,
        metadata: {
          created_at: z.string().parse(record.metadata?.created_at),
        },
      };
    }
  }
};

export const sanitizeFreeCard = (
  schemaId: FreeSchemaId,
  data: unknown,
  createdAt: string,
): unknown => {
  const cloned = JSON.parse(JSON.stringify(data ?? {})) as Record<string, unknown>;
  delete cloned.signature;
  delete cloned.isPreset;
  delete cloned.userAnswers;
  if (cloned.metadata && typeof cloned.metadata === 'object') {
    delete (cloned.metadata as Record<string, unknown>).signature;
  }

  if (schemaId === 'magical-girl') {
    cloned.templateId = '魔法少女/心之花/魔法少女（自由生成）';
  } else if (schemaId === 'canshou') {
    cloned.templateId = '魔法少女/心之花/残兽（自由生成）';
  } else if (schemaId === 'general') {
    cloned.templateId = GENERAL_CHARACTER_TEMPLATE_ID;
  } else if (schemaId === 'general-scenario') {
    cloned.templateId = GENERAL_SCENARIO_TEMPLATE_ID;
  } else {
    const metadata = cloned.metadata && typeof cloned.metadata === 'object'
      ? cloned.metadata as Record<string, unknown>
      : {};
    cloned.metadata = {
      ...metadata,
      created_at: metadata.created_at ?? createdAt,
    };
  }

  return cloned;
};
