import { buildScenarioStreamPrompt } from '@mahoshojo/ai-core/scenario-generation';
import {
  createGenerateScenarioStreamService,
  type GenerateScenarioService,
} from '@mahoshojo/hosted-api/generate-scenario';
import { completeStep, respondStep } from '@mahoshojo/hosted-api/regular-generation';

import {
  inferCustomProviderMode,
  type CustomProviderRuntimeDependencies,
} from './custom-provider-runtime';
import {
  SCENARIO_GENERATION_ACTION_TYPE,
  resolveScenarioProviderRuntime,
} from './generate-scenario-runtime';
import {
  type GenerationAiTelemetry,
  type RawGenerationConfig,
  type ReasoningSseBridge,
  type StreamAiOptions,
  type StreamGenerationResult,
} from './generation-runtime-shared';

export interface GenerateScenarioStreamRuntimeDependencies
  extends CustomProviderRuntimeDependencies {
  checkRateLimit(_input: {
    request: Request;
    actionType: typeof SCENARIO_GENERATION_ACTION_TYPE;
    providerMode: ReturnType<typeof inferCustomProviderMode>;
  }): Promise<Response | null>;
  enforceSafety(_input: {
    request: Request;
    text: string;
    logMeta: { answersCount: number };
    sensitiveWordReason: '使用危险符文';
    aiPromptTemplate: 'scenario';
  }): Promise<Response | null>;
  shouldUseReasoningSse(_request: Request): boolean;
  createReasoningSseBridge(_label: '情景卡（流式）'): ReasoningSseBridge;
  generateWithStreamAI(
    _config: RawGenerationConfig,
    _options: StreamAiOptions,
  ): Promise<StreamGenerationResult>;
  recordActivity(_request: Request): void;
  logWarn(
    _message: '自定义 AI 供应商配置校验失败',
    _meta: { providerId: unknown; issues: unknown },
  ): void;
  logError(_error: unknown): void;
}

export interface GenerateScenarioStreamRuntime {
  readonly service: GenerateScenarioService;
}

type ScenarioStreamGeneration = {
  streamResult: StreamGenerationResult;
  reasoningBridge: ReasoningSseBridge | null;
  aiTelemetry: GenerationAiTelemetry;
  customModelOverride?: string;
};

export const createGenerateScenarioStreamRuntime = (
  dependencies: GenerateScenarioStreamRuntimeDependencies,
): GenerateScenarioStreamRuntime => {
  const ports = Object.freeze({ ...dependencies });
  const service = createGenerateScenarioStreamService<ScenarioStreamGeneration>({
    checkRateLimit: (request, input) => ports.checkRateLimit({
      request,
      actionType: SCENARIO_GENERATION_ACTION_TYPE,
      providerMode: inferCustomProviderMode(input.customProvider),
    }),
    enforceSafety: (request, input, safetyText) => ports.enforceSafety({
      request,
      text: safetyText,
      logMeta: { answersCount: Object.keys(input.answers).length },
      sensitiveWordReason: '使用危险符文',
      aiPromptTemplate: 'scenario',
    }),
    generate: async (request, input) => {
      const resolvedProvider = resolveScenarioProviderRuntime(input.customProvider, ports);
      if (resolvedProvider.response) return respondStep(resolvedProvider.response);

      const reasoningBridge = ports.shouldUseReasoningSse(request)
        ? ports.createReasoningSseBridge('情景卡（流式）')
        : null;
      const aiTelemetry: GenerationAiTelemetry = {};
      const streamResult = await ports.generateWithStreamAI(
        {
          prompt: buildScenarioStreamPrompt(input),
          temperature: 0.75,
          ...(resolvedProvider.modelOverride
            ? { modelOverride: resolvedProvider.modelOverride }
            : {}),
          ...(resolvedProvider.options.generationSettingsContext
            ? { generationSettingsContext: resolvedProvider.options.generationSettingsContext }
            : {}),
        },
        {
          ...resolvedProvider.options,
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
        ...(resolvedProvider.modelOverride
          ? { customModelOverride: resolvedProvider.modelOverride }
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
