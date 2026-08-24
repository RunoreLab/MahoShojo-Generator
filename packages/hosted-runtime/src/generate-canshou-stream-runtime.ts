import type { QuestionnaireAnswerItem } from '@mahoshojo/domain/questionnaire';
import {
  createGenerateCanshouStreamService,
  type GenerateCanshouService,
} from '@mahoshojo/hosted-api/generate-canshou';
import { completeStep, respondStep } from '@mahoshojo/hosted-api/regular-generation';

import { buildCanshouStreamPrompt } from './canshou-generation-runtime-shared';
import {
  inferCustomProviderMode,
  type CustomProviderRuntimeDependencies,
} from './custom-provider-runtime';
import { CANSHOU_GENERATION_ACTION_TYPE } from './generate-canshou-runtime';
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
  resolveLegacyQuestionnaireProviderRuntime,
  type LegacyProviderRuntimeLogger,
} from './questionnaire-composition-runtime-shared';

export interface GenerateCanshouStreamRuntimeDependencies
  extends CustomProviderRuntimeDependencies,
  LegacyProviderRuntimeLogger {
  canshouLore: string;
  checkRateLimit(_input: {
    request: Request;
    actionType: typeof CANSHOU_GENERATION_ACTION_TYPE;
    providerMode: ReturnType<typeof inferCustomProviderMode>;
  }): Promise<Response | null>;
  enforceSafety(_input: {
    request: Request;
    text: string;
    logMeta: Record<string, unknown>;
    enableAiSafetyCheck: false;
    sensitiveWordReason: '在残兽问卷中使用了危险符文';
  }): Promise<Response | null>;
  shouldUseReasoningSse(_request: Request): boolean;
  createReasoningSseBridge(_label: '残兽档案（流式）'): ReasoningSseBridge;
  generateWithStreamAI(
    _config: RawGenerationConfig,
    _options: StreamAiOptions,
  ): Promise<StreamGenerationResult>;
  recordActivity(_request: Request): void;
  logError(_error: unknown): void;
}

export interface GenerateCanshouStreamRuntime {
  readonly service: GenerateCanshouService;
}

type CanshouStreamInput = {
  normalizedAnswers: QuestionnaireAnswerItem[];
  questionnaires: RequestQuestionnaire[];
  language: string;
  customProviderPayload: unknown;
};

type CanshouStreamGeneration = {
  streamResult: StreamGenerationResult;
  reasoningBridge: ReasoningSseBridge | null;
  aiTelemetry: GenerationAiTelemetry;
  customModelOverride?: string;
};

export const createGenerateCanshouStreamRuntime = (
  dependencies: GenerateCanshouStreamRuntimeDependencies,
): GenerateCanshouStreamRuntime => {
  const ports = Object.freeze({ ...dependencies });
  const service = createGenerateCanshouStreamService<
    CanshouStreamInput,
    Exclude<ReturnType<typeof resolveLegacyQuestionnaireProviderRuntime>, { response: Response }>,
    CanshouStreamGeneration
  >({
    prepare: async (_request, body) => {
      const parsedBody = body && typeof body === 'object'
        ? body as Record<string, unknown>
        : {};
      const questionnaires = normalizeQuestionnaires(parsedBody.questionnaires);
      const normalizedAnswers = resolveAnswerItems(parsedBody.answers, questionnaires, {
        lookupMode: 'legacy-first-match',
      });
      if (normalizedAnswers.length === 0) {
        return respondStep(new Response(JSON.stringify({ error: 'Answers array is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      return completeStep({
        normalizedAnswers,
        questionnaires,
        language: typeof parsedBody.language === 'string' ? parsedBody.language : 'zh-CN',
        customProviderPayload: parsedBody.customProvider,
      });
    },
    checkRateLimit: (request, input) => ports.checkRateLimit({
      request,
      actionType: CANSHOU_GENERATION_ACTION_TYPE,
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
          sensitiveWordReason: '在残兽问卷中使用了危险符文',
        });
        if (response) return response;
      }
      return null;
    },
    resolveExecution: async (_request, input) => {
      const resolved = resolveLegacyQuestionnaireProviderRuntime(
        input.customProviderPayload,
        ports,
      );
      return resolved.response ? respondStep(resolved.response) : completeStep(resolved);
    },
    generate: async (request, input, execution) => {
      const reasoningBridge = ports.shouldUseReasoningSse(request)
        ? ports.createReasoningSseBridge('残兽档案（流式）')
        : null;
      const aiTelemetry: GenerationAiTelemetry = {};
      const streamResult = await ports.generateWithStreamAI(
        {
          prompt: buildCanshouStreamPrompt({
            answers: input.normalizedAnswers,
            questionnairesLore: buildQuestionnaireLoreText(input.questionnaires),
            canshouLore: ports.canshouLore,
            language: input.language,
          }),
          temperature: 0.8,
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
