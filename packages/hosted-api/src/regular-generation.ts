import { z } from 'zod/v3';

export const MAX_CUSTOM_PROVIDER_OUTPUT_TOKENS = 1_000_000;
export const HOSTED_GENERATION_INTERNAL_MESSAGE = '服务器内部错误';
export const HOSTED_GENERATION_ERROR_CODE = 'HOSTED_GENERATION_FAILED';

export const PUBLIC_AI_ERROR_CODES = Object.freeze([
  'AI_UPSTREAM_REQUEST_FAILED',
  'AI_UPSTREAM_TIMEOUT',
  'AI_REQUEST_ABORTED',
  'AI_PROVIDER_REDIRECT_BLOCKED',
  'THINKING_DISABLED_REASONING_ONLY',
  'AI_OUTPUT_TRUNCATED',
  'AI_OUTPUT_FILTERED',
  'AI_STREAM_INCOMPLETE',
  'ARENA_WEB_PACKAGE_OUTPUT_INVALID',
  'ARENA_WEB_PACKAGE_TARGET_INVALID',
  'ARENA_WEB_PACKAGE_TARGET_MALFORMED',
  'ARENA_WEB_PACKAGE_TARGET_SCHEMA',
] as const);

export type PublicAiErrorCode = typeof PUBLIC_AI_ERROR_CODES[number];

/**
 * Output-contract failures the user can act on. They carry no model output, no
 * validation detail and no provider data: only what happened and what to do, so
 * a code that reaches the client always explains itself.
 */
const PUBLIC_AI_ERROR_MESSAGES: Readonly<Partial<Record<PublicAiErrorCode, string>>> = Object.freeze({
  AI_OUTPUT_TRUNCATED: '生成达到输出上限，正文未完整完成。已保留收到的内容，请调整生成设置后手动重试。',
  AI_OUTPUT_FILTERED: '上游内容过滤终止了生成，当前内容不构成完整战报。',
  AI_STREAM_INCOMPLETE: '未收到可靠的正常结束信号，无法确认战报完整性。已保留收到的内容，不会自动重新生成。',
  ARENA_WEB_PACKAGE_OUTPUT_INVALID:
    'Web 包输出缺少可解析的 Arena 战报元数据结尾，无法确认本次结果完整。收到的内容已按纯文本保留，可在下方查看后重试。',
  ARENA_WEB_PACKAGE_TARGET_INVALID:
    'AI 生成的 Web 包目标文件未通过格式或 schema 校验，本次结果不会应用到 Web 包。收到的内容已按纯文本保留，可在下方查看后重试。',
  ARENA_WEB_PACKAGE_TARGET_MALFORMED:
    'AI 没有按 Web 包要求的形态输出目标文件（宿主已尝试剥离 Markdown 代码围栏与前导路径行，仍不是可直接解析的 JSON）。'
    + '收到的内容已按纯文本保留，可在下方查看：若模型输出的是一段散文，说明该包的创作指引不足。',
  ARENA_WEB_PACKAGE_TARGET_SCHEMA:
    'AI 输出的目标是合法 JSON，但不符合这个 Web 包声明的数据结构，本次结果不会应用到 Web 包。'
    + '收到的内容已按纯文本保留，可在下方对照查看：若结构明显跑偏，通常说明该包的 generation.schema 约束不够，需要补全嵌套结构。',
});

export const getPublicAiErrorMessage = (code: unknown): string | null => (
  typeof code === 'string' && Object.prototype.hasOwnProperty.call(PUBLIC_AI_ERROR_MESSAGES, code)
    ? PUBLIC_AI_ERROR_MESSAGES[code as PublicAiErrorCode] ?? null
    : null
);

export type SafePublicAiErrorProjection = Readonly<{
  code: PublicAiErrorCode;
  message: string;
  upstreamStatus?: number;
  upstreamRequestId?: string;
}>;

export type HostedGenerationErrorPayload = {
  error: string;
  message: string;
  code?: PublicAiErrorCode;
  upstreamStatus?: number;
  upstreamRequestId?: string;
};

const MAX_PUBLIC_AI_ERROR_MESSAGE_LENGTH = 2_000;
const MAX_UPSTREAM_REQUEST_ID_LENGTH = 200;
const SAFE_PUBLIC_AI_ERRORS = new WeakMap<object, SafePublicAiErrorProjection>();

const isPublicAiErrorCode = (value: unknown): value is PublicAiErrorCode =>
  typeof value === 'string'
  && (PUBLIC_AI_ERROR_CODES as readonly string[]).includes(value);

const isUpstreamStatus = (value: unknown): value is number =>
  typeof value === 'number'
  && Number.isInteger(value)
  && value >= 100
  && value <= 599;

const containsUnredactedCredential = (message: string): boolean => (
  /\b(?:authorization|proxy-authorization|x-auth-token|x-api-key|cookie|set-cookie)\s*[:=](?!\s*\[REDACTED\])\s*/iu.test(message)
  || /\bBearer(?!\s*\[REDACTED\])\s+/iu.test(message)
  || /"(?:[^"]*api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|session)"\s*:(?!\s*"\[REDACTED\]")\s*/iu.test(message)
  || /\b((?:[a-z0-9]+[_-])?api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|session)\s*[:=](?!\s*\[REDACTED\])\s*/iu.test(message)
  || /([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/iu.test(message)
);

export const isSafePublicAiErrorProjection = (
  value: unknown,
): value is SafePublicAiErrorProjection => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const projection = value as Partial<SafePublicAiErrorProjection>;
  return isPublicAiErrorCode(projection.code)
    && typeof projection.message === 'string'
    && projection.message.length > 0
    && projection.message.length <= MAX_PUBLIC_AI_ERROR_MESSAGE_LENGTH
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(projection.message)
    && !containsUnredactedCredential(projection.message)
    && (projection.upstreamStatus === undefined || isUpstreamStatus(projection.upstreamStatus))
    && (
      projection.upstreamRequestId === undefined
      || (
        typeof projection.upstreamRequestId === 'string'
        && projection.upstreamRequestId.length > 0
        && projection.upstreamRequestId.length <= MAX_UPSTREAM_REQUEST_ID_LENGTH
        && /^[A-Za-z0-9._:-]+$/u.test(projection.upstreamRequestId)
      )
    );
};

/**
 * 创建跨 runtime 传递的 opaque 公共错误。调用方仍必须先移除已知 secret 与请求正文；
 * 本层只做结构校验和明显 credential 模式的 defense-in-depth 拒绝。
 */
export const createSafePublicAiError = (
  projection: SafePublicAiErrorProjection,
): Error => {
  if (!isSafePublicAiErrorProjection(projection)) {
    throw new TypeError('Invalid public AI error projection');
  }

  const error = new Error(projection.code);
  error.name = projection.code === 'AI_REQUEST_ABORTED'
    ? 'AbortError'
    : projection.code === 'AI_UPSTREAM_TIMEOUT'
      ? 'StreamReadTimeoutError'
      : projection.code === 'AI_PROVIDER_REDIRECT_BLOCKED'
        ? 'AIProviderRedirectError'
        : projection.code === 'ARENA_WEB_PACKAGE_OUTPUT_INVALID'
          ? 'ArenaWebPackageOutputError'
          : projection.code === 'ARENA_WEB_PACKAGE_TARGET_INVALID'
            ? 'ArenaWebPackageTargetError'
            : 'AI_APICallError';
  if (projection.upstreamStatus !== undefined) {
    Object.assign(error, {
      status: projection.upstreamStatus,
      statusCode: projection.upstreamStatus,
    });
  }
  SAFE_PUBLIC_AI_ERRORS.set(error, Object.freeze({ ...projection }));
  return error;
};

export const readSafePublicAiError = (
  error: unknown,
): SafePublicAiErrorProjection | null => {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return null;
  return SAFE_PUBLIC_AI_ERRORS.get(error as object) ?? null;
};

export const buildHostedGenerationErrorPayload = (
  error: unknown,
  publicTitle: string,
): HostedGenerationErrorPayload => {
  const projection = readSafePublicAiError(error);
  if (!projection) {
    return {
      error: publicTitle,
      message: HOSTED_GENERATION_INTERNAL_MESSAGE,
    };
  }
  return {
    error: publicTitle,
    message: projection.message,
    code: projection.code,
    ...(projection.upstreamStatus === undefined
      ? {}
      : { upstreamStatus: projection.upstreamStatus }),
    ...(projection.upstreamRequestId === undefined
      ? {}
      : { upstreamRequestId: projection.upstreamRequestId }),
  };
};

export const createSafeHostedGenerationError = (caughtError?: unknown): Error => {
  if (readSafePublicAiError(caughtError)) return caughtError as Error;
  const error = new Error(HOSTED_GENERATION_ERROR_CODE);
  error.name = 'HostedGenerationError';
  return error;
};

const ThinkingEffortSchema = z.enum([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

const UserThinkingOverrideSchema = z.union([
  z.object({ mode: z.literal('default') }),
  z.object({ mode: z.literal('disabled') }),
  z.object({ mode: z.literal('enabled'), effort: ThinkingEffortSchema.optional() }),
]);

export const UserGenerationOverridesRequestSchema = z.object({
  maxOutputTokens: z.number().int().min(1).max(MAX_CUSTOM_PROVIDER_OUTPUT_TOKENS).optional(),
  temperature: z.number().finite().min(0).optional(),
  thinking: UserThinkingOverrideSchema.optional(),
}).strict();

export const CustomProviderRequestSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  apiKey: z.string(),
  maxOutputTokens: z.number().int().min(1).max(MAX_CUSTOM_PROVIDER_OUTPUT_TOKENS).optional(),
  generationOverrides: UserGenerationOverridesRequestSchema.optional(),
});

export type CustomProviderRequest = z.infer<typeof CustomProviderRequestSchema>;

export type StepResult<T> =
  | { completed: true; value: T }
  | { completed: false; response: Response };

export const completeStep = <T>(value: T): StepResult<T> => ({
  completed: true,
  value,
});

export const respondStep = (response: Response): StepResult<never> => ({
  completed: false,
  response,
});

export const jsonResponse = (
  payload: unknown,
  status: number,
  includeJsonContentType = true,
): Response => new Response(
  JSON.stringify(payload),
  {
    status,
    ...(includeJsonContentType
      ? { headers: { 'Content-Type': 'application/json' } }
      : {}),
  },
);
