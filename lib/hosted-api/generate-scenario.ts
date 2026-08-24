import type { GenerateScenarioService } from '@mahoshojo/hosted-api/generate-scenario';
import {
  createGenerateScenarioRuntime,
  type GenerateScenarioAiOptions,
  type ScenarioGeneratedData,
} from '@mahoshojo/hosted-runtime/generate-scenario-runtime';

import {
  generateWithAI,
  LoadBalanceStrategy,
  type GenerationConfig,
  type GenerateWithAIOptions,
} from '@/lib/ai';
import { AI_PROVIDER_CATALOG, resolveAIProviderModel } from '@/lib/ai/constants';
import { buildJsonResponseWithOptionalAiMeta } from '@/lib/ai/meta-response';
import {
  acquirePublicAiRateLimit,
  buildPublicAiRateLimitResponse,
} from '@/lib/ai/public-rate-limit';
import type { AIProvider } from '@/lib/config';
import { enforceTextSafety } from '@/lib/content-safety/server';
import { getLogger } from '@/lib/logger';
import { generateSignature } from '@/lib/signature';
import { recordUserActivityFromRequest } from '@/lib/user-activity/record';

const log = getLogger('api-gen-scenario');

const mapAiOptions = (options: GenerateScenarioAiOptions): GenerateWithAIOptions => ({
  channelContext: options.channelContext,
  telemetry: options.telemetry as NonNullable<GenerateWithAIOptions['telemetry']>,
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
});

export const createDefaultGenerateScenarioService = (): GenerateScenarioService =>
  createGenerateScenarioRuntime({
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
    generateWithAI: (input, config, options) => generateWithAI(
      input,
      config as GenerationConfig<ScenarioGeneratedData, null>,
      mapAiOptions(options),
    ),
    now: () => new Date(),
    sign: generateSignature,
    recordActivity: recordUserActivityFromRequest,
    buildResponse: ({ requestHeaders, data, telemetry }) =>
      buildJsonResponseWithOptionalAiMeta({
        requestHeaders,
        data,
        telemetry: telemetry as NonNullable<GenerateWithAIOptions['telemetry']>,
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    logWarn: (message, meta) => {
      log.warn(message, meta);
    },
    logError: (error) => {
      log.error('情景生成失败', { error });
    },
  }).service;

export const defaultGenerateScenarioService = createDefaultGenerateScenarioService();
