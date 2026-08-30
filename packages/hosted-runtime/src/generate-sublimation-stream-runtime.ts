import {
  createGenerateSublimationStreamService,
  type GenerateSublimationService,
} from '@mahoshojo/hosted-api/generate-sublimation';
import { completeStep, respondStep } from '@mahoshojo/hosted-api/regular-generation';

import {
  inferCustomProviderMode,
  type CustomProviderRuntimeDependencies,
} from './custom-provider-runtime';
import { SUBLIMATION_ACTION_TYPE } from './generate-sublimation-runtime';
import {
  type GenerationAiTelemetry,
  type ReasoningSseBridge,
  type StreamAiOptions,
  type StreamGenerationResult,
} from './generation-runtime-shared';
import {
  buildQuestionnaireLoreText,
  normalizeQuestionnaires,
} from './questionnaire-generation-runtime';
import {
  resolveLegacyQuestionnaireProviderRuntime,
  type LegacyProviderRuntimeLogger,
} from './questionnaire-composition-runtime-shared';
import {
  SUBLIMATION_FIELDS_TO_PRESERVE_MAX,
  SUBLIMATION_NARRATIVE_HISTORY_MAX_CHARS,
  SUBLIMATION_USER_GUIDANCE_MAX_CHARS,
  buildSublimationStreamConfig,
} from './sublimation-runtime-shared';

export interface GenerateSublimationStreamRuntimeDependencies
  extends CustomProviderRuntimeDependencies,
  LegacyProviderRuntimeLogger {
  checkRateLimit(_input: {
    request: Request;
    actionType: typeof SUBLIMATION_ACTION_TYPE;
    providerMode: ReturnType<typeof inferCustomProviderMode>;
  }): Promise<Response | null>;
  enforceSafety(_input: {
    request: Request;
    text: string;
    enableAiSafetyCheck: false;
    sensitiveWordReason: '上传的角色档案或引导内容包含危险符文';
  }): Promise<Response | null>;
  shouldUseReasoningSse(_request: Request): boolean;
  createReasoningSseBridge(_label: '角色升华（流式）'): ReasoningSseBridge;
  generateWithStreamAI(
    _config: ReturnType<typeof buildSublimationStreamConfig>,
    _options: StreamAiOptions,
  ): Promise<StreamGenerationResult>;
  recordActivity(_request: Request): void;
  logError(_error: unknown): void;
}

type StreamInput = {
  original: Record<string, unknown>;
  language: string;
  userGuidance: string;
  narrativeHistory: string;
  fieldsToPreserve: string[];
  isDowngrade: boolean;
  allowReshapeNames: boolean;
  sourceTemplate: unknown;
  targetTemplate: unknown;
  loreText: string;
  customProviderPayload: unknown;
};

type StreamOutput = {
  result: StreamGenerationResult;
  bridge: ReasoningSseBridge | null;
  telemetry: GenerationAiTelemetry;
  customModelOverride?: string;
};

const STREAM_CONTROL_FIELDS = [
  'language', 'userGuidance', 'narrativeHistory', 'fieldsToPreserve', 'isDowngrade',
  'allowReshapeNames', 'customProvider', 'targetTemplate', 'sourceTemplate',
  'arenaHistoryRetentionStrategy', 'questionnaires', 'questionnaireSelections',
] as const;

export const createGenerateSublimationStreamRuntime = (
  dependencies: GenerateSublimationStreamRuntimeDependencies,
): Readonly<{ service: GenerateSublimationService }> => {
  const ports = Object.freeze({ ...dependencies });
  const service = createGenerateSublimationStreamService<
    StreamInput,
    Exclude<ReturnType<typeof resolveLegacyQuestionnaireProviderRuntime>, { response: Response }>,
    StreamOutput
  >({
    prepare: async (_request, body) => {
      const parsed = body && typeof body === 'object'
        ? body as Record<string, unknown>
        : {};
      const original = { ...parsed };
      for (const field of STREAM_CONTROL_FIELDS) delete original[field];
      if (Object.keys(original).length === 0) {
        return respondStep(new Response(JSON.stringify({ error: '角色数据卡不能为空' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      return completeStep({
        original,
        language: typeof parsed.language === 'string' ? parsed.language : 'zh-CN',
        userGuidance: typeof parsed.userGuidance === 'string'
          ? parsed.userGuidance.trim().slice(0, SUBLIMATION_USER_GUIDANCE_MAX_CHARS)
          : '',
        narrativeHistory: typeof parsed.narrativeHistory === 'string'
          ? parsed.narrativeHistory.trim().slice(0, SUBLIMATION_NARRATIVE_HISTORY_MAX_CHARS)
          : '',
        fieldsToPreserve: Array.isArray(parsed.fieldsToPreserve)
          ? parsed.fieldsToPreserve.filter((field): field is string => (
            typeof field === 'string' && Boolean(field.trim())
          )).slice(0, SUBLIMATION_FIELDS_TO_PRESERVE_MAX)
          : [],
        isDowngrade: parsed.isDowngrade === true,
        allowReshapeNames: parsed.allowReshapeNames === true,
        sourceTemplate: parsed.sourceTemplate,
        targetTemplate: parsed.targetTemplate,
        loreText: buildQuestionnaireLoreText(
          normalizeQuestionnaires(parsed.questionnaires),
        ).trim(),
        customProviderPayload: parsed.customProvider,
      });
    },
    checkRateLimit: (request, input) => ports.checkRateLimit({
      request,
      actionType: SUBLIMATION_ACTION_TYPE,
      providerMode: inferCustomProviderMode(input.customProviderPayload),
    }),
    enforceSafety: (request, input) => ports.enforceSafety({
      request,
      text: `${JSON.stringify(input.original)} ${input.userGuidance} ${input.narrativeHistory} ${input.loreText}`,
      enableAiSafetyCheck: false,
      sensitiveWordReason: '上传的角色档案或引导内容包含危险符文',
    }),
    resolveExecution: async (_request, input) => {
      const resolved = resolveLegacyQuestionnaireProviderRuntime(
        input.customProviderPayload,
        ports,
      );
      return resolved.response ? respondStep(resolved.response) : completeStep(resolved);
    },
    generate: async (request, input, execution) => {
      const bridge = ports.shouldUseReasoningSse(request)
        ? ports.createReasoningSseBridge('角色升华（流式）')
        : null;
      const telemetry: GenerationAiTelemetry = {};
      const result = await ports.generateWithStreamAI(buildSublimationStreamConfig({
        originalData: input.original,
        language: input.language,
        userGuidance: input.userGuidance,
        narrativeHistory: input.narrativeHistory,
        fieldsToPreserve: input.fieldsToPreserve,
        isDowngrade: input.isDowngrade,
        allowReshapeNames: input.allowReshapeNames,
        sourceTemplate: input.sourceTemplate,
        targetTemplate: input.targetTemplate,
        loreText: input.loreText,
        modelOverride: execution.modelOverride,
        generationSettingsContext: execution.options.generationSettingsContext,
      }), {
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
