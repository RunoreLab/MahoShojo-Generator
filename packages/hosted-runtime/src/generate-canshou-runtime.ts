import type { QuestionnaireAnswerItem } from '@mahoshojo/domain/questionnaire';
import {
  createGenerateCanshouService,
  type GenerateCanshouService,
} from '@mahoshojo/hosted-api/generate-canshou';
import { completeStep, respondStep } from '@mahoshojo/hosted-api/regular-generation';

import {
  createCanshouGenerationConfig,
  type CanshouGeneratedData,
  type CanshouGenerationInput,
} from './canshou-generation-runtime-shared';
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

export const CANSHOU_GENERATION_ACTION_TYPE = 'canshou_generate' as const;

export type GenerateCanshouAiOptions = CustomProviderRuntimeOptions & {
  telemetry: GenerationAiTelemetry;
};

export interface GenerateCanshouRuntimeDependencies
  extends CustomProviderRuntimeDependencies,
  LegacyProviderRuntimeLogger {
  presetIndex: unknown;
  canshouLore: string;
  loadPreset(_requestUrl: string, _path: string): Promise<unknown>;
  loadDataCard(_id: string): Promise<QuestionnaireDataCard>;
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
    sensitiveWordReason?: '在残兽问卷中使用了危险符文';
  }): Promise<Response | null>;
  generateWithAI(
    _input: CanshouGenerationInput,
    _config: StructuredGenerationConfig<CanshouGeneratedData, CanshouGenerationInput>,
    _options: GenerateCanshouAiOptions,
  ): Promise<CanshouGeneratedData>;
  sign(_payload: Record<string, unknown>): Promise<unknown>;
  recordActivity(_request: Request): void;
  buildResponse(_input: {
    requestHeaders: Headers;
    data: Record<string, unknown>;
    telemetry: GenerationAiTelemetry;
  }): Response | Promise<Response>;
  logInfo(_message: string, _meta: unknown): void;
  logError(_error: unknown): void;
}

export interface GenerateCanshouRuntime {
  readonly service: GenerateCanshouService;
}

type CanshouInput = {
  normalizedAnswers: QuestionnaireAnswerItem[];
  effectiveQuestionnaires: RequestQuestionnaire[];
  requestedNativeSignature: boolean;
  nativeAllowedByServer: boolean;
  allowNativeSignature: boolean;
  language: string;
  customProviderPayload: unknown;
};

type CanshouGeneration = {
  canshouDetails: CanshouGeneratedData;
  aiTelemetry: GenerationAiTelemetry;
};

export const createGenerateCanshouRuntime = (
  dependencies: GenerateCanshouRuntimeDependencies,
): GenerateCanshouRuntime => {
  const ports = Object.freeze({ ...dependencies });
  const presetEntries = normalizePresetEntries(ports.presetIndex);
  const service = createGenerateCanshouService<
    CanshouInput,
    Exclude<ReturnType<typeof resolveLegacyQuestionnaireProviderRuntime>, { response: Response }>,
    CanshouGeneration
  >({
    prepare: async (request, body) => {
      if (body === null || body === undefined) {
        throw new TypeError(
          "Cannot destructure property 'answers' of 'parsedBody' as it is null.",
        );
      }
      const parsedBody = body && typeof body === 'object'
        ? body as Record<string, unknown>
        : {};
      const rawAnswers = parsedBody.answers;
      const requestedNativeSignature = parsedBody.allowNativeSignature === true;
      const questionnaireSelections = normalizeQuestionnaireSelections(
        parsedBody.questionnaireSelections,
      );
      const requiredQuestionnaireIds = extractAnswerQuestionnaireIds(rawAnswers);
      let effectiveQuestionnaires = normalizeQuestionnaires(parsedBody.questionnaires);
      let nativeAllowedByServer = false;
      if (requestedNativeSignature) {
        try {
          const resolved = await resolveNativeQuestionnaires({
            requestUrl: request.url,
            selections: questionnaireSelections,
            requiredQuestionnaireIds,
            presetEntries,
            loadPreset: ports.loadPreset,
            loadDataCard: ports.loadDataCard,
          });
          if (resolved.allowed && resolved.questionnaires.length > 0) {
            nativeAllowedByServer = true;
            effectiveQuestionnaires = resolved.questionnaires;
          } else {
            ports.logInfo('请求原生签名但问卷未获原生许可，已取消原生签名', {
              selectionCount: questionnaireSelections.length,
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
      return completeStep({
        normalizedAnswers,
        effectiveQuestionnaires,
        requestedNativeSignature,
        nativeAllowedByServer,
        allowNativeSignature: false,
        language: parsedBody.language === undefined
          ? 'zh-CN'
          : parsedBody.language as string,
        customProviderPayload: parsedBody.customProvider,
      });
    },
    checkRateLimit: (request, input) => ports.checkRateLimit({
      request,
      actionType: CANSHOU_GENERATION_ACTION_TYPE,
      providerMode: inferCustomProviderMode(input.customProviderPayload),
    }),
    enforceSafety: async (request, input) => {
      const overLimitAnswer = findOverLimitAnswer(
        input.normalizedAnswers,
        input.effectiveQuestionnaires,
      );
      input.allowNativeSignature = input.requestedNativeSignature
        && input.nativeAllowedByServer
        && !overLimitAnswer;
      if (overLimitAnswer) {
        ports.logInfo('问卷答案超过字数上限，已取消原生签名', overLimitAnswer);
      }
      for (const answerItem of input.normalizedAnswers) {
        const response = await ports.enforceSafety({
          request,
          text: answerItem.answer,
          logMeta: {
            questionId: answerItem.questionId,
            questionnaireId: answerItem.questionnaireId,
          },
          enableAiSafetyCheck: false,
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
    generate: async (_request, input, execution) => {
      const aiTelemetry: GenerationAiTelemetry = {};
      const generationInput: CanshouGenerationInput = {
        answers: input.normalizedAnswers,
        language: input.language,
        loreText: buildQuestionnaireLoreText(input.effectiveQuestionnaires),
      };
      const canshouDetails = await ports.generateWithAI(
        generationInput,
        createCanshouGenerationConfig(
          ports.canshouLore,
          execution.modelOverride,
          execution.options.generationSettingsContext,
        ),
        { ...execution.options, telemetry: aiTelemetry },
      );
      return completeStep({ canshouDetails, aiTelemetry });
    },
    recordActivity: ports.recordActivity,
    buildResponse: async (request, input, output) => {
      const dataToSign: Record<string, unknown> = {
        ...output.canshouDetails,
        templateId: '魔法少女/心之花/残兽（问卷生成）',
        userAnswers: compactQuestionnaireAnswerItems(input.normalizedAnswers),
      };
      const data = input.allowNativeSignature
        ? { ...dataToSign, signature: await ports.sign(dataToSign) }
        : dataToSign;
      return ports.buildResponse({
        requestHeaders: request.headers,
        data,
        telemetry: output.aiTelemetry,
      });
    },
    logError: ports.logError,
  });

  return Object.freeze({ service });
};
