// Hosted generate-scenario-stream default runtime composition.

import { z } from 'zod/v3';
import {
  createGenerateScenarioStreamService,
  type GenerateScenarioService,
  type GenerateScenarioStreamInput,
} from '@mahoshojo/hosted-api/generate-scenario';
import {
  completeStep,
  respondStep,
} from '@mahoshojo/hosted-api/regular-generation';
import { UserGenerationOverridesSchema } from '@/lib/ai/generation-settings/schemas';

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
  generationOverrides: UserGenerationOverridesSchema.optional(),
});

type ScenarioStreamGeneration = {
  streamResult: Awaited<ReturnType<typeof generateWithStreamAI>>;
  reasoningBridge: ReturnType<typeof createReasoningSseBridge> | null;
  aiTelemetry: NonNullable<GenerateWithAIOptions['telemetry']>;
  customModelOverride?: string;
};

export const createDefaultGenerateScenarioStreamService = (): GenerateScenarioService =>
  createGenerateScenarioStreamService<ScenarioStreamGeneration>({
    checkRateLimit: async (request, input) => {
      const rateLimit = await acquirePublicAiRateLimit({
        req: request,
        actionType: 'scenario_generate',
        providerMode: inferPublicAiProviderMode(input.customProvider),
      });
      return rateLimit.allowed ? null : buildPublicAiRateLimitResponse(rateLimit);
    },
    enforceSafety: async (_request, input, safetyText) => enforceTextSafety({
      text: safetyText,
      log,
      logMeta: { answers: input.answers },
      sensitiveWordReason: '使用危险符文',
      aiPromptTemplate: 'scenario',
    }),
    generate: async (request, input: GenerateScenarioStreamInput) => {
      const customProviderPayload = input.customProvider;
      const normalizedEmptyFields = Array.isArray(input.fieldsToKeepEmpty)
        ? input.fieldsToKeepEmpty
          .filter((item: unknown) => typeof item === 'string' && item.trim())
          .slice(0, 32) as string[]
        : [];
      let customProviderOverride: AIProvider | null = null;
      let customProviderId: string | null = null;
      let customModelOverride: string | undefined;

      if (customProviderPayload) {
        const parsedResult = CustomProviderSchema.safeParse(customProviderPayload);
        if (!parsedResult.success) {
          const providerId = typeof customProviderPayload === 'object'
            && customProviderPayload !== null
            && 'providerId' in customProviderPayload
            ? customProviderPayload.providerId
            : undefined;
          log.warn('自定义 AI 供应商配置校验失败', {
            providerId,
            issues: parsedResult.error.issues,
          });
          return respondStep(new Response(
            JSON.stringify({ error: '自定义 AI 供应商配置无效' }),
            { status: 400 },
          ));
        }

        const parsed = parsedResult.data;
        customProviderId = parsed.providerId;
        const providerConfig = AI_PROVIDER_CATALOG.find((item) => item.id === parsed.providerId);
        if (!providerConfig) {
          return respondStep(new Response(
            JSON.stringify({ error: '未知的模型供应商 ID' }),
            { status: 400 },
          ));
        }
        const modelResolution = resolveAIProviderModel(providerConfig, parsed.modelId);
        if (!modelResolution) {
          return respondStep(new Response(
            JSON.stringify({ error: '未知的模型 ID' }),
            { status: 400 },
          ));
        }
        const sanitizedApiKey = parsed.apiKey.trim();
        if (!sanitizedApiKey && providerConfig.id !== 'system') {
          return respondStep(new Response(
            JSON.stringify({ error: 'API Key 不能为空' }),
            { status: 400 },
          ));
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
            ...(typeof parsed.maxOutputTokens === 'number'
              ? { defaultMaxOutputTokens: parsed.maxOutputTokens }
              : {}),
            providerId: parsed.providerId,
            ...(parsed.generationOverrides
              ? { generationOverrides: parsed.generationOverrides }
              : {}),
          };
        }
      }

      const answerText = Object.entries(input.answers)
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
      const titleHintText = typeof input.titleHint === 'string' && input.titleHint.trim()
        ? `\n【用户期望的情景标题（可参考）】\n${input.titleHint.trim().slice(0, 60)}\n`
        : '';
      const prompt = `
你是一个富有想象力的故事场景设计师。你的任务是根据用户提供的要素，生成一份【情景】设定文本，用于后续故事。

${buildScenarioMarkdownRequirements(input.language)}

${emptyFieldsInstruction}
${titleHintText}

【用户的回答】
${answerText}
`.trim();
      const shouldDisablePolling = customProviderId !== null && customProviderId !== 'system';
      const providerOptions: GenerateWithAIOptions | undefined = (
        customProviderOverride
        || shouldDisablePolling
      )
        ? {
            ...(customProviderOverride ? { providerOverride: customProviderOverride } : {}),
            ...(shouldDisablePolling
              ? { loadBalanceStrategy: LoadBalanceStrategy.CUSTOM }
              : { loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL }),
          }
        : undefined;
      const reasoningBridge = shouldUseClientSse(request)
        ? createReasoningSseBridge('情景卡（流式）')
        : null;
      const aiTelemetry: NonNullable<GenerateWithAIOptions['telemetry']> = {};
      const channelContext = buildChannelContextFromPayload(
        customProviderPayload,
        customModelOverride,
      );
      const streamResult = await generateWithStreamAI(
        {
          prompt,
          temperature: 0.75,
          ...(customModelOverride ? { modelOverride: customModelOverride } : {}),
          ...(parsedGenerationSettings(customProviderPayload)),
        },
        {
          ...(providerOptions ?? {}),
          abortSignal: request.signal,
          telemetry: aiTelemetry,
          channelContext,
          ...(reasoningBridge ? { onReasoningEvent: reasoningBridge.onReasoningEvent } : {}),
        },
      );
      return completeStep({
        streamResult,
        reasoningBridge,
        aiTelemetry,
        customModelOverride,
      });
    },
    recordActivity: recordUserActivityFromRequest,
    buildResponse: (_request, _input, output) => {
      if (output.reasoningBridge) {
        return output.reasoningBridge.toResponse(output.streamResult.response, {
          usagePromise: output.streamResult.usagePromise,
          aiModel: output.aiTelemetry.model ?? output.customModelOverride ?? null,
        });
      }
      return output.streamResult.response;
    },
    logError: (error) => log.error('流式生成通用情景卡失败', { error }),
  });

const parsedGenerationSettings = (
  customProviderPayload: unknown,
): Pick<Parameters<typeof generateWithStreamAI>[0], 'generationSettingsContext'> => {
  const parsed = CustomProviderSchema.safeParse(customProviderPayload);
  if (!parsed.success) return {};
  return {
    generationSettingsContext: {
      providerId: parsed.data.providerId,
      ...(parsed.data.generationOverrides
        ? { userOverrides: parsed.data.generationOverrides }
        : {}),
    },
  };
};

export const defaultGenerateScenarioStreamService = createDefaultGenerateScenarioStreamService();
