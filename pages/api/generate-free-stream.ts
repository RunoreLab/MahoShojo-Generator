import { z } from 'zod/v3';
import { NextRequest } from 'next/server';

import { AI_PROVIDER_CATALOG, resolveAIProviderModel } from '@/lib/ai/constants';
import { acquirePublicAiRateLimit, buildPublicAiRateLimitResponse, inferPublicAiProviderMode } from '@/lib/ai/public-rate-limit';
import { FREE_GENERATION_ATTACHMENT_LIMITS, formatReferenceAttachmentsForPrompt, type AITextAttachment } from '@/lib/ai/attachments';
import { type AIProvider } from '@/lib/config';
import { enforceTextSafety } from '@/lib/content-safety/server';
import { getLogger } from '@/lib/logger';
import { generateWithStreamAI, LoadBalanceStrategy, type GenerateWithAIOptions } from '@/lib/stream/raw-ai';
import { createReasoningSseBridge, shouldUseClientSse } from '@/lib/stream/reasoning-sse';
import { recordUserActivityFromRequest } from '@/lib/user-activity/record';

const log = getLogger('api-gen-free-stream');

export const config = {
  runtime: 'edge',
};

const MAX_SAFETY_TEXT_CHARS = 50_000;

const CustomProviderSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  apiKey: z.string(),
});

const AttachmentSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.string().optional().default('application/octet-stream'),
  size: z.number().int().nonnegative().optional(),
  content: z.string().max(FREE_GENERATION_ATTACHMENT_LIMITS.maxCharsPerFile),
  truncated: z.boolean().optional(),
});

const AttachmentsSchema = z
  .array(AttachmentSchema)
  .max(FREE_GENERATION_ATTACHMENT_LIMITS.maxCount)
  .optional()
  .default([])
  .superRefine((items, ctx) => {
    const total = items.reduce((sum, item) => sum + item.content.length, 0);
    if (total > FREE_GENERATION_ATTACHMENT_LIMITS.maxCharsTotal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `附件内容总长度超出限制（上限 ${FREE_GENERATION_ATTACHMENT_LIMITS.maxCharsTotal.toLocaleString()} 字符）`,
      });
    }
  });

const StreamSchemaIdSchema = z.enum(['general', 'general-scenario']);
type StreamSchemaId = z.infer<typeof StreamSchemaIdSchema>;

const RequestBodySchema = z.object({
  schema: StreamSchemaIdSchema,
  prompt: z.string().min(1),
  attachments: AttachmentsSchema,
  language: z.string().optional().default('zh-CN'),
  customProvider: CustomProviderSchema.optional(),
});

const buildStreamPrompt = (schemaId: StreamSchemaId, language: string, userPrompt: string, attachments: AITextAttachment[]): string => {
  const attachmentsSection = formatReferenceAttachmentsForPrompt(attachments);
  if (schemaId === 'general') {
    return `
你将根据【用户提示词】生成一份【通用角色卡】的正文内容。

输出要求：
1) 必须使用【${language}】创作。
2) 必须直接输出 Markdown 正文，不要输出任何解释。
3) 第 1 行必须是一级标题（以 "# " 开头），写角色名或代号，不超过 30 字。
4) 在开头 20 行内，尽量给出明确字段（若无法推断可写“未指定”）：
   - 代号：...
   - 名字：...
5) 正文建议包含：外观、性格、能力与限制、背景与动机、关系与羁绊、战斗风格、常用台词/行为准则（可选）。

${attachmentsSection}

【用户提示词】
${userPrompt}
`.trim();
  }

  return `
你将根据【用户提示词】生成一份【通用情景卡】的正文内容。

输出要求：
1) 必须使用【${language}】创作。
2) 必须直接输出 Markdown 正文，不要输出任何解释。
3) 第 1 行必须是一级标题（以 "# " 开头），写情景标题，不超过 30 字。
4) 在开头 20 行内，尽量给出明确字段（若无法推断可写“未指定”）：
   - 标题：...
5) 正文建议包含：场景概览、时间、地点、环境特征、预设 NPC（可选）、核心事件、整体氛围、发展方向（多条）。

${attachmentsSection}

【用户提示词】
${userPrompt}
`.trim();
};

export default async function handler(req: NextRequest): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const wantsClientSse = shouldUseClientSse(req);

  try {
    const parsedBody = RequestBodySchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) {
      return new Response(JSON.stringify({ error: '请求参数无效' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { schema: schemaId, prompt: userPrompt, attachments, language, customProvider: customProviderPayload } = parsedBody.data;

    const rateLimit = await acquirePublicAiRateLimit({
      req,
      actionType: 'free_generate',
      providerMode: inferPublicAiProviderMode(customProviderPayload),
    });
    if (!rateLimit.allowed) return buildPublicAiRateLimitResponse(rateLimit);

    const combinedForSafety = [userPrompt, ...attachments.map((item) => item.content)].filter((t) => t.trim()).join('\n\n');
    const safetyText =
      combinedForSafety.length > MAX_SAFETY_TEXT_CHARS ? combinedForSafety.slice(0, MAX_SAFETY_TEXT_CHARS) : combinedForSafety;
    const safetyResponse = await enforceTextSafety({
      text: safetyText,
      log,
      logMeta: { schemaId, attachmentsCount: attachments.length, attachmentsChars: combinedForSafety.length },
      sensitiveWordReason: '使用危险符文',
      aiPromptTemplate: 'free',
    });
    if (safetyResponse) return safetyResponse;

    let customProviderOverride: AIProvider | null = null;
    let customProviderId: string | null = null;
    let customModelOverride: string | undefined;

    if (customProviderPayload) {
      const parsedResult = CustomProviderSchema.safeParse(customProviderPayload);
      if (!parsedResult.success) {
        log.warn('自定义 AI 供应商配置校验失败', { providerId: (customProviderPayload as any)?.providerId });
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
        };
      }
    }

    const prompt = buildStreamPrompt(schemaId, language, userPrompt, attachments);

    const shouldDisablePolling = customProviderId !== null && customProviderId !== 'system';
    const providerOptions: GenerateWithAIOptions | undefined = (customProviderOverride || shouldDisablePolling)
      ? {
        ...(customProviderOverride ? { providerOverride: customProviderOverride } : {}),
        ...(shouldDisablePolling ? { loadBalanceStrategy: LoadBalanceStrategy.CUSTOM } : { loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL }),
      }
      : undefined;
    const reasoningBridge = wantsClientSse ? createReasoningSseBridge('自由生成（流式）') : null;
    const aiTelemetry: NonNullable<GenerateWithAIOptions['telemetry']> = {};

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
    log.error('流式自由生成失败', { error });
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    return new Response(JSON.stringify({ error: '生成失败', message: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
