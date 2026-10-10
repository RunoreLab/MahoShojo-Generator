import {
  DEFAULT_STREAM_READ_IDLE_TIMEOUT_MS,
  DEFAULT_STREAM_READ_TOTAL_TIMEOUT_MS,
} from '@mahoshojo/ai-core/stream-timeout';

export {
  buildStreamSoftTimeoutMessage,
  createStreamReadWithTimeout,
  StreamReadTimeoutError,
  type CreateStreamReadWithTimeoutOptions,
  type StreamReadTimeoutKind,
  type StreamReadTimeoutMode,
  type StreamSoftTimeoutEvent,
} from '@mahoshojo/ai-core/stream-timeout';

const parsePositiveTimeoutMs = (value: string | undefined, fallback: number): number => {
  if (typeof value !== 'string') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed <= 0) return fallback;
  return Math.floor(parsed);
};

export const STREAM_READ_IDLE_TIMEOUT_MS = parsePositiveTimeoutMs(
  process.env.NEXT_PUBLIC_STREAM_READ_IDLE_TIMEOUT_MS,
  DEFAULT_STREAM_READ_IDLE_TIMEOUT_MS
);
export const STREAM_READ_TOTAL_TIMEOUT_MS = parsePositiveTimeoutMs(
  process.env.NEXT_PUBLIC_STREAM_READ_TOTAL_TIMEOUT_MS,
  DEFAULT_STREAM_READ_TOTAL_TIMEOUT_MS
);
