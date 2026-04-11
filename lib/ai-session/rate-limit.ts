import { OFFICIAL_KEY_ARENA_BATTLE_REPORT_COOLDOWN_MS, USER_PROVIDED_KEY_COOLDOWN_MS } from '@/lib/ai/cooldowns';
import { anonymizeIp, getClientIpFromHeaders } from '@/lib/arena/battle-report-log-utils';

export type AiSessionRateLimitAction =
  | 'battle_story_session_continue'
  | 'battle_story_session_regenerate_chapter'
  | 'battle_story_session_refresh_summary'
  | 'challenge_node_adjudicate';

type TokenBucketState = {
  tokens: number;
  updatedAt: number;
};

type SessionLeaseState = {
  lastAcceptedAt: number;
  inFlight: number;
};

type RateLimitRule = {
  cooldownMs: number;
  bucketCapacity: number;
  bucketWindowMs: number;
  disallowConcurrent: boolean;
};

export type AcquireAiSessionSoftRateLimitInput = {
  req: Request;
  actionType: AiSessionRateLimitAction;
  sessionId?: string | null;
  providerMode: 'system' | 'custom';
  nowMs?: number;
};

export type AcquireAiSessionSoftRateLimitResult =
  | {
      allowed: true;
      retryAfterSeconds: 0;
      release: () => void;
    }
  | {
      allowed: false;
      retryAfterSeconds: number;
      reason: 'session_in_flight' | 'session_cooldown' | 'ip_burst';
    };

const sessionLeaseStates = new Map<string, SessionLeaseState>();
const ipBucketStates = new Map<string, TokenBucketState>();

const clampRetryAfterSeconds = (valueMs: number): number => {
  return Math.max(1, Math.ceil(Math.max(1, valueMs) / 1000));
};

const getRateLimitRule = (
  actionType: AiSessionRateLimitAction,
  providerMode: 'system' | 'custom'
): RateLimitRule => {
  const isSystem = providerMode === 'system';

  if (actionType === 'battle_story_session_refresh_summary') {
    return {
      cooldownMs: isSystem ? 15_000 : USER_PROVIDED_KEY_COOLDOWN_MS,
      bucketCapacity: isSystem ? 8 : 40,
      bucketWindowMs: 10 * 60_000,
      disallowConcurrent: true,
    };
  }

  if (actionType === 'battle_story_session_regenerate_chapter') {
    return {
      cooldownMs: isSystem ? OFFICIAL_KEY_ARENA_BATTLE_REPORT_COOLDOWN_MS : USER_PROVIDED_KEY_COOLDOWN_MS,
      bucketCapacity: isSystem ? 3 : 30,
      bucketWindowMs: 10 * 60_000,
      disallowConcurrent: true,
    };
  }

  if (actionType === 'challenge_node_adjudicate') {
    return {
      // Challenge AI adjudication intentionally shares the same official-key budget as arena battle reports.
      cooldownMs: isSystem ? OFFICIAL_KEY_ARENA_BATTLE_REPORT_COOLDOWN_MS : USER_PROVIDED_KEY_COOLDOWN_MS,
      bucketCapacity: isSystem ? 3 : 30,
      bucketWindowMs: 10 * 60_000,
      disallowConcurrent: true,
    };
  }

  return {
    cooldownMs: isSystem ? OFFICIAL_KEY_ARENA_BATTLE_REPORT_COOLDOWN_MS : USER_PROVIDED_KEY_COOLDOWN_MS,
    bucketCapacity: isSystem ? 3 : 30,
    bucketWindowMs: 10 * 60_000,
    disallowConcurrent: true,
  };
};

const consumeTokenBucket = (
  key: string,
  rule: Pick<RateLimitRule, 'bucketCapacity' | 'bucketWindowMs'>,
  nowMs: number
): { allowed: boolean; retryAfterSeconds: number } => {
  const refillPerMs = rule.bucketCapacity / rule.bucketWindowMs;
  const current = ipBucketStates.get(key) ?? {
    tokens: rule.bucketCapacity,
    updatedAt: nowMs,
  };

  const elapsed = Math.max(0, nowMs - current.updatedAt);
  const refilled = Math.min(rule.bucketCapacity, current.tokens + elapsed * refillPerMs);

  if (refilled < 1) {
    const missing = 1 - refilled;
    const retryAfterSeconds = clampRetryAfterSeconds(missing / refillPerMs);
    ipBucketStates.set(key, {
      tokens: refilled,
      updatedAt: nowMs,
    });
    return { allowed: false, retryAfterSeconds };
  }

  ipBucketStates.set(key, {
    tokens: refilled - 1,
    updatedAt: nowMs,
  });
  return { allowed: true, retryAfterSeconds: 0 };
};

export const acquireAiSessionSoftRateLimit = (
  input: AcquireAiSessionSoftRateLimitInput
): AcquireAiSessionSoftRateLimitResult => {
  const nowMs = typeof input.nowMs === 'number' ? input.nowMs : Date.now();
  const rule = getRateLimitRule(input.actionType, input.providerMode);
  const safeSessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : '';
  const requestIp = getClientIpFromHeaders(input.req.headers);
  const ipAnonymized = anonymizeIp(requestIp) ?? 'unknown';

  if (safeSessionId) {
    const sessionKey = `${input.providerMode}:${input.actionType}:${safeSessionId}`;
    const current = sessionLeaseStates.get(sessionKey) ?? {
      lastAcceptedAt: 0,
      inFlight: 0,
    };

    if (rule.disallowConcurrent && current.inFlight > 0) {
      return {
        allowed: false,
        retryAfterSeconds: clampRetryAfterSeconds(rule.cooldownMs),
        reason: 'session_in_flight',
      };
    }

    const elapsed = nowMs - current.lastAcceptedAt;
    if (current.lastAcceptedAt > 0 && elapsed < rule.cooldownMs) {
      return {
        allowed: false,
        retryAfterSeconds: clampRetryAfterSeconds(rule.cooldownMs - elapsed),
        reason: 'session_cooldown',
      };
    }

    const bucketKey = `${input.providerMode}:${input.actionType}:${ipAnonymized}`;
    const bucketResult = consumeTokenBucket(bucketKey, rule, nowMs);
    if (!bucketResult.allowed) {
      return {
        allowed: false,
        retryAfterSeconds: bucketResult.retryAfterSeconds,
        reason: 'ip_burst',
      };
    }

    sessionLeaseStates.set(sessionKey, {
      lastAcceptedAt: nowMs,
      inFlight: current.inFlight + 1,
    });

    return {
      allowed: true,
      retryAfterSeconds: 0,
      release: () => {
        const latest = sessionLeaseStates.get(sessionKey);
        if (!latest) return;
        const nextInFlight = Math.max(0, latest.inFlight - 1);
        sessionLeaseStates.set(sessionKey, {
          ...latest,
          inFlight: nextInFlight,
        });
      },
    };
  }

  const bucketKey = `${input.providerMode}:${input.actionType}:${ipAnonymized}`;
  const bucketResult = consumeTokenBucket(bucketKey, rule, nowMs);
  if (!bucketResult.allowed) {
    return {
      allowed: false,
      retryAfterSeconds: bucketResult.retryAfterSeconds,
      reason: 'ip_burst',
    };
  }

  return {
    allowed: true,
    retryAfterSeconds: 0,
    release: () => undefined,
  };
};

export const __resetAiSessionSoftRateLimitForTest = (): void => {
  sessionLeaseStates.clear();
  ipBucketStates.clear();
};
