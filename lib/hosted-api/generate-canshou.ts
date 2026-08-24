import type { GenerateCanshouService } from '@mahoshojo/hosted-api/generate-canshou';
import {
  createGenerateCanshouRuntime,
  type GenerateCanshouAiOptions,
} from '@mahoshojo/hosted-runtime/generate-canshou-runtime';

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
import { CANSHOU_LORE } from '@/lib/canshou-lore';
import type { AIProvider } from '@/lib/config';
import { enforceTextSafety } from '@/lib/content-safety/server';
import { getDataCardById } from '@/lib/database/data-cards';
import { getLogger } from '@/lib/logger';
import { generateSignature } from '@/lib/signature';
import { recordUserActivityFromRequest } from '@/lib/user-activity/record';
import presetIndex from '@/public/questionnaires/presets/index.json';

const log = getLogger('api-gen-canshou');

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

const mapAiOptions = (options: GenerateCanshouAiOptions): GenerateWithAIOptions => ({
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

type CanshouGeneratePort = Parameters<
  typeof createGenerateCanshouRuntime
>[0]['generateWithAI'];

export const createDefaultGenerateCanshouService = (): GenerateCanshouService =>
  createGenerateCanshouRuntime({
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
        ...(sensitiveWordReason ? { sensitiveWordReason } : {}),
      }),
    generateWithAI: (input, config, options) => generateWithAI(
      input,
      config as GenerationConfig<Awaited<ReturnType<CanshouGeneratePort>>, typeof input>,
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
    logError: (error) => {
      log.error('生成残兽档案失败', { error });
    },
  }).service;

export const defaultGenerateCanshouService = createDefaultGenerateCanshouService();
export default defaultGenerateCanshouService;
