import type { GenerateFreeService } from '@mahoshojo/hosted-api/generate-free';
import {
  createGenerateFreeRuntime,
  type GenerateFreeAiOptions,
  type FreeSchemaId,
} from '@mahoshojo/hosted-runtime/generate-free-runtime';

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
import {
  CanshouSchema,
  GeneralCharacterSchema,
  GeneralScenarioSchema,
  MagicalGirlSchema,
  ScenarioSchema,
} from '@/lib/schemas';
import { recordUserActivityFromRequest } from '@/lib/user-activity/record';

const log = getLogger('api-gen-free');

const validateOutput = (schemaId: FreeSchemaId, data: unknown): unknown => {
  switch (schemaId) {
    case 'magical-girl':
      return MagicalGirlSchema.parse(data);
    case 'canshou':
      return CanshouSchema.parse(data);
    case 'scenario':
      return ScenarioSchema.parse(data);
    case 'general':
      return GeneralCharacterSchema.parse(data);
    case 'general-scenario':
      return GeneralScenarioSchema.parse(data);
  }
};

const mapAiOptions = (options: GenerateFreeAiOptions): GenerateWithAIOptions => ({
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

export const createDefaultGenerateFreeService = (): GenerateFreeService =>
  createGenerateFreeRuntime({
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
      config as GenerationConfig<unknown, typeof input>,
      mapAiOptions(options),
    ),
    validateOutput: ({ schemaId, data }) => validateOutput(schemaId, data),
    now: () => new Date(),
    recordActivity: recordUserActivityFromRequest,
    buildResponse: ({ requestHeaders, data, telemetry }) =>
      buildJsonResponseWithOptionalAiMeta({
        requestHeaders,
        data,
        telemetry: telemetry as NonNullable<GenerateWithAIOptions['telemetry']>,
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    logError: (error) => {
      log.error('自由生成失败', { error });
    },
  }).service;

export const defaultGenerateFreeService = createDefaultGenerateFreeService();
