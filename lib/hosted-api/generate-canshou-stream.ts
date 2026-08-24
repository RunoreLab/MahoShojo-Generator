import type { GenerateCanshouService } from '@mahoshojo/hosted-api/generate-canshou';
import {
  createGenerateCanshouStreamRuntime,
  type GenerateCanshouStreamRuntimeDependencies,
} from '@mahoshojo/hosted-runtime/generate-canshou-stream-runtime';

import { AI_PROVIDER_CATALOG, resolveAIProviderModel } from '@/lib/ai/constants';
import {
  acquirePublicAiRateLimit,
  buildPublicAiRateLimitResponse,
} from '@/lib/ai/public-rate-limit';
import { CANSHOU_LORE } from '@/lib/canshou-lore';
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

const log = getLogger('api-gen-canshou-stream');

const mapStreamOptions = (
  options: Parameters<GenerateCanshouStreamRuntimeDependencies['generateWithStreamAI']>[1],
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

export const createDefaultGenerateCanshouStreamService = (): GenerateCanshouService =>
  createGenerateCanshouStreamRuntime({
    canshouLore: CANSHOU_LORE,
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
    enforceSafety: ({ text, logMeta, enableAiSafetyCheck, sensitiveWordReason }) =>
      enforceTextSafety({
        text,
        log,
        logMeta,
        enableAiSafetyCheck,
        sensitiveWordReason,
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
      log.error('流式生成残兽通用角色卡失败', { error });
    },
  }).service;

export const defaultGenerateCanshouStreamService = createDefaultGenerateCanshouStreamService();
export default defaultGenerateCanshouStreamService;
