const readStatusCode = (error: unknown): number | null => {
  if (!error || typeof error !== 'object') return null;
  try {
    const record = error as Record<string, unknown>;
    const status = typeof record.statusCode === 'number'
      ? record.statusCode
      : record.status;
    return typeof status === 'number'
      && Number.isInteger(status)
      && status >= 100
      && status <= 599
      ? status
      : null;
  } catch {
    return null;
  }
};

const readSafeErrorName = (error: unknown): string => {
  if (!error || typeof error !== 'object') return 'AIUpstreamError';
  try {
    const name = (error as Record<string, unknown>).name;
    if (name === 'AbortError') return 'AbortError';
    if (name === 'StreamReadTimeoutError') return 'StreamReadTimeoutError';
    if (name === 'AIProviderRedirectError') return 'AIProviderRedirectError';
    if (name === 'AI_APICallError' || name === 'APICallError') return 'AI_APICallError';
  } catch {
    // 使用固定错误类。
  }
  return 'AIUpstreamError';
};

/**
 * 流式边界只允许返回调用方提供的固定 fallback，不投影上游响应正文。
 */
export function extractUpstreamErrorMessage(
  _capturedError: unknown,
  _result?: unknown,
  fallbackMessage = '流意外结束，没有内容生成',
): string {
  return fallbackMessage;
}

/**
 * 将未知上游错误投影为固定 class/code，只保留可用性分类需要的 HTTP status。
 * 不保留 cause、responseBody、data、URL、请求正文或 Provider 元数据。
 */
export function enhanceErrorWithUpstreamMessage(error: unknown): Error {
  const name = readSafeErrorName(error);
  const message = name === 'AbortError'
    ? 'AI_REQUEST_ABORTED'
    : name === 'StreamReadTimeoutError'
      ? 'AI_UPSTREAM_TIMEOUT'
      : name === 'AIProviderRedirectError'
        ? 'AI_PROVIDER_REDIRECT_BLOCKED'
        : 'AI_UPSTREAM_REQUEST_FAILED';
  const projected = new Error(message);
  projected.name = name;
  const statusCode = readStatusCode(error);
  if (statusCode !== null) {
    Object.assign(projected, { statusCode, status: statusCode });
  }
  return projected;
}
