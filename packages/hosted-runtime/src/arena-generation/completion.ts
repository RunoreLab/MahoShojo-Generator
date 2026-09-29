import { createSafePublicAiError, getPublicAiErrorMessage } from '@mahoshojo/hosted-api/regular-generation';

const finishReasons = new Set(['stop', 'length', 'content-filter', 'tool-calls', 'error', 'other', 'unknown']);
export const normalizeFinishReason = (value: unknown): string =>
  typeof value === 'string' && finishReasons.has(value) ? value : 'unknown';

/** Undefined is reserved for executors that do not use streaming (e.g. validated structured output). */
export const assertStreamCompletion = (telemetry: Record<string, unknown>): void => {
  if (telemetry.finishReason === undefined) return;
  const reason = normalizeFinishReason(telemetry.finishReason);
  if (reason === 'stop') return;
  const code = reason === 'length' ? 'AI_OUTPUT_TRUNCATED'
    : reason === 'content-filter' ? 'AI_OUTPUT_FILTERED' : 'AI_STREAM_INCOMPLETE';
  throw createSafePublicAiError({ code, message: getPublicAiErrorMessage(code)! });
};

/** Do not archive cancellation, policy rejection, malformed executable Web output or arbitrary failures. */
export const canArchivePartialOutput = (input: {
  status: string; errorCode?: string | null; metadata?: Record<string, unknown>;
}): boolean => input.status === 'failed'
  && !['web-document', 'web-package-target', 'structured-report'].includes(String(input.metadata?.outputContract))
  && ['AI_OUTPUT_TRUNCATED', 'AI_STREAM_INCOMPLETE', 'AI_UPSTREAM_REQUEST_FAILED', 'AI_UPSTREAM_TIMEOUT']
    .includes(input.errorCode ?? '');

/** Bounded diagnostics only; never persist arbitrary telemetry/provider data. */
export const completionDiagnostics = (telemetry: Record<string, unknown>): Record<string, unknown> => {
  const raw = telemetry.streamCompletion;
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const result: Record<string, unknown> = {};
  if (telemetry.finishReason !== undefined) result.finishReason = normalizeFinishReason(telemetry.finishReason);
  for (const key of ['sdkFinishEvent', 'streamError'] as const) {
    if (typeof source[key] === 'boolean') result[key] = source[key];
  }
  for (const key of ['maxOutputTokens', 'textChars', 'firstTextMs', 'lastTextMs'] as const) {
    const value = source[key];
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) result[key] = value;
  }
  if (['default', 'enabled', 'disabled'].includes(String(source.thinkingMode))) result.thinkingMode = source.thinkingMode;
  if (['applied', 'default', 'unsupported', 'unknown', 'cannot-disable'].includes(String(source.thinkingDisposition))) {
    result.thinkingDisposition = source.thinkingDisposition;
  }
  return result;
};
