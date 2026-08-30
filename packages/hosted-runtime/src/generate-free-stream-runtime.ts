import {
  createGenerateFreeStreamService,
  type FreeTextAttachment,
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
  formatReferenceAttachmentsForPrompt,
  type GenerationAiTelemetry,
  type RawGenerationConfig,
  type ReasoningSseBridge,
  type StreamAiOptions,
  type StreamGenerationResult,
} from './generation-runtime-shared';

const buildStreamPrompt = (
  schemaId: GenerateFreeStreamInput['schema'],
  language: string,
  userPrompt: string,
  attachments: FreeTextAttachment[],
): string => {
  const attachmentsSection = formatReferenceAttachmentsForPrompt(attachments);
  if (schemaId === 'general') {
    return `
你将根据【用户提示词】生成一份【通用角色卡】的正文内容。

输出要求：
1) 必须使用【${language}】创作。
2) 必须直接输出 Markdown 正文，不要输出任何解释。
3) 第 1 行必须是一级标题（以 "# " 开头），写角色名或代号，不超过 30 字。
4) 在开头 20 行内，尽量给出明确字段（若无法推断可写“未指定”）：
   - 代号：...
   - 名字：...
5) 正文建议包含：外观、性格、能力与限制、背景与动机、关系与羁绊、战斗风格、常用台词/行为准则（可选）。

${attachmentsSection}

【用户提示词】
${userPrompt}
`.trim();
  }

  return `
你将根据【用户提示词】生成一份【通用情景卡】的正文内容。

输出要求：
1) 必须使用【${language}】创作。
2) 必须直接输出 Markdown 正文，不要输出任何解释。
3) 第 1 行必须是一级标题（以 "# " 开头），写情景标题，不超过 30 字。
4) 在开头 20 行内，尽量给出明确字段（若无法推断可写“未指定”）：
   - 标题：...
5) 正文建议包含：场景概览、时间、地点、环境特征、预设 NPC（可选）、核心事件、整体氛围、发展方向（多条）。

${attachmentsSection}

【用户提示词】
${userPrompt}
`.trim();
};

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
          prompt: buildStreamPrompt(
            input.schema,
            input.language,
            input.prompt,
            input.attachments,
          ),
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
