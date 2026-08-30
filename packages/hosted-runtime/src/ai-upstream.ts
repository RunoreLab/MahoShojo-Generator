import {
  beginAiUpstream,
  type AiUpstreamOutcome,
} from './telemetry';

export type AiUpstreamAttemptRuntime = {
  recordTtfb(): void;
  finish(_outcome: AiUpstreamOutcome): void;
};

const readErrorText = (error: object, key: 'name' | 'code' | 'message'): string => {
  try {
    const value = (error as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
};

export const classifyAiUpstreamOutcome = (error: unknown): AiUpstreamOutcome => {
  if (error == null) return 'aborted';

  let name = '';
  let code = '';
  let message = '';
  if (typeof error === 'object' || typeof error === 'function') {
    name = readErrorText(error, 'name');
    code = readErrorText(error, 'code');
    message = readErrorText(error, 'message');
  } else {
    try {
      message = String(error);
    } catch {
      return 'error';
    }
  }

  if (name === 'AbortError' || code === 'ABORT_ERR') return 'aborted';
  if (
    name === 'StreamReadTimeoutError'
    || name === 'TimeoutError'
    || code === 'ETIMEDOUT'
    || code === 'UND_ERR_CONNECT_TIMEOUT'
  ) {
    return 'timeout';
  }

  const lowered = `${name} ${code} ${message}`.toLowerCase();
  if (lowered.includes('abort')) return 'aborted';
  if (lowered.includes('timeout') || message.includes('超时')) return 'timeout';
  return 'error';
};

const monotonicNow = (): number => (
  typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now()
);

export const createAiUpstreamAttemptRuntime = (
  now: () => number = monotonicNow,
): AiUpstreamAttemptRuntime => {
  const observer = beginAiUpstream();
  const startedAt = now();
  let ttfbRecorded = false;
  let finished = false;
  const elapsed = (): number => Math.max(0, now() - startedAt);

  return {
    recordTtfb() {
      if (finished || ttfbRecorded) return;
      ttfbRecorded = true;
      observer.recordTtfb(elapsed());
    },
    finish(outcome) {
      if (finished) return;
      finished = true;
      observer.finish({ outcome, durationMs: elapsed() });
    },
  };
};
