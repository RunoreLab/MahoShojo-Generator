import type { QuestionnaireAnswerItem } from '@mahoshojo/domain/questionnaire';
import {
  createGenerateMagicalGirlDetailsStreamService,
  type GenerateMagicalGirlDetailsService,
} from '@mahoshojo/hosted-api/generate-magical-girl-details';
import { completeStep, respondStep } from '@mahoshojo/hosted-api/regular-generation';

import {
  inferCustomProviderMode,
  type CustomProviderRuntimeDependencies,
} from './custom-provider-runtime';
import { MAGICAL_GIRL_DETAILS_ACTION_TYPE } from './generate-magical-girl-details-runtime';
import {
  type GenerationAiTelemetry,
  type RawGenerationConfig,
  type ReasoningSseBridge,
  type StreamAiOptions,
  type StreamGenerationResult,
} from './generation-runtime-shared';
import { buildMagicalGirlDetailsStreamPrompt } from './magical-girl-details-runtime-shared';
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

export interface GenerateMagicalGirlDetailsStreamRuntimeDependencies
  extends CustomProviderRuntimeDependencies,
  LegacyProviderRuntimeLogger {
  getRandomFlowers(): string;
  checkRateLimit(_input: {
    request: Request;
    actionType: typeof MAGICAL_GIRL_DETAILS_ACTION_TYPE;
    providerMode: ReturnType<typeof inferCustomProviderMode>;
  }): Promise<Response | null>;
  enforceSafety(_input: {
    request: Request;
    text: string;
    logMeta: Record<string, unknown>;
    enableAiSafetyCheck: false;
    sensitiveWordReason: '在问卷中使用了危险符文';
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

type StreamInput = {
  answers: QuestionnaireAnswerItem[];
  questionnaires: RequestQuestionnaire[];
  language: string;
  customProviderPayload: unknown;
};

type StreamOutput = {
  result: StreamGenerationResult;
  bridge: ReasoningSseBridge | null;
  telemetry: GenerationAiTelemetry;
  customModelOverride?: string;
};

export const createGenerateMagicalGirlDetailsStreamRuntime = (
  dependencies: GenerateMagicalGirlDetailsStreamRuntimeDependencies,
): Readonly<{ service: GenerateMagicalGirlDetailsService }> => {
  const ports = Object.freeze({ ...dependencies });
  const service = createGenerateMagicalGirlDetailsStreamService<
    StreamInput,
    Exclude<ReturnType<typeof resolveLegacyQuestionnaireProviderRuntime>, { response: Response }>,
    StreamOutput
  >({
    prepare: async (_request, body) => {
      const parsedBody = body && typeof body === 'object'
        ? body as Record<string, unknown>
        : {};
      const questionnaires = normalizeQuestionnaires(parsedBody.questionnaires);
      const answers = resolveAnswerItems(parsedBody.answers, questionnaires, {
        lookupMode: 'legacy-first-match',
      });
      if (answers.length === 0) {
        return respondStep(new Response(JSON.stringify({ error: 'Answers array is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      return completeStep({
        answers,
        questionnaires,
        language: typeof parsedBody.language === 'string' ? parsedBody.language : 'zh-CN',
        customProviderPayload: parsedBody.customProvider,
      });
    },
    checkRateLimit: (request, input) => ports.checkRateLimit({
      request,
      actionType: MAGICAL_GIRL_DETAILS_ACTION_TYPE,
      providerMode: inferCustomProviderMode(input.customProviderPayload),
    }),
    enforceSafety: async (request, input) => {
      for (const answer of input.answers) {
        const response = await ports.enforceSafety({
          request,
          text: answer.answer,
          logMeta: {
            questionId: answer.questionId,
            questionnaireId: answer.questionnaireId,
          },
          enableAiSafetyCheck: false,
          sensitiveWordReason: '在问卷中使用了危险符文',
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
      const bridge = ports.shouldUseReasoningSse(request)
        ? ports.createReasoningSseBridge('魔法少女档案（流式）')
        : null;
      const telemetry: GenerationAiTelemetry = {};
      const result = await ports.generateWithStreamAI({
        prompt: buildMagicalGirlDetailsStreamPrompt({
          answers: input.answers,
          questionnaireLore: buildQuestionnaireLoreText(input.questionnaires),
          language: input.language,
          flowers: ports.getRandomFlowers(),
        }),
        temperature: 0.75,
        ...(execution.modelOverride ? { modelOverride: execution.modelOverride } : {}),
        ...(execution.options.generationSettingsContext
          ? { generationSettingsContext: execution.options.generationSettingsContext }
          : {}),
      }, {
        ...execution.options,
        abortSignal: request.signal,
        telemetry,
        ...(bridge ? { onReasoningEvent: bridge.onReasoningEvent } : {}),
      });
      return completeStep({
        result,
        bridge,
        telemetry,
        ...(execution.modelOverride ? { customModelOverride: execution.modelOverride } : {}),
      });
    },
    recordActivity: ports.recordActivity,
    buildResponse: (_request, _input, output) => output.bridge
      ? output.bridge.toResponse(output.result.response, {
        usagePromise: output.result.usagePromise,
        aiModel: output.telemetry.model ?? output.customModelOverride ?? null,
      })
      : output.result.response,
    logError: ports.logError,
  });
  return Object.freeze({ service });
};
