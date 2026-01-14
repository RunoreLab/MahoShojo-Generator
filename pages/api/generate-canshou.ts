// pages/api/generate-canshou.ts
import { z } from 'zod/v3';
import { generateWithAI, GenerationConfig, LoadBalanceStrategy } from '../../lib/ai';
import { getLogger } from '../../lib/logger';
import { NextRequest } from 'next/server';
import { generateSignature } from '../../lib/signature'; // 导入签名工具
import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';
import { type AIProvider } from '@/lib/config';
import { enforceTextSafety } from '@/lib/content-safety/server';
import { CANSHOU_LORE } from '@/lib/canshou-lore';

const log = getLogger('api-gen-canshou');

export const config = {
  runtime: 'edge',
};


// 定义残兽设定的Zod Schema
const CanshouSchema = z.object({
  name: z.string().describe('残兽的名称，应体现其核心概念和特征'),
  coreConcept: z.string().describe('对残兽核心概念的概括'),
  coreEmotion: z.string().describe('对残兽核心情感/欲望的概括'),
  evolutionStage: z.string().describe('残兽所处的进化阶段（卵/蠖/蛹/半蜕/蜕/王蜕/羽）'),
  appearance: z.string().describe('外貌形态的详细描述，整合用户输入并进行扩展'),
  materialAndSkin: z.string().describe('材质与表皮的详细描述，整合用户输入并进行扩展'),
  featuresAndAppendages: z.string().describe('特征与附属物的详细描述，整合用户输入并进行扩展'),
  attackMethod: z.string().describe('主要攻击方式的详细描述'),
  specialAbility: z.string().describe('特殊能力的详细描述和运作机制'),
  origin: z.string().describe('起源故事的详细阐述'),
  birthEnvironment: z.string().describe('诞生环境的详细描述'),
  researcherNotes: z.string().describe('作为研究员的分析、预测和警告'),
});

const CustomProviderSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  apiKey: z.string(),
});

type CanshouDetails = z.infer<typeof CanshouSchema>;

// AI生成配置
const canshouGenerationConfig: GenerationConfig<CanshouDetails, { answers: Record<string, string>, language: string }> = {
  systemPrompt: `你是一名魔法国度的研究学者，你的任务是根据一线调查员提交的问卷报告，分析并生成一份详细的档案。
  首先，这是关于残兽的基础设定，你必须严格遵守：
  ${CANSHOU_LORE}

  请根据用户提供的问卷答案，以结构化的JSON格式返回详细设定，包括对其各项特征的详细描述和你作为研究学者的专业分析笔记。`,
  temperature: 0.8,
  promptBuilder: ({ answers, language }: { answers: Record<string, string>, language: string }) => {
    const answerText = Object.entries(answers)
      .map(([key, value]) => `- ${key}: ${value}`)
      .join('\n');
    return `以下是调查员提交的问卷报告，请基于此进行分析：\n${answerText}\n\n【重要指令】请你必须使用【${language}】进行内容创作。`;
  },
  schema: CanshouSchema,
  taskName: "生成残兽档案",
  maxOutputTokens: 8192,
};

// API Handler
async function handler(req: NextRequest): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const parsedBody = await req.json();
    const { answers, language = 'zh-CN', customProvider: customProviderPayload } = parsedBody;

    if (!answers || typeof answers !== 'object' || Object.keys(answers).length === 0) {
      return new Response(JSON.stringify({ error: 'Answers object is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

	    // 安全检查：检查用户输入是否包含敏感词
	    const answersString = Object.values(answers).join(' ');
	    const safetyResponse = await enforceTextSafety({
	      text: answersString,
	      log,
	      enableAiSafetyCheck: false,
	    });
	    if (safetyResponse) return safetyResponse;

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
    const providerOptions = (customProviderOverride || shouldDisablePolling)
      ? {
        ...(customProviderOverride ? { providerOverride: customProviderOverride } : {}),
        ...(shouldDisablePolling ? { loadBalanceStrategy: LoadBalanceStrategy.CUSTOM } : { loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL }),
      }
      : undefined;

    // 调用通用AI生成函数
    const canshouDetails = await generateWithAI({ answers, language }, {
      ...canshouGenerationConfig,
      ...(customModelOverride ? { modelOverride: customModelOverride } : {}),
    }, providerOptions);

    // 将用户答案和生成结果合并，并添加模板ID，为签名做准备
    const dataToSign = {
        ...canshouDetails,
        templateId: "魔法少女/心之花/残兽（问卷生成）", // 添加模板ID
        userAnswers: answers
    };

    // 为合并后的数据生成签名
    const signature = await generateSignature(dataToSign);

    // 将签名附加到最终结果中
    const finalResult = {
        ...dataToSign,
        signature: signature
    };

    return new Response(JSON.stringify(finalResult), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    log.error('生成残兽档案失败', { error });
    const errorMessage = error instanceof Error ? error.message : '服务器内部错误';
    return new Response(JSON.stringify({ error: '生成失败，当前服务器可能正忙，请稍后重试', message: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export default handler;
