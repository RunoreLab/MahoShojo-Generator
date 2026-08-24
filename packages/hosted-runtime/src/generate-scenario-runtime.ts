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
import { z } from 'zod/v3';

import {
  inferCustomProviderMode,
  resolveCustomProviderRuntime,
  type CustomProviderRuntimeDependencies,
  type CustomProviderRuntimeOptions,
} from './custom-provider-runtime';
import {
  buildScenarioCorePrinciples,
  type GenerationAiTelemetry,
  type StructuredGenerationConfig,
} from './generation-runtime-shared';

export const SCENARIO_GENERATION_ACTION_TYPE = 'scenario_generate' as const;

export const SCENARIO_GENERATION_SCHEMA = z.object({
  title: z.string().describe('情景的标题【必需】。根据用户回答，为这个情景取一个简洁而富有吸引力的标题。'),
  scenario_type: z.string().describe('情景类型【必需】。根据情景的核心内容，为其分类（例如：日常、互动、考试、竞技比赛、调查、采访等）。'),
  description: z.string().describe('情景的简短描述。'),
  elements: z.object({
    scene: z.object({
      time: z.string().optional().describe('故事发生的时间。'),
      place: z.string().optional().describe('故事发生的地点。'),
      features: z.string().optional().describe('环境特征和陈设等。'),
    }).describe('场景描述。如果用户未提供，可留空或注明“未指定”。'),
    roles: z.array(z.object({
      name: z.string().describe('角色名称或身份。'),
      description: z.string().describe('该角色的设定、目标或行为准则。'),
    })).optional().describe('预设的NPC角色信息，可留空。'),
    events: z.string().describe('核心事件描述 (角色需要做什么？会怎么互动？有什么冲突？)。'),
    atmosphere: z.string().describe('故事的情感基调和氛围。'),
    development: z.array(z.string()).describe('故事可能的多个发展方向。'),
  }),
}).describe('一个结构化的情景设定，用于后续故事。');

export type ScenarioGeneratedData = z.infer<typeof SCENARIO_GENERATION_SCHEMA>;

export type GenerateScenarioAiOptions = CustomProviderRuntimeOptions & {
  telemetry: GenerationAiTelemetry;
};

export type NativeScenarioData = ScenarioGeneratedData & {
  metadata: {
    created_at: string;
    signature?: string;
  };
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
): StructuredGenerationConfig<ScenarioGeneratedData, null> => {
  const answers = input.answers as Record<string, string>;
  const fieldsToKeepEmpty = input.fieldsToKeepEmpty as string[];
  return {
    systemPrompt: '你是一位富有想象力的世界观构架师和剧本作家，擅长将零散的想法整合成结构化的故事场景。',
    temperature: 0.7,
    promptBuilder: () => {
      const answerText = Object.entries(answers)
        .filter(([, value]) => value.trim() !== '')
        .map(([key, value]) => `【${key}】\n${value}\n`)
        .join('\n');
      const emptyFieldsInstruction = fieldsToKeepEmpty && fieldsToKeepEmpty.length > 0
        ? `
## 强制留空指令 (CRITICAL INSTRUCTION)
用户已指定以下字段必须留空。在你的JSON输出中：
- 对于类型为 "string" 的字段，你必须返回一个空字符串 ""。
- 对于类型为 "array" 的字段，你必须返回一个空数组 []。
绝对不要为这些字段生成任何内容。
需要留空的字段列表:
${fieldsToKeepEmpty.map((field) => `- ${field}`).join('\n')}
`
        : '';

      return `
你是一个富有想象力的故事场景设计师。你的任务是根据用户提供的几个核心要素，构思并生成一个结构化的、可供后续故事使用的自定义情景（Scenario）文件。

${buildScenarioCorePrinciples(input.language)}

${emptyFieldsInstruction}

## 用户的回答
${answerText}

现在，请开始你的创作。
`;
    },
    schema: SCENARIO_GENERATION_SCHEMA,
    taskName: '生成情景',
    ...(modelOverride ? { modelOverride } : {}),
    ...(generationSettingsContext ? { generationSettingsContext } : {}),
  };
};

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
