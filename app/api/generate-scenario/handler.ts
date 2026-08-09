// app/api/generate-scenario/handler.ts

import { z } from 'zod/v3';
import { UserGenerationOverridesSchema } from '@/lib/ai/generation-settings/schemas';
import { generateWithAI, GenerationConfig, LoadBalanceStrategy } from '@/lib/ai';
import { buildChannelContextFromPayload } from '@/lib/ai/availability';
import { getLogger } from '@/lib/logger';
import { NextRequest } from 'next/server';
import { generateSignature } from '@/lib/signature';
import { buildJsonResponseWithOptionalAiMeta } from '@/lib/ai/meta-response';
import type { GenerateWithAIOptions } from '@/lib/ai';
import { type AIProvider } from '@/lib/config';
import { enforceTextSafety } from '@/lib/content-safety/server';
import { AI_PROVIDER_CATALOG, resolveAIProviderModel } from '@/lib/ai/constants';
import { acquirePublicAiRateLimit, buildPublicAiRateLimitResponse, inferPublicAiProviderMode } from '@/lib/ai/public-rate-limit';
import { buildScenarioCorePrinciples } from '@/lib/prompts/scenario';
import { recordUserActivityFromRequest } from '@/lib/user-activity/record';

const log = getLogger('api-gen-scenario');

// =================================================================
// 1. Zod Schema 定义
// =================================================================

// AI需要返回的情景数据结构的Schema (SRS 3.3.3)
const ScenarioSchema = z.object({
  title: z.string().describe("情景的标题【必需】。根据用户回答，为这个情景取一个简洁而富有吸引力的标题。"),
  scenario_type: z.string().describe("情景类型【必需】。根据情景的核心内容，为其分类（例如：日常、互动、考试、竞技比赛、调查、采访等）。"),
  description: z.string().describe("情景的简短描述。"),
  elements: z.object({
    scene: z.object({
      time: z.string().optional().describe("故事发生的时间。"),
      place: z.string().optional().describe("故事发生的地点。"),
      features: z.string().optional().describe("环境特征和陈设等。"),
    }).describe("场景描述。如果用户未提供，可留空或注明“未指定”。"),
    roles: z.array(z.object({
      name: z.string().describe("角色名称或身份。"),
      description: z.string().describe("该角色的设定、目标或行为准则。")
    })).optional().describe("预设的NPC角色信息，可留空。"),
    events: z.string().describe("核心事件描述 (角色需要做什么？会怎么互动？有什么冲突？)。"),
    atmosphere: z.string().describe("故事的情感基调和氛围。"),
    development: z.array(z.string()).describe("故事可能的多个发展方向。"),
  }),
}).describe("一个结构化的情景设定，用于后续故事。");


const CustomProviderSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  apiKey: z.string(),
  maxOutputTokens: z.number().int().min(1).max(1_000_000).optional(),
  generationOverrides: UserGenerationOverridesSchema.optional(),
});


// =================================================================
// 2. AI Prompt 配置
// =================================================================

const createGenerationConfig = (
  answers: Record<string, string>,
  language: string,
  fieldsToKeepEmpty: string[]
): GenerationConfig<z.infer<typeof ScenarioSchema>, any> => {
  const promptBuilder = () => {
    const answerText = Object.entries(answers)
      .filter(([, value]) => value.trim() !== '')
      .map(([key, value]) => `【${key}】\n${value}\n`)
      .join('\n');
    // [新增] 根据用户选择，构建强制留空指令
    let emptyFieldsInstruction = '';
    if (fieldsToKeepEmpty && fieldsToKeepEmpty.length > 0) {
      emptyFieldsInstruction = `
## 强制留空指令 (CRITICAL INSTRUCTION)
用户已指定以下字段必须留空。在你的JSON输出中：
- 对于类型为 "string" 的字段，你必须返回一个空字符串 ""。
- 对于类型为 "array" 的字段，你必须返回一个空数组 []。
绝对不要为这些字段生成任何内容。
需要留空的字段列表:
${fieldsToKeepEmpty.map(f => `- ${f}`).join('\n')}
`;
    }

    return `
你是一个富有想象力的故事场景设计师。你的任务是根据用户提供的几个核心要素，构思并生成一个结构化的、可供后续故事使用的自定义情景（Scenario）文件。

${buildScenarioCorePrinciples(language)}

${emptyFieldsInstruction}

## 用户的回答
${answerText}

现在，请开始你的创作。
`;
  };

  return {
    systemPrompt: "你是一位富有想象力的世界观构架师和剧本作家，擅长将零散的想法整合成结构化的故事场景。",
    temperature: 0.7,
    promptBuilder,
    schema: ScenarioSchema,
    taskName: "生成情景",
  };
};

// =================================================================
// 3. API Handler
// =================================================================

async function handler(req: NextRequest): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const { answers, language = 'zh-CN', fieldsToKeepEmpty = [], customProvider: customProviderPayload } = await req.json();

    if (!answers || typeof answers !== 'object' || Object.keys(answers).length === 0) {
      return new Response(JSON.stringify({ error: 'Answers object is required' }), { status: 400 });
    }

    const rateLimit = await acquirePublicAiRateLimit({
      req,
      actionType: 'scenario_generate',
      providerMode: inferPublicAiProviderMode(customProviderPayload),
    });
    if (!rateLimit.allowed) return buildPublicAiRateLimitResponse(rateLimit);

    // --- 安全检查流程 ---
    const userInputText = Object.values(answers).join(' ');

    const safetyResponse = await enforceTextSafety({
      text: userInputText,
      log,
      logMeta: { answers },
      sensitiveWordReason: '使用危险符文',
      aiPromptTemplate: 'scenario',
    });
    if (safetyResponse) return safetyResponse;

    // --- 自定义模型配置解析 ---
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

      const modelResolution = resolveAIProviderModel(providerConfig, parsed.modelId);
      if (!modelResolution) {
        return new Response(JSON.stringify({ error: '未知的模型 ID' }), { status: 400 });
      }

      const sanitizedApiKey = parsed.apiKey.trim();
      if (!sanitizedApiKey && providerConfig.id !== 'system') {
        return new Response(JSON.stringify({ error: 'API Key 不能为空' }), { status: 400 });
      }

      const sanitizedBaseUrl = providerConfig.baseUrl?.trim() ?? '';
      if (!sanitizedBaseUrl) {
        customModelOverride = modelResolution.modelId === 'default' ? undefined : modelResolution.modelId;
        log.info('检测到 baseUrl 为空的自定义供应商，改用系统默认通道，仅覆盖模型参数', {
          providerId: providerConfig.id,
          model: modelResolution.modelId,
        });
      } else {
        customProviderOverride = {
          name: providerConfig.name,
          apiKey: sanitizedApiKey,
          baseUrl: sanitizedBaseUrl,
          model: modelResolution.modelId,
          type: providerConfig.type,
          mode: providerConfig.mode || 'auto',
          retryCount: 1,
          skipProbability: 0,
          ...(typeof parsed.maxOutputTokens === 'number' ? { defaultMaxOutputTokens: parsed.maxOutputTokens } : {}),
          providerId: parsed.providerId,
          ...(parsed.generationOverrides ? { generationOverrides: parsed.generationOverrides } : {}),
        };
      }
    }

    // --- 生成逻辑 ---
    const generationConfig = createGenerationConfig(answers, language, fieldsToKeepEmpty);
    if (customModelOverride) {
      generationConfig.modelOverride = customModelOverride;
    }

    const shouldDisablePolling = customProviderId !== null && customProviderId !== 'system';
    const providerOptions = (customProviderOverride || shouldDisablePolling)
      ? {
        ...(customProviderOverride ? { providerOverride: customProviderOverride } : {}),
        ...(shouldDisablePolling ? { loadBalanceStrategy: LoadBalanceStrategy.CUSTOM } : { loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL }),
      }
      : undefined;

    const aiTelemetry: NonNullable<GenerateWithAIOptions['telemetry']> = {};
    const channelContext = buildChannelContextFromPayload(customProviderPayload, customModelOverride);
    const aiOptions = providerOptions ? { ...providerOptions, channelContext, telemetry: aiTelemetry } : { channelContext, telemetry: aiTelemetry };
    const scenarioData = await generateWithAI(null, generationConfig, aiOptions);
    recordUserActivityFromRequest(req);

    // [修改] 修正签名逻辑 (SRS 3.3.3 & 4.1)
    // 1. 先构建不含签名的完整数据载荷
    const payloadToSign = {
      ...scenarioData,
      metadata: {
        created_at: new Date().toISOString(),
      }
    };

    // 2. 基于此载荷生成签名
    const signature = await generateSignature(payloadToSign);

    // 3. 将签名附加到最终返回的对象中
    const finalScenario = {
      ...payloadToSign,
      metadata: {
        ...payloadToSign.metadata,
        signature: signature || '签名丢失，可能未设置密钥', // 如果密钥未设置，签名将进行提示
      }
    };


    return buildJsonResponseWithOptionalAiMeta({
      requestHeaders: req.headers,
      data: finalScenario,
      telemetry: aiTelemetry,
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    log.error('情景生成失败', { error });
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    return new Response(JSON.stringify({ error: '生成失败', message: errorMessage }), { status: 500 });
  }
}

export const appRouteHandler = handler;
export default appRouteHandler;
