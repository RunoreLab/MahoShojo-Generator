export const GENERATION_RANKING_MAX_ATTEMPTS = 8;
export const GENERATION_RANKING_MAX_DURATION_MS = 60_000;

const BACKOFF_MS = [2_000, 5_000, 10_000, 20_000] as const;

type GenerationRankingPollingState = {
  enabled: boolean;
  pending: boolean;
  attemptCount: number;
  elapsedMs: number;
};

export const getGenerationRankingRefetchInterval = ({
  enabled,
  pending,
  attemptCount,
  elapsedMs,
}: GenerationRankingPollingState): number | false => {
  if (!enabled || !pending) return false;
  if (attemptCount >= GENERATION_RANKING_MAX_ATTEMPTS) return false;
  if (elapsedMs >= GENERATION_RANKING_MAX_DURATION_MS) return false;

  const backoffIndex = Math.min(Math.max(0, attemptCount - 1), BACKOFF_MS.length - 1);
  return BACKOFF_MS[backoffIndex];
};
