import { z } from 'zod/v3';

export const MAX_CUSTOM_PROVIDER_OUTPUT_TOKENS = 1_000_000;
export const HOSTED_GENERATION_INTERNAL_MESSAGE = '服务器内部错误';
export const HOSTED_GENERATION_ERROR_CODE = 'HOSTED_GENERATION_FAILED';

export const PUBLIC_AI_ERROR_CODES = Object.freeze([
  'AI_UPSTREAM_REQUEST_FAILED',
  'AI_UPSTREAM_TIMEOUT',
  'AI_REQUEST_ABORTED',
  'AI_PROVIDER_REDIRECT_BLOCKED',
] as const);

export type PublicAiErrorCode = typeof PUBLIC_AI_ERROR_CODES[number];

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
