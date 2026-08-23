// Creator 流式 Hosted 生成 service composition。

import { z } from 'zod/v3';
import {
  createGenerateCreatorStreamService,
  type GenerateCreatorService,
} from '@mahoshojo/hosted-api/generate-creator';
import {
  completeStep,
  respondStep,
} from '@mahoshojo/hosted-api/regular-generation';
import { UserGenerationOverridesSchema } from '@/lib/ai/generation-settings/schemas';

import { getLogger } from '@/lib/logger';
import {
  formatQuestionnaireAnswers,
  type QuestionnaireAnswerItem,
} from '@/lib/questionnaires';
import {
  buildQuestionnaireLoreText,
  normalizeQuestionnaires,
  resolveAnswerItems,
  type RequestQuestionnaire,
} from '@/lib/hosted-api/questionnaire-generation-runtime';
import { type AIProvider } from '@/lib/config';
import { enforceTextSafety } from '@/lib/content-safety/server';
import { AI_PROVIDER_CATALOG, resolveAIProviderModel } from '@/lib/ai/constants';
import { acquirePublicAiRateLimit, buildPublicAiRateLimitResponse, inferPublicAiProviderMode } from '@/lib/ai/public-rate-limit';
import { generateWithStreamAI, LoadBalanceStrategy, type GenerateWithAIOptions } from '@/lib/stream/raw-ai';
import { buildChannelContextFromPayload } from '@/lib/ai/availability';
import { createReasoningSseBridge, shouldUseClientSse } from '@/lib/stream/reasoning-sse';
import { recordUserActivityFromRequest } from '@/lib/user-activity/record';
import { resolveBuildRuleRuntimeResultsFromRequest } from '@/lib/creator/build-rule-request';
import { buildCreatorPromptInput, validateCreatorRequest } from '@/lib/creator/server';
import {
  CREATOR_TEMPLATE_IDS,
  isCreatorTemplateSupportedInGenerationMode,
  type CreatorTemplateId,
} from '@/lib/creator/templates';
import { buildCreatorStreamPrompt } from '@/lib/creator/stream-prompt';
import type { CreatorPromptInput, CreatorRequestInput } from '@/lib/creator/types';

const log = getLogger('api-gen-details-stream');

const CustomProviderSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  apiKey: z.string(),
  maxOutputTokens: z.number().int().min(1).max(1_000_000).optional(),
  generationOverrides: UserGenerationOverridesSchema.optional(),
});

const normalizeCreatorTemplate = (raw: unknown): CreatorTemplateId => {
  const candidate = typeof raw === 'string' ? raw.trim() : '';
  return CREATOR_TEMPLATE_IDS.includes(candidate as CreatorTemplateId)
    ? (candidate as CreatorTemplateId)
    : 'general';
};

const buildCreatorPromptText = (creatorPromptInput: CreatorPromptInput): string => {
  const sections: string[] = [];
  if (creatorPromptInput.userIntent) {
    sections.push(`【创作补充要求】\n${creatorPromptInput.userIntent}`);
  }
  if (creatorPromptInput.buildRuleProjection.primary) {
    sections.push(`【主规则事实】\n${creatorPromptInput.buildRuleProjection.primary.summary}`);
  }
  if (creatorPromptInput.buildRuleProjection.references.length > 0) {
    sections.push(
      `【补充规则事实】\n${creatorPromptInput.buildRuleProjection.references
        .map((reference) => reference.summary)
        .join('\n\n')}`
    );
  }
  return sections.join('\n\n');
};

type CreatorStreamInput = {
  normalizedAnswers: QuestionnaireAnswerItem[];
  questionnaires: RequestQuestionnaire[];
  language: string;
  customProviderPayload: unknown;
  template: CreatorTemplateId;
  creatorPromptInput: CreatorPromptInput;
  wantsClientSse: boolean;
};

type CreatorStreamExecution = {
  customProviderOverride: AIProvider | null;
  customProviderId: string | null;
  customModelOverride?: string;
  parsedCustomProvider: z.infer<typeof CustomProviderSchema> | null;
};

type CreatorStreamGeneration = {
  streamResult: Awaited<ReturnType<typeof generateWithStreamAI>>;
  reasoningBridge: ReturnType<typeof createReasoningSseBridge> | null;
  aiTelemetry: NonNullable<GenerateWithAIOptions['telemetry']>;
  customModelOverride?: string;
};

export const createDefaultGenerateCreatorStreamService = (): GenerateCreatorService =>
  createGenerateCreatorStreamService<CreatorStreamInput, CreatorStreamExecution, CreatorStreamGeneration>({
    prepare: async (request, body) => {
      const parsedBody = body && typeof body === 'object'
        ? body as Record<string, unknown>
        : {};
      const questionnaires = normalizeQuestionnaires(parsedBody.questionnaires);
      const normalizedAnswers = resolveAnswerItems(parsedBody.answers, questionnaires);
      const template = normalizeCreatorTemplate(parsedBody.template);
      let creatorPromptInput: CreatorPromptInput;
      try {
        const buildRules = resolveBuildRuleRuntimeResultsFromRequest(parsedBody.buildRules);
        const primaryRuleId = typeof parsedBody.primaryRuleId === 'string'
          && parsedBody.primaryRuleId.trim()
          ? parsedBody.primaryRuleId.trim()
          : null;
        const creatorRequestInput: CreatorRequestInput = {
          template,
          freeformBrief: typeof parsedBody.freeformBrief === 'string'
            ? parsedBody.freeformBrief
            : null,
          questionnaires: questionnaires.map((questionnaire) => ({
            questionnaireId: questionnaire.id,
            title: questionnaire.title,
          })),
          questionnaireAnswers: normalizedAnswers,
          buildRules,
          primaryRuleId,
        };
        if (!isCreatorTemplateSupportedInGenerationMode('stream', template)) {
          throw new Error('CREATOR_TEMPLATE_MODE_UNSUPPORTED');
        }
        validateCreatorRequest(creatorRequestInput);
        creatorPromptInput = buildCreatorPromptInput(creatorRequestInput);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'CREATOR_REQUEST_INVALID';
        return respondStep(new Response(JSON.stringify({ error: '创作请求无效', message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      return completeStep({
        normalizedAnswers,
        questionnaires,
        language: parsedBody.language === undefined ? 'zh-CN' : parsedBody.language as string,
        customProviderPayload: parsedBody.customProvider,
        template,
        creatorPromptInput,
        wantsClientSse: shouldUseClientSse(request),
      });
    },
    checkRateLimit: async (request, input) => {
      const rateLimit = await acquirePublicAiRateLimit({
        req: request,
        actionType: 'magical_girl_details_generate',
        providerMode: inferPublicAiProviderMode(input.customProviderPayload),
      });
      return rateLimit.allowed ? null : buildPublicAiRateLimitResponse(rateLimit);
    },
    enforceSafety: async (_request, input) => {
      for (const answerItem of input.normalizedAnswers) {
        const safetyResponse = await enforceTextSafety({
          text: answerItem.answer,
          log,
          logMeta: {
            questionId: answerItem.questionId,
            questionnaireId: answerItem.questionnaireId,
          },
          enableAiSafetyCheck: false,
          sensitiveWordReason: '在问卷中使用了危险符文',
        });
        if (safetyResponse) return safetyResponse;
      }
      if (input.creatorPromptInput.userIntent) {
        return enforceTextSafety({
          text: input.creatorPromptInput.userIntent,
          log,
          logMeta: { source: 'freeformBrief', template: input.template },
          enableAiSafetyCheck: false,
          sensitiveWordReason: '在自由补充说明中使用了危险符文',
        });
      }
      return null;
    },
    resolveExecution: async (_request, input) => {
      const customProviderPayload = input.customProviderPayload;
      let customProviderOverride: AIProvider | null = null;
      let customProviderId: string | null = null;
      let customModelOverride: string | undefined;
      let parsedCustomProvider: z.infer<typeof CustomProviderSchema> | null = null;
      if (customProviderPayload) {
        const parsedResult = CustomProviderSchema.safeParse(customProviderPayload);
        if (!parsedResult.success) {
          const providerId = typeof customProviderPayload === 'object'
            && customProviderPayload !== null
            && 'providerId' in customProviderPayload
            ? customProviderPayload.providerId
            : undefined;
          log.warn('自定义 AI 供应商配置校验失败', {
            providerId,
            issues: parsedResult.error.issues,
          });
          return respondStep(new Response(
            JSON.stringify({ error: '自定义 AI 供应商配置无效' }),
            { status: 400 },
          ));
        }
        parsedCustomProvider = parsedResult.data;
        customProviderId = parsedCustomProvider.providerId;
        const providerConfig = AI_PROVIDER_CATALOG.find(
          (item) => item.id === parsedCustomProvider!.providerId,
        );
        if (!providerConfig) {
          return respondStep(new Response(
            JSON.stringify({ error: '未知的模型供应商 ID' }),
            { status: 400 },
          ));
        }
        const modelResolution = resolveAIProviderModel(
          providerConfig,
          parsedCustomProvider.modelId,
        );
        if (!modelResolution) {
          return respondStep(new Response(
            JSON.stringify({ error: '未知的模型 ID' }),
            { status: 400 },
          ));
        }
        const sanitizedApiKey = parsedCustomProvider.apiKey.trim();
        if (!sanitizedApiKey && providerConfig.id !== 'system') {
          return respondStep(new Response(
            JSON.stringify({ error: 'API Key 不能为空' }),
            { status: 400 },
          ));
        }
        const sanitizedBaseUrl = providerConfig.baseUrl?.trim() ?? '';
        if (!sanitizedBaseUrl) {
          customModelOverride = modelResolution.modelId === 'default'
            ? undefined
            : modelResolution.modelId;
          log.info('检测到 baseUrl 为空的自定义供应商，改用系统默认通道，仅覆盖模型参数', {
            providerId: providerConfig.id,
            model: modelResolution.modelId,
          });
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
            ...(typeof parsedCustomProvider.maxOutputTokens === 'number'
              ? { defaultMaxOutputTokens: parsedCustomProvider.maxOutputTokens }
              : {}),
            providerId: parsedCustomProvider.providerId,
            ...(parsedCustomProvider.generationOverrides
              ? { generationOverrides: parsedCustomProvider.generationOverrides }
              : {}),
          };
        }
      }
      return completeStep({
        customProviderOverride,
        customProviderId,
        customModelOverride,
        parsedCustomProvider,
      });
    },
    generate: async (request, input, execution) => {
      const prompt = buildCreatorStreamPrompt({
        template: input.template === 'general-scenario' ? 'general-scenario' : 'general',
        language: input.language,
        creatorPromptText: buildCreatorPromptText(input.creatorPromptInput),
        questionnaireAnswerText: formatQuestionnaireAnswers(input.normalizedAnswers),
        loreText: buildQuestionnaireLoreText(input.questionnaires),
      });
      const shouldDisablePolling = execution.customProviderId !== null
        && execution.customProviderId !== 'system';
      const providerOptions: GenerateWithAIOptions | undefined = (
        execution.customProviderOverride || shouldDisablePolling
      )
        ? {
            ...(execution.customProviderOverride
              ? { providerOverride: execution.customProviderOverride }
              : {}),
            ...(shouldDisablePolling
              ? { loadBalanceStrategy: LoadBalanceStrategy.CUSTOM }
              : { loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL }),
          }
        : undefined;
      const reasoningBridge = input.wantsClientSse
        ? createReasoningSseBridge('魔法少女档案（流式）')
        : null;
      const aiTelemetry: NonNullable<GenerateWithAIOptions['telemetry']> = {};
      const channelContext = buildChannelContextFromPayload(
        input.customProviderPayload,
        execution.customModelOverride,
      );
      const streamResult = await generateWithStreamAI(
        {
          prompt,
          temperature: 0.75,
          ...(execution.customModelOverride
            ? { modelOverride: execution.customModelOverride }
            : {}),
          ...(execution.parsedCustomProvider
            ? {
                generationSettingsContext: {
                  providerId: execution.parsedCustomProvider.providerId,
                  ...(execution.parsedCustomProvider.generationOverrides
                    ? { userOverrides: execution.parsedCustomProvider.generationOverrides }
                    : {}),
                },
              }
            : {}),
        },
        {
          ...(providerOptions ?? {}),
          abortSignal: request.signal,
          telemetry: aiTelemetry,
          channelContext,
          ...(reasoningBridge ? { onReasoningEvent: reasoningBridge.onReasoningEvent } : {}),
        },
      );
      return completeStep({
        streamResult,
        reasoningBridge,
        aiTelemetry,
        customModelOverride: execution.customModelOverride,
      });
    },
    recordActivity: recordUserActivityFromRequest,
    buildResponse: (_request, _input, output) => {
      if (output.reasoningBridge) {
        return output.reasoningBridge.toResponse(output.streamResult.response, {
          usagePromise: output.streamResult.usagePromise,
          aiModel: output.aiTelemetry.model ?? output.customModelOverride ?? null,
        });
      }
      return output.streamResult.response;
    },
    logError: (error) => log.error('流式生成创作结果失败', { error }),
  });

export const defaultGenerateCreatorStreamService = createDefaultGenerateCreatorStreamService();
export default defaultGenerateCreatorStreamService;
