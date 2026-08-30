import type { QuestionnaireAnswerItem } from '@mahoshojo/domain/questionnaire';
import {
  createGenerateMagicalGirlDetailsService,
  type GenerateMagicalGirlDetailsService,
} from '@mahoshojo/hosted-api/generate-magical-girl-details';
import { completeStep, respondStep } from '@mahoshojo/hosted-api/regular-generation';

import {
  inferCustomProviderMode,
  type CustomProviderRuntimeDependencies,
  type CustomProviderRuntimeOptions,
} from './custom-provider-runtime';
import {
  type GenerationAiTelemetry,
  type StructuredGenerationConfig,
} from './generation-runtime-shared';
import {
  createMagicalGirlDetailsGenerationConfig,
  type MagicalGirlDetailsGeneratedData,
  type MagicalGirlDetailsGenerationInput,
} from './magical-girl-details-runtime-shared';
import {
  buildQuestionnaireLoreText,
  extractAnswerQuestionnaireIds,
  findOverLimitAnswer,
  normalizePresetEntries,
  normalizeQuestionnaireSelections,
  normalizeQuestionnaires,
  resolveAnswerItems,
  resolveNativeQuestionnaires,
  type QuestionnaireDataCard,
  type RequestQuestionnaire,
} from './questionnaire-generation-runtime';
import {
  compactQuestionnaireAnswerItems,
  resolveLegacyQuestionnaireProviderRuntime,
  type LegacyProviderRuntimeLogger,
} from './questionnaire-composition-runtime-shared';

export const MAGICAL_GIRL_DETAILS_ACTION_TYPE = 'magical_girl_details_generate' as const;

type DetailsAiOptions = CustomProviderRuntimeOptions & { telemetry: GenerationAiTelemetry };

export interface GenerateMagicalGirlDetailsRuntimeDependencies
  extends CustomProviderRuntimeDependencies,
  LegacyProviderRuntimeLogger {
  presetIndex: unknown;
  loadPreset(_requestUrl: string, _path: string): Promise<unknown>;
  loadDataCard(_request: Request, _id: string): Promise<QuestionnaireDataCard>;
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
  generateWithAI(
    _input: MagicalGirlDetailsGenerationInput,
    _config: StructuredGenerationConfig<MagicalGirlDetailsGeneratedData, MagicalGirlDetailsGenerationInput>,
    _options: DetailsAiOptions,
  ): Promise<MagicalGirlDetailsGeneratedData>;
  sign(_payload: Record<string, unknown>): Promise<unknown>;
  recordActivity(_request: Request): void;
  buildResponse(_input: {
    requestHeaders: Headers;
    data: Record<string, unknown>;
    telemetry: GenerationAiTelemetry;
  }): Response | Promise<Response>;
  logError(_error: unknown): void;
}

export type GenerateMagicalGirlDetailsRuntime = Readonly<{
  service: GenerateMagicalGirlDetailsService;
}>;

type DetailsInput = {
  normalizedAnswers: QuestionnaireAnswerItem[];
  effectiveQuestionnaires: RequestQuestionnaire[];
  allowNativeSignature: boolean;
  language: string;
  customProviderPayload: unknown;
};

type DetailsGeneration = {
  details: MagicalGirlDetailsGeneratedData;
  telemetry: GenerationAiTelemetry;
};

export const createGenerateMagicalGirlDetailsRuntime = (
  dependencies: GenerateMagicalGirlDetailsRuntimeDependencies,
): GenerateMagicalGirlDetailsRuntime => {
  const ports = Object.freeze({ ...dependencies });
  const presetEntries = normalizePresetEntries(ports.presetIndex);
  const service = createGenerateMagicalGirlDetailsService<
    DetailsInput,
    Exclude<ReturnType<typeof resolveLegacyQuestionnaireProviderRuntime>, { response: Response }>,
    DetailsGeneration
  >({
    prepare: async (request, body) => {
      const parsedBody = body as Record<string, unknown>;
      const rawAnswers = parsedBody.answers;
      const requestedNativeSignature = parsedBody.allowNativeSignature === true;
      const selections = normalizeQuestionnaireSelections(parsedBody.questionnaireSelections);
      let effectiveQuestionnaires = normalizeQuestionnaires(parsedBody.questionnaires);
      let nativeAllowedByServer = false;
      if (requestedNativeSignature) {
        try {
          const resolved = await resolveNativeQuestionnaires({
            requestUrl: request.url,
            selections,
            requiredQuestionnaireIds: extractAnswerQuestionnaireIds(rawAnswers),
            presetEntries,
            loadPreset: ports.loadPreset,
            loadDataCard: (id) => ports.loadDataCard(request, id),
          });
          if (resolved.allowed && resolved.questionnaires.length > 0) {
            nativeAllowedByServer = true;
            effectiveQuestionnaires = resolved.questionnaires;
          } else {
            ports.logInfo('请求原生签名但问卷未获原生许可，已取消原生签名', {
              selectionCount: selections.length,
            });
          }
        } catch (error) {
          ports.logWarn('尝试解析原生许可问卷失败，已取消原生签名', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      const normalizedAnswers = resolveAnswerItems(rawAnswers, effectiveQuestionnaires, {
        preferResolvedQuestionText: nativeAllowedByServer,
      });
      if (normalizedAnswers.length === 0) {
        return respondStep(new Response(JSON.stringify({ error: 'Answers array is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      const overLimitAnswer = findOverLimitAnswer(normalizedAnswers, effectiveQuestionnaires);
      if (overLimitAnswer) {
        ports.logInfo('问卷答案超过字数上限，已取消原生签名', overLimitAnswer);
      }
      return completeStep({
        normalizedAnswers,
        effectiveQuestionnaires,
        allowNativeSignature: requestedNativeSignature
          && nativeAllowedByServer
          && !overLimitAnswer,
        language: typeof parsedBody.language === 'string' && parsedBody.language.trim()
          ? parsedBody.language.trim()
          : 'zh-CN',
        customProviderPayload: parsedBody.customProvider,
      });
    },
    resolveExecution: async (_request, input) => {
      const resolved = resolveLegacyQuestionnaireProviderRuntime(
        input.customProviderPayload,
        ports,
      );
      return resolved.response ? respondStep(resolved.response) : completeStep(resolved);
    },
    checkRateLimit: (request, input) => ports.checkRateLimit({
      request,
      actionType: MAGICAL_GIRL_DETAILS_ACTION_TYPE,
      providerMode: inferCustomProviderMode(input.customProviderPayload),
    }),
    enforceSafety: async (request, input) => {
      for (const answer of input.normalizedAnswers) {
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
    generate: async (_request, input, execution) => {
      const telemetry: GenerationAiTelemetry = {};
      const generationInput: MagicalGirlDetailsGenerationInput = {
        answers: input.normalizedAnswers,
        language: input.language,
        loreText: buildQuestionnaireLoreText(input.effectiveQuestionnaires),
      };
      const details = await ports.generateWithAI(
        generationInput,
        createMagicalGirlDetailsGenerationConfig(
          ports.getRandomFlowers,
          execution.modelOverride,
          execution.options.generationSettingsContext,
        ),
        { ...execution.options, telemetry },
      );
      return completeStep({ details, telemetry });
    },
    recordActivity: ports.recordActivity,
    buildResponse: async (request, input, output) => {
      const unsigned: Record<string, unknown> = {
        ...output.details,
        templateId: '魔法少女/心之花/魔法少女（问卷生成）',
        userAnswers: compactQuestionnaireAnswerItems(input.normalizedAnswers),
      };
      const data = input.allowNativeSignature
        ? { ...unsigned, signature: await ports.sign(unsigned) }
        : unsigned;
      return ports.buildResponse({
        requestHeaders: request.headers,
        data,
        telemetry: output.telemetry,
      });
    },
    logError: ports.logError,
  });
  return Object.freeze({ service });
};
