import { getClientIpFromHeaders } from '@/lib/arena/battle-report-log-utils';

/**
 * 限流动作维度。`native-grant` / `native-exchange` 属于桌面端 `desktop-auth-v1`
 * 窄协议，使用独立的桶命名空间，不与站点登录/注册共享配额：
 * - `native-grant` 需要已登录会话，按 IP + 授权用户双维度限制；
 * - `native-exchange` 只按 IP 做突发保护——grant 本身已是 256-bit 一次性 code
 *   （120s TTL + 原子消费 + PKCE verifier），不需要也不应有跨用户的共享
 *   identifier 桶，否则不同桌面用户会互相误限流。
 */
export type AuthAttemptAction = 'register' | 'login' | 'native-grant' | 'native-exchange';

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

const NATIVE_GRANT_IP_RULE: TokenBucketRule = {
  capacity: 12,
  windowMs: 10 * 60 * 1000,
};

const NATIVE_GRANT_USER_RULE: TokenBucketRule = {
  capacity: 8,
  windowMs: 10 * 60 * 1000,
};

// 每次桌面登录消耗一次 exchange（外加少量失败重试）；IP 维度给得比登录宽，
// 容忍 NAT 出口聚集，同时仍约束单 IP 对 verification 表的写入压力。
const NATIVE_EXCHANGE_IP_RULE: TokenBucketRule = {
  capacity: 24,
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
  } else if (input.actionType === 'native-grant') {
    checks.push({
      key: `native-grant:ip:${requestIpKey}`,
      rule: NATIVE_GRANT_IP_RULE,
      reason: 'ip_burst',
      scope: 'ip',
    });

    // identifier 维度按授权用户计（调用方传 authUserId），不是登录账号字符串。
    const grantUserKey = normalizeScopeValue(input.identifier);
    if (grantUserKey) {
      checks.push({
        key: `native-grant:user:${grantUserKey}`,
        rule: NATIVE_GRANT_USER_RULE,
        reason: 'identifier_burst',
        scope: 'identifier',
      });
    }
  } else if (input.actionType === 'native-exchange') {
    // 只保留 IP 突发保护；不得引入固定 identifier 桶（会让所有桌面用户共用一桶）。
    checks.push({
      key: `native-exchange:ip:${requestIpKey}`,
      rule: NATIVE_EXCHANGE_IP_RULE,
      reason: 'ip_burst',
      scope: 'ip',
    });
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
