/**
 * AI 渠道可用性：错误分类 → outcome。
 *
 * 系统渠道 (providerId === 'system')：
 *   failure：余额不足、Key 无效、上游账号不可用、超时/网络/5xx、模型不存在、429
 *   excluded：本站限流/turnstile/冷却、用户取消、未发上游的本地校验、上游成功后的本地解析失败
 *
 * 自定义渠道 (BYOK)：
 *   failure：超时/网络/5xx、模型不存在/不支持、上游容量型 429、上游服务/模型暂时不可用
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

const STATUS_FROM_MESSAGE_PATTERNS: RegExp[] = [
  /状态码\s*[=:：]\s*(\d{3})/i,
  /[（(]\s*HTTP\s*[=:：]?\s*(\d{3})\s*[)）]/i,
  /\bHTTP\s+(\d{3})\b/i,
  /\bstatus(?:Code)?\s*[=:：]\s*(\d{3})\b/i,
];

const parseStatusFromMessage = (message: string): number | null => {
  if (!message) return null;
  for (const pattern of STATUS_FROM_MESSAGE_PATTERNS) {
    const match = message.match(pattern);
    if (!match?.[1]) continue;
    const code = Number(match[1]);
    if (Number.isInteger(code) && code >= 100 && code <= 599) {
      return code;
    }
  }
  return null;
};

const readDirectStatusCode = (error: unknown): number | null => {
  if (!error || typeof error !== 'object') return null;
  const e = error as Record<string, unknown>;
  if (typeof e.statusCode === 'number' && Number.isFinite(e.statusCode)) {
    return e.statusCode;
  }
  if (typeof e.status === 'number' && Number.isFinite(e.status)) {
    return e.status;
  }
  return null;
};

/**
 * 读取 status code：属性 → originalError/cause → 消息文本（状态码=503 / HTTP 503）。
 * enhanceErrorWithUpstreamMessage 可能把 status 只写进消息；必须能从文本回推。
 */
const getStatusCode = (error: unknown, depth = 0): number | null => {
  if (!error || depth > 3) return null;

  const direct = readDirectStatusCode(error);
  if (direct !== null) return direct;

  if (typeof error === 'object') {
    const e = error as Record<string, unknown>;
    const nested =
      getStatusCode(e.originalError, depth + 1) ??
      getStatusCode(e.cause, depth + 1);
    if (nested !== null) return nested;
  }

  return parseStatusFromMessage(getErrorMessage(error));
};

const getErrorName = (error: unknown, depth = 0): string => {
  if (!error || depth > 3) return '';
  if (typeof error !== 'object') return '';
  const e = error as Record<string, unknown>;
  if (typeof e.name === 'string' && e.name) return e.name;
  const nestedName =
    getErrorName(e.originalError, depth + 1) ||
    getErrorName(e.cause, depth + 1);
  if (nestedName) return nestedName;

  // 消息前缀形如 "AI_APICallError: ..." 或 "失败:AI_APICallError:..."
  const message = getErrorMessage(error);
  const fromMessage = message.match(/\bAI_?APICallError\b/i);
  if (fromMessage) return 'AI_APICallError';
  return '';
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
    'does not support',
  );

/**
 * 上游服务/模型暂时不可用（503 常见文案，含中英）。
 * 注意：不要与「模型不存在」混为一谈；两者都计 failure，但 errorClass 不同。
 */
const isUpstreamUnavailableError = (message: string, lowerMessage: string): boolean =>
  includes(lowerMessage,
    'service unavailable', 'temporarily unavailable', 'not available',
    'unavailable', 'overloaded', 'capacity',
  ) ||
  includes(message,
    '暂时不可用', '当前不可用', '服务不可用', '模型不可用', '不可用',
  );

const isApiCallErrorName = (name: string): boolean =>
  name === 'AI_APICallError' ||
  name === 'APICallError' ||
  /^AI_?APICallError$/i.test(name);

// --- 系统渠道分类 ---

const classifySystemChannel = (error: unknown): OutcomeClassification => {
  const message = getErrorMessage(error);
  const status = getStatusCode(error);
  const name = getErrorName(error);
  const lowerMessage = message.toLowerCase();

  // billing / quota → failure
  if (includes(lowerMessage,
    'billing', 'quota', 'insufficient', 'exceeded', '余额不足',
    '额度', 'credit', 'payment',
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

  // 上游服务/模型暂时不可用 → failure
  if (isUpstreamUnavailableError(message, lowerMessage)) {
    return { outcome: 'failure', errorClass: 'upstream_unavailable' };
  }

  // model not found → failure
  if (isModelNotFoundError(message)) {
    return { outcome: 'failure', errorClass: 'model_not_found' };
  }

  // AI_APICallError → failure
  if (isApiCallErrorName(name)) {
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

  // --- 个人凭证/额度类优先 excluded（即使 error name 是 AI_APICallError）---

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
  // 注意：不要用裸 'exceeded'（会误伤 "rate limit exceeded" 容量型 429）
  if (includes(lowerMessage,
    'billing', 'quota', 'insufficient', '余额不足',
    '额度', 'credit', 'payment', 'personal',
  )) {
    return { outcome: 'excluded', errorClass: 'billing' };
  }

  // --- 共享上游故障 → failure ---

  // timeout / network → failure
  if (isTimeoutError(message, name)) {
    return { outcome: 'failure', errorClass: 'timeout' };
  }
  if (isNetworkError(message)) {
    return { outcome: 'failure', errorClass: 'network' };
  }

  // 5xx → failure（含仅出现在消息文本中的 状态码=503 / HTTP 503）
  if (status !== null && is5xxError(status)) {
    return { outcome: 'failure', errorClass: 'server_error' };
  }

  // 上游服务/模型暂时不可用 → failure（共享可用性，与个人 Key 无关）
  if (isUpstreamUnavailableError(message, lowerMessage)) {
    return { outcome: 'failure', errorClass: 'upstream_unavailable' };
  }

  // model not found → failure
  if (isModelNotFoundError(message)) {
    return { outcome: 'failure', errorClass: 'model_not_found' };
  }

  // 429 容量型（非个人配额）→ failure
  if (status === 429) {
    return { outcome: 'failure', errorClass: 'rate_limit' };
  }

  // AI_APICallError → failure（已排除个人 auth/billing 后）
  if (isApiCallErrorName(name)) {
    return { outcome: 'failure', errorClass: 'api_call_error' };
  }

  // --- 其他 excluded ---

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
