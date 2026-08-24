import { inferCharacterKind, type CharacterKind } from '@mahoshojo/domain/data-cards';
import {
  GAME_CARD_GENERATION_CONFIG,
  type GameCardFaceData,
  type GameCardGenerationInput,
} from '@mahoshojo/domain/game-card';
import {
  createGenerateGameCardService,
  type GenerateGameCardInput,
  type GenerateGameCardService,
} from '@mahoshojo/hosted-api/generate-game-card';
import { completeStep, respondStep } from '@mahoshojo/hosted-api/regular-generation';
import {
  inferCustomProviderMode,
  resolveCustomProviderRuntime,
  type CustomProviderRuntimeDependencies,
  type CustomProviderRuntimeOptions,
} from './custom-provider-runtime';

export const GAME_CARD_ACTION_TYPE = 'free_generate' as const;

export type GameCardAiTelemetry = {
  providerName?: string;
  providerType?: 'openai' | 'google' | 'deepseek';
  providerBaseUrl?: string;
  model?: string;
  providerIndex?: number;
  attempt?: number;
  usage?: unknown;
  finishReason?: unknown;
  reasoning?: unknown;
};

export type GenerateGameCardAiOptions = CustomProviderRuntimeOptions & {
  telemetry: GameCardAiTelemetry;
};

export type GameCardOutputSafetyResult = {
  hasSensitiveWords: boolean;
  detectedWords: string[];
};

export type GenerateGameCardResponseData = {
  faceData: GameCardFaceData;
  sourceCardKind: CharacterKind;
};

export interface GenerateGameCardRuntimeDependencies
  extends CustomProviderRuntimeDependencies {
  enforceSafety(_input: {
    request: Request;
    text: string;
    sensitiveWordReason: '卡牌生成输入含敏感词';
    aiPromptTemplate: 'free';
  }): Promise<Response | null>;
  checkRateLimit(_input: {
    request: Request;
    actionType: typeof GAME_CARD_ACTION_TYPE;
    providerMode: ReturnType<typeof inferCustomProviderMode>;
  }): Promise<Response | null>;
  generateWithAI(
    _input: GameCardGenerationInput,
    _config: typeof GAME_CARD_GENERATION_CONFIG,
    _options: GenerateGameCardAiOptions,
  ): Promise<GameCardFaceData>;
  isSensitiveWordFilterEnabled: boolean;
  checkOutputSafety(_serializedFaceData: string): Promise<GameCardOutputSafetyResult>;
  applyShieldWords(_faceData: GameCardFaceData): GameCardFaceData;
  recordActivity(_request: Request): void;
  buildResponse(_input: {
    requestHeaders: Headers;
    data: GenerateGameCardResponseData;
    telemetry: GameCardAiTelemetry;
  }): Response | Promise<Response>;
  logInfo(_message: '卡牌卡面生成成功', _meta: {
    cardName: string;
    rarity: GameCardFaceData['rarity'];
    cardType: GameCardFaceData['cardType'];
    sourceCardKind: CharacterKind;
  }): void;
  logWarn(_message: '卡牌卡面生成结果含敏感词，已拒绝返回', _meta: {
    detectedWords: string[];
  }): void;
  logError(_error: unknown): void;
}

export interface GenerateGameCardRuntime {
  readonly service: GenerateGameCardService;
}

type GeneratedGameCard = {
  generatedFaceData: GameCardFaceData;
  telemetry: GameCardAiTelemetry;
};

type OutputGameCard = GeneratedGameCard & GenerateGameCardResponseData;

export const createGenerateGameCardRuntime = (
  dependencies: GenerateGameCardRuntimeDependencies,
): GenerateGameCardRuntime => {
  const ports = Object.freeze({ ...dependencies });

  const service = createGenerateGameCardService<GeneratedGameCard, OutputGameCard>({
    enforceSafety: async (request, input) => ports.enforceSafety({
      request,
      text: input.sourceCardJson + (input.customInstructions ?? ''),
      sensitiveWordReason: '卡牌生成输入含敏感词',
      aiPromptTemplate: 'free',
    }),
    checkRateLimit: async (request, input) => ports.checkRateLimit({
      request,
      actionType: GAME_CARD_ACTION_TYPE,
      providerMode: inferCustomProviderMode(input.customProvider),
    }),
    generate: async (_request, input) => {
      const resolvedProvider = resolveCustomProviderRuntime(input.customProvider, ports);
      if (resolvedProvider.response) return respondStep(resolvedProvider.response);

      const telemetry: GameCardAiTelemetry = {};
      const aiOptions: GenerateGameCardAiOptions = {
        ...resolvedProvider.options,
        telemetry,
      };
      const generationInput: GameCardGenerationInput = {
        sourceCardJson: input.sourceCardJson,
        customInstructions: input.customInstructions,
      };
      const generatedFaceData = await ports.generateWithAI(
        generationInput,
        GAME_CARD_GENERATION_CONFIG,
        aiOptions,
      );
      return completeStep({ generatedFaceData, telemetry });
    },
    applyOutputPolicy: async (_request, input, generated) => {
      if (ports.isSensitiveWordFilterEnabled) {
        const outputCheck = await ports.checkOutputSafety(
          JSON.stringify(generated.generatedFaceData),
        );
        if (outputCheck.hasSensitiveWords) {
          ports.logWarn('卡牌卡面生成结果含敏感词，已拒绝返回', {
            detectedWords: outputCheck.detectedWords,
          });
          return respondStep(new Response(
            JSON.stringify({ error: '卡牌卡面生成结果不合规', shouldRedirect: true }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          ));
        }
      }

      const faceData = ports.applyShieldWords(generated.generatedFaceData);
      let sourceCardKind: CharacterKind = 'unknown';
      try {
        sourceCardKind = inferCharacterKind(JSON.parse(input.sourceCardJson));
      } catch {
        // 保持无法解析来源卡时的 legacy unknown 语义。
      }
      return completeStep({ ...generated, faceData, sourceCardKind });
    },
    recordActivity: ports.recordActivity,
    logSuccess: (_input: GenerateGameCardInput, output) => {
      ports.logInfo('卡牌卡面生成成功', {
        cardName: output.faceData.cardName,
        rarity: output.faceData.rarity,
        cardType: output.faceData.cardType,
        sourceCardKind: output.sourceCardKind,
      });
    },
    buildResponse: (request, _input, output) => ports.buildResponse({
      requestHeaders: request.headers,
      data: {
        faceData: output.faceData,
        sourceCardKind: output.sourceCardKind,
      },
      telemetry: output.telemetry,
    }),
    logError: ports.logError,
  });

  return Object.freeze({ service });
};
