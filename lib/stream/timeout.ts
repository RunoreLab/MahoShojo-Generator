export type StreamReadTimeoutKind = 'idle' | 'total';

export class StreamReadTimeoutError extends Error {
  readonly name = 'StreamReadTimeoutError';
  readonly kind: StreamReadTimeoutKind;
  readonly timeoutMs: number;
  readonly label?: string;

  constructor(kind: StreamReadTimeoutKind, timeoutMs: number, label?: string) {
    const prefix = label ? `【${label}】` : '';
    const message =
      kind === 'idle'
        ? `${prefix}流式读取超时：${Math.round(timeoutMs / 1000)}s 内未收到新内容，已终止。请重试。`
        : `${prefix}流式生成超时：超过 ${Math.round(timeoutMs / 1000)}s 仍未结束，已终止。请重试。`;
    super(message);
    this.kind = kind;
    this.timeoutMs = timeoutMs;
    this.label = label;
  }
}

export type CreateStreamReadWithTimeoutOptions = {
  idleTimeoutMs: number;
  totalTimeoutMs?: number;
  label?: string;
  onTimeout?: (error: StreamReadTimeoutError) => void;
  getLastActivityAtMs?: () => number | null | undefined;
};

const parsePositiveTimeoutMs = (value: string | undefined, fallback: number): number => {
  if (typeof value !== 'string') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed <= 0) return fallback;
  return Math.floor(parsed);
};

export const STREAM_READ_IDLE_TIMEOUT_MS = parsePositiveTimeoutMs(process.env.NEXT_PUBLIC_STREAM_READ_IDLE_TIMEOUT_MS, 150_000);
export const STREAM_READ_TOTAL_TIMEOUT_MS = parsePositiveTimeoutMs(
  process.env.NEXT_PUBLIC_STREAM_READ_TOTAL_TIMEOUT_MS,
  10 * 60_000
);

export function createStreamReadWithTimeout(options: CreateStreamReadWithTimeoutOptions) {
  const startedAtMs = Date.now();
  const deadlineAtMs = typeof options.totalTimeoutMs === 'number' ? startedAtMs + Math.max(0, options.totalTimeoutMs) : null;
  const resolveLastActivityAtMs = (): number | null => {
    try {
      const value = options.getLastActivityAtMs?.();
      return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
    } catch {
      return null;
    }
  };

  return async function readWithTimeout<T>(
    reader: ReadableStreamDefaultReader<T>
  ): Promise<ReadableStreamReadResult<T>> {
    const readStartedAtMs = Date.now();
    if (deadlineAtMs != null) {
      const remaining = deadlineAtMs - readStartedAtMs;
      if (remaining <= 0) {
        const error = new StreamReadTimeoutError('total', options.totalTimeoutMs ?? 0, options.label);
        options.onTimeout?.(error);
        throw error;
      }
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const readPromise = reader.read();
    const timeoutPromise = new Promise<never>((_, reject) => {
      const scheduleTimeout = () => {
        const now = Date.now();
        if (deadlineAtMs != null && now >= deadlineAtMs) {
          const error = new StreamReadTimeoutError('total', options.totalTimeoutMs ?? 0, options.label);
          options.onTimeout?.(error);
          reject(error);
          return;
        }

        const lastActivityAtMs = Math.max(readStartedAtMs, resolveLastActivityAtMs() ?? 0);
        const idleDeadlineAtMs = lastActivityAtMs + options.idleTimeoutMs;
        const nextDeadlineAtMs = deadlineAtMs == null ? idleDeadlineAtMs : Math.min(idleDeadlineAtMs, deadlineAtMs);
        const delayMs = Math.max(1, nextDeadlineAtMs - now);

        timeoutId = setTimeout(() => {
          const firedAtMs = Date.now();
          if (deadlineAtMs != null && firedAtMs >= deadlineAtMs) {
            const error = new StreamReadTimeoutError('total', options.totalTimeoutMs ?? 0, options.label);
            options.onTimeout?.(error);
            reject(error);
            return;
          }

          const latestActivityAtMs = Math.max(readStartedAtMs, resolveLastActivityAtMs() ?? 0);
          if (latestActivityAtMs + options.idleTimeoutMs > firedAtMs) {
            scheduleTimeout();
            return;
          }

          const error = new StreamReadTimeoutError('idle', options.idleTimeoutMs, options.label);
          options.onTimeout?.(error);
          reject(error);
        }, delayMs);
      };

      scheduleTimeout();
    });

    try {
      return await Promise.race([readPromise, timeoutPromise]);
    } finally {
      if (timeoutId != null) clearTimeout(timeoutId);
    }
  };
}
