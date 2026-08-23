import {
  createGenerateFreeStreamService,
  type GenerateFreeStreamInput,
  type GenerateFreeService,
} from '@mahoshojo/hosted-api/generate-free';
import {
  completeStep,
  respondStep,
} from '@mahoshojo/hosted-api/regular-generation';

import { AI_PROVIDER_CATALOG, resolveAIProviderModel } from '@/lib/ai/constants';
import { acquirePublicAiRateLimit, buildPublicAiRateLimitResponse, inferPublicAiProviderMode } from '@/lib/ai/public-rate-limit';
import { formatReferenceAttachmentsForPrompt, type AITextAttachment } from '@/lib/ai/attachments';
import { type AIProvider } from '@/lib/config';
import { enforceTextSafety } from '@/lib/content-safety/server';
import { getLogger } from '@/lib/logger';
import { generateWithStreamAI, LoadBalanceStrategy, type GenerateWithAIOptions } from '@/lib/stream/raw-ai';
import { buildChannelContextFromPayload } from '@/lib/ai/availability';
import { createReasoningSseBridge, shouldUseClientSse } from '@/lib/stream/reasoning-sse';
import { recordUserActivityFromRequest } from '@/lib/user-activity/record';

const log = getLogger('api-gen-free-stream');

type StreamSchemaId = GenerateFreeStreamInput['schema'];

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

type FreeStreamGeneration = {
  streamResult: Awaited<ReturnType<typeof generateWithStreamAI>>;
  reasoningBridge: ReturnType<typeof createReasoningSseBridge> | null;
  telemetry: NonNullable<GenerateWithAIOptions['telemetry']>;
  customModelOverride?: string;
};

export const createDefaultGenerateFreeStreamService = (): GenerateFreeService =>
  createGenerateFreeStreamService<FreeStreamGeneration>({
    checkRateLimit: async (request, input) => {
      const rateLimit = await acquirePublicAiRateLimit({
        req: request,
        actionType: 'free_generate',
        providerMode: inferPublicAiProviderMode(input.customProvider),
      });
      return rateLimit.allowed ? null : buildPublicAiRateLimitResponse(rateLimit);
    },
    enforceSafety: async (_request, input, safetyText) => enforceTextSafety({
      text: safetyText,
      log,
      logMeta: {
        schemaId: input.schema,
        attachmentsCount: input.attachments.length,
        attachmentsChars: [input.prompt, ...input.attachments.map((item) => item.content)]
          .filter((text) => text.trim())
          .join('\n\n').length,
      },
      sensitiveWordReason: '使用危险符文',
      aiPromptTemplate: 'free',
    }),
    generate: async (request, input) => {
      const customProviderPayload = input.customProvider;
      let customProviderOverride: AIProvider | null = null;
      let customProviderId: string | null = null;
      let customModelOverride: string | undefined;

      if (customProviderPayload) {
        customProviderId = customProviderPayload.providerId;
        const providerConfig = AI_PROVIDER_CATALOG.find(
          (item) => item.id === customProviderPayload.providerId,
        );
        if (!providerConfig) {
          return respondStep(new Response(
            JSON.stringify({ error: '未知的模型供应商 ID' }),
            { status: 400 },
          ));
        }

        const modelResolution = resolveAIProviderModel(
          providerConfig,
          customProviderPayload.modelId,
        );
        if (!modelResolution) {
          return respondStep(new Response(JSON.stringify({ error: '未知的模型 ID' }), {
            status: 400,
          }));
        }

        const sanitizedApiKey = customProviderPayload.apiKey.trim();
        if (!sanitizedApiKey && providerConfig.id !== 'system') {
          return respondStep(new Response(JSON.stringify({ error: 'API Key 不能为空' }), {
            status: 400,
          }));
        }

        const sanitizedBaseUrl = providerConfig.baseUrl?.trim() ?? '';
        if (!sanitizedBaseUrl) {
          customModelOverride = modelResolution.modelId === 'default'
            ? undefined
            : modelResolution.modelId;
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
            ...(typeof customProviderPayload.maxOutputTokens === 'number'
              ? { defaultMaxOutputTokens: customProviderPayload.maxOutputTokens }
              : {}),
            providerId: customProviderPayload.providerId,
            ...(customProviderPayload.generationOverrides
              ? { generationOverrides: customProviderPayload.generationOverrides }
              : {}),
          };
        }
      }

      const providerOptions: GenerateWithAIOptions | undefined = (
        customProviderOverride
        || (customProviderId !== null && customProviderId !== 'system')
      )
        ? {
            ...(customProviderOverride ? { providerOverride: customProviderOverride } : {}),
            ...(customProviderId !== null && customProviderId !== 'system'
              ? { loadBalanceStrategy: LoadBalanceStrategy.CUSTOM }
              : { loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL }),
          }
        : undefined;
      const reasoningBridge = shouldUseClientSse(request)
        ? createReasoningSseBridge('自由生成（流式）')
        : null;
      const telemetry: NonNullable<GenerateWithAIOptions['telemetry']> = {};
      const channelContext = buildChannelContextFromPayload(
        customProviderPayload,
        customModelOverride,
      );
      const streamResult = await generateWithStreamAI(
        {
          prompt: buildStreamPrompt(
            input.schema,
            input.language,
            input.prompt,
            input.attachments,
          ),
          temperature: 0.75,
          ...(customModelOverride ? { modelOverride: customModelOverride } : {}),
          ...(customProviderPayload
            ? {
                generationSettingsContext: {
                  providerId: customProviderPayload.providerId,
                  ...(customProviderPayload.generationOverrides
                    ? { userOverrides: customProviderPayload.generationOverrides }
                    : {}),
                },
              }
            : {}),
        },
        {
          ...(providerOptions ?? {}),
          abortSignal: request.signal,
          telemetry,
          channelContext,
          ...(reasoningBridge ? { onReasoningEvent: reasoningBridge.onReasoningEvent } : {}),
        },
      );
      return completeStep({
        streamResult,
        reasoningBridge,
        telemetry,
        customModelOverride,
      });
    },
    recordActivity: recordUserActivityFromRequest,
    buildResponse: (_request, _input, output) => {
      if (output.reasoningBridge) {
        return output.reasoningBridge.toResponse(output.streamResult.response, {
          usagePromise: output.streamResult.usagePromise,
          aiModel: output.telemetry.model ?? output.customModelOverride ?? null,
        });
      }
      return output.streamResult.response;
    },
    logError: (error) => {
      log.error('流式自由生成失败', { error });
    },
  });

export const defaultGenerateFreeStreamService = createDefaultGenerateFreeStreamService();
