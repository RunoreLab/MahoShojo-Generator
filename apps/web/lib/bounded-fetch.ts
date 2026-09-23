// 幂等卡片 GET 的有界传输策略（规格 §12）：单次 30 秒超时、最多两次尝试、500ms 退避。
// 可重试：408 / 429 / 5xx / network error / timeout；外部 Abort 立即停止重试与退避。
// 权限错误与非法契约不在此层自动重试，由调用方按业务语义处理。
// fetchJsonWithBoundedRetry 额外把 JSON body 消费纳入同一 attempt，避免 headers 成功后正文断流只试一次。
//
// 兼容性：不依赖 AbortSignal.any / AbortSignal.timeout / AbortSignal#throwIfAborted 等较新
// convenience API（Baseline 2024 附近，旧浏览器/WebView 可能缺失），改用经典
// AbortController + abort 事件 + setTimeout 实现取消与超时。

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

const createAbortDomException = (message: string, name: 'AbortError' | 'TimeoutError'): DOMException =>
  new DOMException(message, name);

const getAbortReason = (signal?: AbortSignal): unknown =>
  signal?.reason ?? createAbortDomException('The operation was aborted.', 'AbortError');

/** 兼容旧环境：不调用可能缺失的 AbortSignal#throwIfAborted，按 aborted/reason 语义抛出。 */
export const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw getAbortReason(signal);
  }
};

type AttemptSignalHandle = {
  signal: AbortSignal;
  cleanup: () => void;
};

// 每次 attempt 自建 AbortController：外部取消经传统 abort 事件转发，超时用 setTimeout 实现。
// cleanup 必须覆盖整个 attempt（含 JSON body 消费），避免正文阶段重新失去超时保护。
const createAttemptSignal = (
  externalSignal: AbortSignal | undefined,
  timeoutMs: number,
): AttemptSignalHandle => {
  const controller = new AbortController();

  const abortFromExternal = (): void => {
    controller.abort(getAbortReason(externalSignal));
  };

  if (externalSignal?.aborted) {
    abortFromExternal();
  } else {
    externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
  }

  const timer = setTimeout(() => {
    controller.abort(createAbortDomException('The operation timed out.', 'TimeoutError'));
  }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', abortFromExternal);
    },
  };
};

// jsdom 的 DOMException 不是 Error 子类，不能只靠 instanceof；TimeoutError/AbortError 按 name 判定。
const hasRetryableErrorName = (cause: unknown): boolean => typeof cause === 'object'
  && cause !== null
  && 'name' in cause
  && ((cause as { name: unknown }).name === 'TimeoutError' || (cause as { name: unknown }).name === 'AbortError');

// fetch 网络失败通常抛 TypeError；但 "xxx is not a function" 等是确定性编程/兼容性错误，重试无意义。
const isDeterministicProgrammingTypeError = (cause: TypeError): boolean =>
  /\bis not a (?:function|constructor|method)\b/.test(cause.message);

const isRetryableError = (cause: unknown): boolean => {
  if (hasRetryableErrorName(cause)) return true;
  if (cause instanceof TypeError) return !isDeterministicProgrammingTypeError(cause);
  return false;
};

const delayWithAbort = (ms: number, signal?: AbortSignal): Promise<void> => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) {
    reject(getAbortReason(signal));
    return;
  }
  const onAbort = () => {
    clearTimeout(timer);
    reject(getAbortReason(signal));
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
    throwIfAborted(signal);
    const isLastAttempt = attempt === maxAttempts - 1;
    const attemptSignal = createAttemptSignal(signal, timeoutMs);
    try {
      const response = await doFetch(url, { signal: attemptSignal.signal });
      if (response.ok || isLastAttempt || !isRetryableStatus(response.status)) return response;
      // 丢弃将被替换的 5xx 响应体，避免连接挂起。
      void response.body?.cancel().catch(() => undefined);
    } catch (cause) {
      // 外部 Abort 优先于可重试判定：调用方取消后不得继续退避或重试。
      throwIfAborted(signal);
      if (isLastAttempt || !isRetryableError(cause)) throw cause;
    } finally {
      attemptSignal.cleanup();
    }
    await delayWithAbort(backoffMs, signal);
  }

  throw new Error('bounded fetch: attempts exhausted');
}

export type BoundedJsonSuccess<T> = {
  ok: true;
  status: number;
  data: T;
};

export type BoundedJsonFailure = {
  ok: false;
  status: number;
  /** JSON 错误体（content-type 为 JSON 且可解析时）。 */
  data?: unknown;
  /** 非 JSON 错误体原文（截断前）。 */
  bodyText?: string;
};

export type BoundedJsonResult<T> = BoundedJsonSuccess<T> | BoundedJsonFailure;

const readJsonFailureBody = async (response: Response): Promise<BoundedJsonFailure> => {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    const data = await response.json().catch(() => null);
    if (data !== null && data !== undefined) {
      return { ok: false, status: response.status, data };
    }
    return { ok: false, status: response.status };
  }

  const bodyText = await response.text().catch(() => '');
  return {
    ok: false,
    status: response.status,
    ...(bodyText ? { bodyText } : {}),
  };
};

/**
 * 一次 attempt 覆盖 fetch + JSON body 消费：
 * headers 到达后正文在传输中断/超时失败时，仍会在有界次数内重试。
 * 非 ok 的最终响应返回 failure（含尽力解析的错误体），不抛出。
 */
export async function fetchJsonWithBoundedRetry<T = unknown>(
  url: string,
  options: BoundedFetchOptions = {},
): Promise<BoundedJsonResult<T>> {
  const {
    fetcher,
    signal,
    timeoutMs = BOUNDED_FETCH_TIMEOUT_MS,
    maxAttempts = BOUNDED_FETCH_MAX_ATTEMPTS,
    backoffMs = BOUNDED_FETCH_BACKOFF_MS,
  } = options;
  const doFetch: BoundedFetchFetcher = fetcher ?? ((input, init) => fetch(input, init));

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    throwIfAborted(signal);
    const isLastAttempt = attempt === maxAttempts - 1;
    const attemptSignal = createAttemptSignal(signal, timeoutMs);
    try {
      const response = await doFetch(url, { signal: attemptSignal.signal });

      if (!response.ok) {
        if (!isLastAttempt && isRetryableStatus(response.status)) {
          void response.body?.cancel().catch(() => undefined);
        } else {
          return await readJsonFailureBody(response);
        }
      } else {
        try {
          const data = await response.json() as T;
          return { ok: true, status: response.status, data };
        } catch (bodyCause) {
          void response.body?.cancel().catch(() => undefined);
          throwIfAborted(signal);
          if (isLastAttempt || !isRetryableError(bodyCause)) throw bodyCause;
        }
      }
    } catch (cause) {
      throwIfAborted(signal);
      if (isLastAttempt || !isRetryableError(cause)) throw cause;
    } finally {
      attemptSignal.cleanup();
    }
    await delayWithAbort(backoffMs, signal);
  }

  throw new Error('bounded fetch: attempts exhausted');
}
