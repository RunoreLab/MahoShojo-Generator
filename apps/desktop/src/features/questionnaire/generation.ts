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
import type {
  HostedGenerationRouteId,
  HostedJsonGenerationRouteId,
} from '@mahoshojo/contracts/desktop-cloud';
import type { JsonValue } from '@mahoshojo/contracts/json-value';
import type { UserGenerationOverrides } from '@mahoshojo/ai-core/generation-settings';
import { collectAiStreamResult, type AiStreamEvent } from '@mahoshojo/ai-core/stream-events';
import {
  compactQuestionnaireAnswerItems,
  type QuestionnaireAnswerItem,
} from '@mahoshojo/domain/questionnaire';
import { buildGeneralCharacterCardFromMarkdown } from '@mahoshojo/domain/markdown-card';
import {
  buildQuestionnaireGenerationRequestBody,
  type QuestionnaireSelection,
} from '@mahoshojo/domain/questionnaire-selection';

import {
  createDesktopAiExecutionPort,
  type DesktopAiExecutionOptions,
} from '../../platform/desktop-ai-execution';
import {
  cancelHostedAi,
  DesktopCloudError,
  hostedAiRequest,
  streamHostedAi,
  type HostedAiChannel,
} from '../../platform/cloud-bridge';

/** Desktop 双执行位置：本机直连（local/remote）与服务器托管（流式/非流式）。 */
export type QuestionnaireExecutionMode = 'direct-local' | 'direct-remote' | 'hosted-stream' | 'hosted-json';

export interface QuestionnaireGenerationIntent {
  requestId: string;
  mode: QuestionnaireExecutionMode;
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

/** hosted 生成请求所需的问卷语义输入；direct 通路忽略。 */
export interface QuestionnaireHostedRequestInput {
  /** 当前选择集；请求字段投影统一走 domain `buildQuestionnaireGenerationRequestBody`。 */
  selections: readonly QuestionnaireSelection[];
  allowNativeSignature: boolean;
}

export interface QuestionnaireGenerationInput {
  answers: QuestionnaireAnswerItem[];
  language: string;
  loreText: string;
  hosted?: QuestionnaireHostedRequestInput;
}

/**
 * 已校验结果卡数据：结构化 schema 字段 + 服务端透传字段
 * （templateId/userAnswers/signature/arena_history 等），或流式 Markdown
 * 构造的通用角色卡（cardKind === 'general'）。
 */
export interface QuestionnaireResultCardData {
  [key: string]: unknown;
}

export type QuestionnaireCardKind<TStructuredKind extends string = string> = TStructuredKind | 'general';

type CompletedResult = AiExecutionCompletedResult;

export type QuestionnaireGenerationOutcome<TStructuredKind extends string = string> =
  | {
      status: 'completed';
      mode: QuestionnaireExecutionMode;
      card: QuestionnaireResultCardData;
      cardKind: QuestionnaireCardKind<TStructuredKind>;
      rawText: string;
      /** hosted SSE `reasoning*` 事件或非流式 `aiMeta.aiReasoning` 的投影。 */
      reasoning?: AIReasoningEnvelope | null;
      /** direct 通路的原始执行结果（usage/finishReason 诊断）。 */
      result?: CompletedResult;
    }
  | { status: 'invalid-output'; mode: QuestionnaireExecutionMode; result?: CompletedResult; rawText: string; message: string }
  | {
      status: 'failed';
      mode: QuestionnaireExecutionMode;
      rawText: string;
      message: string;
      code?: string;
      retryAfterSeconds?: number;
    }
  | { status: 'cancelled'; mode: QuestionnaireExecutionMode; rawText: string; reason?: string }
  | {
      /** 结果无法确认：请求可能已到达服务器（也可能没有），不自动重放。 */
      status: 'uncertain';
      mode: QuestionnaireExecutionMode;
      rawText: string;
      message: string;
    };

/**
 * 生成通路/流协议的包装错误基类：保留已收到的正文供 UI 与草稿恢复使用。
 * 各家族可派生自有错误类（error.name 区分），instanceof 判定走本基类。
 */
export class QuestionnaireGenerationError extends Error {
  constructor(readonly rawText: string, cause: unknown) {
    super('生成连接或流协议失败，已保留收到的正文。', { cause });
    this.name = 'QuestionnaireGenerationError';
  }
}

type StructuredSchema = Parameters<typeof buildStructuredJsonInstructionFromZodSchema>[0];

/** direct 通路的结构化生成配置：与 ai-core 的 `<family>GenerationConfig` 同形。 */
export interface QuestionnaireStructuredConfig {
  systemPrompt: string;
  temperature: number;
  promptBuilder(input: QuestionnaireGenerationInput): string;
  schema: StructuredSchema;
  taskName: string;
}

/**
 * 问卷生成家族描述符（D5.1-G1）：通路编排、取消语义、错误投影与草稿
 * 契约对 `/details` 与 `/canshou` 完全一致，家族差异集中在结构化配置、
 * 结果卡构造/归一化、hosted 路由与默认名。
 */
export interface QuestionnaireGenerationFamily<
  TIntent extends QuestionnaireGenerationIntent = QuestionnaireGenerationIntent,
  TStructuredKind extends string = string,
> {
  /** 结构化结果卡的 kind 标识（direct 与 hosted-json 通路产出）。 */
  structuredCardKind: TStructuredKind;
  /** hosted 流式（SSE）与非流式（JSON）路由标识。 */
  streamRouteId: HostedGenerationRouteId;
  jsonRouteId: HostedJsonGenerationRouteId;
  /** 流式 Markdown → 通用角色卡的默认名；fallbackName 缺省则只用正文标题。 */
  streamCardDefaultName: string;
  streamCardFallbackName?(input: QuestionnaireGenerationInput): string | undefined;
  /** direct 通路的结构化生成配置（system prompt/schema/temperature/promptBuilder）。 */
  createStructuredConfig(intent: TIntent): QuestionnaireStructuredConfig;
  /** 结构化结果 → 未签名结果卡（direct 通路产出）。 */
  buildStructuredCard(data: unknown, answers: readonly QuestionnaireAnswerItem[]): QuestionnaireResultCardData;
  /** hosted JSON 响应 `data` → 结构化结果卡（schema 校验 + 透传字段）。 */
  normalizeStructuredCard(value: unknown): QuestionnaireResultCardData;
  /** 通路/协议错误包装：保留已收正文。 */
  createError(rawText: string, cause: unknown): QuestionnaireGenerationError;
}

/**
 * hosted JSON 响应 `data` → 结构化结果卡的归一化器工厂：
 * schema 校验核心字段，`passthroughKeys` 中的已知透传字段按原样保留。
 */
export const createStructuredCardNormalizer = (
  schema: StructuredSchema,
  passthroughKeys: readonly string[],
): ((value: unknown) => QuestionnaireResultCardData) =>
  (value: unknown): QuestionnaireResultCardData => {
    if (!isRecord(value)) throw new Error('生成结果不是角色卡对象。');
    const parsed = schema.parse(value) as Record<string, unknown>;
    const card: QuestionnaireResultCardData = { ...parsed };
    for (const key of passthroughKeys) {
      if (value[key] !== undefined) card[key] = value[key];
    }
    return card;
  };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const readStringField = (record: Record<string, unknown>, key: string): string | undefined =>
  typeof record[key] === 'string' ? record[key] : undefined;

/* ── direct 通路 ─────────────────────────────────────────────────────── */

const executeDirectGeneration = async <
  TIntent extends QuestionnaireGenerationIntent,
  TStructuredKind extends string,
>(
  family: QuestionnaireGenerationFamily<TIntent, TStructuredKind>,
  options: DesktopAiExecutionOptions,
  input: QuestionnaireGenerationInput,
  intent: TIntent,
  signal: AbortSignal,
  onPartialText?: (text: string) => void,
): Promise<QuestionnaireGenerationOutcome<TStructuredKind>> => {
  const snapshot = { ...input, answers: input.answers.map((answer) => ({ ...answer })) };
  const config = family.createStructuredConfig(intent);
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
    throw family.createError(partialText, cause);
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
      card: family.buildStructuredCard(data, snapshot.answers),
      cardKind: family.structuredCardKind,
      rawText,
    };
  } catch {
    return { status: 'invalid-output', mode: intent.mode, result, rawText, message: '输出未通过角色卡校验，原始内容已保留。' };
  }
};

/* ── hosted 通路公共件 ─────────────────────────────────────────────────── */

const buildHostedBody = (input: QuestionnaireGenerationInput): Record<string, JsonValue> => {
  if (!input.hosted) {
    throw new Error('服务器执行需要问卷请求字段。');
  }
  // 业务请求体与 Web 各问卷页共用同一组装器（D5.1a-r1 对拍基准）；
  // Desktop 宿主无 customProvider 等附加字段。
  return buildQuestionnaireGenerationRequestBody({
    answers: input.answers,
    selections: input.hosted.selections,
    allowNativeSignature: input.hosted.allowNativeSignature,
    language: input.language,
  }) as unknown as Record<string, JsonValue>;
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

const executeHostedStreamGeneration = async <
  TIntent extends QuestionnaireGenerationIntent,
  TStructuredKind extends string,
>(
  family: QuestionnaireGenerationFamily<TIntent, TStructuredKind>,
  options: DesktopAiExecutionOptions,
  input: QuestionnaireGenerationInput,
  intent: TIntent,
  signal: AbortSignal,
  onPartialText?: (text: string) => void,
): Promise<QuestionnaireGenerationOutcome<TStructuredKind>> => {
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
      { requestId: intent.requestId, routeId: family.streamRouteId, body },
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
    throw family.createError(markdown, acc.pumpError);
  }
  if (acc.terminal?.kind === 'error') {
    return { status: 'failed', mode: intent.mode, rawText: markdown, message: acc.terminal.message, code: acc.terminal.code };
  }
  if (acc.terminal?.kind !== 'done') {
    return { status: 'failed', mode: intent.mode, rawText: markdown, message: '生成流未产生终态事件。' };
  }
  const { card } = buildGeneralCharacterCardFromMarkdown({
    markdown,
    fallbackName: family.streamCardFallbackName?.(input),
    defaultName: family.streamCardDefaultName,
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

/* ── hosted 非流式：JSON 响应 → 家族结构化卡（可带服务端签名） ────────── */

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

/**
 * dispatch 前错误码：`hosted_ai_request` 中只有这些失败可证明发生在生成
 * 请求上线路之前——`prepare_hosted_dispatch`（路由/requestId/body 校验、
 * 凭据装载、DESK-094 契约探测）与 requestId 注册。可以诚实按普通
 * failed/cancelled 处理——服务器绝不可能执行过这次生成。
 *
 * `internal-error` 不在此列：`toCloudError` 把一切无法识别的 IPC/invoke
 * 失败（含未来版本 native 返回的未知 structured code）归一为它，拿到它
 * 只能说明「不知道 native 执行到了哪一步」，不能当作未 dispatch 的证据。
 * 同理，不属于本命令阶段词汇的错误码（not-authenticated/state-mismatch/
 * flow-not-found/flow-in-progress 等登录流程码）不登记为「已证明未
 * dispatch」——真出现时也按不可信处理。
 *
 * 其余错误（`cancelled`：native select 取消时 send 可能已在飞行中；
 * `network-error`：含 reqwest 超时；`invalid-response`/`bridge-invalid`：
 * 已收到响应但无法信任；未知 invoke 异常）都无法确认服务器是否已执行，
 * 一律投影为 `uncertain`——不声称干净取消，也不自动重放。
 */
const HOSTED_JSON_PRE_DISPATCH_CODES: ReadonlySet<DesktopCloudError['code']> = new Set([
  'invalid-request',
  'protocol-mismatch',
  'server-unavailable',
  'storage-unavailable',
]);

const HOSTED_JSON_UNCERTAIN_MESSAGE =
  '无法确认这次生成是否在服务器执行——请求可能已发送。不会自动重试；再次生成会发起新请求，可能产生重复调用与费用。';

const executeHostedJsonGeneration = async <
  TIntent extends QuestionnaireGenerationIntent,
  TStructuredKind extends string,
>(
  family: QuestionnaireGenerationFamily<TIntent, TStructuredKind>,
  options: DesktopAiExecutionOptions,
  input: QuestionnaireGenerationInput,
  intent: TIntent,
  signal: AbortSignal,
): Promise<QuestionnaireGenerationOutcome<TStructuredKind>> => {
  const body = buildHostedBody(input);
  const cancel = createHostedCancellation(options.invoke, intent.requestId);
  const onAbort = () => cancel();
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await hostedAiRequest(options.invoke, {
      requestId: intent.requestId,
      routeId: family.jsonRouteId,
      body,
    });
    if (signal.aborted) {
      // 响应已返回但用户已要求取消：请求肯定到达过服务器，不能声称干净取消。
      return { status: 'uncertain', mode: intent.mode, rawText: '', message: HOSTED_JSON_UNCERTAIN_MESSAGE };
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
    const card = family.normalizeStructuredCard(data);
    return {
      status: 'completed',
      mode: intent.mode,
      card,
      cardKind: family.structuredCardKind,
      rawText: JSON.stringify(data),
      reasoning,
    };
  } catch (cause) {
    // 请求体 schema 校验与 structured-json 解析在 renderer 侧抛出（前者 dispatch 前，
    // 后者是已确认响应），都属于「结果已知」而非「结果不确定」。
    if (cause instanceof SyntaxError || (cause instanceof Error && cause.name === 'ZodError')) {
      return {
        status: 'invalid-output',
        mode: intent.mode,
        rawText: '',
        message: '服务器返回的角色卡未通过校验。',
      };
    }
    const cloudCode = cause instanceof DesktopCloudError ? cause.code : null;
    if (cloudCode !== null && HOSTED_JSON_PRE_DISPATCH_CODES.has(cloudCode)) {
      if (signal.aborted) {
        return { status: 'cancelled', mode: intent.mode, rawText: '', reason: 'aborted' };
      }
      return {
        status: 'failed',
        mode: intent.mode,
        rawText: '',
        message: cause instanceof Error ? cause.message : '生成失败。',
        code: cloudCode,
      };
    }
    // cancelled / network-error / timeout / invalid-response / bridge-invalid / 未知异常：
    // 服务器是否已执行无从确认——诚实投影为 uncertain，由用户显式决定是否再试。
    return { status: 'uncertain', mode: intent.mode, rawText: '', message: HOSTED_JSON_UNCERTAIN_MESSAGE };
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
};

/** 单次显式意图：冻结输入，只执行一次；解析修复仅在本地进行。 */
export const executeQuestionnaireGeneration = async <
  TIntent extends QuestionnaireGenerationIntent,
  TStructuredKind extends string,
>(
  family: QuestionnaireGenerationFamily<TIntent, TStructuredKind>,
  options: DesktopAiExecutionOptions,
  input: QuestionnaireGenerationInput,
  intent: TIntent,
  signal: AbortSignal,
  onPartialText?: (text: string) => void,
): Promise<QuestionnaireGenerationOutcome<TStructuredKind>> => {
  // cancelled intent 不 dispatch：下游的 abort listener 只覆盖注册之后的
  // 事件，进入时已经中止的 signal 必须在这里直接结算（D5.1a-r1 复审）。
  if (signal.aborted) {
    return { status: 'cancelled', mode: intent.mode, rawText: '', reason: 'aborted' };
  }
  if (input.answers.length === 0) throw new Error('请先填写问卷。');
  if (intent.mode === 'hosted-stream') {
    return executeHostedStreamGeneration(family, options, input, intent, signal, onPartialText);
  }
  if (intent.mode === 'hosted-json') {
    return executeHostedJsonGeneration(family, options, input, intent, signal);
  }
  return executeDirectGeneration(family, options, input, intent, signal, onPartialText);
};
