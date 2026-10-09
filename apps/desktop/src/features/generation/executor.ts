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
import {
  hostedGenerationBodyMaxBytes,
  type DesktopHostedSystemConfig,
  type DesktopHostedPresetConfig,
  type HostedGenerationRouteId,
  type HostedJsonGenerationRouteId,
} from '@mahoshojo/contracts/desktop-cloud';
import { exceedsUtf8ByteLimit } from '@mahoshojo/domain/data-card-size';
import type { JsonValue } from '@mahoshojo/contracts/json-value';
import type { UserGenerationOverrides } from '@mahoshojo/ai-core/generation-settings';
import { collectAiStreamResult, type AiStreamEvent } from '@mahoshojo/ai-core/stream-events';

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
export type DesktopExecutionMode = 'direct-local' | 'direct-remote' | 'hosted-stream' | 'hosted-json';

export interface DesktopGenerationIntent {
  requestId: string;
  mode: DesktopExecutionMode;
  modelId?: string;
  /**
   * 连接级高级生成设置（D5.0b 统一配置状态）。
   * 逐项覆盖任务默认值。direct 通路下发 temperature/maxOutputTokens（native
   * `AiExecutionRequest` 尚无 thinking 字段，`thinking` 只持久化不下发）；
   * hosted 通路经 `systemConfig.generationOverrides` 携带到服务器解析
   * （D5.1-AIP-r1），语义与 Web `customProvider.generationOverrides` 一致。
   */
  overrides?: UserGenerationOverrides;
}

/**
 * 已校验结果卡数据：结构化 schema 字段 + 服务端透传字段
 * （templateId/userAnswers/signature/metadata 等），或流式 Markdown
 * 构造的通用卡（'general'/'general-scenario' 等流式 kind）。
 */
export interface GenerationResultCardData {
  [key: string]: unknown;
}

type CompletedResult = AiExecutionCompletedResult;

export type DesktopGenerationOutcome<TCardKind extends string = string> =
  | {
      status: 'completed';
      mode: DesktopExecutionMode;
      card: GenerationResultCardData;
      cardKind: TCardKind;
      rawText: string;
      /** hosted SSE `reasoning*` 事件或非流式 `aiMeta.aiReasoning` 的投影。 */
      reasoning?: AIReasoningEnvelope | null;
      /** direct 通路的原始执行结果（usage/finishReason 诊断）。 */
      result?: CompletedResult;
    }
  | { status: 'invalid-output'; mode: DesktopExecutionMode; result?: CompletedResult; rawText: string; message: string }
  | {
      status: 'failed';
      mode: DesktopExecutionMode;
      rawText: string;
      message: string;
      code?: string;
      retryAfterSeconds?: number;
    }
  | { status: 'cancelled'; mode: DesktopExecutionMode; rawText: string; reason?: string }
  | {
      /** 结果无法确认：请求可能已到达服务器（也可能没有），不自动重放。 */
      status: 'uncertain';
      mode: DesktopExecutionMode;
      rawText: string;
      message: string;
    };

/**
 * 生成通路/流协议的包装错误基类：保留已收到的正文供 UI 与草稿恢复使用。
 * 各家族可派生自有错误类（error.name 区分），session 的 rawText 提取走本基类。
 */
export class GenerationTransportError extends Error {
  constructor(readonly rawText: string, cause: unknown, message = '生成连接或流协议失败，已保留收到的正文。') {
    super(message, { cause });
    this.name = 'GenerationTransportError';
  }
}

type StructuredSchema = Parameters<typeof buildStructuredJsonInstructionFromZodSchema>[0];

/** direct 通路的结构化生成配置：与 ai-core 的 `<family>GenerationConfig` 同形。 */
export interface DesktopDirectGenerationConfig<TInput> {
  systemPrompt: string;
  temperature: number;
  promptBuilder(input: TInput): string;
  schema: StructuredSchema;
  taskName: string;
}

export interface GenerationCardProjection<TCardKind extends string> {
  card: GenerationResultCardData;
  cardKind: TCardKind;
}

/**
 * 通用生成家族描述符（D5.1-G2）：通路编排、取消语义、错误投影与草稿
 * 契约对所有生成族一致，家族差异集中在输入校验、结构化配置、
 * 结果卡构造/归一化、hosted 路由与错误包装。
 */
export interface DesktopGenerationFamily<
  TInput,
  TIntent extends DesktopGenerationIntent = DesktopGenerationIntent,
  TCardKind extends string = string,
> {
  /** dispatch 前的输入校验；抛出的 Error.message 如实投影为失败原因。 */
  validateInput?(input: TInput): void;
  /** hosted 流式（SSE）与非流式（JSON）路由标识。 */
  streamRouteId: HostedGenerationRouteId;
  jsonRouteId: HostedJsonGenerationRouteId;
  /** hosted 业务请求体（不含 customProvider 等凭据字段——native 拒绝）。 */
  buildHostedBody(input: TInput): Record<string, JsonValue>;
  /** direct 通路的结构化生成配置（system prompt/schema/temperature/promptBuilder）。 */
  createDirectConfig(intent: TIntent, input: TInput): DesktopDirectGenerationConfig<TInput>;
  /** direct 结构化 data → 结果卡（无签名通路产出）。 */
  buildStructuredCard(data: unknown, input: TInput): GenerationCardProjection<TCardKind>;
  /** hosted SSE Markdown → 结果卡。 */
  buildStreamCard(markdown: string, input: TInput): GenerationCardProjection<TCardKind>;
  /** hosted JSON 响应 `data` → 结果卡（schema 校验 + 透传字段；可携带签名）。 */
  normalizeHostedJsonCard(data: unknown, input: TInput): GenerationCardProjection<TCardKind>;
  /** 通路/协议错误包装：保留已收正文。 */
  createError(rawText: string, cause: unknown): GenerationTransportError;
  /** invalid-output 文案中的卡片名词（'角色卡'/'数据卡'/'情景卡'）。 */
  cardNoun: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const readStringField = (record: Record<string, unknown>, key: string): string | undefined =>
  typeof record[key] === 'string' ? record[key] : undefined;

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/* ── direct 通路 ─────────────────────────────────────────────────────── */

const executeDirectGeneration = async <
  TInput,
  TIntent extends DesktopGenerationIntent,
  TCardKind extends string,
>(
  family: DesktopGenerationFamily<TInput, TIntent, TCardKind>,
  options: DesktopAiExecutionOptions,
  input: TInput,
  intent: TIntent,
  signal: AbortSignal,
  onPartialText?: (text: string) => void,
): Promise<DesktopGenerationOutcome<TCardKind>> => {
  const snapshot = clone(input);
  const config = family.createDirectConfig(intent, snapshot);
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
    const projection = family.buildStructuredCard(data, snapshot);
    return {
      status: 'completed',
      mode: intent.mode,
      result,
      card: projection.card,
      cardKind: projection.cardKind,
      rawText,
    };
  } catch {
    return { status: 'invalid-output', mode: intent.mode, result, rawText, message: `输出未通过${family.cardNoun}校验，原始内容已保留。` };
  }
};

/* ── hosted 通路公共件 ─────────────────────────────────────────────────── */

/** renderer abort → native RequestRegistry 取消（同一 requestId 门禁）。 */
const createHostedCancellation = (invoke: DesktopAiExecutionOptions['invoke'], requestId: string) => {
  let sent = false;
  return () => {
    if (sent) return;
    sent = true;
    void cancelHostedAi(invoke, requestId).catch(() => undefined);
  };
};

/**
 * 「使用系统默认配置」通道的非秘密偏好 → hosted IPC `systemConfig`
 * （D5.1-AIP-r1，与 Web `customProvider:{providerId:'system'}` 同语义）。
 *
 * `intent.modelId` 是系统通道的模型选择（'default' = 服务器默认顺序）；
 * `intent.overrides` 为逐模型生成覆盖。字段均非秘密——native 注入
 * `customProvider` 时固定 `providerId:'system'` + 空 `apiKey`。
 * BYOK 另经 presetConfig，仅传非秘密的可信目录身份。
 *
 * Web 折叠语义：'default' 且无任何生成覆盖时返回 undefined（普通系统
 * 默认），不携带冗余字段。
 */
type HostedProviderConfig = { systemConfig?: DesktopHostedSystemConfig; presetConfig?: DesktopHostedPresetConfig };

const buildHostedSystemConfig = (
  intent: DesktopGenerationIntent,
): DesktopHostedSystemConfig | undefined => {
  const modelId = intent.modelId?.trim() ?? '';
  const overrides = intent.overrides;
  const hasOverrides =
    overrides !== undefined &&
    (overrides.maxOutputTokens !== undefined ||
      overrides.temperature !== undefined ||
      overrides.thinking !== undefined);
  if ((modelId === '' || modelId === 'default') && !hasOverrides) return undefined;
  return {
    ...(modelId === '' ? {} : { modelId }),
    ...(hasOverrides ? { generationOverrides: overrides } : {}),
  };
};

/* ── hosted 流式：Markdown SSE → 流式结果卡（无 resign，DESK-ONLINE-009 延期项） ── */

const executeHostedStreamGeneration = async <
  TInput,
  TIntent extends DesktopGenerationIntent,
  TCardKind extends string,
>(
  family: DesktopGenerationFamily<TInput, TIntent, TCardKind>,
  options: DesktopAiExecutionOptions,
  input: TInput,
  intent: TIntent,
  signal: AbortSignal,
  body: Record<string, JsonValue>,
  providerConfig: HostedProviderConfig,
  onPartialText?: (text: string) => void,
): Promise<DesktopGenerationOutcome<TCardKind>> => {
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
      {
        requestId: intent.requestId,
        routeId: family.streamRouteId,
        body,
        ...providerConfig,
      },
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
  const projection = family.buildStreamCard(markdown, input);
  return {
    status: 'completed',
    mode: intent.mode,
    card: projection.card,
    cardKind: projection.cardKind,
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
  TInput,
  TIntent extends DesktopGenerationIntent,
  TCardKind extends string,
>(
  family: DesktopGenerationFamily<TInput, TIntent, TCardKind>,
  options: DesktopAiExecutionOptions,
  input: TInput,
  intent: TIntent,
  signal: AbortSignal,
  body: Record<string, JsonValue>,
  providerConfig: HostedProviderConfig,
): Promise<DesktopGenerationOutcome<TCardKind>> => {
  const cancel = createHostedCancellation(options.invoke, intent.requestId);
  const onAbort = () => cancel();
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await hostedAiRequest(options.invoke, {
      requestId: intent.requestId,
      routeId: family.jsonRouteId,
      body,
      ...providerConfig,
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
    // 归一化失败（非对象/schema 违例）是「响应已收到但不可信」——
    // 如实投影为 invalid-output，而不是误报为结果不确定（D5.1-G2 收紧）。
    let projection: GenerationCardProjection<TCardKind>;
    try {
      projection = family.normalizeHostedJsonCard(data, input);
    } catch {
      return {
        status: 'invalid-output',
        mode: intent.mode,
        // 保留原始响应正文供导出诊断：native 已将 2xx 正文限在
        // HOSTED_JSON_RESPONSE_MAX_BYTES 内，此序列化天然有界（G2-r1）。
        rawText: JSON.stringify(payload),
        message: `服务器返回的${family.cardNoun}未通过校验。`,
      };
    }
    return {
      status: 'completed',
      mode: intent.mode,
      card: projection.card,
      cardKind: projection.cardKind,
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
        message: `服务器返回的${family.cardNoun}未通过校验。`,
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

/**
 * hosted 请求体的 renderer 侧预算预检：按完整 JSON 正文的 UTF-8 字节数
 * 对比路由配额（与 native `hosted_body_max_bytes` 同一 fixture 来源）。
 * 超限返回用户可读文案；未超限返回 null。
 */
const hostedBodyOversizeMessage = (
  body: Record<string, JsonValue>,
  routeId: HostedGenerationRouteId | HostedJsonGenerationRouteId,
): string | null => {
  const limit = hostedGenerationBodyMaxBytes(routeId);
  if (!exceedsUtf8ByteLimit(JSON.stringify(body), limit)) return null;
  const limitText = limit >= 1024 * 1024 ? `${limit / (1024 * 1024)} MiB` : `${limit / 1024} KiB`;
  return `生成请求体超出当前服务器通路上限（${limitText}），请精简输入后重试。`;
};

/** 单次显式意图：冻结输入，只执行一次；解析修复仅在本地进行。 */
export const executeDesktopGeneration = async <
  TInput,
  TIntent extends DesktopGenerationIntent,
  TCardKind extends string,
>(
  family: DesktopGenerationFamily<TInput, TIntent, TCardKind>,
  options: DesktopAiExecutionOptions,
  input: TInput,
  intent: TIntent,
  signal: AbortSignal,
  onPartialText?: (text: string) => void,
): Promise<DesktopGenerationOutcome<TCardKind>> => {
  // cancelled intent 不 dispatch：下游的 abort listener 只覆盖注册之后的
  // 事件，进入时已经中止的 signal 必须在这里直接结算（D5.1a-r1 复审）。
  if (signal.aborted) {
    return { status: 'cancelled', mode: intent.mode, rawText: '', reason: 'aborted' };
  }
  family.validateInput?.(input);
  if (intent.mode === 'hosted-stream' || intent.mode === 'hosted-json') {
    const routeId = intent.mode === 'hosted-stream' ? family.streamRouteId : family.jsonRouteId;
    const body = family.buildHostedBody(input);
    // 派发前按完整 JSON 正文的 UTF-8 字节数预检：native 在 dispatch 门禁内做
    // 最终检查，这里用同一份路由配额提前如实失败——不让超限请求先过兼容
    // 探测再死在 native 边界（G2-r1）。
    const oversize = hostedBodyOversizeMessage(body, routeId);
    if (oversize !== null) {
      return { status: 'failed', mode: intent.mode, rawText: '', message: oversize, code: 'invalid-request' };
    }
    // 「使用系统默认配置」通道的模型选择/生成覆盖随请求一起过 IPC；
    // 折叠语义与 Web 一致（'default' 且无覆盖 → 不携带字段）。
    const target = options.providerTarget;
    if (target?.kind === 'custom') {
      return { status: 'failed', mode: intent.mode, rawText: '', message: '自定义连接仅支持客户端执行', code: 'invalid-request' };
    }
    const providerConfig: HostedProviderConfig = target?.kind === 'preset'
      ? { presetConfig: {
        providerId: target.providerId,
        modelId: intent.modelId?.trim() ?? '',
        ...(intent.overrides ? { generationOverrides: intent.overrides } : {}),
      } }
      : { systemConfig: buildHostedSystemConfig(intent) };
    return intent.mode === 'hosted-stream'
      ? executeHostedStreamGeneration(family, options, input, intent, signal, body, providerConfig, onPartialText)
      : executeHostedJsonGeneration(family, options, input, intent, signal, body, providerConfig);
  }
  return executeDirectGeneration(family, options, input, intent, signal, onPartialText);
};
