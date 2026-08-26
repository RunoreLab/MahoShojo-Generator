import type { GenerateCanshouService } from '@mahoshojo/hosted-api/generate-canshou';
import type { GenerateCreatorService } from '@mahoshojo/hosted-api/generate-creator';
import type { GenerateFreeService } from '@mahoshojo/hosted-api/generate-free';
import type { GenerateMagicalGirlDetailsService } from '@mahoshojo/hosted-api/generate-magical-girl-details';
import type { GenerateScenarioService } from '@mahoshojo/hosted-api/generate-scenario';
import type { GenerateSublimationService } from '@mahoshojo/hosted-api/generate-sublimation';

import { resolveBuildRuleRuntimeResultsFromRequest } from '../creator/build-rule-request';
import { buildPersistedCreationInputs } from '../creator/card-metadata';
import { buildCreatorPromptInput, validateCreatorRequest } from '../creator/server';
import {
  createGenerateCanshouRuntime,
  type GenerateCanshouRuntimeDependencies,
} from '../generate-canshou-runtime';
import {
  createGenerateCanshouStreamRuntime,
  type GenerateCanshouStreamRuntimeDependencies,
} from '../generate-canshou-stream-runtime';
import {
  createGenerateCreatorRuntime,
  type GenerateCreatorRuntimeDependencies,
} from '../generate-creator-runtime';
import {
  createGenerateCreatorStreamRuntime,
  type GenerateCreatorStreamRuntimeDependencies,
} from '../generate-creator-stream-runtime';
import {
  createGenerateFreeRuntime,
  validateFreeOutput,
  type GenerateFreeRuntimeDependencies,
} from '../generate-free-runtime';
import {
  createGenerateFreeStreamRuntime,
  type GenerateFreeStreamRuntimeDependencies,
} from '../generate-free-stream-runtime';
import {
  createGenerateGameCardRuntime,
  type GenerateGameCardRuntimeDependencies,
} from '../generate-game-card-runtime';
import {
  createGenerateMagicalGirlRuntime,
  type AIGeneratedMagicalGirl,
  type GenerateMagicalGirlRuntimeDependencies,
  type MainColor,
} from '../generate-magical-girl-runtime';
import {
  createGenerateMagicalGirlDetailsRuntime,
  type GenerateMagicalGirlDetailsRuntimeDependencies,
} from '../generate-magical-girl-details-runtime';
import {
  createGenerateMagicalGirlDetailsStreamRuntime,
  type GenerateMagicalGirlDetailsStreamRuntimeDependencies,
} from '../generate-magical-girl-details-stream-runtime';
import {
  createGenerateScenarioRuntime,
  type GenerateScenarioRuntimeDependencies,
} from '../generate-scenario-runtime';
import {
  createGenerateScenarioStreamRuntime,
  type GenerateScenarioStreamRuntimeDependencies,
} from '../generate-scenario-stream-runtime';
import {
  createGenerateSublimationRuntime,
  type GenerateSublimationRuntimeDependencies,
} from '../generate-sublimation-runtime';
import {
  createGenerateSublimationStreamRuntime,
  type GenerateSublimationStreamRuntimeDependencies,
} from '../generate-sublimation-stream-runtime';
import { createActivityTokenService } from './activity-token';
import {
  createContentSafetyService,
  type AiSafetyPromptTemplate,
} from './content-safety';
import { createNodeD1ClientFromEnvironment } from './d1-client';
import {
  createNodeDataPorts,
  type NodeDataD1Client,
} from './data-ports';
import { createEnvSignatureService } from './env-signature';
import { applyShieldWordsToGameCardFaceData } from './game-card-content-safety';
import { silentLogger, type NodeAiLogger } from './logger';
import { buildJsonResponseWithOptionalAiMeta } from './meta-response';
import { AI_PROVIDER_CATALOG, resolveAIProviderModel } from './provider-catalog';
import { createNodeRawStreamAiRuntime } from './raw-stream-ai';
import { createReasoningSseBridge, shouldUseClientSse } from './reasoning-sse';
import {
  buildPublicAiRateLimitResponse,
  createPublicAiRateLimiter,
  OFFICIAL_KEY_QUESTIONNAIRE_CHARACTER_COOLDOWN_MS,
  type PublicAiProviderMode,
  type PublicAiRateLimitAction,
} from './public-rate-limit';
import { quickCheckForServer } from './sensitive-word-filter';
import { createNodeStructuredAiRuntime } from './structured-ai';
import {
  CANSHOU_LORE,
  DEFAULT_CANSHOU_QUESTION_TEXTS,
  DEFAULT_MAGICAL_GIRL_QUESTION_TEXTS,
  QUESTIONNAIRE_PRESET_INDEX,
  getRandomFlowers,
  requireQuestionnairePresetAsset,
} from './static-assets';
import { parseAIProvidersFromEnv } from './providers';
import type { GenerateWithAIOptions } from './types';

export type NodeHostedServicesOptions = {
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: typeof fetch;
  now?: () => Date;
  logger?: NodeAiLogger;
  getD1Client?: () => NodeDataD1Client | null;
  subtle?: typeof globalThis.crypto.subtle;
};

export type NodeHostedServices = Readonly<{
  generateFreeService: GenerateFreeService;
  generateFreeStreamService: GenerateFreeService;
  generateScenarioService: GenerateScenarioService;
  generateScenarioStreamService: GenerateScenarioService;
  generateCanshouService: GenerateCanshouService;
  generateCanshouStreamService: GenerateCanshouService;
  generateMagicalGirlDetailsService: GenerateMagicalGirlDetailsService;
  generateMagicalGirlDetailsStreamService: GenerateMagicalGirlDetailsService;
  generateSublimationService: GenerateSublimationService;
  generateSublimationStreamService: GenerateSublimationService;
  generateMagicalGirlService: ReturnType<typeof createGenerateMagicalGirlRuntime>['service'];
  generateMagicalGirlWithAI: ReturnType<
    typeof createGenerateMagicalGirlRuntime
  >['generateMagicalGirlWithAI'];
  generateGameCardService: ReturnType<typeof createGenerateGameCardRuntime>['service'];
  generateCreatorService: GenerateCreatorService;
  generateCreatorStreamService: GenerateCreatorService;
}>;

let configuredDefaultD1ClientResolver: (() => NodeDataD1Client | null) | null = null;
let cachedDefaultHttpD1Client: NodeDataD1Client | null | undefined;

export const configureDefaultNodeHostedD1ClientResolver = (
  resolver: (() => NodeDataD1Client | null) | null,
): void => {
  configuredDefaultD1ClientResolver = resolver;
};

export const getDefaultNodeHostedD1Client = (): NodeDataD1Client | null => {
  if (configuredDefaultD1ClientResolver) return configuredDefaultD1ClientResolver();
  if (cachedDefaultHttpD1Client === undefined) {
    cachedDefaultHttpD1Client = createNodeD1ClientFromEnvironment();
  }
  return cachedDefaultHttpD1Client;
};

const flagEnabled = (
  env: Readonly<Record<string, string | undefined>>,
  key: string,
  fallback: boolean,
): boolean => (env[key] ?? String(fallback)) === 'true';

const asStructuredPort = <T extends (..._args: never[]) => unknown>(
  generateWithAI: ReturnType<typeof createNodeStructuredAiRuntime>['generateWithAI'],
): T => generateWithAI as unknown as T;

const asStreamPort = <T extends (..._args: never[]) => unknown>(
  generateWithStreamAI: ReturnType<typeof createNodeRawStreamAiRuntime>['generateWithStreamAI'],
): T => generateWithStreamAI as unknown as T;

export const createNodeHostedServices = (
  options: NodeHostedServicesOptions = {},
): NodeHostedServices => {
  const env = options.env ?? process.env;
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? silentLogger;
  const signatureService = createEnvSignatureService({
    env,
    logger,
    ...(options.subtle ? { subtle: options.subtle } : {}),
  });
  const activityTokenService = createActivityTokenService(signatureService);
  const rateLimiter = createPublicAiRateLimiter({
    verifyActivityToken: activityTokenService.verifyActivityToken,
  });
  let cachedD1Client: NodeDataD1Client | null | undefined;
  const getD1Client = options.getD1Client ?? (() => {
    if (cachedD1Client === undefined) {
      cachedD1Client = createNodeD1ClientFromEnvironment({ env, fetch: fetcher });
    }
    return cachedD1Client;
  });
  const dataPorts = createNodeDataPorts({
    getD1Client,
    getUserIdFromActivityHeaders: activityTokenService.getUserIdFromActivityHeaders,
    now,
    log: logger,
  });
  const aiDependencies = {
    providers: parseAIProvidersFromEnv(env),
    loadBalanceStrategy: env.AI_LOAD_BALANCE_STRATEGY || 'random',
    logger,
    recordAiChannelOutcome: dataPorts.recordAiChannelOutcome,
    fetch: fetcher,
  };
  const structuredAi = createNodeStructuredAiRuntime(aiDependencies);
  const streamAi = createNodeRawStreamAiRuntime(aiDependencies);
  const contentSafety = createContentSafetyService({
    defaults: {
      enableSensitiveWordFilter: flagEnabled(
        env,
        'NEXT_PUBLIC_ENABLE_SENSITIVE_WORD_FILTER',
        true,
      ),
      enableAiSafetyCheck: flagEnabled(env, 'NEXT_PUBLIC_ENABLE_AI_SAFETY_CHECK', false),
    },
    quickCheck: quickCheckForServer,
    generateWithAI: (input, config) => structuredAi.generateWithAI(input, config),
  });

  const providerPorts = {
    findProvider: (providerId: string) => AI_PROVIDER_CATALOG.find(
      (provider) => provider.id === providerId,
    ) ?? null,
    resolveModel: (
      provider: Parameters<typeof resolveAIProviderModel>[0],
      modelId: string,
    ) => resolveAIProviderModel(provider, modelId),
  };
  const checkRateLimit = async (
    input: {
      request: Request;
      actionType: PublicAiRateLimitAction;
      providerMode: PublicAiProviderMode;
    },
  ): Promise<Response | null> => {
    const result = await rateLimiter.acquirePublicAiRateLimit({
      req: input.request,
      actionType: input.actionType,
      providerMode: input.providerMode,
    });
    return result.allowed ? null : buildPublicAiRateLimitResponse(result);
  };
  const enforceSafety = (
    input: {
      request: Request;
      text: string;
      logMeta?: Record<string, unknown>;
      sensitiveWordReason?: string;
      enableAiSafetyCheck?: boolean;
      aiPromptTemplate?: AiSafetyPromptTemplate;
    },
  ): Promise<Response | null> => contentSafety.enforceTextSafety({
    text: input.text,
    log: logger,
    ...('logMeta' in input ? { logMeta: input.logMeta } : {}),
    ...('sensitiveWordReason' in input
      ? { sensitiveWordReason: input.sensitiveWordReason }
      : {}),
    ...('enableAiSafetyCheck' in input
      ? { enableAiSafetyCheck: input.enableAiSafetyCheck }
      : {}),
    ...('aiPromptTemplate' in input ? { aiPromptTemplate: input.aiPromptTemplate } : {}),
  });
  const buildResponse = (
    input: Parameters<GenerateFreeRuntimeDependencies['buildResponse']>[0],
  ): Response => buildJsonResponseWithOptionalAiMeta({
    requestHeaders: input.requestHeaders,
    data: input.data,
    telemetry: input.telemetry as GenerateWithAIOptions['telemetry'],
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  const loadPreset = async (_requestUrl: string, path: string): Promise<unknown> => (
    requireQuestionnairePresetAsset(path)
  );
  const recordActivity = dataPorts.recordUserActivityFromRequest;
  const sign = signatureService.generateSignature;
  const logInfo = (message: string): void => logger.info(message);
  const logWarn = (message: string): void => logger.warn(message);
  const logError = (message: string): ((_error: unknown) => void) =>
    () => logger.error(message);

  const generateFreeService = createGenerateFreeRuntime({
    ...providerPorts,
    checkRateLimit,
    enforceSafety,
    generateWithAI: asStructuredPort<GenerateFreeRuntimeDependencies['generateWithAI']>(
      structuredAi.generateWithAI,
    ),
    validateOutput: validateFreeOutput,
    now,
    recordActivity,
    buildResponse,
    logError: logError('自由生成失败'),
  }).service;

  const generateFreeStreamService = createGenerateFreeStreamRuntime({
    ...providerPorts,
    checkRateLimit,
    enforceSafety,
    shouldUseReasoningSse: shouldUseClientSse,
    createReasoningSseBridge,
    generateWithStreamAI: asStreamPort<
      GenerateFreeStreamRuntimeDependencies['generateWithStreamAI']
    >(streamAi.generateWithStreamAI),
    recordActivity,
    logError: logError('流式自由生成失败'),
  }).service;

  const generateScenarioService = createGenerateScenarioRuntime({
    ...providerPorts,
    checkRateLimit,
    enforceSafety,
    generateWithAI: asStructuredPort<GenerateScenarioRuntimeDependencies['generateWithAI']>(
      structuredAi.generateWithAI,
    ),
    now,
    sign,
    recordActivity,
    buildResponse,
    logWarn,
    logError: logError('情景生成失败'),
  }).service;

  const generateScenarioStreamService = createGenerateScenarioStreamRuntime({
    ...providerPorts,
    checkRateLimit,
    enforceSafety,
    shouldUseReasoningSse: shouldUseClientSse,
    createReasoningSseBridge,
    generateWithStreamAI: asStreamPort<
      GenerateScenarioStreamRuntimeDependencies['generateWithStreamAI']
    >(streamAi.generateWithStreamAI),
    recordActivity,
    logWarn,
    logError: logError('流式生成通用情景卡失败'),
  }).service;

  const generateCanshouService = createGenerateCanshouRuntime({
    ...providerPorts,
    presetIndex: QUESTIONNAIRE_PRESET_INDEX,
    canshouLore: CANSHOU_LORE,
    loadPreset,
    loadDataCard: (id) => dataPorts.getDataCardById(id, false),
    checkRateLimit,
    enforceSafety,
    generateWithAI: asStructuredPort<GenerateCanshouRuntimeDependencies['generateWithAI']>(
      structuredAi.generateWithAI,
    ),
    sign,
    recordActivity,
    buildResponse,
    logInfo,
    logWarn,
    logError: logError('生成残兽档案失败'),
  }).service;

  const generateCanshouStreamService = createGenerateCanshouStreamRuntime({
    ...providerPorts,
    canshouLore: CANSHOU_LORE,
    checkRateLimit,
    enforceSafety,
    shouldUseReasoningSse: shouldUseClientSse,
    createReasoningSseBridge,
    generateWithStreamAI: asStreamPort<
      GenerateCanshouStreamRuntimeDependencies['generateWithStreamAI']
    >(streamAi.generateWithStreamAI),
    recordActivity,
    logInfo,
    logWarn,
    logError: logError('流式生成残兽通用角色卡失败'),
  }).service;

  const generateMagicalGirlDetailsService = createGenerateMagicalGirlDetailsRuntime({
    ...providerPorts,
    presetIndex: QUESTIONNAIRE_PRESET_INDEX,
    loadPreset,
    loadDataCard: (id) => dataPorts.getDataCardById(id, false),
    getRandomFlowers,
    checkRateLimit,
    enforceSafety,
    generateWithAI: asStructuredPort<
      GenerateMagicalGirlDetailsRuntimeDependencies['generateWithAI']
    >(structuredAi.generateWithAI),
    sign,
    recordActivity,
    buildResponse,
    logInfo,
    logWarn,
    logError: logError('生成魔法少女详细信息失败'),
  }).service;

  const generateMagicalGirlDetailsStreamService = createGenerateMagicalGirlDetailsStreamRuntime({
    ...providerPorts,
    getRandomFlowers,
    checkRateLimit,
    enforceSafety,
    shouldUseReasoningSse: shouldUseClientSse,
    createReasoningSseBridge,
    generateWithStreamAI: asStreamPort<
      GenerateMagicalGirlDetailsStreamRuntimeDependencies['generateWithStreamAI']
    >(streamAi.generateWithStreamAI),
    recordActivity,
    logInfo,
    logWarn,
    logError: logError('流式生成魔法少女档案失败'),
  }).service;

  const generateSublimationService = createGenerateSublimationRuntime({
    ...providerPorts,
    presetIndex: QUESTIONNAIRE_PRESET_INDEX,
    defaultQuestions: {
      magicalGirl: [...DEFAULT_MAGICAL_GIRL_QUESTION_TEXTS],
      canshou: [...DEFAULT_CANSHOU_QUESTION_TEXTS],
    },
    allowGuidedNativeSigning: flagEnabled(
      env,
      'ALLOW_GUIDED_SUBLIMATION_NATIVE_SIGNING',
      false,
    ),
    loadPreset,
    loadDataCard: (id) => dataPorts.getDataCardById(id, false),
    checkRateLimit,
    enforceSafety,
    generateWithAI: asStructuredPort<
      GenerateSublimationRuntimeDependencies['generateWithAI']
    >(structuredAi.generateWithAI),
    verify: signatureService.verifySignature,
    sign,
    recordActivity,
    buildResponse,
    now,
    logInfo,
    logWarn,
    logError: logError('成长升华失败'),
  }).service;

  const generateSublimationStreamService = createGenerateSublimationStreamRuntime({
    ...providerPorts,
    checkRateLimit,
    enforceSafety,
    shouldUseReasoningSse: shouldUseClientSse,
    createReasoningSseBridge,
    generateWithStreamAI: asStreamPort<
      GenerateSublimationStreamRuntimeDependencies['generateWithStreamAI']
    >(streamAi.generateWithStreamAI),
    recordActivity,
    logInfo,
    logWarn,
    logError: logError('流式升华失败'),
  }).service;

  const magicalGirlRuntime = createGenerateMagicalGirlRuntime({
    checkRateLimit,
    enforceSafety: ({ request: _request, name, language }) => contentSafety.enforceTextSafety({
      text: name,
      log: logger,
      logMeta: { nameLength: name.length, language },
      enableAiSafetyCheck: false,
      sensitiveWordReason: '使用危险符文',
    }),
    generateWithAI: asStructuredPort<GenerateMagicalGirlRuntimeDependencies['generateWithAI']>(
      structuredAi.generateWithAI,
    ),
    sign,
    recordActivity,
    logError: logError('生成魔法少女失败'),
    cooldownMs: OFFICIAL_KEY_QUESTIONNAIRE_CHARACTER_COOLDOWN_MS,
  });

  const generateGameCardService = createGenerateGameCardRuntime({
    ...providerPorts,
    enforceSafety,
    checkRateLimit,
    generateWithAI: asStructuredPort<GenerateGameCardRuntimeDependencies['generateWithAI']>(
      structuredAi.generateWithAI,
    ),
    isSensitiveWordFilterEnabled: flagEnabled(
      env,
      'NEXT_PUBLIC_ENABLE_SENSITIVE_WORD_FILTER',
      true,
    ),
    checkOutputSafety: async (serializedFaceData) => {
      const result = await quickCheckForServer(serializedFaceData);
      return {
        hasSensitiveWords: result.hasSensitiveWords,
        detectedWords: result.detectedWords,
      };
    },
    applyShieldWords: (faceData) => applyShieldWordsToGameCardFaceData(faceData).faceData,
    recordActivity,
    buildResponse,
    logInfo,
    logWarn,
    logError: logError('卡牌卡面生成失败'),
  }).service;

  const creatorDomainPorts = {
    resolveBuildRules: resolveBuildRuleRuntimeResultsFromRequest,
    validateCreatorRequest,
    buildCreatorPromptInput,
  };
  const generateCreatorService = createGenerateCreatorRuntime({
    ...providerPorts,
    ...creatorDomainPorts,
    presetIndex: QUESTIONNAIRE_PRESET_INDEX,
    canshouLore: CANSHOU_LORE,
    loadPreset,
    loadDataCard: (id) => dataPorts.getDataCardById(id, false),
    buildPersistedCreationInputs,
    getRandomFlowers,
    checkRateLimit,
    enforceSafety,
    generateWithAI: asStructuredPort<GenerateCreatorRuntimeDependencies['generateWithAI']>(
      structuredAi.generateWithAI,
    ),
    sign,
    recordActivity,
    buildResponse,
    logInfo,
    logWarn,
    logError: logError('生成创作页结构化结果失败'),
  }).service;

  const generateCreatorStreamService = createGenerateCreatorStreamRuntime({
    ...providerPorts,
    ...creatorDomainPorts,
    checkRateLimit,
    enforceSafety,
    shouldUseReasoningSse: shouldUseClientSse,
    createReasoningSseBridge,
    generateWithStreamAI: asStreamPort<
      GenerateCreatorStreamRuntimeDependencies['generateWithStreamAI']
    >(streamAi.generateWithStreamAI),
    recordActivity,
    logInfo,
    logWarn,
    logError: logError('流式生成创作结果失败'),
  }).service;

  return Object.freeze({
    generateFreeService,
    generateFreeStreamService,
    generateScenarioService,
    generateScenarioStreamService,
    generateCanshouService,
    generateCanshouStreamService,
    generateMagicalGirlDetailsService,
    generateMagicalGirlDetailsStreamService,
    generateSublimationService,
    generateSublimationStreamService,
    generateMagicalGirlService: magicalGirlRuntime.service,
    generateMagicalGirlWithAI: magicalGirlRuntime.generateMagicalGirlWithAI,
    generateGameCardService,
    generateCreatorService,
    generateCreatorStreamService,
  });
};

const createDefaultService = <K extends keyof NodeHostedServices>(key: K) =>
  (): NodeHostedServices[K] => createNodeHostedServices({
    getD1Client: getDefaultNodeHostedD1Client,
  })[key];

export const createDefaultGenerateFreeService = createDefaultService('generateFreeService');
export const createDefaultGenerateFreeStreamService = createDefaultService(
  'generateFreeStreamService',
);
export const createDefaultGenerateScenarioService = createDefaultService(
  'generateScenarioService',
);
export const createDefaultGenerateScenarioStreamService = createDefaultService(
  'generateScenarioStreamService',
);
export const createDefaultGenerateCanshouService = createDefaultService(
  'generateCanshouService',
);
export const createDefaultGenerateCanshouStreamService = createDefaultService(
  'generateCanshouStreamService',
);
export const createDefaultGenerateMagicalGirlDetailsService = createDefaultService(
  'generateMagicalGirlDetailsService',
);
export const createDefaultGenerateMagicalGirlDetailsStreamService = createDefaultService(
  'generateMagicalGirlDetailsStreamService',
);
export const createDefaultGenerateSublimationService = createDefaultService(
  'generateSublimationService',
);
export const createDefaultGenerateSublimationStreamService = createDefaultService(
  'generateSublimationStreamService',
);
export const createDefaultGenerateCreatorService = createDefaultService('generateCreatorService');
export const createDefaultGenerateCreatorStreamService = createDefaultService(
  'generateCreatorStreamService',
);

const defaultServices = createNodeHostedServices({
  getD1Client: getDefaultNodeHostedD1Client,
});

export const defaultGenerateFreeService = defaultServices.generateFreeService;
export const defaultGenerateFreeStreamService = defaultServices.generateFreeStreamService;
export const defaultGenerateScenarioService = defaultServices.generateScenarioService;
export const defaultGenerateScenarioStreamService = defaultServices.generateScenarioStreamService;
export const defaultGenerateCanshouService = defaultServices.generateCanshouService;
export const defaultGenerateCanshouStreamService = defaultServices.generateCanshouStreamService;
export const defaultGenerateMagicalGirlDetailsService =
  defaultServices.generateMagicalGirlDetailsService;
export const defaultGenerateMagicalGirlDetailsStreamService =
  defaultServices.generateMagicalGirlDetailsStreamService;
export const defaultGenerateSublimationService = defaultServices.generateSublimationService;
export const defaultGenerateSublimationStreamService =
  defaultServices.generateSublimationStreamService;
export const defaultGenerateMagicalGirlService = defaultServices.generateMagicalGirlService;
export const generateMagicalGirlWithAI = defaultServices.generateMagicalGirlWithAI;
export const defaultGenerateGameCardService = defaultServices.generateGameCardService;
export const defaultGenerateCreatorService = defaultServices.generateCreatorService;
export const defaultGenerateCreatorStreamService = defaultServices.generateCreatorStreamService;

export type { AIGeneratedMagicalGirl, MainColor };
