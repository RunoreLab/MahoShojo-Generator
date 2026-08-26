import { ObserverRegistry } from './observer-registry';
import type {
  HostedGenerationLifecycleObservation,
  HostedGenerationOperation,
  HostedGenerationOutcome,
  HostedGenerationPlacement,
} from './generation-lifecycle';

export type { HostedGenerationLifecycleObservation } from './generation-lifecycle';

export type AiUpstreamOutcome = 'success' | 'error' | 'aborted' | 'timeout';

export type AiUpstreamFinishObservation = {
  outcome: AiUpstreamOutcome;
  durationMs: number;
};

export interface AiUpstreamAttemptObserver {
  recordTtfb(_durationMs: number): void;
  finish(_observation: AiUpstreamFinishObservation): void;
}

export type D1RoundTripOutcome = 'ok' | 'error';

export type D1RoundTripErrorClass =
  | 'none'
  | 'aborted'
  | 'timeout'
  | 'transport'
  | 'response'
  | 'unknown';

export type D1RoundTripInput = {
  durationMs: number;
  rowsRead: number;
  rowsWritten: number;
  outcome: D1RoundTripOutcome;
  errorClass?: D1RoundTripErrorClass;
};

export type D1RoundTripObservation = {
  durationMs: number;
  rowsRead: number;
  rowsWritten: number;
  outcome: D1RoundTripOutcome;
  errorClass: D1RoundTripErrorClass;
};

export interface HostedRuntimeObserver {
  beginAiUpstream(): AiUpstreamAttemptObserver;
  observeD1RoundTrip(_observation: D1RoundTripObservation): void;
  observeHostedGenerationLifecycle?(_observation: HostedGenerationLifecycleObservation): void;
}

const noopAttemptObserver: AiUpstreamAttemptObserver = Object.freeze({
  recordTtfb: () => undefined,
  finish: () => undefined,
});

export const noopHostedRuntimeObserver: HostedRuntimeObserver = Object.freeze({
  beginAiUpstream: () => noopAttemptObserver,
  observeD1RoundTrip: () => undefined,
  observeHostedGenerationLifecycle: () => undefined,
});

const observerRegistry = new ObserverRegistry<HostedRuntimeObserver>();

const currentObserver = (): HostedRuntimeObserver => (
  observerRegistry.current() ?? noopHostedRuntimeObserver
);

export const registerHostedRuntimeObserver = (
  observer: HostedRuntimeObserver,
): (() => void) => observerRegistry.register(observer);

export const resetHostedRuntimeObserverForTests = (): void => {
  observerRegistry.clear();
};

const normalizeNonNegativeFinite = (value: number): number => Math.min(
  Number.MAX_SAFE_INTEGER,
  Number.isFinite(value) && value > 0 ? value : 0,
);

const normalizeNonNegativeInteger = (value: number): number => Math.min(
  Number.MAX_SAFE_INTEGER,
  Math.floor(normalizeNonNegativeFinite(value)),
);

const normalizeAiOutcome = (value: AiUpstreamOutcome): AiUpstreamOutcome => {
  switch (value) {
    case 'success':
    case 'error':
    case 'aborted':
    case 'timeout':
      return value;
    default:
      return 'error';
  }
};

const normalizeD1Outcome = (value: D1RoundTripOutcome): D1RoundTripOutcome => (
  value === 'ok' ? 'ok' : 'error'
);

const normalizeD1ErrorClass = (
  value: D1RoundTripErrorClass | undefined,
  outcome: D1RoundTripOutcome,
): D1RoundTripErrorClass => {
  if (outcome === 'ok') return 'none';
  switch (value) {
    case 'aborted':
    case 'timeout':
    case 'transport':
    case 'response':
    case 'unknown':
      return value;
    default:
      return 'unknown';
  }
};

const safely = (callback: () => void): void => {
  try {
    callback();
  } catch {
    // Telemetry observer 失败不得改变业务调用。
  }
};

export const beginAiUpstream = (): AiUpstreamAttemptObserver => {
  let attemptObserver = noopAttemptObserver;
  safely(() => {
    attemptObserver = currentObserver().beginAiUpstream();
  });

  let ttfbRecorded = false;
  let finished = false;

  return {
    recordTtfb(durationMs) {
      if (finished || ttfbRecorded) return;
      ttfbRecorded = true;
      safely(() => attemptObserver.recordTtfb(normalizeNonNegativeFinite(durationMs)));
    },
    finish(observation) {
      if (finished) return;
      finished = true;
      const normalized: AiUpstreamFinishObservation = {
        outcome: normalizeAiOutcome(observation.outcome),
        durationMs: normalizeNonNegativeFinite(observation.durationMs),
      };
      safely(() => attemptObserver.finish(normalized));
    },
  };
};

export const observeD1RoundTrip = (observation: D1RoundTripInput): void => {
  const outcome = normalizeD1Outcome(observation.outcome);
  const normalized: D1RoundTripObservation = {
    durationMs: normalizeNonNegativeFinite(observation.durationMs),
    rowsRead: normalizeNonNegativeInteger(observation.rowsRead),
    rowsWritten: normalizeNonNegativeInteger(observation.rowsWritten),
    outcome,
    errorClass: normalizeD1ErrorClass(observation.errorClass, outcome),
  };
  safely(() => currentObserver().observeD1RoundTrip(normalized));
};

const normalizeHostedGenerationOperation = (
  value: HostedGenerationOperation,
): HostedGenerationOperation => {
  switch (value) {
    case 'generate-magical-girl-details':
    case 'generate-magical-girl-details-stream':
    case 'generate-sublimation':
    case 'generate-sublimation-stream':
      return value;
    default:
      return 'generate-sublimation';
  }
};

const normalizeHostedGenerationPlacement = (
  value: HostedGenerationPlacement,
): HostedGenerationPlacement => value === 'hono-primary' ? value : 'next-dr';

const normalizeHostedGenerationOutcome = (
  value: HostedGenerationOutcome,
): HostedGenerationOutcome => {
  switch (value) {
    case 'success':
    case 'rejected':
    case 'failure':
    case 'cancelled':
      return value;
    default:
      return 'failure';
  }
};

export const observeHostedGenerationLifecycle = (
  observation: HostedGenerationLifecycleObservation,
): void => {
  const normalized: HostedGenerationLifecycleObservation = {
    event: 'hosted-generation',
    operation: normalizeHostedGenerationOperation(observation.operation),
    placement: normalizeHostedGenerationPlacement(observation.placement),
    outcome: normalizeHostedGenerationOutcome(observation.outcome),
    durationMs: normalizeNonNegativeFinite(observation.durationMs),
  };
  safely(() => currentObserver().observeHostedGenerationLifecycle?.(normalized));
};
