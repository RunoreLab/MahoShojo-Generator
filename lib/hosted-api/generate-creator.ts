import type { GenerateCreatorService } from '@mahoshojo/hosted-api/generate-creator';
import {
  createGenerateCreatorRuntime,
  type GenerateCreatorAiOptions,
} from '@mahoshojo/hosted-runtime/generate-creator-runtime';

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
import { CANSHOU_LORE } from '@/lib/canshou-lore';
import { resolveBuildRuleRuntimeResultsFromRequest } from '@/lib/creator/build-rule-request';
import { buildPersistedCreationInputs } from '@/lib/creator/card-metadata';
import {
  buildCreatorPromptInput,
  validateCreatorRequest,
} from '@/lib/creator/server';
import type { CreatorRequestInput as RootCreatorRequestInput } from '@/lib/creator/types';
import { getDataCardById } from '@/lib/database/data-cards';
import { getLogger } from '@/lib/logger';
import { getRandomFlowers } from '@/lib/random-choose-hana-name';
import { generateSignature } from '@/lib/signature';
import { recordUserActivityFromRequest } from '@/lib/user-activity/record';
import presetIndex from '@/public/questionnaires/presets/index.json';

const log = getLogger('api-gen-details');

const loadPresetQuestionnaire = async (
  requestUrl: string,
  path: string,
): Promise<unknown> => {
  const response = await fetch(new URL(path, requestUrl), { method: 'GET' });
  if (!response.ok) {
    throw new Error(`加载预设问卷失败: ${response.status} ${response.statusText}`);
  }
  return response.json();
};

const mapAiOptions = (options: GenerateCreatorAiOptions): GenerateWithAIOptions => ({
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

type CreatorGeneratePort = Parameters<
  typeof createGenerateCreatorRuntime
>[0]['generateWithAI'];

export const createDefaultGenerateCreatorService = (): GenerateCreatorService =>
  createGenerateCreatorRuntime({
    presetIndex,
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
    loadPreset: loadPresetQuestionnaire,
    loadDataCard: (id) => getDataCardById(id, false),
    resolveBuildRules: resolveBuildRuleRuntimeResultsFromRequest,
    validateCreatorRequest: (input) => {
      validateCreatorRequest(input as RootCreatorRequestInput);
    },
    buildCreatorPromptInput: (input) => buildCreatorPromptInput(
      input as RootCreatorRequestInput,
    ),
    buildPersistedCreationInputs,
    getRandomFlowers,
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
    generateWithAI: (
      input: Parameters<CreatorGeneratePort>[0],
      config: Parameters<CreatorGeneratePort>[1],
      options: GenerateCreatorAiOptions,
    ) => generateWithAI(
      input,
      config as GenerationConfig<Awaited<ReturnType<CreatorGeneratePort>>, typeof input>,
      mapAiOptions(options),
    ),
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
    logInfo: (message, meta) => {
      log.info(message, meta);
    },
    logWarn: (message, meta) => {
      log.warn(message, meta);
    },
    logError: (error, input) => {
      log.error('生成创作页结构化结果失败', {
        error,
        answersLength: input?.normalizedAnswers.length,
        template: input?.template,
      });
    },
  }).service;

export const defaultGenerateCreatorService = createDefaultGenerateCreatorService();
export default defaultGenerateCreatorService;
