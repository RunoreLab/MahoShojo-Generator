import {
  FREE_GENERATION_SCHEMAS,
  buildFreeStructuredPrompt,
  sanitizeFreeCard,
  type FreeSchemaId,
} from '@mahoshojo/ai-core/free-generation';
import {
  createGenerateFreeService,
  type FreeTextAttachment,
  type GenerateFreeService,
} from '@mahoshojo/hosted-api/generate-free';
import { completeStep, respondStep } from '@mahoshojo/hosted-api/regular-generation';

import {
  inferCustomProviderMode,
  resolveCustomProviderRuntime,
  type CustomProviderRuntimeDependencies,
  type CustomProviderRuntimeOptions,
} from './custom-provider-runtime';
import {
  type GenerationAiTelemetry,
  type StructuredGenerationConfig,
} from './generation-runtime-shared';

export const FREE_GENERATION_ACTION_TYPE = 'free_generate' as const;

export type { FreeSchemaId } from '@mahoshojo/ai-core/free-generation';
export { validateFreeOutput } from '@mahoshojo/ai-core/free-generation';

export type GenerateFreeAiOptions = CustomProviderRuntimeOptions & {
  telemetry: GenerationAiTelemetry;
};

export interface GenerateFreeRuntimeDependencies extends CustomProviderRuntimeDependencies {
  checkRateLimit(_input: {
    request: Request;
    actionType: typeof FREE_GENERATION_ACTION_TYPE;
    providerMode: ReturnType<typeof inferCustomProviderMode>;
  }): Promise<Response | null>;
  enforceSafety(_input: {
    request: Request;
    text: string;
    logMeta: {
      schemaId: FreeSchemaId;
      attachmentsCount: number;
      attachmentsChars: number;
    };
    sensitiveWordReason: '使用危险符文';
    aiPromptTemplate: 'free';
  }): Promise<Response | null>;
  generateWithAI(
    _input: {
      prompt: string;
      language: string;
      attachments: FreeTextAttachment[];
    },
    _config: StructuredGenerationConfig<unknown, {
      prompt: string;
      language: string;
      attachments: FreeTextAttachment[];
    }>,
    _options: GenerateFreeAiOptions,
  ): Promise<unknown>;
  validateOutput(_input: { schemaId: FreeSchemaId; data: unknown }): unknown;
  now(): Date;
  recordActivity(_request: Request): void;
  buildResponse(_input: {
    requestHeaders: Headers;
    data: unknown;
    telemetry: GenerationAiTelemetry;
  }): Response | Promise<Response>;
  logError(_error: unknown): void;
}

export interface GenerateFreeRuntime {
  readonly service: GenerateFreeService;
}

type FreeGeneration = {
  result: unknown;
  telemetry: GenerationAiTelemetry;
};

export const createGenerateFreeRuntime = (
  dependencies: GenerateFreeRuntimeDependencies,
): GenerateFreeRuntime => {
  const ports = Object.freeze({ ...dependencies });
  const service = createGenerateFreeService<FreeGeneration, FreeGeneration>({
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
    generate: async (_request, input) => {
      const resolvedProvider = resolveCustomProviderRuntime(
        input.customProvider,
        ports,
        {
          nonSystemLoadBalanceStrategy: 'custom',
          exposeEmptyBaseUrlModelOverride: true,
        },
      );
      if (resolvedProvider.response) return respondStep(resolvedProvider.response);

      const generationInput = {
        prompt: input.prompt,
        language: input.language,
        attachments: input.attachments,
      };
      const generationConfig: StructuredGenerationConfig<unknown, typeof generationInput> = {
        systemPrompt: '你的任务是创作具有指定数据结构的内容。',
        temperature: 0.7,
        promptBuilder: (value) => buildFreeStructuredPrompt({
          schema: input.schema,
          prompt: value.prompt,
          language: value.language,
          attachments: value.attachments,
        }),
        schema: FREE_GENERATION_SCHEMAS[input.schema],
        taskName: '自由生成数据卡',
        ...(resolvedProvider.modelOverride
          ? { modelOverride: resolvedProvider.modelOverride }
          : {}),
        ...(resolvedProvider.options.generationSettingsContext
          ? { generationSettingsContext: resolvedProvider.options.generationSettingsContext }
          : {}),
      };
      const telemetry: GenerationAiTelemetry = {};
      const result = await ports.generateWithAI(
        generationInput,
        generationConfig,
        { ...resolvedProvider.options, telemetry },
      );
      return completeStep({ result, telemetry });
    },
    normalizeOutput: async (_request, input, generated) => completeStep({
      result: ports.validateOutput({
        schemaId: input.schema,
        data: sanitizeFreeCard(input.schema, generated.result, ports.now().toISOString()),
      }),
      telemetry: generated.telemetry,
    }),
    recordActivity: ports.recordActivity,
    buildResponse: (request, _input, output) => ports.buildResponse({
      requestHeaders: request.headers,
      data: output.result,
      telemetry: output.telemetry,
    }),
    logError: ports.logError,
  });

  return Object.freeze({ service });
};
