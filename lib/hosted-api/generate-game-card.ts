import {
  createGenerateGameCardService,
  type GenerateGameCardInput,
  type GenerateGameCardService,
} from '@mahoshojo/hosted-api/generate-game-card';
import {
  completeStep,
  respondStep,
} from '@mahoshojo/hosted-api/regular-generation';
import { generateWithAI, LoadBalanceStrategy, type GenerateWithAIOptions } from '@/lib/ai';
import { buildChannelContextFromPayload } from '@/lib/ai/availability';
import { AI_PROVIDER_CATALOG, resolveAIProviderModel } from '@/lib/ai/constants';
import {
  acquirePublicAiRateLimit,
  buildPublicAiRateLimitResponse,
  inferPublicAiProviderMode,
} from '@/lib/ai/public-rate-limit';
import { buildJsonResponseWithOptionalAiMeta } from '@/lib/ai/meta-response';
import { config as appConfig, type AIProvider } from '@/lib/config';
import { applyShieldWordsToGameCardFaceData } from '@/lib/card-forge/content-safety';
import { enforceTextSafety } from '@/lib/content-safety/server';
import { getLogger } from '@/lib/logger';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { recordUserActivityFromRequest } from '@/lib/user-activity/record';
import { gameCardGenerationConfig, type GameCardGenerationInput } from '@/lib/game-card/config';
import type { GameCardFaceData } from '@/lib/schemas/game-card';
import { inferCharacterKind } from '@mahoshojo/domain/data-cards';

const log = getLogger('api-gen-game-card');

type GameCardGeneration = {
  generatedFaceData: GameCardFaceData;
  telemetry: NonNullable<GenerateWithAIOptions['telemetry']>;
};

type GameCardOutput = GameCardGeneration & {
  faceData: ReturnType<typeof applyShieldWordsToGameCardFaceData>['faceData'];
  sourceCardKind: ReturnType<typeof inferCharacterKind>;
};

const resolveProviderOptions = (input: GenerateGameCardInput): {
  response?: Response;
  providerOptions?: GenerateWithAIOptions;
  customModelOverride?: string;
} => {
  const customProviderPayload = input.customProvider;
  if (!customProviderPayload) return {};

  const providerConfig = AI_PROVIDER_CATALOG.find(
    (item) => item.id === customProviderPayload.providerId,
  );
  if (!providerConfig) {
    return {
      response: new Response(JSON.stringify({ error: '未知的模型供应商 ID' }), { status: 400 }),
    };
  }

  const modelResolution = resolveAIProviderModel(providerConfig, customProviderPayload.modelId);
  if (!modelResolution) {
    return {
      response: new Response(JSON.stringify({ error: '未知的模型 ID' }), { status: 400 }),
    };
  }

  const sanitizedApiKey = customProviderPayload.apiKey.trim();
  if (!sanitizedApiKey && providerConfig.id !== 'system') {
    return {
      response: new Response(JSON.stringify({ error: 'API Key 不能为空' }), { status: 400 }),
    };
  }

  const sanitizedBaseUrl = providerConfig.baseUrl?.trim() ?? '';
  if (!sanitizedBaseUrl) {
    return {
      customModelOverride: modelResolution.modelId === 'default'
        ? undefined
        : modelResolution.modelId,
    };
  }

  const providerOverride: AIProvider = {
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

  // 保留 legacy handler 的实际策略：存在 provider override 时使用 sequential。
  return {
    providerOptions: {
      providerOverride,
      loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL,
    },
  };
};

export const createDefaultGenerateGameCardService = (): GenerateGameCardService =>
  createGenerateGameCardService<GameCardGeneration, GameCardOutput>({
    enforceSafety: async (_request, input) => enforceTextSafety({
      text: input.sourceCardJson + (input.customInstructions ?? ''),
      log,
      sensitiveWordReason: '卡牌生成输入含敏感词',
      aiPromptTemplate: 'free',
    }),
    checkRateLimit: async (request, input) => {
      const rateLimit = await acquirePublicAiRateLimit({
        req: request,
        actionType: 'free_generate',
        providerMode: inferPublicAiProviderMode(input.customProvider),
      });
      return rateLimit.allowed ? null : buildPublicAiRateLimitResponse(rateLimit);
    },
    generate: async (_request, input) => {
      const resolvedProvider = resolveProviderOptions(input);
      if (resolvedProvider.response) return respondStep(resolvedProvider.response);

      const telemetry: NonNullable<GenerateWithAIOptions['telemetry']> = {};
      const channelContext = buildChannelContextFromPayload(
        input.customProvider,
        resolvedProvider.customModelOverride,
      );
      const aiOptions: GenerateWithAIOptions = {
        channelContext,
        telemetry,
        ...(resolvedProvider.providerOptions ?? {}),
        ...(input.customProvider
          ? {
              generationSettingsContext: {
                providerId: input.customProvider.providerId,
                ...(input.customProvider.generationOverrides
                  ? { userOverrides: input.customProvider.generationOverrides }
                  : {}),
              },
            }
          : {}),
      };
      const generationInput: GameCardGenerationInput = {
        sourceCardJson: input.sourceCardJson,
        customInstructions: input.customInstructions,
      };
      const generatedFaceData = await generateWithAI(
        generationInput,
        gameCardGenerationConfig,
        aiOptions,
      );
      return completeStep({ generatedFaceData, telemetry });
    },
    applyOutputPolicy: async (_request, input, generated) => {
      if (appConfig.ENABLE_SENSITIVE_WORD_FILTER) {
        const outputCheck = await quickCheck(JSON.stringify(generated.generatedFaceData));
        if (outputCheck.hasSensitiveWords) {
          log.warn('卡牌卡面生成结果含敏感词，已拒绝返回', {
            detectedWords: outputCheck.detectedWords,
          });
          return respondStep(new Response(
            JSON.stringify({ error: '卡牌卡面生成结果不合规', shouldRedirect: true }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          ));
        }
      }

      const faceData = applyShieldWordsToGameCardFaceData(
        generated.generatedFaceData,
      ).faceData;
      let sourceCardKind: ReturnType<typeof inferCharacterKind> = 'unknown';
      try {
        sourceCardKind = inferCharacterKind(JSON.parse(input.sourceCardJson));
      } catch {
        // 保持无法解析来源卡时的 legacy unknown 语义。
      }
      return completeStep({ ...generated, faceData, sourceCardKind });
    },
    recordActivity: recordUserActivityFromRequest,
    logSuccess: (_input, output) => {
      log.info('卡牌卡面生成成功', {
        cardName: output.faceData.cardName,
        rarity: output.faceData.rarity,
        cardType: output.faceData.cardType,
        sourceCardKind: output.sourceCardKind,
      });
    },
    buildResponse: (request, _input, output) => buildJsonResponseWithOptionalAiMeta({
      requestHeaders: request.headers,
      data: {
        faceData: output.faceData,
        sourceCardKind: output.sourceCardKind,
      },
      telemetry: output.telemetry,
    }),
    logError: (error) => {
      log.error('卡牌卡面生成失败', { error: String(error) });
    },
  });

export const defaultGenerateGameCardService = createDefaultGenerateGameCardService();
