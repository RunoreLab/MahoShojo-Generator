export const STREAM_ABORT_REASON_USER = 'user';
export const STREAM_ABORT_REASON_CONTENT_POLICY = 'content_policy';
export const STREAM_ABORT_REASON_OUTPUT_SAFETY = 'output-safety';
export const STREAM_ABORT_REASON_TIMEOUT = 'timeout';

export type StreamAbortReason =
  | typeof STREAM_ABORT_REASON_USER
  | typeof STREAM_ABORT_REASON_CONTENT_POLICY
  | typeof STREAM_ABORT_REASON_OUTPUT_SAFETY
  | typeof STREAM_ABORT_REASON_TIMEOUT;

export const isAbortErrorLike = (error: unknown): boolean => {
  if (!error) return false;
  const record = error as { name?: unknown; message?: unknown };
  const name = typeof record.name === 'string' ? record.name.toLowerCase() : '';
  const message = typeof record.message === 'string' ? record.message.toLowerCase() : '';
  return name === 'aborterror' || message.includes('aborted') || message.includes('中断');
};

export const resolveAbortReason = (signal?: AbortSignal | null, error?: unknown): string | null => {
  if (signal?.aborted) {
    const reason = signal.reason;
    if (typeof reason === 'string' && reason.trim()) return reason;
  }
  if (isAbortErrorLike(error)) return STREAM_ABORT_REASON_USER;
  return null;
};

export const isManualStopReason = (reason: unknown): boolean => reason === STREAM_ABORT_REASON_USER;
export const isOutputSafetyStopReason = (reason: unknown): boolean => reason === STREAM_ABORT_REASON_OUTPUT_SAFETY;

export const relayAbortSignal = (
  sourceSignal: AbortSignal | null | undefined,
  targetController: AbortController,
): (() => void) => {
  if (!sourceSignal) {
    return () => {};
  }

  if (sourceSignal.aborted) {
    if (!targetController.signal.aborted) {
      targetController.abort(sourceSignal.reason);
    }
    return () => {};
  }

  const handleAbort = () => {
    if (!targetController.signal.aborted) {
      targetController.abort(sourceSignal.reason);
    }
  };

  sourceSignal.addEventListener('abort', handleAbort, { once: true });

  return () => {
    sourceSignal.removeEventListener('abort', handleAbort);
  };
};
