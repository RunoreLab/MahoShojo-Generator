import {
  beginAiUpstream,
  type AiUpstreamOutcome,
} from './telemetry';

export type AiUpstreamAttemptRuntime = {
  recordTtfb(): void;
  finish(_outcome: AiUpstreamOutcome): void;
};

export const classifyAiUpstreamOutcome = (error: unknown): AiUpstreamOutcome => {
  if (error == null) return 'aborted';
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  const lowered = message.toLowerCase();
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
