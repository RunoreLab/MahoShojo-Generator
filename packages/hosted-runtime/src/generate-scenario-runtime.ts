import {
  SCENARIO_GENERATION_SCHEMA,
  buildScenarioStructuredPrompt,
  type NativeScenarioData,
  type ScenarioGeneratedData,
} from '@mahoshojo/ai-core/scenario-generation';
import {
  createGenerateScenarioService,
  type GenerateScenarioInput,
  type GenerateScenarioService,
} from '@mahoshojo/hosted-api/generate-scenario';
import {
  CustomProviderRequestSchema,
  completeStep,
  respondStep,
} from '@mahoshojo/hosted-api/regular-generation';

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

export const SCENARIO_GENERATION_ACTION_TYPE = 'scenario_generate' as const;

export {
  SCENARIO_GENERATION_SCHEMA,
  type NativeScenarioData,
  type ScenarioGeneratedData,
} from '@mahoshojo/ai-core/scenario-generation';

export type GenerateScenarioAiOptions = CustomProviderRuntimeOptions & {
  telemetry: GenerationAiTelemetry;
};

export interface GenerateScenarioRuntimeDependencies
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
  generateWithAI(
    _input: null,
    _config: StructuredGenerationConfig<ScenarioGeneratedData, null>,
    _options: GenerateScenarioAiOptions,
  ): Promise<ScenarioGeneratedData>;
  now(): Date;
  sign(_payload: NativeScenarioData): Promise<string | null>;
  recordActivity(_request: Request): void;
  buildResponse(_input: {
    requestHeaders: Headers;
    data: NativeScenarioData;
    telemetry: GenerationAiTelemetry;
  }): Response | Promise<Response>;
  logWarn(
    _message: '自定义 AI 供应商配置校验失败',
    _meta: { providerId: unknown; issues: unknown },
  ): void;
  logError(_error: unknown): void;
}

export interface GenerateScenarioRuntime {
  readonly service: GenerateScenarioService;
}

type ScenarioGeneration = {
  scenarioData: ScenarioGeneratedData;
  aiTelemetry: GenerationAiTelemetry;
};

const createGenerationConfig = (
  input: GenerateScenarioInput,
  modelOverride: string | undefined,
  generationSettingsContext: CustomProviderRuntimeOptions['generationSettingsContext'],
): StructuredGenerationConfig<ScenarioGeneratedData, null> => ({
  systemPrompt: '你是一位富有想象力的世界观构架师和剧本作家，擅长将零散的想法整合成结构化的故事场景。',
  temperature: 0.7,
  promptBuilder: () => buildScenarioStructuredPrompt({
    answers: input.answers as Record<string, string>,
    language: input.language,
    fieldsToKeepEmpty: input.fieldsToKeepEmpty as string[],
  }),
  schema: SCENARIO_GENERATION_SCHEMA,
  taskName: '生成情景',
  ...(modelOverride ? { modelOverride } : {}),
  ...(generationSettingsContext ? { generationSettingsContext } : {}),
});

export const resolveScenarioProviderRuntime = (
  payload: unknown,
  ports: CustomProviderRuntimeDependencies & Pick<
    GenerateScenarioRuntimeDependencies,
    'logWarn'
  >,
) => {
  if (!payload) {
    return resolveCustomProviderRuntime(undefined, ports, {
      nonSystemLoadBalanceStrategy: 'custom',
      exposeEmptyBaseUrlModelOverride: true,
    });
  }
  const parsedResult = CustomProviderRequestSchema.safeParse(payload);
  if (!parsedResult.success) {
    const providerId = payload && typeof payload === 'object' && 'providerId' in payload
      ? payload.providerId
      : undefined;
    ports.logWarn('自定义 AI 供应商配置校验失败', {
      providerId,
      issues: parsedResult.error.issues,
    });
    return {
      response: new Response(
        JSON.stringify({ error: '自定义 AI 供应商配置无效' }),
        { status: 400 },
      ),
    } as const;
  }
  return resolveCustomProviderRuntime(parsedResult.data, ports, {
    nonSystemLoadBalanceStrategy: 'custom',
    exposeEmptyBaseUrlModelOverride: true,
  });
};

export const createGenerateScenarioRuntime = (
  dependencies: GenerateScenarioRuntimeDependencies,
): GenerateScenarioRuntime => {
  const ports = Object.freeze({ ...dependencies });
  const service = createGenerateScenarioService<ScenarioGeneration>({
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
    generate: async (_request, input) => {
      const resolvedProvider = resolveScenarioProviderRuntime(input.customProvider, ports);
      if (resolvedProvider.response) return respondStep(resolvedProvider.response);

      const aiTelemetry: GenerationAiTelemetry = {};
      const scenarioData = await ports.generateWithAI(
        null,
        createGenerationConfig(
          input,
          resolvedProvider.modelOverride,
          resolvedProvider.options.generationSettingsContext,
        ),
        { ...resolvedProvider.options, telemetry: aiTelemetry },
      );
      return completeStep({ scenarioData, aiTelemetry });
    },
    recordActivity: ports.recordActivity,
    finalize: async (request, _input, output) => {
      const payloadToSign: NativeScenarioData = {
        ...output.scenarioData,
        metadata: { created_at: ports.now().toISOString() },
      };
      const signature = await ports.sign(payloadToSign);
      const finalScenario: NativeScenarioData = {
        ...payloadToSign,
        metadata: {
          ...payloadToSign.metadata,
          signature: signature || '签名丢失，可能未设置密钥',
        },
      };
      return ports.buildResponse({
        requestHeaders: request.headers,
        data: finalScenario,
        telemetry: output.aiTelemetry,
      });
    },
    logError: ports.logError,
  });

  return Object.freeze({ service });
};
