const createAbortError = (reason?: unknown): Error => {
  if (reason instanceof Error) return reason;
  const error = new Error(typeof reason === 'string' && reason ? reason : 'The operation was aborted');
  error.name = 'AbortError';
  return error;
};

const CLIENT_CONNECTION_PREMATURELY_CLOSED = 'client connection prematurely closed';

const readErrorMessage = (reason: unknown): string => {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === 'string') return reason;
  if (!reason || typeof reason !== 'object') return '';

  const message = (reason as { message?: unknown }).message;
  return typeof message === 'string' ? message : '';
};

export const isExpectedClientDisconnect = (reason: unknown): boolean => {
  const normalizedMessage = readErrorMessage(reason).trim().toLowerCase();
  return normalizedMessage === CLIENT_CONNECTION_PREMATURELY_CLOSED
    || normalizedMessage === `${CLIENT_CONNECTION_PREMATURELY_CLOSED}.`;
};

export const isAbortErrorLike = (error: unknown): boolean => {
  if (isExpectedClientDisconnect(error)) return true;
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
