// 幂等卡片 GET 的有界传输策略（规格 §12）：单次 30 秒超时、最多两次尝试、500ms 退避。
// 可重试：408 / 429 / 5xx / network error / timeout；外部 Abort 立即停止重试与退避。
// 权限错误与非法契约不在此层自动重试，由调用方按业务语义处理。

export type BoundedFetchFetcher = (input: string, init?: RequestInit) => Promise<Response>;

export type BoundedFetchOptions = {
  /** 缺省使用全局 fetch；鉴权路径传入 authStorage.fetch 包装。 */
  fetcher?: BoundedFetchFetcher;
  /** 外部取消信号：Tab 切换、查询变化或模态框关闭时中止当前尝试并停止重试。 */
  signal?: AbortSignal;
  timeoutMs?: number;
  maxAttempts?: number;
  backoffMs?: number;
};

export const BOUNDED_FETCH_TIMEOUT_MS = 30_000;
export const BOUNDED_FETCH_MAX_ATTEMPTS = 2;
export const BOUNDED_FETCH_BACKOFF_MS = 500;

// 导出供调用方区分“可重试传输错误”与不可重试的 4xx 业务终态（400/401/403/404 等）。
export const isRetryableStatus = (status: number): boolean => status === 408 || status === 429 || status >= 500;

// jsdom 的 DOMException 不是 Error 子类，不能只靠 instanceof；TimeoutError/AbortError 按 name 判定。
const hasRetryableErrorName = (cause: unknown): boolean => typeof cause === 'object'
  && cause !== null
  && 'name' in cause
  && ((cause as { name: unknown }).name === 'TimeoutError' || (cause as { name: unknown }).name === 'AbortError');

const isRetryableError = (cause: unknown): boolean => cause instanceof TypeError || hasRetryableErrorName(cause);

const delayWithAbort = (ms: number, signal?: AbortSignal): Promise<void> => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) {
    reject(signal.reason);
    return;
  }
  const onAbort = () => {
    clearTimeout(timer);
    reject(signal?.reason);
  };
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort);
    resolve();
  }, ms);
  signal?.addEventListener('abort', onAbort, { once: true });
});

export async function fetchWithBoundedRetry(url: string, options: BoundedFetchOptions = {}): Promise<Response> {
  const {
    fetcher,
    signal,
    timeoutMs = BOUNDED_FETCH_TIMEOUT_MS,
    maxAttempts = BOUNDED_FETCH_MAX_ATTEMPTS,
    backoffMs = BOUNDED_FETCH_BACKOFF_MS,
  } = options;
  const doFetch: BoundedFetchFetcher = fetcher ?? ((input, init) => fetch(input, init));

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    signal?.throwIfAborted();
    const isLastAttempt = attempt === maxAttempts - 1;
    try {
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const attemptSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
      const response = await doFetch(url, { signal: attemptSignal });
      if (response.ok || isLastAttempt || !isRetryableStatus(response.status)) return response;
      // 丢弃将被替换的 5xx 响应体，避免连接挂起。
      void response.body?.cancel().catch(() => undefined);
    } catch (cause) {
      // 外部 Abort 优先于可重试判定：调用方取消后不得继续退避或重试。
      signal?.throwIfAborted();
      if (isLastAttempt || !isRetryableError(cause)) throw cause;
    }
    await delayWithAbort(backoffMs, signal);
  }

  throw new Error('bounded fetch: attempts exhausted');
}
