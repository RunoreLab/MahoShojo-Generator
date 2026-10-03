import {
  buildUnsignedMagicalGirlDetailsCard,
  createMagicalGirlDetailsGenerationConfig,
  type MagicalGirlDetailsGenerationInput,
} from '@mahoshojo/ai-core/magical-girl-details-generation';
import {
  buildStructuredJsonInstructionFromZodSchema,
  parseStructuredJsonWithSchema,
} from '@mahoshojo/ai-core/structured-json';
import type { AiExecutionRequest, AiExecutionResult } from '@mahoshojo/contracts/ai-execution';
import { collectAiStreamResult, type AiStreamEvent } from '@mahoshojo/ai-core/stream-events';

import {
  createDesktopAiExecutionPort,
  type DesktopAiExecutionOptions,
} from '../../platform/desktop-ai-execution';

export interface DetailsGenerationIntent {
  requestId: string;
  mode: 'direct-local' | 'direct-remote';
  flowers: string;
  modelId?: string;
}

type CompletedResult = Extract<AiExecutionResult, { status: 'completed' }>;
export type DetailsGenerationOutcome =
  | (Exclude<AiExecutionResult, CompletedResult> & { rawText: string })
  | { status: 'completed'; result: CompletedResult; card: ReturnType<typeof buildUnsignedMagicalGirlDetailsCard> }
  | { status: 'invalid-output'; result: CompletedResult; rawText: string; message: string };

export class DetailsGenerationError extends Error {
  constructor(readonly rawText: string, cause: unknown) {
    super('生成连接或流协议失败，已保留收到的正文。', { cause });
    this.name = 'DetailsGenerationError';
  }
}

/** 单次显式意图：冻结输入，只执行一次 Direct；解析修复仅在本地进行。 */
export const executeDetailsGeneration = async (
  options: DesktopAiExecutionOptions,
  input: MagicalGirlDetailsGenerationInput,
  intent: DetailsGenerationIntent,
  signal: AbortSignal,
): Promise<DetailsGenerationOutcome> => {
  if (input.answers.length === 0) throw new Error('请先填写问卷。');
  if (intent.mode !== 'direct-local' && intent.mode !== 'direct-remote') {
    throw new Error('问卷生成仅支持 Direct 模式。');
  }
  const snapshot = { ...input, answers: input.answers.map((answer) => ({ ...answer })) };
  const config = createMagicalGirlDetailsGenerationConfig(() => intent.flowers);
  const request: AiExecutionRequest = {
    requestId: intent.requestId,
    contractVersion: 1,
    mode: intent.mode,
    ...(intent.modelId === undefined ? {} : { modelId: intent.modelId }),
    messages: [
      { role: 'system', content: `${config.systemPrompt}\n\n${buildStructuredJsonInstructionFromZodSchema(config.schema)}` },
      { role: 'user', content: config.promptBuilder(snapshot) },
    ],
    temperature: config.temperature,
    // schema 指令与解析复用 Hosted 的 text JSON 路径，无二次 Provider 修复或自动回退。
    responseFormat: 'text',
  };
  let partialText = '';
  const port = createDesktopAiExecutionPort(options);
  const source = async function* (): AsyncGenerator<AiStreamEvent> {
    for await (const event of port.stream(request, signal)) {
      yield event;
      // collectAiStreamResult 接受该事件（身份、顺序及资源上限）后才保留正文。
      if (event.type === 'text-delta') partialText += event.delta;
    }
  };
  let result: AiExecutionResult;
  try {
    result = await collectAiStreamResult(request, source());
  } catch (cause) {
    if (signal.aborted) {
      return { status: 'cancelled', requestId: request.requestId, contractVersion: 1, mode: request.mode, reason: 'aborted', rawText: partialText };
    }
    throw new DetailsGenerationError(partialText, cause);
  }
  if (signal.aborted) {
    return { status: 'cancelled', requestId: request.requestId, contractVersion: 1, mode: request.mode, reason: 'aborted', rawText: partialText };
  }
  if (result.status !== 'completed') return { ...result, rawText: partialText };
  const rawText = result.output.text ?? partialText;
  if (result.finishReason !== 'stop') {
    return { status: 'invalid-output', result, rawText, message: '生成未正常结束，请保留原始输出后重试。' };
  }
  try {
    const { data } = parseStructuredJsonWithSchema(rawText, config.schema, { taskName: config.taskName });
    return { status: 'completed', result, card: buildUnsignedMagicalGirlDetailsCard(data, snapshot.answers) };
  } catch {
    return { status: 'invalid-output', result, rawText, message: '输出未通过角色卡校验，原始内容已保留。' };
  }
};
