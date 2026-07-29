export type StreamReadTimeoutKind = 'idle' | 'total';

export type StreamReadTimeoutMode = 'hard' | 'soft';

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

export type StreamSoftTimeoutEvent = {
  kind: StreamReadTimeoutKind;
  timeoutMs: number;
  elapsedMs: number;
  label?: string;
};

export type CreateStreamReadWithTimeoutOptions = {
  idleTimeoutMs: number;
  totalTimeoutMs?: number;
  label?: string;
  /**
   * hard（默认）：超时后 reject 并调用 onTimeout（会切断读流）。
   * soft：超时后仅调用 onSoftTimeout，继续等待 reader.read()，不主动切断。
   */
  mode?: StreamReadTimeoutMode;
  onTimeout?: (error: StreamReadTimeoutError) => void;
  onSoftTimeout?: (event: StreamSoftTimeoutEvent) => void;
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

export function buildStreamSoftTimeoutMessage(event: Pick<StreamSoftTimeoutEvent, 'kind' | 'timeoutMs'>): string {
  const seconds = Math.max(1, Math.round(event.timeoutMs / 1000));
  if (event.kind === 'idle') {
    return `已超过 ${seconds} 秒仍未收到新内容，建议手动终止后重试。`;
  }
  return `已超过 ${seconds} 秒仍未结束生成，建议手动终止后重试。`;
}

export function createStreamReadWithTimeout(options: CreateStreamReadWithTimeoutOptions) {
  const mode: StreamReadTimeoutMode = options.mode === 'soft' ? 'soft' : 'hard';
  const startedAtMs = Date.now();
  const deadlineAtMs = typeof options.totalTimeoutMs === 'number' ? startedAtMs + Math.max(0, options.totalTimeoutMs) : null;
  // soft 提示去重：同一 reader 生命周期内 total 只提示一次；idle 在重新有活动后可再次提示。
  let totalSoftNotified = false;
  let idleSoftNotified = false;
  const resolveLastActivityAtMs = (): number | null => {
    try {
      const value = options.getLastActivityAtMs?.();
      return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
    } catch {
      return null;
    }
  };

  const createHardTimeoutError = (kind: StreamReadTimeoutKind, timeoutMs: number): StreamReadTimeoutError =>
    new StreamReadTimeoutError(kind, timeoutMs, options.label);

  const notifySoftTimeout = (kind: StreamReadTimeoutKind, timeoutMs: number) => {
    if (kind === 'total') {
      if (totalSoftNotified) return;
      totalSoftNotified = true;
    } else {
      if (idleSoftNotified) return;
      idleSoftNotified = true;
    }
    const event: StreamSoftTimeoutEvent = {
      kind,
      timeoutMs,
      elapsedMs: Math.max(0, Date.now() - startedAtMs),
      ...(options.label ? { label: options.label } : {}),
    };
    options.onSoftTimeout?.(event);
  };

  return async function readWithTimeout<T>(
    reader: ReadableStreamDefaultReader<T>
  ): Promise<ReadableStreamReadResult<T>> {
    const readStartedAtMs = Date.now();

    if (mode === 'hard' && deadlineAtMs != null) {
      const remaining = deadlineAtMs - readStartedAtMs;
      if (remaining <= 0) {
        const error = createHardTimeoutError('total', options.totalTimeoutMs ?? 0);
        options.onTimeout?.(error);
        throw error;
      }
    }

    if (mode === 'soft' && deadlineAtMs != null && readStartedAtMs >= deadlineAtMs) {
      notifySoftTimeout('total', options.totalTimeoutMs ?? 0);
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const readPromise = reader.read();

    if (mode === 'soft') {
      // soft：不与 read race 切断；仅在后台定时观察，超时只提示。
      // total 已触发时仍继续监测 idle（内容长期无更新时也需要提示）。
      const scheduleSoftWatch = () => {
        const now = Date.now();
        const lastActivityAtMs = Math.max(readStartedAtMs, resolveLastActivityAtMs() ?? 0);
        const idleDeadlineAtMs = lastActivityAtMs + options.idleTimeoutMs;

        let nextCheckAtMs = idleDeadlineAtMs;
        if (deadlineAtMs != null && !totalSoftNotified) {
          nextCheckAtMs = Math.min(nextCheckAtMs, deadlineAtMs);
        }
        // total 已提示且 idle 也已提示时无需再 watch
        if (totalSoftNotified && idleSoftNotified) {
          return;
        }
        // 若 total 已提示，仍盯 idle；若 idle 已提示但 total 未到，只盯 total
        if (idleSoftNotified && deadlineAtMs != null && !totalSoftNotified) {
          nextCheckAtMs = deadlineAtMs;
        } else if (idleSoftNotified && (deadlineAtMs == null || totalSoftNotified)) {
          return;
        }

        const delayMs = Math.max(1, nextCheckAtMs - now);

        timeoutId = setTimeout(() => {
          const firedAtMs = Date.now();

          if (deadlineAtMs != null && firedAtMs >= deadlineAtMs) {
            notifySoftTimeout('total', options.totalTimeoutMs ?? 0);
          }

          const latestActivityAtMs = Math.max(readStartedAtMs, resolveLastActivityAtMs() ?? 0);
          if (latestActivityAtMs + options.idleTimeoutMs <= firedAtMs) {
            notifySoftTimeout('idle', options.idleTimeoutMs);
            // idle 已提示后，仅在 total 尚未提示时继续盯 total
            if (deadlineAtMs == null || totalSoftNotified) {
              timeoutId = null;
              return;
            }
          } else {
            // 有新活动时允许再次提示 idle
            idleSoftNotified = false;
          }

          scheduleSoftWatch();
        }, delayMs);
      };

      scheduleSoftWatch();

      try {
        return await readPromise;
      } finally {
        if (timeoutId != null) clearTimeout(timeoutId);
      }
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      const rejectHardTimeout = (kind: StreamReadTimeoutKind, timeoutMs: number) => {
        const error = createHardTimeoutError(kind, timeoutMs);
        reject(error);
        options.onTimeout?.(error);
      };

      const scheduleTimeout = () => {
        const now = Date.now();
        if (deadlineAtMs != null && now >= deadlineAtMs) {
          rejectHardTimeout('total', options.totalTimeoutMs ?? 0);
          return;
        }

        const lastActivityAtMs = Math.max(readStartedAtMs, resolveLastActivityAtMs() ?? 0);
        const idleDeadlineAtMs = lastActivityAtMs + options.idleTimeoutMs;
        const nextDeadlineAtMs = deadlineAtMs == null ? idleDeadlineAtMs : Math.min(idleDeadlineAtMs, deadlineAtMs);
        const delayMs = Math.max(1, nextDeadlineAtMs - now);

        timeoutId = setTimeout(() => {
          const firedAtMs = Date.now();
          if (deadlineAtMs != null && firedAtMs >= deadlineAtMs) {
            rejectHardTimeout('total', options.totalTimeoutMs ?? 0);
            return;
          }

          const latestActivityAtMs = Math.max(readStartedAtMs, resolveLastActivityAtMs() ?? 0);
          if (latestActivityAtMs + options.idleTimeoutMs > firedAtMs) {
            scheduleTimeout();
            return;
          }

          rejectHardTimeout('idle', options.idleTimeoutMs);
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
