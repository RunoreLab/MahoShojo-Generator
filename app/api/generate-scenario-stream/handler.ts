// app/api/generate-scenario-stream/handler.ts

import { z } from 'zod/v3';
import { NextRequest } from 'next/server';

import { getLogger } from '@/lib/logger';
import { type AIProvider } from '@/lib/config';
import { enforceTextSafety } from '@/lib/content-safety/server';
import { AI_PROVIDER_CATALOG, resolveAIProviderModel } from '@/lib/ai/constants';
import { acquirePublicAiRateLimit, buildPublicAiRateLimitResponse, inferPublicAiProviderMode } from '@/lib/ai/public-rate-limit';
import { generateWithStreamAI, LoadBalanceStrategy, type GenerateWithAIOptions } from '@/lib/stream/raw-ai';
import { buildChannelContextFromPayload } from '@/lib/ai/availability';
import { createReasoningSseBridge, shouldUseClientSse } from '@/lib/stream/reasoning-sse';
import { buildScenarioMarkdownRequirements } from '@/lib/prompts/scenario';
import { recordUserActivityFromRequest } from '@/lib/user-activity/record';

const log = getLogger('api-gen-scenario-stream');

const CustomProviderSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  apiKey: z.string(),
  maxOutputTokens: z.number().int().min(1).max(1_000_000).optional(),
});

async function handler(req: NextRequest): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const wantsClientSse = shouldUseClientSse(req);

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

    const rateLimit = await acquirePublicAiRateLimit({
      req,
      actionType: 'scenario_generate',
      providerMode: inferPublicAiProviderMode(customProviderPayload),
    });
    if (!rateLimit.allowed) return buildPublicAiRateLimitResponse(rateLimit);

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
        customModelOverride = modelResolution.modelId;
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

${buildScenarioMarkdownRequirements(language)}

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
    const reasoningBridge = wantsClientSse ? createReasoningSseBridge('情景卡（流式）') : null;
    const aiTelemetry: NonNullable<GenerateWithAIOptions['telemetry']> = {};
    const channelContext = buildChannelContextFromPayload(customProviderPayload, customModelOverride);

    const streamResult = await generateWithStreamAI(
      {
        prompt,
        temperature: 0.75,
        ...(customModelOverride ? { modelOverride: customModelOverride } : {}),
      },
      {
        ...(providerOptions ?? {}),
        abortSignal: req.signal,
        telemetry: aiTelemetry,
        channelContext,
        ...(reasoningBridge ? { onReasoningEvent: reasoningBridge.onReasoningEvent } : {}),
      }
    );
    recordUserActivityFromRequest(req);

    if (wantsClientSse && reasoningBridge) {
      return reasoningBridge.toResponse(streamResult.response, {
        usagePromise: streamResult.usagePromise,
        aiModel: aiTelemetry.model ?? customModelOverride ?? null,
      });
    }

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

export const appRouteHandler = handler;
export default appRouteHandler;
