export const USER_PROVIDED_KEY_COOLDOWN_MS = 3_000;
export const OFFICIAL_KEY_ARENA_BATTLE_REPORT_COOLDOWN_MS = 120_000;

export type ArenaSessionRateLimitAction =
  | 'battle_story_session_continue'
  | 'battle_story_session_regenerate_chapter'
  | 'battle_story_session_refresh_summary'
  | 'challenge_node_adjudicate';

type TokenBucketState = { tokens: number; updatedAt: number };
type SessionLeaseState = { lastAcceptedAt: number; inFlight: number };
type RateLimitRule = {
  cooldownMs: number;
  bucketCapacity: number;
  bucketWindowMs: number;
  disallowConcurrent: boolean;
};

export type AcquireArenaSessionSoftRateLimitInput = {
  req: Request;
  actionType: ArenaSessionRateLimitAction;
  sessionId?: string | null;
  providerMode: 'system' | 'custom';
  nowMs?: number;
};

export type AcquireArenaSessionSoftRateLimitResult =
  | { allowed: true; retryAfterSeconds: 0; release(): void }
  | {
    allowed: false;
    retryAfterSeconds: number;
    reason: 'session_in_flight' | 'session_cooldown' | 'ip_burst';
  };

const sessionLeaseStates = new Map<string, SessionLeaseState>();
const ipBucketStates = new Map<string, TokenBucketState>();

const retryAfter = (milliseconds: number): number => (
  Math.max(1, Math.ceil(Math.max(1, milliseconds) / 1_000))
);

const ruleFor = (
  actionType: ArenaSessionRateLimitAction,
  providerMode: 'system' | 'custom',
): RateLimitRule => {
  const system = providerMode === 'system';
  if (actionType === 'battle_story_session_refresh_summary') {
    return {
      cooldownMs: system ? 15_000 : USER_PROVIDED_KEY_COOLDOWN_MS,
      bucketCapacity: system ? 8 : 40,
      bucketWindowMs: 10 * 60_000,
      disallowConcurrent: true,
    };
  }
  return {
    cooldownMs: system
      ? OFFICIAL_KEY_ARENA_BATTLE_REPORT_COOLDOWN_MS
      : USER_PROVIDED_KEY_COOLDOWN_MS,
    bucketCapacity: system ? 3 : 30,
    bucketWindowMs: 10 * 60_000,
    disallowConcurrent: true,
  };
};

const consumeBucket = (
  key: string,
  rule: Pick<RateLimitRule, 'bucketCapacity' | 'bucketWindowMs'>,
  nowMs: number,
): { allowed: boolean; retryAfterSeconds: number } => {
  const refillPerMs = rule.bucketCapacity / rule.bucketWindowMs;
  const current = ipBucketStates.get(key) ?? { tokens: rule.bucketCapacity, updatedAt: nowMs };
  const elapsed = Math.max(0, nowMs - current.updatedAt);
  const refilled = Math.min(rule.bucketCapacity, current.tokens + elapsed * refillPerMs);
  if (refilled < 1) {
    ipBucketStates.set(key, { tokens: refilled, updatedAt: nowMs });
    return { allowed: false, retryAfterSeconds: retryAfter((1 - refilled) / refillPerMs) };
  }
  ipBucketStates.set(key, { tokens: refilled - 1, updatedAt: nowMs });
  return { allowed: true, retryAfterSeconds: 0 };
};

const requestIp = (headers: Headers): string => (
  headers.get('cf-connecting-ip')?.trim()
  || headers.get('x-forwarded-for')?.split(',', 1)[0]?.trim()
  || headers.get('x-real-ip')?.trim()
  || ''
);

const anonymizeIp = (value: string): string => {
  const ipv4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u);
  if (ipv4) {
    const parts = ipv4.slice(1).map(Number);
    if (parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    }
  }
  if (value.includes(':')) {
    const head = (value.toLowerCase().split('::', 1)[0] ?? '')
      .split(':').filter(Boolean).slice(0, 4).join(':');
    if (head) return `${head}::`;
  }
  return 'unknown';
};

export const acquireArenaSessionSoftRateLimit = (
  input: AcquireArenaSessionSoftRateLimitInput,
): AcquireArenaSessionSoftRateLimitResult => {
  const nowMs = input.nowMs ?? Date.now();
  const rule = ruleFor(input.actionType, input.providerMode);
  const sessionId = input.sessionId?.trim() ?? '';
  const ipKey = `${input.providerMode}:${input.actionType}:${anonymizeIp(requestIp(input.req.headers))}`;
  if (!sessionId) {
    const bucket = consumeBucket(ipKey, rule, nowMs);
    return bucket.allowed
      ? { allowed: true, retryAfterSeconds: 0, release: () => undefined }
      : { allowed: false, retryAfterSeconds: bucket.retryAfterSeconds, reason: 'ip_burst' };
  }
  const sessionKey = `${input.providerMode}:${input.actionType}:${sessionId}`;
  const current = sessionLeaseStates.get(sessionKey) ?? { lastAcceptedAt: 0, inFlight: 0 };
  if (rule.disallowConcurrent && current.inFlight > 0) {
    return {
      allowed: false,
      retryAfterSeconds: retryAfter(rule.cooldownMs),
      reason: 'session_in_flight',
    };
  }
  const elapsed = nowMs - current.lastAcceptedAt;
  if (current.lastAcceptedAt > 0 && elapsed < rule.cooldownMs) {
    return {
      allowed: false,
      retryAfterSeconds: retryAfter(rule.cooldownMs - elapsed),
      reason: 'session_cooldown',
    };
  }
  const bucket = consumeBucket(ipKey, rule, nowMs);
  if (!bucket.allowed) {
    return { allowed: false, retryAfterSeconds: bucket.retryAfterSeconds, reason: 'ip_burst' };
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
      sessionLeaseStates.set(sessionKey, {
        ...latest,
        inFlight: Math.max(0, latest.inFlight - 1),
      });
    },
  };
};

export const __resetArenaSessionSoftRateLimitForTest = (): void => {
  sessionLeaseStates.clear();
  ipBucketStates.clear();
};
