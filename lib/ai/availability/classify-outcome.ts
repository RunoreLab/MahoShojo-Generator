/**
 * AI 渠道可用性：错误分类 → outcome。
 *
 * 系统渠道 (providerId === 'system')：
 *   failure：余额不足、Key 无效、上游账号不可用、超时/网络/5xx、模型不存在、429
 *   excluded：本站限流/turnstile/冷却、用户取消、未发上游的本地校验、上游成功后的本地解析失败
 *
 * 自定义渠道 (BYOK)：
 *   failure：超时/网络/5xx、模型不存在/不支持、上游容量型 429
 *   excluded：用户 Key 无效、用户个人余额不足、本站限流、用户取消、未发上游的本地错误、上游成功后的本地解析失败
 */

export type OutcomeClassification = {
  outcome: 'success' | 'failure' | 'excluded';
  errorClass?: string;
};

// --- 提取错误元数据 ---

const getErrorMessage = (error: unknown): string => {
  if (!error) return '';
  if (error instanceof Error) return error.message || '';
  try { return String(error); } catch { return ''; }
};

const getStatusCode = (error: unknown): number | null => {
  if (!error || typeof error !== 'object') return null;
  const e = error as Record<string, unknown>;
  if (typeof e.statusCode === 'number') return e.statusCode;
  if (typeof e.status === 'number') return e.status;
  return null;
};

const getErrorName = (error: unknown): string => {
  if (!error || typeof error !== 'object') return '';
  const e = error as Record<string, unknown>;
  return typeof e.name === 'string' ? e.name : '';
};

// --- 模式匹配 ---

const includes = (text: string, ...hints: string[]): boolean =>
  hints.some((h) => text.includes(h));

const isNetworkError = (message: string): boolean =>
  includes(message,
    'failed to fetch', 'networkerror', 'network error', 'load failed',
    'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND',
    '网络', '连接失败', '连接中断', 'fetch failed',
  );

const isTimeoutError = (message: string, name: string): boolean =>
  name === 'StreamReadTimeoutError' ||
  includes(message, 'timeout', 'timed out', '超时', 'deadline exceeded');

const is5xxError = (status: number): boolean =>
  status >= 500 && status < 600;

const isModelNotFoundError = (message: string): boolean =>
  includes(message,
    'model not found', 'model does not exist', 'model_not_found',
    'unknown model', '模型不存在', '模型不支持', 'not supported',
    'does not support', 'not available',
  );

// --- 系统渠道分类 ---

const classifySystemChannel = (error: unknown): OutcomeClassification => {
  const message = getErrorMessage(error);
  const status = getStatusCode(error);
  const name = getErrorName(error);
  const lowerMessage = message.toLowerCase();

  // billing / quota → failure
  if (includes(lowerMessage,
    'billing', 'quota', 'insufficient', 'exceeded', '余额不足',
    '额度', 'credit', 'payment', 'overloaded',
  )) {
    return { outcome: 'failure', errorClass: 'billing' };
  }

  // auth (401/403) → failure
  if (status === 401 || status === 403) {
    return { outcome: 'failure', errorClass: 'auth' };
  }
  if (includes(lowerMessage,
    'unauthorized', 'forbidden', 'invalid api key', 'api key',
    'authentication', '鉴权', '授权',
  )) {
    return { outcome: 'failure', errorClass: 'auth' };
  }

  // 429 → failure（系统渠道默认计 failure）
  if (status === 429) {
    return { outcome: 'failure', errorClass: 'rate_limit' };
  }

  // timeout / network → failure
  if (isTimeoutError(message, name)) {
    return { outcome: 'failure', errorClass: 'timeout' };
  }
  if (isNetworkError(message)) {
    return { outcome: 'failure', errorClass: 'network' };
  }

  // 5xx → failure
  if (status !== null && is5xxError(status)) {
    return { outcome: 'failure', errorClass: 'server_error' };
  }

  // model not found → failure
  if (isModelNotFoundError(message)) {
    return { outcome: 'failure', errorClass: 'model_not_found' };
  }

  // AI_APICallError → failure
  if (name === 'AI_APICallError') {
    return { outcome: 'failure', errorClass: 'api_call_error' };
  }

  // --- 以下为 excluded ---

  // 本站限流 / turnstile / 冷却
  if (includes(lowerMessage,
    'turnstile', 'rate limit', '冷却', '请求过于频繁',
    '操作过于频繁', 'too many requests',
  )) {
    return { outcome: 'excluded', errorClass: 'local_rate_limit' };
  }

  // 用户取消 / 客户端中断
  if (includes(lowerMessage,
    'abort', 'cancelled', 'canceled', '用户取消', '取消',
  ) || name === 'AbortError') {
    return { outcome: 'excluded', errorClass: 'user_cancel' };
  }

  // 未发上游的本地校验失败
  if (includes(lowerMessage,
    'validation', '校验', 'schema', '参数',
  )) {
    return { outcome: 'excluded', errorClass: 'local_validation' };
  }

  // 上游成功后的本地解析/修复失败
  if (includes(lowerMessage,
    'json', 'parse', '解析', '格式', 'repair',
  )) {
    return { outcome: 'excluded', errorClass: 'local_parse' };
  }

  // 默认：系统渠道兜底为 failure
  return { outcome: 'failure', errorClass: 'unknown' };
};

// --- 自定义渠道分类 ---

const classifyCustomChannel = (error: unknown): OutcomeClassification => {
  const message = getErrorMessage(error);
  const status = getStatusCode(error);
  const name = getErrorName(error);
  const lowerMessage = message.toLowerCase();

  // timeout / network → failure
  if (isTimeoutError(message, name)) {
    return { outcome: 'failure', errorClass: 'timeout' };
  }
  if (isNetworkError(message)) {
    return { outcome: 'failure', errorClass: 'network' };
  }

  // 5xx → failure
  if (status !== null && is5xxError(status)) {
    return { outcome: 'failure', errorClass: 'server_error' };
  }

  // model not found → failure
  if (isModelNotFoundError(message)) {
    return { outcome: 'failure', errorClass: 'model_not_found' };
  }

  // AI_APICallError → failure
  if (name === 'AI_APICallError') {
    return { outcome: 'failure', errorClass: 'api_call_error' };
  }

  // 429 (容量型，非个人 Key 配额时) → failure
  if (status === 429 && !includes(lowerMessage,
    'quota', 'billing', 'credit', 'key', 'token', '额度',
  )) {
    return { outcome: 'failure', errorClass: 'rate_limit' };
  }

  // --- 以下为 excluded ---

  // 用户 Key 无效 / 权限不足
  if (status === 401 || status === 403) {
    return { outcome: 'excluded', errorClass: 'auth' };
  }
  if (includes(lowerMessage,
    'unauthorized', 'forbidden', 'invalid api key', 'api key',
    'authentication', '鉴权', '授权',
  )) {
    return { outcome: 'excluded', errorClass: 'auth' };
  }

  // 用户个人余额不足 / 个人额度用尽
  if (includes(lowerMessage,
    'billing', 'quota', 'insufficient', 'exceeded', '余额不足',
    '额度', 'credit', 'payment', 'personal',
  )) {
    return { outcome: 'excluded', errorClass: 'billing' };
  }

  // 本站限流 / turnstile / 冷却
  if (includes(lowerMessage,
    'turnstile', 'rate limit', '冷却', '请求过于频繁',
    '操作过于频繁', 'too many requests',
  )) {
    return { outcome: 'excluded', errorClass: 'local_rate_limit' };
  }

  // 用户取消 / 客户端中断
  if (includes(lowerMessage,
    'abort', 'cancelled', 'canceled', '用户取消', '取消',
  ) || name === 'AbortError') {
    return { outcome: 'excluded', errorClass: 'user_cancel' };
  }

  // 未发上游的本地校验失败
  if (includes(lowerMessage,
    'validation', '校验', 'schema', '参数',
  )) {
    return { outcome: 'excluded', errorClass: 'local_validation' };
  }

  // 上游成功后的本地解析/修复失败
  if (includes(lowerMessage,
    'json', 'parse', '解析', '格式', 'repair',
  )) {
    return { outcome: 'excluded', errorClass: 'local_parse' };
  }

  // 默认：自定义渠道兜底为 excluded（保守，不污染共享成功率）
  return { outcome: 'excluded', errorClass: 'unknown' };
};

// --- 公开 API ---

/**
 * 根据错误对象和渠道类型分类 outcome。
 */
export function classifyOutcome(
  isSystemChannel: boolean,
  error?: unknown,
): OutcomeClassification {
  if (!error) {
    return { outcome: 'success' };
  }
  return isSystemChannel
    ? classifySystemChannel(error)
    : classifyCustomChannel(error);
}

/**
 * 记录成功 outcome。
 */
export function classifySuccess(): OutcomeClassification {
  return { outcome: 'success' };
}
