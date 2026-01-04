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
};

export function createStreamReadWithTimeout(options: CreateStreamReadWithTimeoutOptions) {
  const startedAtMs = Date.now();
  const deadlineAtMs = typeof options.totalTimeoutMs === 'number' ? startedAtMs + Math.max(0, options.totalTimeoutMs) : null;

  return async function readWithTimeout<T>(
    reader: ReadableStreamDefaultReader<T>
  ): Promise<ReadableStreamReadResult<T>> {
    const now = Date.now();
    if (deadlineAtMs != null) {
      const remaining = deadlineAtMs - now;
      if (remaining <= 0) {
        const error = new StreamReadTimeoutError('total', options.totalTimeoutMs ?? 0, options.label);
        options.onTimeout?.(error);
        throw error;
      }
    }

    const timeoutMs = Math.max(
      1,
      deadlineAtMs == null ? options.idleTimeoutMs : Math.min(options.idleTimeoutMs, deadlineAtMs - now)
    );

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const readPromise = reader.read();
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        const error = new StreamReadTimeoutError('idle', timeoutMs, options.label);
        options.onTimeout?.(error);
        reject(error);
      }, timeoutMs);
    });

    try {
      return await Promise.race([readPromise, timeoutPromise]);
    } finally {
      if (timeoutId != null) clearTimeout(timeoutId);
    }
  };
}

