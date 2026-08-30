import {
  createSafePublicAiError,
  readSafePublicAiError,
  type PublicAiErrorCode,
} from '@mahoshojo/hosted-api/regular-generation';

const MAX_PUBLIC_ERROR_MESSAGE_LENGTH = 2_000;
const MAX_UPSTREAM_REQUEST_ID_LENGTH = 200;

export type EnhanceUpstreamErrorOptions = Readonly<{
  secrets?: readonly string[];
  sensitiveTexts?: readonly string[];
}>;

const safeRead = (value: unknown, key: string): unknown => {
  if (!value || typeof value !== 'object') return undefined;
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
};

const safeString = (value: unknown): string => typeof value === 'string' ? value : '';

const safeJsonParse = (value: unknown): unknown => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || (!text.startsWith('{') && !text.startsWith('['))) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

const nested = (value: unknown, ...keys: string[]): unknown => {
  let current = value;
  for (const key of keys) current = safeRead(current, key);
  return current;
};

const readStatusCode = (error: unknown): number | null => {
  const candidate = safeRead(error, 'statusCode') ?? safeRead(error, 'status');
  return typeof candidate === 'number'
    && Number.isInteger(candidate)
    && candidate >= 100
    && candidate <= 599
    ? candidate
    : null;
};

const readSafeErrorName = (error: unknown): string => {
  const name = safeString(safeRead(error, 'name'));
  if (name === 'AbortError') return 'AbortError';
  if (name === 'StreamReadTimeoutError') return 'StreamReadTimeoutError';
  if (name === 'AIProviderRedirectError') return 'AIProviderRedirectError';
  if (name === 'AI_APICallError' || name === 'APICallError') return 'AI_APICallError';
  return 'AIUpstreamError';
};

const isRecognizedUpstreamError = (error: unknown): boolean => {
  const name = safeString(safeRead(error, 'name'));
  return name === 'AI_APICallError' || name === 'APICallError';
};

const readMessageFromPayload = (payload: unknown): string => {
  if (typeof payload === 'string') return payload;
  return safeString(safeRead(payload, 'message'))
    || safeString(nested(payload, 'error', 'message'))
    || safeString(safeRead(payload, 'error'));
};

const readUpstreamMessage = (error: unknown): string => {
  const responseBody = safeRead(error, 'responseBody');
  return safeString(nested(error, 'data', 'error', 'message'))
    || safeString(nested(error, 'error', 'data', 'error', 'message'))
    || safeString(safeRead(error, 'message'))
    || safeString(nested(responseBody, 'error', 'message'))
    || readMessageFromPayload(safeJsonParse(responseBody))
    || safeString(nested(error, 'cause', 'message'))
    || readMessageFromPayload(safeRead(error, 'data'));
};

const redactLiteral = (message: string, secret: string): string => {
  const normalized = secret.trim();
  if (!normalized) return message;
  if (normalized.length < 4) return message.includes(normalized) ? '' : message;
  return message.split(normalized).join('[REDACTED]');
};

const sharesSensitiveFragment = (
  message: string,
  sensitiveText: string,
  fragmentLength = 24,
): boolean => {
  if (message.length < fragmentLength || sensitiveText.length < fragmentLength) return false;
  const base = 257;
  let power = 1;
  for (let index = 1; index < fragmentLength; index += 1) {
    power = Math.imul(power, base) >>> 0;
  }
  const initialHash = (text: string): number => {
    let hash = 0;
    for (let index = 0; index < fragmentLength; index += 1) {
      hash = (Math.imul(hash, base) + text.charCodeAt(index)) >>> 0;
    }
    return hash;
  };
  const advanceHash = (hash: number, text: string, index: number): number => {
    const removed = Math.imul(text.charCodeAt(index - fragmentLength), power) >>> 0;
    return (Math.imul((hash - removed) >>> 0, base) + text.charCodeAt(index)) >>> 0;
  };

  const sensitiveHashes = new Set<number>();
  let sensitiveHash = initialHash(sensitiveText);
  sensitiveHashes.add(sensitiveHash);
  for (let index = fragmentLength; index < sensitiveText.length; index += 1) {
    sensitiveHash = advanceHash(sensitiveHash, sensitiveText, index);
    sensitiveHashes.add(sensitiveHash);
  }

  let messageHash = initialHash(message);
  if (sensitiveHashes.has(messageHash)) return true;
  for (let index = fragmentLength; index < message.length; index += 1) {
    messageHash = advanceHash(messageHash, message, index);
    if (sensitiveHashes.has(messageHash)) return true;
  }
  return false;
};

const sanitizePublicMessage = (
  message: string,
  secrets: readonly string[] = [],
  sensitiveTexts: readonly string[] = [],
): string => {
  const raw = message.slice(0, MAX_PUBLIC_ERROR_MESSAGE_LENGTH * 4);
  if (
    /<(?:!doctype|html|body|script)\b/iu.test(raw)
    || /(?:^|\n)\s*at\s+[^\n]+:\d+(?::\d+)?/u.test(raw)
    || /\bfile:\/\//iu.test(raw)
  ) return '';
  for (const sensitiveText of sensitiveTexts) {
    const normalized = sensitiveText.trim();
    if (normalized.length > 0 && normalized.length < 24 && raw.includes(normalized)) return '';
    if (sharesSensitiveFragment(raw, normalized)) return '';
  }

  let sanitized = raw
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    .replace(/\b(authorization|proxy-authorization|x-auth-token|x-api-key|cookie|set-cookie)\s*[:=]\s*[^,\r\n]+/giu, '$1: [REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [REDACTED]')
    .replace(/"(?:[^"]*api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|session)"\s*:\s*"[^"]*"/giu, '"credential":"[REDACTED]"')
    .replace(/\b((?:[a-z0-9]+[_-])?api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|session)\s*[:=]\s*[^&#；;,\s]+/giu, '$1=[REDACTED]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/giu, '$1[REDACTED]@')
    .replace(/([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|session)=)[^&#\s]+/giu, '$1[REDACTED]')
    .replace(/\b(sk|pk|key)-[A-Za-z0-9_-]{12,}\b/gu, '$1-[REDACTED]');

  for (const secret of secrets) sanitized = redactLiteral(sanitized, secret);
  sanitized = sanitized.replace(/\s+/gu, ' ').trim();
  return sanitized.slice(0, MAX_PUBLIC_ERROR_MESSAGE_LENGTH);
};

const readUpstreamRequestId = (
  error: unknown,
  secrets: readonly string[] = [],
): string | undefined => {
  const headers = safeRead(error, 'responseHeaders') ?? safeRead(error, 'headers');
  let headerRequestId: unknown;
  if (headers && typeof headers === 'object') {
    const get = safeRead(headers, 'get');
    if (typeof get === 'function') {
      try {
        headerRequestId = get.call(headers, 'x-request-id')
          ?? get.call(headers, 'request-id')
          ?? get.call(headers, 'x-amzn-requestid');
      } catch {
        headerRequestId = undefined;
      }
    } else {
      headerRequestId = safeRead(headers, 'x-request-id')
        ?? safeRead(headers, 'request-id')
        ?? safeRead(headers, 'x-amzn-requestid');
    }
  }
  const candidate = safeRead(error, 'requestId')
    ?? safeRead(error, 'requestID')
    ?? safeRead(error, 'upstreamRequestId')
    ?? nested(error, 'data', 'requestId')
    ?? headerRequestId;
  if (typeof candidate !== 'string') return undefined;
  const normalized = candidate.trim();
  if (secrets.some((secret) => {
    const normalizedSecret = secret.trim();
    return normalizedSecret.length > 0 && normalized.includes(normalizedSecret);
  })) return undefined;
  return normalized.length > 0
    && normalized.length <= MAX_UPSTREAM_REQUEST_ID_LENGTH
    && /^[A-Za-z0-9._:-]+$/u.test(normalized)
    ? normalized
    : undefined;
};

const fixedProjection = (
  name: string,
): { code: PublicAiErrorCode; message: string } | null => {
  if (name === 'AbortError') return { code: 'AI_REQUEST_ABORTED', message: '请求已取消' };
  if (name === 'StreamReadTimeoutError') {
    return { code: 'AI_UPSTREAM_TIMEOUT', message: '上游 AI 响应超时，请稍后重试' };
  }
  if (name === 'AIProviderRedirectError') {
    return {
      code: 'AI_PROVIDER_REDIRECT_BLOCKED',
      message: '上游 AI 服务重定向被安全策略拒绝',
    };
  }
  return null;
};

const buildPublicDiagnostic = (
  error: unknown,
  fallbackMessage: string,
  options?: EnhanceUpstreamErrorOptions,
): string => {
  if (!isRecognizedUpstreamError(error)) return fallbackMessage;
  const rawMessage = readUpstreamMessage(error);
  const sanitizedMessage = sanitizePublicMessage(
    rawMessage,
    options?.secrets,
    options?.sensitiveTexts,
  );
  if (!sanitizedMessage) return fallbackMessage;
  const prefix = readSafeErrorName(error);
  const statusCode = readStatusCode(error);
  return `${prefix}: ${sanitizedMessage}${statusCode === null ? '' : `（HTTP ${statusCode}）`}`;
};

export function extractUpstreamErrorMessage(
  capturedError: unknown,
  result?: unknown,
  fallbackMessage = '流意外结束，没有内容生成',
  options?: EnhanceUpstreamErrorOptions,
): string {
  const capturedMessage = buildPublicDiagnostic(capturedError, '', options);
  if (capturedMessage) return capturedMessage;

  const resultError = safeRead(result, 'error') ?? safeRead(result, 'cause');
  const resultMessage = buildPublicDiagnostic(resultError, '', options);
  return resultMessage || fallbackMessage;
}

export function enhanceErrorWithUpstreamMessage(
  error: unknown,
  options?: EnhanceUpstreamErrorOptions,
): Error {
  if (readSafePublicAiError(error)) return error as Error;

  const name = readSafeErrorName(error);
  const fixed = fixedProjection(name);
  if (!fixed && !isRecognizedUpstreamError(error)) {
    // 普通内部异常不得仅凭 status/responseBody 等形状取得 Provider 公共投影信任。
    // 返回低基数 Error 供日志与分类使用，Hosted API 边界会将其投影为 generic 错误。
    return new Error('AI_UPSTREAM_REQUEST_FAILED');
  }
  const statusCode = readStatusCode(error);
  const upstreamRequestId = readUpstreamRequestId(error, options?.secrets);
  const projection = fixed ?? {
    code: 'AI_UPSTREAM_REQUEST_FAILED' as const,
    message: buildPublicDiagnostic(error, '上游 AI 请求失败', options),
  };

  return createSafePublicAiError({
    ...projection,
    ...(statusCode === null ? {} : { upstreamStatus: statusCode }),
    ...(upstreamRequestId === undefined ? {} : { upstreamRequestId }),
  });
}
