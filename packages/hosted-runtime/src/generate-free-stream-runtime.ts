import { buildFreeStreamPrompt } from '@mahoshojo/ai-core/free-generation';
import {
  createGenerateFreeStreamService,
  type GenerateFreeService,
  type GenerateFreeStreamInput,
} from '@mahoshojo/hosted-api/generate-free';
import { completeStep, respondStep } from '@mahoshojo/hosted-api/regular-generation';

import {
  FREE_GENERATION_ACTION_TYPE,
} from './generate-free-runtime';
import {
  inferCustomProviderMode,
  resolveCustomProviderRuntime,
  type CustomProviderRuntimeDependencies,
} from './custom-provider-runtime';
import {
  type GenerationAiTelemetry,
  type RawGenerationConfig,
  type ReasoningSseBridge,
  type StreamAiOptions,
  type StreamGenerationResult,
} from './generation-runtime-shared';

export interface GenerateFreeStreamRuntimeDependencies
  extends CustomProviderRuntimeDependencies {
  checkRateLimit(_input: {
    request: Request;
    actionType: typeof FREE_GENERATION_ACTION_TYPE;
    providerMode: ReturnType<typeof inferCustomProviderMode>;
  }): Promise<Response | null>;
  enforceSafety(_input: {
    request: Request;
    text: string;
    logMeta: {
      schemaId: GenerateFreeStreamInput['schema'];
      attachmentsCount: number;
      attachmentsChars: number;
    };
    sensitiveWordReason: '使用危险符文';
    aiPromptTemplate: 'free';
  }): Promise<Response | null>;
  shouldUseReasoningSse(_request: Request): boolean;
  createReasoningSseBridge(_label: '自由生成（流式）'): ReasoningSseBridge;
  generateWithStreamAI(
    _config: RawGenerationConfig,
    _options: StreamAiOptions,
  ): Promise<StreamGenerationResult>;
  recordActivity(_request: Request): void;
  logError(_error: unknown): void;
}

export interface GenerateFreeStreamRuntime {
  readonly service: GenerateFreeService;
}

type FreeStreamGeneration = {
  streamResult: StreamGenerationResult;
  reasoningBridge: ReasoningSseBridge | null;
  telemetry: GenerationAiTelemetry;
  customModelOverride?: string;
};

export const createGenerateFreeStreamRuntime = (
  dependencies: GenerateFreeStreamRuntimeDependencies,
): GenerateFreeStreamRuntime => {
  const ports = Object.freeze({ ...dependencies });
  const service = createGenerateFreeStreamService<FreeStreamGeneration>({
    checkRateLimit: (request, input) => ports.checkRateLimit({
      request,
      actionType: FREE_GENERATION_ACTION_TYPE,
      providerMode: inferCustomProviderMode(input.customProvider),
    }),
    enforceSafety: (request, input, safetyText) => ports.enforceSafety({
      request,
      text: safetyText,
      logMeta: {
        schemaId: input.schema,
        attachmentsCount: input.attachments.length,
        attachmentsChars: [input.prompt, ...input.attachments.map((item) => item.content)]
          .filter((text) => text.trim())
          .join('\n\n').length,
      },
      sensitiveWordReason: '使用危险符文',
      aiPromptTemplate: 'free',
    }),
    generate: async (request, input) => {
      const resolvedProvider = resolveCustomProviderRuntime(
        input.customProvider,
        ports,
        {
          nonSystemLoadBalanceStrategy: 'custom',
          exposeEmptyBaseUrlModelOverride: true,
        },
      );
      if (resolvedProvider.response) return respondStep(resolvedProvider.response);

      const reasoningBridge = ports.shouldUseReasoningSse(request)
        ? ports.createReasoningSseBridge('自由生成（流式）')
        : null;
      const telemetry: GenerationAiTelemetry = {};
      const streamResult = await ports.generateWithStreamAI(
        {
          prompt: buildFreeStreamPrompt({
            schema: input.schema,
            language: input.language,
            prompt: input.prompt,
            attachments: input.attachments,
          }),
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
          telemetry,
          ...(reasoningBridge
            ? { onReasoningEvent: reasoningBridge.onReasoningEvent }
            : {}),
        },
      );
      return completeStep({
        streamResult,
        reasoningBridge,
        telemetry,
        ...(resolvedProvider.modelOverride
          ? { customModelOverride: resolvedProvider.modelOverride }
          : {}),
      });
    },
    recordActivity: ports.recordActivity,
    buildResponse: (_request, _input, output) => output.reasoningBridge
      ? output.reasoningBridge.toResponse(output.streamResult.response, {
        usagePromise: output.streamResult.usagePromise,
        aiModel: output.telemetry.model ?? output.customModelOverride ?? null,
      })
      : output.streamResult.response,
    logError: ports.logError,
  });

  return Object.freeze({ service });
};
