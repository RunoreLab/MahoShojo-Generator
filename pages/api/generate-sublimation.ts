// pages/api/generate-sublimation.ts

import { z } from 'zod/v3';
import { generateWithAI, GenerationConfig, LoadBalanceStrategy } from '../../lib/ai';
import { getLogger } from '../../lib/logger';
import { NextRequest } from 'next/server';
import { generateSignature, verifySignature } from '@/lib/signature';
import magicalGirlQuestionnaire from '../../public/questionnaire.json';
import { config as appConfig, type AIProvider } from '../../lib/config';
import { enforceTextSafety } from '@/lib/content-safety/server';
import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';
import {
  convertDataCard,
  createBlankDataCard,
  inferTemplate,
  TEMPLATE_LABELS,
  type DataCardTemplate,
  type InferableTemplate
} from '@/lib/data-card-converter';
import { GENERAL_CHARACTER_TEMPLATE_ID } from '@/lib/schemas/general-character';

const log = getLogger('api-gen-sublimation');

export const config = {
  runtime: 'edge',
};

type SupportedTargetTemplate = 'magical-girl' | 'canshou' | 'general';

const SUPPORTED_TARGET_TEMPLATES: SupportedTargetTemplate[] = ['magical-girl', 'canshou', 'general'];
const SUPPORTED_SOURCE_TEMPLATES: DataCardTemplate[] = ['magical-girl', 'canshou', 'general', 'scenario'];

const isSupportedTargetTemplate = (value: unknown): value is SupportedTargetTemplate =>
  typeof value === 'string' && SUPPORTED_TARGET_TEMPLATES.includes(value as SupportedTargetTemplate);

const isSupportedSourceTemplate = (value: unknown): value is DataCardTemplate =>
  typeof value === 'string' && SUPPORTED_SOURCE_TEMPLATES.includes(value as DataCardTemplate);

const getFullPayloadSchema = (target: SupportedTargetTemplate, options?: { allowReshapeNames?: boolean }) => {
  switch (target) {
    case 'magical-girl':
      return FullMagicalGirlSublimationPayloadSchemaFactory(Boolean(options?.allowReshapeNames));
    case 'canshou':
      return FullCanshouSublimationPayloadSchema;
    case 'general':
    default:
      return FullGeneralSublimationPayloadSchema;
  }
};

// =================================================================
// 1. Zod Schema 定义
// =================================================================

/**
 * @description 这是一个“完全体”的魔法少女Schema，包含了所有可能被用户选择进行升华的字段。
 * 我们将基于这个Schema，根据用户的选择动态地移除那些需要“保留”的字段。
 */
const CurrentStateUpdateSchema = z.object({
  summary: z.string().describe('角色当前状态的摘要，1-2句话描述角色身体状况、心境或想法等。')
}).partial().optional();

const FullMagicalGirlSublimationPayloadSchemaFactory = (allowReshapeNames: boolean) => z.object({
  codename: z.string().describe("角色的新代号，必须包含原始代号并在后面加上一个「称号」。例如，如果原始代号是'代号'，新代号可以是'代号「称号」'。"),
  appearance: z.object({
    outfit: z.string(),
    accessories: z.string(),
    colorScheme: z.string(),
    overallLook: z.string(),
  }).describe("根据角色经历更新后的外观描述。"),
  magicConstruct: z.object({
    name: z.string().describe(
      allowReshapeNames
        ? "魔装的名字。"
        : "魔装的名字(此字段为固定值，不应修改)。"
    ),
    form: z.string().describe("魔装形态的演变。"),
    basicAbilities: z.array(z.string()).describe("基础能力的进化或新增，不得重复。"),
    description: z.string().describe("对魔装当前状态的全新描述。"),
  }),
  wonderlandRule: z.object({
    name: z.string().describe(
      allowReshapeNames
        ? "奇境的名字。"
        : "奇境的名字(此字段为固定值，不应修改)。"
    ),
    description: z.string(),
    tendency: z.string(),
    activation: z.string(),
  }).describe("奇境规则的改变。"),
  blooming: z.object({
    name: z.string().describe(
      allowReshapeNames
        ? "繁开的名字。"
        : "繁开的名字(此字段为固定值，不应修改)。"
    ),
    evolvedAbilities: z.array(z.string()),
    evolvedForm: z.string(),
    evolvedOutfit: z.string(),
    powerLevel: z.string(),
  }).describe("繁开状态的改变。"),
  analysis: z.object({
    personalityAnalysis: z.string().describe("角色经历一系列事件后的性格分析。"),
    abilityReasoning: z.string().describe("能力进化的内在逻辑和原因。"),
    coreTraits: z.array(z.string()).describe("更新后的核心性格关键词。"),
    predictionBasis: z.string().describe("对角色成长发展的分析依据。"),
    background: z.object({
      belief: z.string().describe("角色信念的演变或深化。"),
      bonds: z.string().describe("角色情感羁绊的变化。"),
    }).describe("角色背景故事的演进。")
  }).describe("对角色分析的全面更新。"),
  userAnswers: z.array(z.string()).optional().describe("根据角色的成长，对问卷问题的全新回答。"),
  current_state: CurrentStateUpdateSchema,
});

/**
 * @description “完全体”的残兽Schema。
 */
const FullCanshouSublimationPayloadSchema = z.object({
  name: z.string().describe("残兽的新名称，必须包含原始名称并在后面加上一个「称号」。例如，如果原始名称是'名称'，新名称可以是'名称「称号」'。"),
  coreConcept: z.string(),
  coreEmotion: z.string(),
  evolutionStage: z.string(),
  appearance: z.string(),
  materialAndSkin: z.string(),
  featuresAndAppendages: z.string(),
  attackMethod: z.string(),
  specialAbility: z.string(),
  origin: z.string(),
  birthEnvironment: z.string(),
  researcherNotes: z.string().describe("研究员对这次升华的补充笔记。"),
  userAnswers: z.array(z.string()).optional().describe("根据残兽的成长，对问卷问题的全新回答。"),
  current_state: CurrentStateUpdateSchema,
});

const FullGeneralSublimationPayloadSchema = z.object({
  name: z.string().describe('角色的新名称，建议在原始名称基础上追加一个以「」包裹的称号来凸显成长。'),
  content: z.string().describe('角色的完整设定文本；需要涵盖外观、能力、背景、性格、重要经历等全部要点，建议使用结构化 Markdown。'),
  current_state: CurrentStateUpdateSchema,
});


// 升华事件的通用Schema
const SublimationEventSchema = z.object({
  title: z.string().describe("描述本次升华事件的标题。"),
  impact: z.string().describe("对本次升华事件的描述，解释角色是如何被过往经历影响，最终蜕变到新状态的。")
}).describe("描述角色如何升华的事件。");

/**
 * @description 从对象顶层移除指定字段，主要用于控制传递给 AI 的上下文。
 */
const pruneTopLevelFields = (target: Record<string, any>, fields: Iterable<string>) => {
  if (!target || typeof target !== 'object') {
    return;
  }
  for (const field of fields) {
    if (field in target) {
      delete target[field];
    }
  }
};

/**
 * 核心函数：根据用户选择，动态构建AI所需的Zod Schema。
 * @param baseSchema - “完全体”的基础Schema。
 * @param fieldsToPreserve - 用户选择要保持不变的字段键名数组（已清洗）。
 * @returns 一个新的Zod Schema，仅包含AI需要生成的部分。
 */
const createDynamicSchema = (baseSchema: z.ZodObject<any>, fieldsToPreserve: string[]) => {
  const omitShape = fieldsToPreserve.reduce<Record<string, true>>((acc, field) => {
    if (field in baseSchema.shape) {
      acc[field] = true;
    }
    return acc;
  }, {});

  const dynamicSchema = Object.keys(omitShape).length > 0
    ? baseSchema.omit(omitShape)
    : baseSchema;

  // 最终返回一个包含动态生成部分和固定“升华事件”部分的Schema
  return z.object({
    updatedCharacterData: dynamicSchema.describe("一个JSON对象，仅包含所有被AI更新后的字段。"),
    sublimationEvent: SublimationEventSchema
  });
};

// =================================================================
// 2. AI Prompt 配置
// =================================================================

const CustomProviderSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  apiKey: z.string(),
});

const formatCurrentStateForPrompt = (state: any): string => {
  if (!state) {
    return '无（未记录当前状态，可根据其他设定自行判断）。';
  }
  const lines: string[] = [];
  if (typeof state.summary === 'string' && state.summary.trim()) {
    lines.push(`- 状态摘要: ${state.summary.trim()}`);
  }
  if (Array.isArray(state.fields) && state.fields.length > 0) {
    lines.push('- 结构化状态点:');
    state.fields.forEach((field: any) => {
      const type = field?.type ?? typeof field?.value;
      let value = field?.value;
      if (type === 'boolean') {
        value = value ? '是' : '否';
      }
      lines.push(`  • ${field?.label ?? '未命名字段'} (${type}): ${value}`);
    });
  }
  if (lines.length === 0) {
    return '无（当前状态字段为空，AI可结合叙事自行推断）。';
  }
  return lines.join('\n');
};

const createGenerationConfig = (
  originalData: any,
  baseOutputData: any,
  language: string,
  userGuidance: string | null,
  sourceTemplate: InferableTemplate,
  targetTemplate: SupportedTargetTemplate,
  fieldsToPreserve: string[],
  allowReshapeNames: boolean,
  isDowngrade: boolean = false,
  modelOverride?: string,
  stateOptions?: {
    readArenaHistory: boolean;
    writeArenaHistory: boolean;
    readCurrentState: boolean;
    writeCurrentState: boolean;
  }
): GenerationConfig<any, any> => {
  const baseSchema = getFullPayloadSchema(targetTemplate, { allowReshapeNames });
  const schemaKeys = Object.keys(baseSchema.shape);
  const sanitizedFieldsToPreserve = fieldsToPreserve.filter(field => schemaKeys.includes(field));
  const autoSchemaOmissions: string[] = [];

  if (stateOptions?.writeCurrentState === false && schemaKeys.includes('current_state')) {
    autoSchemaOmissions.push('current_state');
  }

  const effectiveSchemaOmissions = Array.from(new Set([...sanitizedFieldsToPreserve, ...autoSchemaOmissions]));
  const fieldsToGenerate = schemaKeys.filter(key => !effectiveSchemaOmissions.includes(key));

  const nameField = targetTemplate === 'magical-girl' ? 'codename' : 'name';
  const targetLabel = TEMPLATE_LABELS[targetTemplate];
  const sourceLabel = sourceTemplate === 'unknown' ? '未知模板' : TEMPLATE_LABELS[sourceTemplate];

  const promptBuilder = () => {
    const dataForPrompt = JSON.parse(JSON.stringify(originalData || {}));
    delete dataForPrompt.signature;

    const outputSkeletonForPrompt = JSON.parse(JSON.stringify(baseOutputData || {}));
    delete outputSkeletonForPrompt.signature;

    const includeHistory = stateOptions?.readArenaHistory !== false;
    const includeCurrentState = stateOptions?.readCurrentState !== false;

    const promptOmissionSet = new Set(effectiveSchemaOmissions);
    if (!includeHistory) {
      promptOmissionSet.add('arena_history');
    }
    if (!includeCurrentState) {
      promptOmissionSet.add('current_state');
    }

    const historyEntries = includeHistory && Array.isArray(dataForPrompt?.arena_history?.entries)
      ? dataForPrompt.arena_history.entries
      : [];
    const historyText = includeHistory
      ? (historyEntries.length > 0
        ? historyEntries
          .map((entry: any) => {
            const title = entry?.title ? `“${entry.title}”` : '（未命名事件）';
            const winner = entry?.winner ?? '未知胜者';
            const impact = entry?.impact ?? '影响未记录';
            return `- 事件${title}：胜利者 ${winner}，对角色的影响是“${impact}”`;
          })
          .join('\n')
        : '无（原始素材未包含历战记录，可直接基于设定内容完成升华）')
      : '用户选择不提供历战记录，本次升华请只参考当前设定。';

    const currentStateText = includeCurrentState
      ? formatCurrentStateForPrompt(dataForPrompt?.current_state)
      : '用户选择不提供当前状态，本次升华请根据设定自行推断角色的即时状态。';

    let userAnswersReviewSection = '';
    const allowUserAnswersInPrompt = !promptOmissionSet.has('userAnswers');
    if (allowUserAnswersInPrompt && Array.isArray(dataForPrompt?.userAnswers) && dataForPrompt.userAnswers.length > 0) {
      const questions = magicalGirlQuestionnaire.questions;
      const userAnswersText = dataForPrompt.userAnswers
        .map((answer: string, index: number) => {
          const question = questions[index] || `问题 ${index + 1}`;
          return `Q: ${question}\nA: ${answer}`;
        })
        .join('\n');
      userAnswersReviewSection = `\n## 问卷回答回顾 (用于理解角色深层性格)\n${userAnswersText}`;
    }

    let guidanceInstruction = '';
    if (userGuidance) {
      guidanceInstruction = `\n## 成长方向引导\n角色可以朝这个方向成长升华：“${userGuidance}”。请在重塑角色时将此作为最重要的参考。`;
    }

    const rules: string[] = [];
    const fieldsToGenerateText = fieldsToGenerate.length > 0
      ? `\`${fieldsToGenerate.join('`, `')}\``
      : '（列表为空时，仅需返回 updatedCharacterData 的空对象，同时确保升华事件完整）';

    rules.push(`**任务范围**: 你的任务是 **只生成** 以下字段的全新内容：${fieldsToGenerateText}。`);

    if (sanitizedFieldsToPreserve.length > 0) {
      rules.push(`**保留字段**: 你 **绝对不能** 在 JSON 输出中包含以下字段：\`${sanitizedFieldsToPreserve.join('`, `')}\`。这些字段由用户选择保留，你无需关心。`);
    } else {
      rules.push('**保留字段**: 用户未指定保留字段，你可以根据需要重塑所有字段。');
    }

    if (fieldsToGenerate.includes(nameField)) {
      rules.push(`**称号规则**: 角色名称字段(\`${nameField}\`)必须更新。该字段的结构为 \`{代号/名称}\` 或 \`{代号/名称}「{称号}」\`。你 **不可** 修改 \`{代号/名称}\` 部分，但 **必须** 为其生成或更新一个4个字左右（1~8个字）的 \`{称号}\`，并以「」包裹，以体现其新状态。`);
    }

    if (targetTemplate === 'general' && fieldsToGenerate.includes('content')) {
      rules.push('**通用角色设定**: `content` 字段需要完整描述角色的外观、能力、背景、性格、重要经历等关键信息，建议使用结构化 Markdown 段落与小标题。');
    }

    rules.push('**生成升华事件**:  你还需要创作一个“升华事件”，简要描述角色是如何从这些经历中收获成长，升华到新状态的。');

    if (stateOptions?.writeCurrentState === false) {
      rules.push('**当前状态**: 用户禁用了当前状态写入，你不得在输出中新增或修改 `current_state` 字段。');
    } else {
      rules.push('**当前状态同步**: 如果输出的 `updatedCharacterData` 中包含 `current_state`，请专注更新 `summary`，不要更改已有 `fields` 的结构与取值。');
    }

    const rulesText = rules.map((rule, index) => `${index + 1}.  ${rule}`).join('\n');

    const promptOmittedFields = Array.from(promptOmissionSet);
    pruneTopLevelFields(dataForPrompt, promptOmittedFields);
    pruneTopLevelFields(outputSkeletonForPrompt, promptOmittedFields);

    return `
# 角色成长升华任务
你是一位资深的角色设定师。你的任务是为一个${targetLabel}角色进行“成长升华”。
你需要基于其完整的设定和所有“历战记录”（如有），对其进行一次全面的重塑和升级，以体现其成长与蜕变。

## 模板信息
- 原始素材类型：${sourceLabel}
- 目标输出模板：${targetLabel}
- 输出语言：${language}

${guidanceInstruction}

## 原始角色设定
\`\`\`json
${JSON.stringify(dataForPrompt, null, 2)}
\`\`\`

## 目标模板初始结构（供参考，可在其基础上重塑）
\`\`\`json
${JSON.stringify(outputSkeletonForPrompt, null, 2)}
\`\`\`

## 历战记录回顾
${historyText}

## 当前状态
${currentStateText}
${userAnswersReviewSection}

## 升华规则 (必须严格遵守)
${rulesText}

请严格按照提供的 JSON Schema 返回结果，使用【${language}】进行内容创作。`;
  };

  const finalSchema = createDynamicSchema(baseSchema, effectiveSchemaOmissions);

  return {
    systemPrompt: '你是一位资深的角色设定师，擅长根据角色的经历描绘其成长与蜕变。',
    temperature: 0.7,
    promptBuilder,
    schema: finalSchema,
    taskName: '角色成长升华',
    maxOutputTokens: 8192,
    modelOverride: modelOverride ?? (isDowngrade ? 'gemini-2.5-flash-lite' : undefined),
  };
};


// =================================================================
// 3. 辅助函数
// =================================================================

function isObject(item: any): boolean {
  return (item && typeof item === 'object' && !Array.isArray(item));
}

/**
 * 安全地深度合并两个对象。源对象的属性会覆盖目标对象的属性。
 * @param target - 目标对象，将被覆盖。
 * @param source - 源对象，提供更新数据。
 * @returns {any} 返回一个合并后的新对象。
 */
function safeDeepMerge(target: any, source: any): any {
  const output = { ...target };
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key]) && key in target && isObject(target[key])) {
        output[key] = safeDeepMerge(target[key], source[key]);
      } else {
        output[key] = source[key];
      }
    });
  }
  return output;
}

// =================================================================
// 4. API Handler
// =================================================================

async function handler(req: NextRequest): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

	  try {
	    const body = await req.json();
	    const {
	      language = 'zh-CN',
	      userGuidance = '',
	      fieldsToPreserve = [],
	      isDowngrade = false,
	      allowReshapeNames = false,
	      customProvider: customProviderPayload,
	      targetTemplate: requestedTargetTemplate,
	      sourceTemplate: requestedSourceTemplate,
	      readArenaHistory,
	      writeArenaHistory,
	      readCurrentState,
	      writeCurrentState,
	      ...originalCharacterData
	    } = body;
	    const resolvedReadArenaHistory = typeof readArenaHistory === 'boolean' ? readArenaHistory : true;
	    const resolvedWriteArenaHistory = typeof writeArenaHistory === 'boolean' ? writeArenaHistory : true;
	    const resolvedReadCurrentState = typeof readCurrentState === 'boolean' ? readCurrentState : true;
	    const resolvedWriteCurrentState = typeof writeCurrentState === 'boolean' ? writeCurrentState : true;
	    const resolvedAllowReshapeNames = typeof allowReshapeNames === 'boolean' ? allowReshapeNames : false;
	    const finalUserGuidance = userGuidance.trim() || null;

	    // 安全检查
	    const textToCheck = extractTextForCheck(originalCharacterData) + " " + (finalUserGuidance || '');
	    const safetyResponse = await enforceTextSafety({
	      text: textToCheck,
	      log,
	      enableAiSafetyCheck: false,
	      sensitiveWordReason: '上传的角色档案或引导内容包含危险符文',
	    });
	    if (safetyResponse) return safetyResponse;

    const inferredSourceTemplate = inferTemplate(originalCharacterData) as InferableTemplate;
    const bodySourceTemplate = isSupportedSourceTemplate(requestedSourceTemplate) ? requestedSourceTemplate : null;
    const sourceTemplate: InferableTemplate = bodySourceTemplate ?? inferredSourceTemplate;

    let targetTemplate: SupportedTargetTemplate;
    if (isSupportedTargetTemplate(requestedTargetTemplate)) {
      targetTemplate = requestedTargetTemplate;
    } else if (isSupportedTargetTemplate(sourceTemplate)) {
      targetTemplate = sourceTemplate as SupportedTargetTemplate;
    } else {
      targetTemplate = 'general';
    }

    let baseOutputData: any;
    let conversionWarnings: string[] = [];
    try {
      const conversionResult = convertDataCard(originalCharacterData, targetTemplate, sourceTemplate);
      baseOutputData = conversionResult.data;
      conversionWarnings = conversionResult.warnings || [];
      if (conversionWarnings.length > 0) {
        log.info('转换到目标模板时产生警告', { warnings: conversionWarnings, targetTemplate });
      }
    } catch (conversionError) {
      log.warn('角色数据转换目标模板失败，使用空白模板兜底', { error: conversionError instanceof Error ? conversionError.message : conversionError, targetTemplate });
      baseOutputData = createBlankDataCard(targetTemplate);
    }

	    const targetSchema = getFullPayloadSchema(targetTemplate, { allowReshapeNames: resolvedAllowReshapeNames });
	    const schemaKeys = Object.keys(targetSchema.shape);
    const sanitizedFieldsToPreserve = Array.isArray(fieldsToPreserve)
      ? (fieldsToPreserve as string[]).filter(field => schemaKeys.includes(field))
      : [];

    let customProviderOverride: AIProvider | null = null;
    let customProviderId: string | null = null;
    let customModelOverride: string | undefined;
    if (customProviderPayload) {
      const parsedResult = CustomProviderSchema.safeParse(customProviderPayload);
      if (!parsedResult.success) {
        log.warn('自定义 AI 供应商配置校验失败', { providerId: customProviderPayload?.providerId, issues: parsedResult.error.issues });
        return new Response(JSON.stringify({ error: '自定义 AI 供应商配置无效' }), { status: 400 });
      }

      const parsed = parsedResult.data;
      customProviderId = parsed.providerId;
      const providerConfig = AI_PROVIDER_CATALOG.find(item => item.id === parsed.providerId);
      if (!providerConfig) {
        return new Response(JSON.stringify({ error: '未知的模型供应商 ID' }), { status: 400 });
      }

      const modelConfig = providerConfig.models.find(model => model.value === parsed.modelId);
      if (!modelConfig) {
        return new Response(JSON.stringify({ error: '未知的模型 ID' }), { status: 400 });
      }

      const sanitizedApiKey = parsed.apiKey.trim();
      if (!sanitizedApiKey && providerConfig.id !== 'system') {
        return new Response(JSON.stringify({ error: 'API Key 不能为空' }), { status: 400 });
      }

      const sanitizedBaseUrl = providerConfig.baseUrl?.trim() ?? '';
      if (!sanitizedBaseUrl) {
        customModelOverride = modelConfig.value;
        log.info('检测到 baseUrl 为空的自定义供应商，改用系统默认通道，仅覆盖模型参数', {
          providerId: providerConfig.id,
          model: modelConfig.value,
        });
      } else {
        customProviderOverride = {
          name: providerConfig.name,
          apiKey: sanitizedApiKey,
          baseUrl: sanitizedBaseUrl,
          model: modelConfig.value,
          type: providerConfig.type,
          mode: providerConfig.mode || 'auto',
          retryCount: 1,
          skipProbability: 0,
        };
      }
    }

    const shouldDisablePolling = customProviderId !== null && customProviderId !== 'system';

    const isNative = await verifySignature(originalCharacterData);
	    const generationConfig = createGenerationConfig(
	      originalCharacterData,
	      baseOutputData,
	      language,
	      finalUserGuidance,
	      sourceTemplate,
	      targetTemplate,
	      sanitizedFieldsToPreserve,
	      resolvedAllowReshapeNames,
	      isDowngrade,
	      customModelOverride,
	      {
	        readArenaHistory: resolvedReadArenaHistory,
	        writeArenaHistory: resolvedWriteArenaHistory,
        readCurrentState: resolvedReadCurrentState,
        writeCurrentState: resolvedWriteCurrentState,
      }
    );

    const providerOptions = (customProviderOverride || shouldDisablePolling)
      ? {
        ...(customProviderOverride ? { providerOverride: customProviderOverride } : {}),
        ...(shouldDisablePolling ? { loadBalanceStrategy: LoadBalanceStrategy.CUSTOM } : { loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL }),
      }
      : undefined;

    const aiResult = await generateWithAI(null, generationConfig, providerOptions);
    const updatedDataFromAI = aiResult.updatedCharacterData;

    // --- 数据整合与签名 ---
    // 1. 创建目标模板的数据副本作为基础
    const sublimatedData: any = JSON.parse(JSON.stringify(baseOutputData));

    // 1.1 确保 templateId 存在且符合目标模板
    if (!sublimatedData.templateId) {
      sublimatedData.templateId = targetTemplate === 'magical-girl'
        ? '魔法少女/心之花/魔法少女（问卷生成）'
        : targetTemplate === 'canshou'
          ? '魔法少女/心之花/残兽（问卷生成）'
          : GENERAL_CHARACTER_TEMPLATE_ID;
      log.info('为升华结果补充了目标模板的 templateId', { targetTemplate });
    }

    // 2. 合并 AI 生成的新数据
    Object.assign(sublimatedData, safeDeepMerge(sublimatedData, updatedDataFromAI));

    // 3. 重新应用不可变字段，确保模板关键字段不会被修改
    if (targetTemplate === 'magical-girl' && !resolvedAllowReshapeNames) {
      const baseMagicName = baseOutputData?.magicConstruct?.name;
      const baseWonderlandName = baseOutputData?.wonderlandRule?.name;
      const baseBloomingName = baseOutputData?.blooming?.name;
      if (baseMagicName && sublimatedData.magicConstruct) {
        sublimatedData.magicConstruct.name = baseMagicName;
      }
      if (baseWonderlandName && sublimatedData.wonderlandRule) {
        sublimatedData.wonderlandRule.name = baseWonderlandName;
      }
      if (baseBloomingName && sublimatedData.blooming) {
        sublimatedData.blooming.name = baseBloomingName;
      }
    }

    if (resolvedWriteArenaHistory) {
      const historyEntriesFromSource = Array.isArray(originalCharacterData?.arena_history?.entries)
        ? [...originalCharacterData.arena_history.entries]
        : (Array.isArray(sublimatedData?.arena_history?.entries) ? [...sublimatedData.arena_history.entries] : []);

      const sublimationHistoryEntries = historyEntriesFromSource.filter((entry: any) => entry?.type === 'sublimation');
      const participantsName = targetTemplate === 'magical-girl'
        ? sublimatedData.codename
        : sublimatedData.name;

      const lastEntryId = sublimationHistoryEntries.reduce((maxId: number, entry: any) => {
        const numericId = typeof entry?.id === 'number'
          ? entry.id
          : Number(entry?.id);
        return Number.isFinite(numericId) ? Math.max(maxId, numericId as number) : maxId;
      }, 0);

      sublimationHistoryEntries.push({
        id: lastEntryId + 1,
        type: 'sublimation',
        title: aiResult.sublimationEvent.title,
        participants: participantsName ? [participantsName] : [],
        winner: participantsName ?? '未知角色',
        impact: aiResult.sublimationEvent.impact,
        metadata: { user_guidance: finalUserGuidance, scenario_title: null, non_native_data_involved: !isNative || !!finalUserGuidance }
      });

      const nowISO = new Date().toISOString();
      const existingAttributes = originalCharacterData?.arena_history?.attributes
        || sublimatedData?.arena_history?.attributes
        || {};
      const ensureWorldLineId = () => {
        if (existingAttributes.world_line_id) return existingAttributes.world_line_id;
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
          return crypto.randomUUID();
        }
        return `world-${Math.random().toString(16).slice(2, 10)}`;
      };

      const previousCountRaw = (existingAttributes as any).sublimation_count;
      const previousCount = typeof previousCountRaw === 'number'
        ? previousCountRaw
        : Number(previousCountRaw ?? 0) || 0;

      sublimatedData.arena_history = {
        attributes: {
          world_line_id: ensureWorldLineId(),
          created_at: existingAttributes.created_at ?? nowISO,
          updated_at: nowISO,
          sublimation_count: previousCount + 1,
          last_sublimation_at: nowISO
        },
        entries: sublimationHistoryEntries
      };
    } else if (originalCharacterData?.arena_history) {
      sublimatedData.arena_history = JSON.parse(JSON.stringify(originalCharacterData.arena_history));
    }

    if (resolvedWriteCurrentState) {
      if (sublimatedData.current_state) {
        const preservedFields = Array.isArray(originalCharacterData?.current_state?.fields)
          ? JSON.parse(JSON.stringify(originalCharacterData.current_state.fields))
          : Array.isArray(sublimatedData.current_state.fields)
            ? JSON.parse(JSON.stringify(sublimatedData.current_state.fields))
            : [];
        sublimatedData.current_state.fields = preservedFields;
        sublimatedData.current_state.updated_at = new Date().toISOString();
      }
    } else if (originalCharacterData?.current_state) {
      sublimatedData.current_state = JSON.parse(JSON.stringify(originalCharacterData.current_state));
    } else {
      delete sublimatedData.current_state;
    }

    // 5. 签名逻辑
    // 默认情况下，有引导的升华会失去原生性
    let shouldSign = isNative && !finalUserGuidance;
    // 但是，如果管理员在配置中开启了特例，则即使有引导也进行签名
    if (isNative && finalUserGuidance && appConfig.ALLOW_GUIDED_SUBLIMATION_NATIVE_SIGNING) {
      shouldSign = true;
    }

    if (shouldSign) {
      sublimatedData.signature = await generateSignature(sublimatedData);
    } else {
      delete sublimatedData.signature;
    }

    const finalResponse = {
      sublimatedData,
      unchangedFields: sanitizedFieldsToPreserve,
      targetTemplate
    };

    return new Response(JSON.stringify(finalResponse), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    log.error('成长升华失败', { error });
    const errorMessage = error instanceof Error ? `角色成长升华失败: ${error.message}` : '角色成长升华失败: 发生未知错误';
    return new Response(JSON.stringify({ error: errorMessage, message: errorMessage }), { status: 500 });
  }
}

/**
 * 递归提取对象中所有字符串值的函数，用于敏感词检查。
 * @param data 要提取文本的对象。
 * @returns 连接所有字符串值的单个字符串。
 */
const extractTextForCheck = (data: any): string => {
  let textContent = '';
  if (typeof data === 'string') {
    textContent += data + ' ';
  } else if (Array.isArray(data)) {
    data.forEach(item => { textContent += extractTextForCheck(item); });
  } else if (typeof data === 'object' && data !== null) {
    for (const key in data) {
      if (key !== 'signature' && key !== 'userAnswers') {
        textContent += extractTextForCheck(data[key]);
      }
    }
  }
  return textContent;
};

export default handler;
