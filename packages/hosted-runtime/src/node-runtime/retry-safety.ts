export type AiRetrySafety = 'pre-dispatch-safe' | 'non-replayable';

type RetrySafetyCarrier = {
  retrySafety?: unknown;
};

export const markAiRetrySafety = (
  error: unknown,
  retrySafety: AiRetrySafety,
): Error & { retrySafety: AiRetrySafety } => {
  const target = error instanceof Error ? error : new Error(String(error));
  Object.defineProperty(target, 'retrySafety', {
    configurable: true,
    enumerable: false,
    value: retrySafety,
  });
  return target as Error & { retrySafety: AiRetrySafety };
};

export const readAiRetrySafety = (error: unknown): AiRetrySafety | null => {
  if (!error || typeof error !== 'object') return null;
  const value = (error as RetrySafetyCarrier).retrySafety;
  return value === 'pre-dispatch-safe' || value === 'non-replayable' ? value : null;
};

export const isAiPreDispatchRetrySafe = (error: unknown): boolean => (
  readAiRetrySafety(error) === 'pre-dispatch-safe'
);
