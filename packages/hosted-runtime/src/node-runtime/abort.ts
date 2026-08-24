const createAbortError = (reason?: unknown): Error => {
  if (reason instanceof Error) return reason;
  const error = new Error(typeof reason === 'string' && reason ? reason : 'The operation was aborted');
  error.name = 'AbortError';
  return error;
};

export const isAbortErrorLike = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return candidate.name === 'AbortError' || candidate.code === 'ABORT_ERR';
};

export const isAbortRequested = (
  signal: AbortSignal | undefined,
  error?: unknown,
): boolean => signal?.aborted === true || isAbortErrorLike(error);

export const throwIfAborted = (signal?: AbortSignal): void => {
  if (!signal?.aborted) return;
  throw createAbortError(signal.reason);
};
