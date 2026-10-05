import { getCloudflareContext } from '@opennextjs/cloudflare';

type RateLimiter = {
  limit: (input: { key: string }) => Promise<{ success: boolean }>;
};

export type HostedDrTelemetryRateLimitBindings = {
  HOSTED_DR_TELEMETRY_SOURCE_LIMITER?: RateLimiter;
  HOSTED_DR_TELEMETRY_AGGREGATE_LIMITER?: RateLimiter;
};

export type HostedDrTelemetryRateLimitResult = Readonly<{
  allowed: boolean;
  limitedBy: 'source' | 'aggregate' | null;
  mode: 'cloudflare-binding' | 'best-effort-local';
}>;

export type HostedDrTelemetryLocalRateLimiter = (
  sourceKey: string,
  now: number,
) => boolean;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_EVENTS = 120;
const AGGREGATE_RATE_LIMIT_MAX_EVENTS = 2_048;
const MAX_RATE_LIMIT_KEYS = 1_024;
const AGGREGATE_RATE_LIMIT_KEY = 'hosted-dr-client';

type RateLimitBucket = {
  startedAt: number;
  count: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const sourceIdentityOf = (request: Request): string => {
  const forwardedAddress = request.headers.get('cf-connecting-ip')?.trim() ?? '';
  return forwardedAddress.length > 0 && forwardedAddress.length <= 128
    ? `source:${forwardedAddress}`
    : 'source:anonymous';
};

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const sourceRateLimitKeyOf = async (request: Request): Promise<string> => {
  try {
    return `source:${await sha256(sourceIdentityOf(request))}`;
  } catch {
    // Workers and the supported Node test runtime both expose Web Crypto. Keep a
    // bounded local fallback even if a non-standard test runtime does not.
    return sourceIdentityOf(request);
  }
};

const getOldestKey = (buckets: Map<string, RateLimitBucket>): string | null => {
  let oldestKey: string | null = null;
  let oldestStartedAt = Number.POSITIVE_INFINITY;
  for (const [key, bucket] of buckets) {
    if (bucket.startedAt >= oldestStartedAt) continue;
    oldestKey = key;
    oldestStartedAt = bucket.startedAt;
  }
  return oldestKey;
};

/**
 * Deliberately local, bounded fallback for local/test runs or a missing binding.
 * It is not a deployment-wide quota and must not be described as one.
 */
export const createHostedDrTelemetryLocalRateLimiter = (): HostedDrTelemetryLocalRateLimiter => {
  const sourceBuckets = new Map<string, RateLimitBucket>();
  let aggregateBucket: RateLimitBucket | null = null;

  const bucketFor = (
    buckets: Map<string, RateLimitBucket>,
    key: string,
    now: number,
  ): RateLimitBucket => {
    const existing = buckets.get(key);
    if (existing && now - existing.startedAt < RATE_LIMIT_WINDOW_MS) return existing;

    if (!existing && buckets.size >= MAX_RATE_LIMIT_KEYS) {
      const oldestKey = getOldestKey(buckets);
      if (oldestKey) buckets.delete(oldestKey);
    }

    const bucket = { startedAt: now, count: 0 };
    buckets.set(key, bucket);
    return bucket;
  };

  return (sourceKey, now) => {
    const sourceBucket = bucketFor(sourceBuckets, sourceKey, now);
    if (sourceBucket.count >= RATE_LIMIT_MAX_EVENTS) return false;

    if (!aggregateBucket || now - aggregateBucket.startedAt >= RATE_LIMIT_WINDOW_MS) {
      aggregateBucket = { startedAt: now, count: 0 };
    }
    if (aggregateBucket.count >= AGGREGATE_RATE_LIMIT_MAX_EVENTS) return false;

    sourceBucket.count += 1;
    aggregateBucket.count += 1;
    return true;
  };
};

export const getHostedDrTelemetryRateLimitBindings = (): HostedDrTelemetryRateLimitBindings | null => {
  try {
    const { env } = getCloudflareContext();
    if (!isRecord(env)) return null;
    return env as HostedDrTelemetryRateLimitBindings;
  } catch {
    return null;
  }
};

export const enforceHostedDrTelemetryRateLimit = async ({
  request,
  bindings,
  localLimiter,
  now = Date.now(),
}: {
  request: Request;
  bindings: HostedDrTelemetryRateLimitBindings | null;
  localLimiter: HostedDrTelemetryLocalRateLimiter;
  now?: number;
}): Promise<HostedDrTelemetryRateLimitResult> => {
  const sourceKey = await sourceRateLimitKeyOf(request);
  const sourceLimiter = bindings?.HOSTED_DR_TELEMETRY_SOURCE_LIMITER;
  const aggregateLimiter = bindings?.HOSTED_DR_TELEMETRY_AGGREGATE_LIMITER;

  if (!sourceLimiter || !aggregateLimiter) {
    return {
      allowed: localLimiter(sourceKey, now),
      limitedBy: null,
      mode: 'best-effort-local',
    };
  }

  try {
    const sourceResult = await sourceLimiter.limit({ key: sourceKey });
    if (!sourceResult.success) {
      return { allowed: false, limitedBy: 'source', mode: 'cloudflare-binding' };
    }

    const aggregateResult = await aggregateLimiter.limit({ key: AGGREGATE_RATE_LIMIT_KEY });
    if (!aggregateResult.success) {
      return { allowed: false, limitedBy: 'aggregate', mode: 'cloudflare-binding' };
    }

    return { allowed: true, limitedBy: null, mode: 'cloudflare-binding' };
  } catch {
    return {
      allowed: localLimiter(sourceKey, now),
      limitedBy: null,
      mode: 'best-effort-local',
    };
  }
};
