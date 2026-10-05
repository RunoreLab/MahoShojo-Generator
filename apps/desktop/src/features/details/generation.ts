import {
  buildUnsignedMagicalGirlDetailsCard,
  createMagicalGirlDetailsGenerationConfig,
  MAGICAL_GIRL_DETAILS_SCHEMA,
  type MagicalGirlDetailsGeneratedData,
  type MagicalGirlDetailsGenerationInput,
} from '@mahoshojo/ai-core/magical-girl-details-generation';
import {
  buildStructuredJsonInstructionFromZodSchema,
  parseStructuredJsonWithSchema,
} from '@mahoshojo/ai-core/structured-json';
import type {
  AiExecutionCompletedResult,
  AiExecutionRequest,
  AiExecutionResult,
} from '@mahoshojo/contracts/ai-execution';
import type { AIReasoningEnvelope } from '@mahoshojo/contracts/ai-reasoning';
import type { JsonValue } from '@mahoshojo/contracts/json-value';
import type { UserGenerationOverrides } from '@mahoshojo/ai-core/generation-settings';
import { collectAiStreamResult, type AiStreamEvent } from '@mahoshojo/ai-core/stream-events';
import { compactQuestionnaireAnswerItems } from '@mahoshojo/domain/questionnaire';
import { buildGeneralCharacterCardFromMarkdown } from '@mahoshojo/domain/markdown-card';
import type { QuestionnaireGenerationRequestFields } from '@mahoshojo/domain/questionnaire-selection';

import {
  createDesktopAiExecutionPort,
  type DesktopAiExecutionOptions,
} from '../../platform/desktop-ai-execution';
import {
  cancelHostedAi,
  hostedAiRequest,
  streamHostedAi,
  type HostedAiChannel,
} from '../../platform/cloud-bridge';

export type DetailsExecutionMode = 'direct-local' | 'direct-remote' | 'hosted-stream' | 'hosted-json';

export interface DetailsGenerationIntent {
  requestId: string;
  mode: DetailsExecutionMode;
  flowers: string;
  modelId?: string;
  /**
   * 连接级高级生成设置（D5.0b 统一配置状态）。
   * 逐项覆盖任务默认值。`thinking` 可持久化但当前不下发：native
   * `AiExecutionRequest` 标了 `deny_unknown_fields` 且尚无 thinking 字段，
   * 携带会让整次请求反序列化失败。hosted 通路的生成设置在服务器侧解析，
   * 本字段只对 direct 通路生效。
   */
  overrides?: UserGenerationOverrides;
}

/** hosted 生成请求所需的问卷投影；direct 通路忽略。 */
export interface DetailsHostedRequestInput {
  fields: QuestionnaireGenerationRequestFields;
  allowNativeSignature: boolean;
}

export interface DetailsGenerationInput extends MagicalGirlDetailsGenerationInput {
  hosted?: DetailsHostedRequestInput;
}

export type DetailsResultCardKind = 'magical-girl' | 'general';

/**
 * 已校验结果卡数据。
 * - `magical-girl`：`MAGICAL_GIRL_DETAILS_SCHEMA` 字段 + 服务端透传字段
 *   （templateId/userAnswers/signature/arena_history 等）；
 * - `general`：流式 Markdown 构造的通用角色卡。
 */
export interface DetailsResultCardData {
  [key: string]: unknown;
}

type CompletedResult = AiExecutionCompletedResult;

export type DetailsGenerationOutcome =
  | {
      status: 'completed';
      mode: DetailsExecutionMode;
      card: DetailsResultCardData;
      cardKind: DetailsResultCardKind;
      rawText: string;
      /** hosted SSE `reasoning*` 事件或非流式 `aiMeta.aiReasoning` 的投影。 */
      reasoning?: AIReasoningEnvelope | null;
      /** direct 通路的原始执行结果（usage/finishReason 诊断）。 */
      result?: CompletedResult;
    }
  | { status: 'invalid-output'; mode: DetailsExecutionMode; result?: CompletedResult; rawText: string; message: string }
  | {
      status: 'failed';
      mode: DetailsExecutionMode;
      rawText: string;
      message: string;
      code?: string;
      retryAfterSeconds?: number;
    }
  | { status: 'cancelled'; mode: DetailsExecutionMode; rawText: string; reason?: string };

export class DetailsGenerationError extends Error {
  constructor(readonly rawText: string, cause: unknown) {
    super('生成连接或流协议失败，已保留收到的正文。', { cause });
    this.name = 'DetailsGenerationError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const readStringField = (record: Record<string, unknown>, key: string): string | undefined =>
  typeof record[key] === 'string' ? record[key] : undefined;

/* ── direct 通路（既有实现，未变） ─────────────────────────────────────── */

const executeDirectGeneration = async (
  options: DesktopAiExecutionOptions,
  input: DetailsGenerationInput,
  intent: DetailsGenerationIntent,
  signal: AbortSignal,
  onPartialText?: (text: string) => void,
): Promise<DetailsGenerationOutcome> => {
  const snapshot = { ...input, answers: input.answers.map((answer) => ({ ...answer })) };
  const config = createMagicalGirlDetailsGenerationConfig(() => intent.flowers);
  // 本函数只服务 direct 两通路；hosted 在入口处分流，这里把 mode 收窄回 contract 枚举。
  const directMode = intent.mode === 'direct-remote' ? 'direct-remote' : 'direct-local';
  const request: AiExecutionRequest = {
    requestId: intent.requestId,
    contractVersion: 1,
    mode: directMode,
    ...(intent.modelId === undefined ? {} : { modelId: intent.modelId }),
    messages: [
      { role: 'system', content: `${config.systemPrompt}\n\n${buildStructuredJsonInstructionFromZodSchema(config.schema)}` },
      { role: 'user', content: config.promptBuilder(snapshot) },
    ],
    temperature: intent.overrides?.temperature ?? config.temperature,
    ...(intent.overrides?.maxOutputTokens !== undefined
      ? { maxOutputTokens: intent.overrides.maxOutputTokens }
      : {}),
    // schema 指令与解析复用 Hosted 的 text JSON 路径，无二次 Provider 修复或自动回退。
    responseFormat: 'text',
  };
  let partialText = '';
  const port = createDesktopAiExecutionPort(options);
  const source = async function* (): AsyncGenerator<AiStreamEvent> {
    for await (const event of port.stream(request, signal)) {
      yield event;
      // collectAiStreamResult 接受该事件（身份、顺序及资源上限）后才保留正文。
      if (event.type === 'text-delta') {
        partialText += event.delta;
        onPartialText?.(partialText);
      }
    }
  };
  let result: AiExecutionResult;
  try {
    result = await collectAiStreamResult(request, source());
  } catch (cause) {
    if (signal.aborted) {
      return { status: 'cancelled', mode: intent.mode, reason: 'aborted', rawText: partialText };
    }
    throw new DetailsGenerationError(partialText, cause);
  }
  if (signal.aborted) {
    return { status: 'cancelled', mode: intent.mode, reason: 'aborted', rawText: partialText };
  }
  if (result.status === 'cancelled') {
    return { status: 'cancelled', mode: intent.mode, rawText: partialText, reason: result.reason };
  }
  if (result.status === 'failed') {
    return {
      status: 'failed',
      mode: intent.mode,
      rawText: partialText,
      message: result.error.message ?? '生成失败，已保留收到的正文。',
      code: result.error.code,
      ...(result.error.retryAfterMs !== undefined
        ? { retryAfterSeconds: Math.max(1, Math.ceil(result.error.retryAfterMs / 1000)) }
        : {}),
    };
  }
  const rawText = result.output.text ?? partialText;
  if (result.finishReason !== 'stop') {
    return { status: 'invalid-output', mode: intent.mode, result, rawText, message: '生成未正常结束，请保留原始输出后重试。' };
  }
  try {
    const { data } = parseStructuredJsonWithSchema(rawText, config.schema, { taskName: config.taskName });
    return {
      status: 'completed',
      mode: intent.mode,
      result,
      card: buildUnsignedMagicalGirlDetailsCard(data, snapshot.answers),
      cardKind: 'magical-girl',
      rawText,
    };
  } catch {
    return { status: 'invalid-output', mode: intent.mode, result, rawText, message: '输出未通过角色卡校验，原始内容已保留。' };
  }
};

/* ── hosted 通路公共件 ─────────────────────────────────────────────────── */

const buildHostedBody = (input: DetailsGenerationInput): Record<string, JsonValue> => {
  if (!input.hosted) {
    throw new Error('服务器执行需要问卷请求字段。');
  }
  return {
    answers: input.answers as unknown as JsonValue,
    ...input.hosted.fields,
    allowNativeSignature: input.hosted.allowNativeSignature === true,
    language: input.language,
  } as unknown as Record<string, JsonValue>;
};

/** renderer abort → native RequestRegistry 取消（同一 requestId 门禁）。 */
const createHostedCancellation = (invoke: DesktopAiExecutionOptions['invoke'], requestId: string) => {
  let sent = false;
  return () => {
    if (sent) return;
    sent = true;
    void cancelHostedAi(invoke, requestId).catch(() => undefined);
  };
};

/* ── hosted 流式：Markdown SSE → 通用角色卡（无 resign，DESK-ONLINE-009 延期项） ── */

const executeHostedStreamGeneration = async (
  options: DesktopAiExecutionOptions,
  input: DetailsGenerationInput,
  intent: DetailsGenerationIntent,
  signal: AbortSignal,
  onPartialText?: (text: string) => void,
): Promise<DetailsGenerationOutcome> => {
  const body = buildHostedBody(input);
  let markdown = '';
  let reasoningText = '';
  let reasoningDone: 'done' | 'unavailable' | null = null;
  type Terminal = { kind: 'done' } | { kind: 'error'; message: string; code?: string };
  // 终态事件在回调闭包里写入：用对象属性避开 TS 对 let 变量的跨闭包收窄。
  const acc: { terminal: Terminal | null; pumpError: unknown } = { terminal: null, pumpError: undefined };
  const cancel = createHostedCancellation(options.invoke, intent.requestId);
  const onAbort = () => cancel();
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    await streamHostedAi(
      options.invoke,
      { requestId: intent.requestId, routeId: 'generate-magical-girl-details-stream', body },
      (event) => {
        if (!isRecord(event.data)) return;
        const data = event.data;
        if (event.event === 'markdown') {
          const chunk = readStringField(data, 'chunk') ?? '';
          if (chunk) {
            markdown += chunk;
            onPartialText?.(markdown);
          }
        } else if (event.event === 'reasoning') {
          reasoningText += readStringField(data, 'chunk') ?? '';
        } else if (event.event === 'reasoning_done') {
          const status = readStringField(data, 'status');
          reasoningDone = status === 'unavailable' ? 'unavailable' : 'done';
        } else if (event.event === 'done') {
          acc.terminal = { kind: 'done' };
        } else if (event.event === 'error') {
          acc.terminal = {
            kind: 'error',
            message: readStringField(data, 'message') ?? readStringField(data, 'error') ?? '生成失败',
            code: readStringField(data, 'code'),
          };
        }
      },
      // 与 direct 同型 `{onmessage}`：测试经同一工厂注入替身 Channel。
      { createChannel: options.createChannel as (() => HostedAiChannel) | undefined },
    );
  } catch (cause) {
    acc.pumpError = cause;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }

  const reasoning: AIReasoningEnvelope | null = reasoningDone === null && !reasoningText
    ? null
    : {
        status: reasoningDone ?? 'thinking',
        source: 'sdk',
        text: reasoningText || null,
      };

  if (signal.aborted || (acc.terminal?.kind === 'error' && acc.terminal.code === 'cancelled')) {
    return { status: 'cancelled', mode: intent.mode, rawText: markdown, reason: 'aborted' };
  }
  if (acc.pumpError !== undefined) {
    throw new DetailsGenerationError(markdown, acc.pumpError);
  }
  if (acc.terminal?.kind === 'error') {
    return { status: 'failed', mode: intent.mode, rawText: markdown, message: acc.terminal.message, code: acc.terminal.code };
  }
  if (acc.terminal?.kind !== 'done') {
    return { status: 'failed', mode: intent.mode, rawText: markdown, message: '生成流未产生终态事件。' };
  }
  const fallbackName = input.answers[0]?.answer ?? '';
  const { card } = buildGeneralCharacterCardFromMarkdown({
    markdown,
    fallbackName,
    defaultName: '魔法少女',
  });
  return {
    status: 'completed',
    mode: intent.mode,
    card: { ...card, userAnswers: compactQuestionnaireAnswerItems(input.answers) },
    cardKind: 'general',
    rawText: markdown,
    reasoning,
  };
};

/* ── hosted 非流式：JSON 响应 → 魔法少女结构化卡（可带服务端签名） ────────── */

/** `x-mahoshojo-ai-meta: 1` 包装：`{data, aiMeta}`；无包装时正文即 data。 */
const unwrapAiMetaPayload = (payload: unknown): { data: unknown; reasoning: AIReasoningEnvelope | null } => {
  if (!isRecord(payload) || !('data' in payload) || !('aiMeta' in payload)) {
    return { data: payload, reasoning: null };
  }
  const aiMeta = payload.aiMeta;
  const reasoning = isRecord(aiMeta) && isRecord(aiMeta.aiReasoning)
    ? (aiMeta.aiReasoning as unknown as AIReasoningEnvelope)
    : null;
  return { data: payload.data, reasoning };
};

const HOSTED_CARD_PASSTHROUGH_KEYS = [
  'templateId',
  'userAnswers',
  'signature',
  'arena_history',
  'current_state',
  'creationInputs',
  'buildState',
] as const;

/** 服务端 `data` → 结构化卡：schema 校验核心字段，已知透传字段按原样保留。 */
export const normalizeMagicalGirlDetailsResultCard = (value: unknown): DetailsResultCardData => {
  if (!isRecord(value)) throw new Error('生成结果不是角色卡对象。');
  const parsed = MAGICAL_GIRL_DETAILS_SCHEMA.parse(value) as MagicalGirlDetailsGeneratedData;
  const card: DetailsResultCardData = { ...parsed };
  for (const key of HOSTED_CARD_PASSTHROUGH_KEYS) {
    if (value[key] !== undefined) card[key] = value[key];
  }
  return card;
};

const readRetryAfterSeconds = (payload: unknown, status: number): number | undefined => {
  if (status !== 429 || !isRecord(payload)) return undefined;
  const raw = payload.retryAfterSeconds ?? payload.retryAfter;
  const seconds = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : undefined;
};

const readErrorMessage = (payload: unknown, status: number): string => {
  if (isRecord(payload)) {
    const direct = readStringField(payload, 'error') ?? readStringField(payload, 'message');
    if (direct?.trim()) return direct;
  }
  return status >= 500 ? '服务器内部错误' : '生成失败';
};

const executeHostedJsonGeneration = async (
  options: DesktopAiExecutionOptions,
  input: DetailsGenerationInput,
  intent: DetailsGenerationIntent,
  signal: AbortSignal,
): Promise<DetailsGenerationOutcome> => {
  const body = buildHostedBody(input);
  const cancel = createHostedCancellation(options.invoke, intent.requestId);
  const onAbort = () => cancel();
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await hostedAiRequest(options.invoke, {
      requestId: intent.requestId,
      routeId: 'generate-magical-girl-details',
      body,
    });
    if (signal.aborted) {
      return { status: 'cancelled', mode: intent.mode, rawText: '', reason: 'aborted' };
    }
    const { status, body: payload } = response;
    if (status < 200 || status >= 300) {
      return {
        status: 'failed',
        mode: intent.mode,
        rawText: '',
        message: readErrorMessage(payload, status),
        retryAfterSeconds: readRetryAfterSeconds(payload, status),
      };
    }
    const { data, reasoning } = unwrapAiMetaPayload(payload);
    const card = normalizeMagicalGirlDetailsResultCard(data);
    return {
      status: 'completed',
      mode: intent.mode,
      card,
      cardKind: 'magical-girl',
      rawText: JSON.stringify(data),
      reasoning,
    };
  } catch (cause) {
    if (signal.aborted) {
      return { status: 'cancelled', mode: intent.mode, rawText: '', reason: 'aborted' };
    }
    if (cause instanceof SyntaxError || (cause instanceof Error && cause.name === 'ZodError')) {
      return {
        status: 'invalid-output',
        mode: intent.mode,
        rawText: '',
        message: '服务器返回的角色卡未通过校验。',
      };
    }
    throw new DetailsGenerationError('', cause);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
};

/** 单次显式意图：冻结输入，只执行一次；解析修复仅在本地进行。 */
export const executeDetailsGeneration = async (
  options: DesktopAiExecutionOptions,
  input: DetailsGenerationInput,
  intent: DetailsGenerationIntent,
  signal: AbortSignal,
  onPartialText?: (text: string) => void,
): Promise<DetailsGenerationOutcome> => {
  if (input.answers.length === 0) throw new Error('请先填写问卷。');
  if (intent.mode === 'hosted-stream') {
    return executeHostedStreamGeneration(options, input, intent, signal, onPartialText);
  }
  if (intent.mode === 'hosted-json') {
    return executeHostedJsonGeneration(options, input, intent, signal);
  }
  return executeDirectGeneration(options, input, intent, signal, onPartialText);
};
