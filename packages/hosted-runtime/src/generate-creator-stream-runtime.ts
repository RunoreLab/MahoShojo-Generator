import type { QuestionnaireAnswerItem } from '@mahoshojo/domain/questionnaire';
import {
  createGenerateCreatorStreamService,
  type GenerateCreatorService,
} from '@mahoshojo/hosted-api/generate-creator';
import { completeStep, respondStep } from '@mahoshojo/hosted-api/regular-generation';

import {
  buildCreatorPromptText,
  buildCreatorStreamPrompt,
  isCreatorTemplateSupported,
  normalizeCreatorTemplate,
  type CreatorDomainRuntimeDependencies,
  type CreatorPromptInput,
  type CreatorRequestInput,
  type CreatorTemplateId,
} from './creator-runtime-shared';
import {
  inferCustomProviderMode,
  type CustomProviderRuntimeDependencies,
} from './custom-provider-runtime';
import {
  buildCreatorPreparationErrorResponse,
  CREATOR_MAGICAL_GIRL_ACTION_TYPE,
} from './generate-creator-runtime';
import {
  type GenerationAiTelemetry,
  type RawGenerationConfig,
  type ReasoningSseBridge,
  type StreamAiOptions,
  type StreamGenerationResult,
} from './generation-runtime-shared';
import {
  buildQuestionnaireLoreText,
  normalizeQuestionnaires,
  resolveAnswerItems,
  type RequestQuestionnaire,
} from './questionnaire-generation-runtime';
import {
  formatQuestionnaireAnswers,
  resolveLegacyQuestionnaireProviderRuntime,
  type LegacyProviderRuntimeLogger,
} from './questionnaire-composition-runtime-shared';

export interface GenerateCreatorStreamRuntimeDependencies
  extends CustomProviderRuntimeDependencies,
  CreatorDomainRuntimeDependencies,
  LegacyProviderRuntimeLogger {
  checkRateLimit(_input: {
    request: Request;
    actionType: typeof CREATOR_MAGICAL_GIRL_ACTION_TYPE;
    providerMode: ReturnType<typeof inferCustomProviderMode>;
  }): Promise<Response | null>;
  enforceSafety(_input: {
    request: Request;
    text: string;
    logMeta: Record<string, unknown>;
    enableAiSafetyCheck: false;
    sensitiveWordReason: '在问卷中使用了危险符文' | '在自由补充说明中使用了危险符文';
  }): Promise<Response | null>;
  shouldUseReasoningSse(_request: Request): boolean;
  createReasoningSseBridge(_label: '魔法少女档案（流式）'): ReasoningSseBridge;
  generateWithStreamAI(
    _config: RawGenerationConfig,
    _options: StreamAiOptions,
  ): Promise<StreamGenerationResult>;
  recordActivity(_request: Request): void;
  logError(_error: unknown): void;
}

export interface GenerateCreatorStreamRuntime {
  readonly service: GenerateCreatorService;
}

type CreatorStreamInput = {
  normalizedAnswers: QuestionnaireAnswerItem[];
  questionnaires: RequestQuestionnaire[];
  language: string;
  customProviderPayload: unknown;
  template: CreatorTemplateId;
  creatorPromptInput: CreatorPromptInput;
};

type CreatorStreamGeneration = {
  streamResult: StreamGenerationResult;
  reasoningBridge: ReasoningSseBridge | null;
  aiTelemetry: GenerationAiTelemetry;
  customModelOverride?: string;
};

export const createGenerateCreatorStreamRuntime = (
  dependencies: GenerateCreatorStreamRuntimeDependencies,
): GenerateCreatorStreamRuntime => {
  const ports = Object.freeze({ ...dependencies });
  const service = createGenerateCreatorStreamService<
    CreatorStreamInput,
    Exclude<ReturnType<typeof resolveLegacyQuestionnaireProviderRuntime>, { response: Response }>,
    CreatorStreamGeneration
  >({
    prepare: async (_request, body) => {
      const parsedBody = body && typeof body === 'object'
        ? body as Record<string, unknown>
        : {};
      const questionnaires = normalizeQuestionnaires(parsedBody.questionnaires);
      const normalizedAnswers = resolveAnswerItems(parsedBody.answers, questionnaires);
      const template = normalizeCreatorTemplate(parsedBody.template, 'stream');
      const customProviderPayload = parsedBody.customProvider;
      const providerSecret = customProviderPayload
        && typeof customProviderPayload === 'object'
        && !Array.isArray(customProviderPayload)
        && typeof (customProviderPayload as Record<string, unknown>).apiKey === 'string'
        ? (customProviderPayload as Record<string, string>).apiKey
        : '';
      const sensitiveTexts = [
        typeof parsedBody.freeformBrief === 'string' ? parsedBody.freeformBrief : '',
        ...normalizedAnswers.flatMap((answer) => [answer.question ?? '', answer.answer]),
      ];
      let creatorRequestInput: CreatorRequestInput;
      try {
        const buildRules = ports.resolveBuildRules(parsedBody.buildRules);
        const primaryRuleId = typeof parsedBody.primaryRuleId === 'string'
          && parsedBody.primaryRuleId.trim()
          ? parsedBody.primaryRuleId.trim()
          : null;
        creatorRequestInput = {
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
        if (!isCreatorTemplateSupported('stream', template)) {
          throw new Error('CREATOR_TEMPLATE_MODE_UNSUPPORTED');
        }
        ports.validateCreatorRequest(creatorRequestInput);
      } catch (error) {
        return respondStep(buildCreatorPreparationErrorResponse(error, {
          allowValidationMessage: true,
          providerSecret,
          sensitiveTexts,
        }));
      }
      let creatorPromptInput: CreatorPromptInput;
      try {
        creatorPromptInput = ports.buildCreatorPromptInput(creatorRequestInput);
      } catch (error) {
        return respondStep(buildCreatorPreparationErrorResponse(error, {
          allowValidationMessage: false,
          providerSecret,
          sensitiveTexts,
        }));
      }
      return completeStep({
        normalizedAnswers,
        questionnaires,
        language: parsedBody.language === undefined
          ? 'zh-CN'
          : parsedBody.language as string,
        customProviderPayload,
        template,
        creatorPromptInput,
      });
    },
    checkRateLimit: (request, input) => ports.checkRateLimit({
      request,
      actionType: CREATOR_MAGICAL_GIRL_ACTION_TYPE,
      providerMode: inferCustomProviderMode(input.customProviderPayload),
    }),
    enforceSafety: async (request, input) => {
      for (const answerItem of input.normalizedAnswers) {
        const response = await ports.enforceSafety({
          request,
          text: answerItem.answer,
          logMeta: {
            questionId: answerItem.questionId,
            questionnaireId: answerItem.questionnaireId,
          },
          enableAiSafetyCheck: false,
          sensitiveWordReason: '在问卷中使用了危险符文',
        });
        if (response) return response;
      }
      return input.creatorPromptInput.userIntent
        ? ports.enforceSafety({
          request,
          text: input.creatorPromptInput.userIntent,
          logMeta: { source: 'freeformBrief', template: input.template },
          enableAiSafetyCheck: false,
          sensitiveWordReason: '在自由补充说明中使用了危险符文',
        })
        : null;
    },
    resolveExecution: async (_request, input) => {
      const resolved = resolveLegacyQuestionnaireProviderRuntime(
        input.customProviderPayload,
        ports,
      );
      return resolved.response ? respondStep(resolved.response) : completeStep(resolved);
    },
    generate: async (request, input, execution) => {
      const prompt = buildCreatorStreamPrompt({
        template: input.template === 'general-scenario' ? 'general-scenario' : 'general',
        language: input.language,
        creatorPromptText: buildCreatorPromptText(input.creatorPromptInput),
        questionnaireAnswerText: formatQuestionnaireAnswers(input.normalizedAnswers),
        loreText: buildQuestionnaireLoreText(input.questionnaires),
      });
      const reasoningBridge = ports.shouldUseReasoningSse(request)
        ? ports.createReasoningSseBridge('魔法少女档案（流式）')
        : null;
      const aiTelemetry: GenerationAiTelemetry = {};
      const streamResult = await ports.generateWithStreamAI(
        {
          prompt,
          temperature: 0.75,
          ...(execution.modelOverride
            ? { modelOverride: execution.modelOverride }
            : {}),
          ...(execution.options.generationSettingsContext
            ? { generationSettingsContext: execution.options.generationSettingsContext }
            : {}),
        },
        {
          ...execution.options,
          abortSignal: request.signal,
          telemetry: aiTelemetry,
          ...(reasoningBridge
            ? { onReasoningEvent: reasoningBridge.onReasoningEvent }
            : {}),
        },
      );
      return completeStep({
        streamResult,
        reasoningBridge,
        aiTelemetry,
        ...(execution.modelOverride
          ? { customModelOverride: execution.modelOverride }
          : {}),
      });
    },
    recordActivity: ports.recordActivity,
    buildResponse: (_request, _input, output) => output.reasoningBridge
      ? output.reasoningBridge.toResponse(output.streamResult.response, {
        usagePromise: output.streamResult.usagePromise,
        aiModel: output.aiTelemetry.model ?? output.customModelOverride ?? null,
      })
      : output.streamResult.response,
    logError: ports.logError,
  });

  return Object.freeze({ service });
};
