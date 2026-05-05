import type { DataCardInteractionActorScope } from '@/lib/db/schema';

export type AcquireDataCardStatsRateLimitInput = {
  actorScope: DataCardInteractionActorScope;
  actorKeyHash: string;
  nowMs?: number;
};

export type DataCardStatsRateLimitResult =
  | { allowed: true; retryAfterSeconds: 0 }
  | { allowed: false; retryAfterSeconds: number };

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 30;
const SWEEP_INTERVAL = 256;

type RateLimitBucket = {
  windowStartMs: number;
  count: number;
};

const buckets = new Map<string, RateLimitBucket>();
let acquireCallCount = 0;

const buildKey = (input: AcquireDataCardStatsRateLimitInput): string =>
  `${input.actorScope}:${input.actorKeyHash}`;

const maybeSweepExpiredBuckets = (nowMs: number): void => {
  acquireCallCount += 1;
  if (acquireCallCount % SWEEP_INTERVAL !== 0) return;

  for (const [key, bucket] of buckets.entries()) {
    if (nowMs - bucket.windowStartMs >= WINDOW_MS) {
      buckets.delete(key);
    }
  }
};

export const acquireDataCardStatsRateLimit = (
  input: AcquireDataCardStatsRateLimitInput,
): DataCardStatsRateLimitResult => {
  const nowMs = typeof input.nowMs === 'number' ? input.nowMs : Date.now();
  maybeSweepExpiredBuckets(nowMs);

  const key = buildKey(input);
  const current = buckets.get(key);
  if (!current || nowMs - current.windowStartMs >= WINDOW_MS) {
    buckets.set(key, { windowStartMs: nowMs, count: 1 });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (current.count >= MAX_REQUESTS_PER_WINDOW) {
    const retryAfterMs = WINDOW_MS - (nowMs - current.windowStartMs);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
};

export const __resetDataCardStatsRateLimitForTest = (): void => {
  buckets.clear();
  acquireCallCount = 0;
};
