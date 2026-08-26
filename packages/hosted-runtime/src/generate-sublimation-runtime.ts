import {
  buildFinalSublimationData,
  convertSublimationCharacterCard,
  createBlankSublimationCharacterCard,
  inferSublimationSourceTemplate,
  normalizeArenaHistoryRetentionStrategy,
  type SublimationCharacterTemplate,
  type SublimationSourceTemplate,
} from '@mahoshojo/domain/sublimation';
import {
  createGenerateSublimationService,
  type GenerateSublimationService,
} from '@mahoshojo/hosted-api/generate-sublimation';
import { completeStep } from '@mahoshojo/hosted-api/regular-generation';

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
  normalizePresetEntries,
  normalizeQuestionnaireSelections,
  normalizeQuestionnaires,
  resolveNativeLoreQuestionnaires,
  type QuestionnaireDataCard,
  type RequestQuestionnaireSelection,
} from './questionnaire-generation-runtime';
import {
  resolveLegacyQuestionnaireProviderRuntime,
  type LegacyProviderRuntimeLogger,
} from './questionnaire-composition-runtime-shared';
import {
  SUBLIMATION_USER_GUIDANCE_MAX_CHARS,
  createSublimationGenerationConfig,
  extractSublimationSafetyText,
  getSublimationSchemaKeys,
  normalizeGeneratedSublimationAnswers,
  type SublimationAiResult,
} from './sublimation-runtime-shared';

export const SUBLIMATION_ACTION_TYPE = 'sublimation_generate' as const;

type SublimationAiOptions = CustomProviderRuntimeOptions & { telemetry: GenerationAiTelemetry };

export interface GenerateSublimationRuntimeDependencies
  extends CustomProviderRuntimeDependencies,
  LegacyProviderRuntimeLogger {
  presetIndex: unknown;
  defaultQuestions: { magicalGirl: string[]; canshou: string[] };
  allowGuidedNativeSigning: boolean;
  loadPreset(_requestUrl: string, _path: string): Promise<unknown>;
  loadDataCard(_id: string): Promise<QuestionnaireDataCard>;
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
  generateWithAI(
    _input: null,
    _config: StructuredGenerationConfig<SublimationAiResult, null>,
    _options: SublimationAiOptions,
  ): Promise<SublimationAiResult>;
  verify(_payload: unknown): Promise<boolean>;
  sign(_payload: Record<string, unknown>): Promise<unknown>;
  recordActivity(_request: Request): void;
  buildResponse(_input: {
    requestHeaders: Headers;
    data: Record<string, unknown>;
    telemetry: GenerationAiTelemetry;
  }): Response | Promise<Response>;
  now(): Date;
  createWorldLineId?: () => string;
  logError(_error: unknown): void;
}

type SublimationInput = {
  original: Record<string, unknown>;
  language: string;
  finalUserGuidance: string | null;
  finalNarrativeHistory: string | null;
  requestedFieldsToPreserve: unknown;
  isDowngrade: boolean;
  allowReshapeNames: boolean;
  requestedTargetTemplate: unknown;
  requestedSourceTemplate: unknown;
  readArenaHistory: boolean;
  writeArenaHistory: boolean;
  readCurrentState: boolean;
  writeCurrentState: boolean;
  arenaHistoryRetentionStrategy: ReturnType<typeof normalizeArenaHistoryRetentionStrategy>;
  selections: RequestQuestionnaireSelection[];
  requestLoreText: string;
  customProviderPayload: unknown;
};

type SublimationExecution = {
  options: CustomProviderRuntimeOptions;
  modelOverride?: string;
  targetTemplate: SublimationCharacterTemplate;
  sourceTemplate: SublimationSourceTemplate;
  baseOutputData: Record<string, unknown>;
  fieldsToPreserve: string[];
};

type SublimationOutput = {
  aiResult: SublimationAiResult;
  telemetry: GenerationAiTelemetry;
  isNative: boolean;
  shouldSign: boolean;
  effectiveLoreText: string;
  loreNativeAllowedByServer: boolean;
  targetTemplate: SublimationCharacterTemplate;
  sourceTemplate: SublimationSourceTemplate;
  baseOutputData: Record<string, unknown>;
  fieldsToPreserve: string[];
};

const isTargetTemplate = (value: unknown): value is SublimationCharacterTemplate => (
  value === 'magical-girl' || value === 'canshou' || value === 'general'
);
const isSourceTemplate = (value: unknown): value is SublimationSourceTemplate => (
  isTargetTemplate(value) || value === 'scenario'
);

const CONTROL_FIELDS = [
  'language', 'userGuidance', 'narrativeHistory', 'fieldsToPreserve', 'isDowngrade',
  'allowReshapeNames', 'customProvider', 'targetTemplate', 'sourceTemplate',
  'readArenaHistory', 'writeArenaHistory', 'readCurrentState', 'writeCurrentState',
  'arenaHistoryRetentionStrategy', 'questionnaireSelections', 'questionnaires',
] as const;

export const createGenerateSublimationRuntime = (
  dependencies: GenerateSublimationRuntimeDependencies,
): Readonly<{ service: GenerateSublimationService }> => {
  const ports = Object.freeze({ ...dependencies });
  const presetEntries = normalizePresetEntries(ports.presetIndex);
  const service = createGenerateSublimationService<
    SublimationInput,
    SublimationExecution,
    SublimationOutput
  >({
    prepare: async (_request, body) => {
      const parsed = body && typeof body === 'object'
        ? body as Record<string, unknown>
        : {};
      const original = { ...parsed };
      for (const field of CONTROL_FIELDS) delete original[field];
      const selections = normalizeQuestionnaireSelections(parsed.questionnaireSelections);
      const requestLoreText = buildQuestionnaireLoreText(
        normalizeQuestionnaires(parsed.questionnaires),
      );
      const allowReshapeNames = parsed.allowReshapeNames === true;
      return completeStep({
        original,
        language: typeof parsed.language === 'string' ? parsed.language : 'zh-CN',
        finalUserGuidance: typeof parsed.userGuidance === 'string'
          && parsed.userGuidance.trim()
          ? parsed.userGuidance.trim().slice(0, SUBLIMATION_USER_GUIDANCE_MAX_CHARS)
          : null,
        finalNarrativeHistory: typeof parsed.narrativeHistory === 'string'
          && parsed.narrativeHistory.trim()
          ? parsed.narrativeHistory.trim()
          : null,
        requestedFieldsToPreserve: parsed.fieldsToPreserve,
        isDowngrade: parsed.isDowngrade === true,
        allowReshapeNames,
        requestedTargetTemplate: parsed.targetTemplate,
        requestedSourceTemplate: parsed.sourceTemplate,
        readArenaHistory: typeof parsed.readArenaHistory === 'boolean'
          ? parsed.readArenaHistory
          : true,
        writeArenaHistory: typeof parsed.writeArenaHistory === 'boolean'
          ? parsed.writeArenaHistory
          : true,
        readCurrentState: typeof parsed.readCurrentState === 'boolean'
          ? parsed.readCurrentState
          : true,
        writeCurrentState: typeof parsed.writeCurrentState === 'boolean'
          ? parsed.writeCurrentState
          : true,
        arenaHistoryRetentionStrategy: normalizeArenaHistoryRetentionStrategy(
          parsed.arenaHistoryRetentionStrategy,
        ),
        selections,
        requestLoreText,
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
      text: `${extractSublimationSafetyText(input.original)} ${input.finalUserGuidance ?? ''} ${input.finalNarrativeHistory ?? ''} ${input.requestLoreText}`,
      enableAiSafetyCheck: false,
      sensitiveWordReason: '上传的角色档案或引导内容包含危险符文',
    }),
    resolveExecution: async (_request, input) => {
      const inferredSource = inferSublimationSourceTemplate(input.original);
      const sourceTemplate = isSourceTemplate(input.requestedSourceTemplate)
        ? input.requestedSourceTemplate
        : inferredSource;
      const targetTemplate = isTargetTemplate(input.requestedTargetTemplate)
        ? input.requestedTargetTemplate
        : isTargetTemplate(sourceTemplate)
          ? sourceTemplate
          : 'general';
      let baseOutputData: Record<string, unknown>;
      try {
        const converted = convertSublimationCharacterCard(
          input.original,
          targetTemplate,
          sourceTemplate,
        );
        baseOutputData = converted.data;
        if (converted.warnings.length) {
          ports.logInfo('转换到目标模板时产生警告', {
            warnings: converted.warnings,
            targetTemplate,
          });
        }
      } catch (error) {
        ports.logWarn('角色数据转换目标模板失败，使用空白模板兜底', {
          error: error instanceof Error ? error.message : String(error),
          targetTemplate,
        });
        baseOutputData = createBlankSublimationCharacterCard(targetTemplate);
      }
      const schemaKeys = getSublimationSchemaKeys(targetTemplate, input.allowReshapeNames);
      const fieldsToPreserve = Array.isArray(input.requestedFieldsToPreserve)
        ? input.requestedFieldsToPreserve.filter((field): field is string => (
          typeof field === 'string' && schemaKeys.includes(field)
        ))
        : [];
      const provider = resolveLegacyQuestionnaireProviderRuntime(
        input.customProviderPayload,
        ports,
      );
      return provider.response
        ? { completed: false, response: provider.response }
        : completeStep({
          ...provider,
          targetTemplate,
          sourceTemplate,
          baseOutputData,
          fieldsToPreserve,
        });
    },
    generate: async (request, input, execution) => {
      const isNative = await ports.verify(input.original);
      const hasHistory = Boolean(input.finalNarrativeHistory);
      let shouldSign = isNative && !input.finalUserGuidance && !hasHistory;
      if (
        isNative
        && input.finalUserGuidance
        && ports.allowGuidedNativeSigning
        && !hasHistory
      ) shouldSign = true;

      let loreNativeAllowedByServer = false;
      let effectiveLoreText = input.requestLoreText.trim();
      if (effectiveLoreText && shouldSign) {
        try {
          const resolved = await resolveNativeLoreQuestionnaires({
            requestUrl: request.url,
            selections: input.selections,
            presetEntries,
            loadPreset: ports.loadPreset,
            loadDataCard: ports.loadDataCard,
          });
          if (resolved.allowed) {
            loreNativeAllowedByServer = true;
            effectiveLoreText = buildQuestionnaireLoreText(resolved.questionnaires).trim();
          } else shouldSign = false;
        } catch (error) {
          ports.logWarn('尝试解析原生许可问卷设定失败，已取消原生签名', {
            error: error instanceof Error ? error.message : String(error),
          });
          shouldSign = false;
        }
      }
      const hasQuestionnaireLore = Boolean(effectiveLoreText);
      if (hasQuestionnaireLore && !loreNativeAllowedByServer) shouldSign = false;

      const telemetry: GenerationAiTelemetry = {};
      const aiResult = await ports.generateWithAI(null, createSublimationGenerationConfig({
        originalData: input.original,
        baseOutputData: execution.baseOutputData,
        language: input.language,
        userGuidance: input.finalUserGuidance,
        narrativeHistory: input.finalNarrativeHistory,
        loreText: hasQuestionnaireLore ? effectiveLoreText : null,
        sourceTemplate: execution.sourceTemplate,
        targetTemplate: execution.targetTemplate,
        fieldsToPreserve: execution.fieldsToPreserve,
        allowReshapeNames: input.allowReshapeNames,
        isDowngrade: input.isDowngrade,
        modelOverride: execution.modelOverride,
        generationSettingsContext: execution.options.generationSettingsContext,
        defaultQuestions: ports.defaultQuestions,
        stateOptions: {
          readArenaHistory: input.readArenaHistory,
          writeArenaHistory: input.writeArenaHistory,
          readCurrentState: input.readCurrentState,
          writeCurrentState: input.writeCurrentState,
        },
      }), { ...execution.options, telemetry });
      return completeStep({
        aiResult,
        telemetry,
        isNative,
        shouldSign,
        effectiveLoreText,
        loreNativeAllowedByServer,
        targetTemplate: execution.targetTemplate,
        sourceTemplate: execution.sourceTemplate,
        baseOutputData: execution.baseOutputData,
        fieldsToPreserve: execution.fieldsToPreserve,
      });
    },
    recordActivity: ports.recordActivity,
    buildResponse: async (request, input, output) => {
      const updated = { ...output.aiResult.updatedCharacterData };
      if (updated.userAnswers) {
        updated.userAnswers = normalizeGeneratedSublimationAnswers(
          updated.userAnswers,
          input.original.userAnswers,
          output.targetTemplate,
          ports.defaultQuestions,
        );
      }
      const hasQuestionnaireLore = Boolean(output.effectiveLoreText);
      const sublimatedData = buildFinalSublimationData({
        originalCharacterData: input.original,
        baseOutputData: output.baseOutputData,
        updatedDataFromAI: updated,
        targetTemplate: output.targetTemplate,
        allowReshapeNames: input.allowReshapeNames,
        writeArenaHistory: input.writeArenaHistory,
        writeCurrentState: input.writeCurrentState,
        arenaHistoryRetentionStrategy: input.arenaHistoryRetentionStrategy,
        sublimationEvent: output.aiResult.sublimationEvent,
        finalUserGuidance: input.finalUserGuidance,
        hasNarrativeHistory: Boolean(input.finalNarrativeHistory),
        hasQuestionnaireLore,
        hasNonNativeQuestionnaireLore: hasQuestionnaireLore
          && !output.loreNativeAllowedByServer,
        questionnaireSelectionCount: input.selections.length,
        isNative: output.isNative,
        nowISO: ports.now().toISOString(),
        createWorldLineId: ports.createWorldLineId,
      });
      if (output.shouldSign) sublimatedData.signature = await ports.sign(sublimatedData);
      else delete sublimatedData.signature;
      return ports.buildResponse({
        requestHeaders: request.headers,
        data: {
          sublimatedData,
          unchangedFields: output.fieldsToPreserve,
          targetTemplate: output.targetTemplate,
        },
        telemetry: output.telemetry,
      });
    },
    logError: ports.logError,
  });
  return Object.freeze({ service });
};
