// pages/api/generate-scenario-stream.ts

import { z } from 'zod/v3';
import { NextRequest } from 'next/server';

import { getLogger } from '@/lib/logger';
import { type AIProvider } from '@/lib/config';
import { enforceTextSafety } from '@/lib/content-safety/server';
import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';
import { generateWithStreamAI, LoadBalanceStrategy, type GenerateWithAIOptions } from '@/lib/stream/raw-ai';

const log = getLogger('api-gen-scenario-stream');

export const config = {
  runtime: 'edge',
};

const CustomProviderSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  apiKey: z.string(),
});

async function handler(req: NextRequest): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const parsedBody = await req.json();
    const {
      answers,
      language = 'zh-CN',
      fieldsToKeepEmpty = [],
      customProvider: customProviderPayload,
      titleHint,
    } = parsedBody ?? {};

    if (!answers || typeof answers !== 'object' || Array.isArray(answers) || Object.keys(answers).length === 0) {
      return new Response(JSON.stringify({ error: 'Answers object is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userInputText = Object.values(answers as Record<string, unknown>).join(' ');

    const safetyResponse = await enforceTextSafety({
      text: userInputText,
      log,
      logMeta: { answers },
      sensitiveWordReason: '使用危险符文',
      aiPromptTemplate: 'scenario',
    });
    if (safetyResponse) return safetyResponse;

    const normalizedEmptyFields = Array.isArray(fieldsToKeepEmpty)
      ? fieldsToKeepEmpty.filter((item: unknown) => typeof item === 'string' && item.trim()).slice(0, 32)
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
      const providerConfig = AI_PROVIDER_CATALOG.find((item) => item.id === parsed.providerId);
      if (!providerConfig) {
        return new Response(JSON.stringify({ error: '未知的模型供应商 ID' }), { status: 400 });
      }

      const modelConfig = providerConfig.models.find((model) => model.value === parsed.modelId);
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

    const answerText = Object.entries(answers as Record<string, unknown>)
      .filter(([, value]) => typeof value === 'string' && value.trim())
      .map(([key, value]) => `【${key}】\n${String(value).trim()}\n`)
      .join('\n');

    const emptyFieldsInstruction = normalizedEmptyFields.length > 0
      ? `
【强制留空指令】
用户已指定以下内容必须排除：请勿输出对应内容，不要擅自补全。
需要排除的内容列表：
${normalizedEmptyFields.map((f) => `- ${f}`).join('\n')}
`.trim()
      : '';

    const titleHintText = typeof titleHint === 'string' && titleHint.trim()
      ? `\n【用户期望的情景标题（可参考）】\n${titleHint.trim().slice(0, 60)}\n`
      : '';

    const prompt = `
你是一个富有想象力的故事场景设计师。你的任务是根据用户提供的要素，生成一份【情景】设定文本，用于后续故事。

【重要】输出要求：
1) 必须使用【${language}】创作。
2) 必须直接输出 Markdown 正文，不要输出“我将要/我不能”之类的解释。
3) 第 1 行必须是一级标题（以 "# " 开头），写情景标题，不超过 30 字。
4) 在开头 20 行内，尽量给出明确字段（若无法推断可写“未指定”）：
   - 标题：...
5) 正文建议包含：场景概览、时间、地点、环境特征、预设NPC（可选）、核心事件、整体氛围、发展方向（多条）。

${emptyFieldsInstruction}
${titleHintText}

【用户的回答】
${answerText}
`.trim();

    const shouldDisablePolling = customProviderId !== null && customProviderId !== 'system';
    const providerOptions: GenerateWithAIOptions | undefined = (customProviderOverride || shouldDisablePolling)
      ? {
        ...(customProviderOverride ? { providerOverride: customProviderOverride } : {}),
        ...(shouldDisablePolling ? { loadBalanceStrategy: LoadBalanceStrategy.CUSTOM } : { loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL }),
      }
      : undefined;

    const streamResult = await generateWithStreamAI(
      {
        prompt,
        temperature: 0.75,
        maxOutputTokens: 4096,
        ...(customModelOverride ? { modelOverride: customModelOverride } : {}),
      },
      providerOptions
    );

    return streamResult.response;
  } catch (error) {
    log.error('流式生成通用情景卡失败', { error });
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    return new Response(JSON.stringify({ error: '生成失败', message: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export default handler;

