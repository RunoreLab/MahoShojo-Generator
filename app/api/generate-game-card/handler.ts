import { z } from 'zod/v3';
import { generateWithAI, LoadBalanceStrategy, type GenerateWithAIOptions } from '@/lib/ai';
import { buildChannelContextFromPayload } from '@/lib/ai/availability';
import { AI_PROVIDER_CATALOG, resolveAIProviderModel } from '@/lib/ai/constants';
import { acquirePublicAiRateLimit, buildPublicAiRateLimitResponse, inferPublicAiProviderMode } from '@/lib/ai/public-rate-limit';
import { buildJsonResponseWithOptionalAiMeta } from '@/lib/ai/meta-response';
import { type AIProvider } from '@/lib/config';
import { enforceTextSafety } from '@/lib/content-safety/server';
import { getLogger } from '@/lib/logger';
import { recordUserActivityFromRequest } from '@/lib/user-activity/record';
import { gameCardGenerationConfig, type GameCardGenerationInput } from '@/lib/game-card/config';
import { inferCharacterKind } from '@/lib/schemas';

const log = getLogger('api-gen-game-card');

const MAX_SOURCE_CARD_CHARS = 50_000;
const MAX_INSTRUCTIONS_CHARS = 2_000;

const CustomProviderSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  apiKey: z.string(),
  maxOutputTokens: z.number().int().min(1).max(1_000_000).optional(),
});

const RequestBodySchema = z.object({
  sourceCardJson: z.string().min(1).max(MAX_SOURCE_CARD_CHARS),
  customInstructions: z.string().max(MAX_INSTRUCTIONS_CHARS).optional(),
  customProvider: CustomProviderSchema.optional(),
});

function formatZodIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '输入';
      return `${path}：${issue.message}`;
    })
    .join('；');
}

async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } },
    );
  }

  try {
    const payloadRaw = await req.json().catch(() => null);
    const parsed = RequestBodySchema.safeParse(payloadRaw);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({
          error: '请求参数无效',
          message: formatZodIssues(parsed.error.issues),
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const { sourceCardJson, customInstructions, customProvider: customProviderPayload } = parsed.data;

    const safetyResponse = await enforceTextSafety({
      text: sourceCardJson + (customInstructions ?? ''),
      log,
      sensitiveWordReason: '卡牌生成输入含敏感词',
      aiPromptTemplate: 'free',
    });
    if (safetyResponse) return safetyResponse;

    const rateLimit = await acquirePublicAiRateLimit({
      req,
      actionType: 'free_generate',
      providerMode: inferPublicAiProviderMode(customProviderPayload),
    });
    if (!rateLimit.allowed) {
      return buildPublicAiRateLimitResponse(rateLimit);
    }

    let customProviderOverride: AIProvider | null = null;
    const customProviderId: string | null = null;
    let customModelOverride: string | undefined;

    if (customProviderPayload) {
      const providerConfig = AI_PROVIDER_CATALOG.find((item) => item.id === customProviderPayload.providerId);
      if (!providerConfig) {
        return new Response(JSON.stringify({ error: '未知的模型供应商 ID' }), { status: 400 });
      }
      const modelResolution = resolveAIProviderModel(providerConfig, customProviderPayload.modelId);
      if (!modelResolution) {
        return new Response(JSON.stringify({ error: '未知的模型 ID' }), { status: 400 });
      }
      const sanitizedApiKey = customProviderPayload.apiKey.trim();
      if (!sanitizedApiKey && providerConfig.id !== 'system') {
        return new Response(JSON.stringify({ error: 'API Key 不能为空' }), { status: 400 });
      }
      const sanitizedBaseUrl = providerConfig.baseUrl?.trim() ?? '';
      if (!sanitizedBaseUrl) {
        customModelOverride = modelResolution.modelId;
      } else {
        customProviderOverride = {
          name: providerConfig.name,
          apiKey: sanitizedApiKey,
          baseUrl: sanitizedBaseUrl,
          model: modelResolution.modelId,
          type: providerConfig.type,
          mode: providerConfig.mode || 'auto',
          retryCount: 1,
          skipProbability: 0,
          ...(typeof customProviderPayload.maxOutputTokens === 'number' ? { defaultMaxOutputTokens: customProviderPayload.maxOutputTokens } : {}),
        };
      }
    }

    const input: GameCardGenerationInput = {
      sourceCardJson,
      customInstructions,
    };

    const shouldDisablePolling = customProviderId !== null && customProviderId !== 'system';
    const providerOptions = (customProviderOverride || shouldDisablePolling)
      ? {
          ...(customProviderOverride ? { providerOverride: customProviderOverride } : {}),
          ...(shouldDisablePolling
            ? { loadBalanceStrategy: LoadBalanceStrategy.CUSTOM }
            : { loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL }),
        }
      : undefined;

    const telemetry: NonNullable<GenerateWithAIOptions['telemetry']> = {};
    const channelContext = buildChannelContextFromPayload(customProviderPayload, customModelOverride);
    const aiOptions: GenerateWithAIOptions = {
      channelContext,
      telemetry,
      ...(providerOptions ?? {}),
    };

    const faceData = await generateWithAI(input, gameCardGenerationConfig, aiOptions);
    recordUserActivityFromRequest(req);

    const sourceCardKind = (() => {
      try {
        const parsed = JSON.parse(sourceCardJson);
        return inferCharacterKind(parsed);
      } catch {
        return 'unknown';
      }
    })();

    log.info('卡牌卡面生成成功', {
      cardName: faceData.cardName,
      rarity: faceData.rarity,
      cardType: faceData.cardType,
      sourceCardKind,
    });

    return buildJsonResponseWithOptionalAiMeta({
      requestHeaders: req.headers,
      data: {
        faceData,
        sourceCardKind,
      },
      telemetry,
    });
  } catch (error) {
    log.error('卡牌卡面生成失败', { error: String(error) });
    return new Response(
      JSON.stringify({ error: '卡牌卡面生成失败', message: String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

export { handler };
