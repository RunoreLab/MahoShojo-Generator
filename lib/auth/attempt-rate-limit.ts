import { getClientIpFromHeaders } from '@/lib/arena/battle-report-log-utils';

export type AuthAttemptAction = 'register' | 'login';

export type AcquireAuthAttemptRateLimitInput = {
  req: Request;
  actionType: AuthAttemptAction;
  identifier?: string | null;
  email?: string | null;
  username?: string | null;
  nowMs?: number;
};

export type AcquireAuthAttemptRateLimitResult =
  | {
      allowed: true;
      retryAfterSeconds: 0;
    }
  | {
      allowed: false;
      retryAfterSeconds: number;
      reason: 'ip_burst' | 'identifier_burst' | 'email_burst' | 'username_burst';
      scope: 'ip' | 'identifier' | 'email' | 'username';
    };

export type AuthAttemptRateLimitRejectedResult = Extract<AcquireAuthAttemptRateLimitResult, { allowed: false }>;

type TokenBucketRule = {
  capacity: number;
  windowMs: number;
};

type TokenBucketState = {
  tokens: number;
  updatedAt: number;
};

const bucketStates = new Map<string, TokenBucketState>();

const SWEEP_INTERVAL = 256;
const SWEEP_STALE_AFTER_MS = 2 * 60 * 60 * 1000;

const REGISTER_IP_RULE: TokenBucketRule = {
  capacity: 6,
  windowMs: 10 * 60 * 1000,
};

const REGISTER_EMAIL_RULE: TokenBucketRule = {
  capacity: 3,
  windowMs: 30 * 60 * 1000,
};

const REGISTER_USERNAME_RULE: TokenBucketRule = {
  capacity: 3,
  windowMs: 30 * 60 * 1000,
};

const LOGIN_IP_RULE: TokenBucketRule = {
  capacity: 12,
  windowMs: 10 * 60 * 1000,
};

const LOGIN_IDENTIFIER_RULE: TokenBucketRule = {
  capacity: 8,
  windowMs: 10 * 60 * 1000,
};

let acquireCallCount = 0;

const clampRetryAfterSeconds = (valueMs: number): number => {
  return Math.max(1, Math.ceil(Math.max(1, valueMs) / 1000));
};

const normalizeScopeValue = (value: string | null | undefined): string => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
};

const getRequestIpKey = (req: Request): string => {
  const ip = getClientIpFromHeaders(req.headers)?.trim();
  return ip || 'unknown';
};

const maybeSweepExpiredStates = (nowMs: number): void => {
  acquireCallCount += 1;
  if (acquireCallCount % SWEEP_INTERVAL !== 0) return;

  for (const [key, state] of bucketStates.entries()) {
    if (nowMs - state.updatedAt > SWEEP_STALE_AFTER_MS) {
      bucketStates.delete(key);
    }
  }
};

const consumeTokenBucket = (
  key: string,
  rule: TokenBucketRule,
  nowMs: number,
): { allowed: true; retryAfterSeconds: 0 } | { allowed: false; retryAfterSeconds: number } => {
  const refillPerMs = rule.capacity / rule.windowMs;
  const current = bucketStates.get(key) ?? {
    tokens: rule.capacity,
    updatedAt: nowMs,
  };

  const elapsed = Math.max(0, nowMs - current.updatedAt);
  const refilled = Math.min(rule.capacity, current.tokens + elapsed * refillPerMs);

  if (refilled < 1) {
    const missing = 1 - refilled;
    bucketStates.set(key, {
      tokens: refilled,
      updatedAt: nowMs,
    });
    return {
      allowed: false,
      retryAfterSeconds: clampRetryAfterSeconds(missing / refillPerMs),
    };
  }

  bucketStates.set(key, {
    tokens: refilled - 1,
    updatedAt: nowMs,
  });
  return {
    allowed: true,
    retryAfterSeconds: 0,
  };
};

export const acquireAuthAttemptRateLimit = (
  input: AcquireAuthAttemptRateLimitInput,
): AcquireAuthAttemptRateLimitResult => {
  const nowMs = typeof input.nowMs === 'number' ? input.nowMs : Date.now();
  maybeSweepExpiredStates(nowMs);

  const checks: Array<{
    key: string;
    rule: TokenBucketRule;
    reason: AuthAttemptRateLimitRejectedResult['reason'];
    scope: AuthAttemptRateLimitRejectedResult['scope'];
  }> = [];

  const requestIpKey = getRequestIpKey(input.req);

  if (input.actionType === 'register') {
    checks.push({
      key: `register:ip:${requestIpKey}`,
      rule: REGISTER_IP_RULE,
      reason: 'ip_burst',
      scope: 'ip',
    });

    const normalizedEmail = normalizeScopeValue(input.email);
    if (normalizedEmail) {
      checks.push({
        key: `register:email:${normalizedEmail}`,
        rule: REGISTER_EMAIL_RULE,
        reason: 'email_burst',
        scope: 'email',
      });
    }

    const normalizedUsername = normalizeScopeValue(input.username);
    if (normalizedUsername) {
      checks.push({
        key: `register:username:${normalizedUsername}`,
        rule: REGISTER_USERNAME_RULE,
        reason: 'username_burst',
        scope: 'username',
      });
    }
  } else {
    checks.push({
      key: `login:ip:${requestIpKey}`,
      rule: LOGIN_IP_RULE,
      reason: 'ip_burst',
      scope: 'ip',
    });

    const normalizedIdentifier = normalizeScopeValue(input.identifier);
    if (normalizedIdentifier) {
      checks.push({
        key: `login:identifier:${normalizedIdentifier}`,
        rule: LOGIN_IDENTIFIER_RULE,
        reason: 'identifier_burst',
        scope: 'identifier',
      });
    }
  }

  for (const check of checks) {
    const result = consumeTokenBucket(check.key, check.rule, nowMs);
    if (!result.allowed) {
      return {
        allowed: false,
        retryAfterSeconds: result.retryAfterSeconds,
        reason: check.reason,
        scope: check.scope,
      };
    }
  }

  return {
    allowed: true,
    retryAfterSeconds: 0,
  };
};

export const buildAuthAttemptRateLimitResponse = (result: AuthAttemptRateLimitRejectedResult): Response => {
  return new Response(
    JSON.stringify({
      error: `登录或注册请求过于频繁，请在 ${result.retryAfterSeconds} 秒后重试`,
      reason: result.reason,
      retryAfter: result.retryAfterSeconds,
      retryAfterSeconds: result.retryAfterSeconds,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Retry-After': String(result.retryAfterSeconds),
      },
    },
  );
};

export const __resetAuthAttemptRateLimitForTest = (): void => {
  bucketStates.clear();
  acquireCallCount = 0;
};
