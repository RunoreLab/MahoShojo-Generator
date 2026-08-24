import {
  createGenerateGameCardRuntime,
} from '@mahoshojo/hosted-runtime/generate-game-card-runtime';
import {
  generateWithAI,
  LoadBalanceStrategy,
  type GenerateWithAIOptions,
} from '@/lib/ai';
import { AI_PROVIDER_CATALOG, resolveAIProviderModel } from '@/lib/ai/constants';
import { buildJsonResponseWithOptionalAiMeta } from '@/lib/ai/meta-response';
import {
  acquirePublicAiRateLimit,
  buildPublicAiRateLimitResponse,
} from '@/lib/ai/public-rate-limit';
import { applyShieldWordsToGameCardFaceData } from '@/lib/card-forge/content-safety';
import { config as appConfig, type AIProvider } from '@/lib/config';
import { enforceTextSafety } from '@/lib/content-safety/server';
import { getLogger } from '@/lib/logger';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { recordUserActivityFromRequest } from '@/lib/user-activity/record';

const log = getLogger('api-gen-game-card');

const defaultGenerateGameCardRuntime = createGenerateGameCardRuntime({
  findProvider: (providerId) => AI_PROVIDER_CATALOG.find(
    (provider) => provider.id === providerId,
  ) ?? null,
  resolveModel: (provider, modelId) => {
    const providerConfig = AI_PROVIDER_CATALOG.find(
      (candidate) => candidate.id === provider.id,
    );
    return providerConfig
      ? resolveAIProviderModel(providerConfig, modelId)
      : null;
  },
  enforceSafety: async ({ text, sensitiveWordReason, aiPromptTemplate }) => enforceTextSafety({
    text,
    log,
    sensitiveWordReason,
    aiPromptTemplate,
  }),
  checkRateLimit: async ({ request, actionType, providerMode }) => {
    const rateLimit = await acquirePublicAiRateLimit({
      req: request,
      actionType,
      providerMode,
    });
    return rateLimit.allowed ? null : buildPublicAiRateLimitResponse(rateLimit);
  },
  generateWithAI: async (input, config, options) => generateWithAI(
    input,
    config,
    {
      channelContext: options.channelContext,
      telemetry: options.telemetry as NonNullable<GenerateWithAIOptions['telemetry']>,
      ...(options.loadBalanceStrategy === 'sequential'
        ? { loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL }
        : {}),
      ...(options.providerOverride
        ? { providerOverride: options.providerOverride as AIProvider }
        : {}),
      ...(options.generationSettingsContext
        ? { generationSettingsContext: options.generationSettingsContext }
        : {}),
    },
  ),
  isSensitiveWordFilterEnabled: appConfig.ENABLE_SENSITIVE_WORD_FILTER,
  checkOutputSafety: async (serializedFaceData) => {
    const outputCheck = await quickCheck(serializedFaceData);
    return {
      hasSensitiveWords: outputCheck.hasSensitiveWords,
      detectedWords: outputCheck.detectedWords,
    };
  },
  applyShieldWords: (faceData) => applyShieldWordsToGameCardFaceData(faceData).faceData,
  recordActivity: recordUserActivityFromRequest,
  buildResponse: ({ requestHeaders, data, telemetry }) => buildJsonResponseWithOptionalAiMeta({
    requestHeaders,
    data,
    telemetry: telemetry as NonNullable<GenerateWithAIOptions['telemetry']>,
  }),
  logInfo: (message, meta) => {
    log.info(message, meta);
  },
  logWarn: (message, meta) => {
    log.warn(message, meta);
  },
  logError: (error) => {
    log.error('卡牌卡面生成失败', { error: String(error) });
  },
});

export const defaultGenerateGameCardService = defaultGenerateGameCardRuntime.service;
