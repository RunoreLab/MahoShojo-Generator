import type { GenerateScenarioService } from '@mahoshojo/hosted-api/generate-scenario';
import {
  createGenerateScenarioStreamRuntime,
  type GenerateScenarioStreamRuntimeDependencies,
} from '@mahoshojo/hosted-runtime/generate-scenario-stream-runtime';

import { AI_PROVIDER_CATALOG, resolveAIProviderModel } from '@/lib/ai/constants';
import {
  acquirePublicAiRateLimit,
  buildPublicAiRateLimitResponse,
} from '@/lib/ai/public-rate-limit';
import type { AIProvider } from '@/lib/config';
import { enforceTextSafety } from '@/lib/content-safety/server';
import { getLogger } from '@/lib/logger';
import { createReasoningSseBridge, shouldUseClientSse } from '@/lib/stream/reasoning-sse';
import {
  generateWithStreamAI,
  LoadBalanceStrategy,
  type GenerateWithAIOptions,
  type RawGenerationConfig,
} from '@/lib/stream/raw-ai';
import { recordUserActivityFromRequest } from '@/lib/user-activity/record';

const log = getLogger('api-gen-scenario-stream');

const mapStreamOptions = (
  options: Parameters<GenerateScenarioStreamRuntimeDependencies['generateWithStreamAI']>[1],
): GenerateWithAIOptions => ({
  abortSignal: options.abortSignal,
  telemetry: options.telemetry as NonNullable<GenerateWithAIOptions['telemetry']>,
  channelContext: options.channelContext,
  ...(options.loadBalanceStrategy === 'custom'
    ? { loadBalanceStrategy: LoadBalanceStrategy.CUSTOM }
    : options.loadBalanceStrategy === 'sequential'
      ? { loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL }
      : {}),
  ...(options.providerOverride
    ? { providerOverride: options.providerOverride as AIProvider }
    : {}),
  ...(options.generationSettingsContext
    ? { generationSettingsContext: options.generationSettingsContext }
    : {}),
  ...(options.onReasoningEvent
    ? { onReasoningEvent: options.onReasoningEvent }
    : {}),
});

export const createDefaultGenerateScenarioStreamService = (): GenerateScenarioService =>
  createGenerateScenarioStreamRuntime({
    findProvider: (providerId) => AI_PROVIDER_CATALOG.find(
      (provider) => provider.id === providerId,
    ) ?? null,
    resolveModel: (provider, modelId) => {
      const providerConfig = AI_PROVIDER_CATALOG.find(
        (candidate) => candidate.id === provider.id,
      );
      return providerConfig ? resolveAIProviderModel(providerConfig, modelId) : null;
    },
    checkRateLimit: async ({ request, actionType, providerMode }) => {
      const rateLimit = await acquirePublicAiRateLimit({
        req: request,
        actionType,
        providerMode,
      });
      return rateLimit.allowed ? null : buildPublicAiRateLimitResponse(rateLimit);
    },
    enforceSafety: ({ text, logMeta, sensitiveWordReason, aiPromptTemplate }) =>
      enforceTextSafety({
        text,
        log,
        logMeta,
        sensitiveWordReason,
        aiPromptTemplate,
      }),
    shouldUseReasoningSse: shouldUseClientSse,
    createReasoningSseBridge,
    generateWithStreamAI: (config, options) => generateWithStreamAI(
      config as RawGenerationConfig,
      mapStreamOptions(options),
    ),
    recordActivity: recordUserActivityFromRequest,
    logWarn: (message, meta) => {
      log.warn(message, meta);
    },
    logError: (error) => {
      log.error('流式生成通用情景卡失败', { error });
    },
  }).service;

export const defaultGenerateScenarioStreamService = createDefaultGenerateScenarioStreamService();
