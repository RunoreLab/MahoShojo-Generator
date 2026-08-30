import { ACTIVITY_TOKEN_HEADER, verifyActivityToken } from './activity-token';

const USER_PROVIDED_KEY_COOLDOWN_MS = 3_000;
export const OFFICIAL_KEY_QUESTIONNAIRE_CHARACTER_COOLDOWN_MS = 60_000;
const OFFICIAL_KEY_MAX_AI_COOLDOWN_MS = 120_000;

export type PublicAiRateLimitAction =
  | 'magical_girl_generate'
  | 'magical_girl_details_generate'
  | 'canshou_generate'
  | 'scenario_generate'
  | 'free_generate'
  | 'sublimation_generate';

export type PublicAiProviderMode = 'system' | 'custom';

export type AcquirePublicAiRateLimitInput = {
  req: Request;
  actionType: PublicAiRateLimitAction;
  providerMode: PublicAiProviderMode;
  nowMs?: number;
};

export type AcquirePublicAiRateLimitResult =
  | {
      allowed: true;
      retryAfterSeconds: 0;
      identityScope: 'user' | 'ip' | 'unknown';
    }
  | {
      allowed: false;
      retryAfterSeconds: number;
      reason: 'identity_cooldown';
      identityScope: 'user' | 'ip' | 'unknown';
    };

export type PublicAiRateLimitRejectedResult = Extract<
  AcquirePublicAiRateLimitResult,
  { allowed: false }
>;

export type PublicAiRateLimiterDependencies = {
  verifyActivityToken(
    _token: string,
  ): Promise<{ userId: number; expiresAt: string } | null>;
};

export type PublicAiRateLimiter = {
  acquirePublicAiRateLimit(
    _input: AcquirePublicAiRateLimitInput,
  ): Promise<AcquirePublicAiRateLimitResult>;
  resetForTest(): void;
};

type IdentityResolution =
  | { scope: 'user'; key: string }
  | { scope: 'ip'; key: string }
  | { scope: 'unknown'; key: string };

const SWEEP_INTERVAL = 256;
const SWEEP_STALE_AFTER_MS = 60 * 60 * 1_000;

const clampRetryAfterSeconds = (valueMs: number): number =>
  Math.max(1, Math.ceil(Math.max(1, valueMs) / 1_000));

const getCooldownMs = (
  actionType: PublicAiRateLimitAction,
  providerMode: PublicAiProviderMode,
): number => {
  if (providerMode === 'custom') return USER_PROVIDED_KEY_COOLDOWN_MS;
  if (actionType === 'free_generate') return OFFICIAL_KEY_MAX_AI_COOLDOWN_MS;
  return OFFICIAL_KEY_QUESTIONNAIRE_CHARACTER_COOLDOWN_MS;
};

const anonymizeIp = (ip: string | null): string | null => {
  if (!ip) return null;
  const trimmed = ip.trim();
  if (!trimmed) return null;

  const v4 = trimmed.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const parts = v4.slice(1).map(Number);
    if (parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    }
  }

  if (trimmed.includes(':')) {
    const leading = (trimmed.toLowerCase().split('::')[0] ?? '')
      .split(':')
      .filter(Boolean)
      .slice(0, 4)
      .join(':');
    if (leading) return `${leading}::`;
  }

  return null;
};

const getClientIpFromHeaders = (headers: Headers): string | null => {
  const cfIp = headers.get('cf-connecting-ip')?.trim();
  if (cfIp) return cfIp;
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  return headers.get('x-real-ip')?.trim() || null;
};

export const createPublicAiRateLimiter = (
  dependencies: PublicAiRateLimiterDependencies,
): PublicAiRateLimiter => {
  const identityLastAcceptedAt = new Map<string, number>();
  let acquireCallCount = 0;

  const maybeSweepExpiredStates = (nowMs: number): void => {
    acquireCallCount += 1;
    if (acquireCallCount % SWEEP_INTERVAL !== 0) return;
    for (const [key, acceptedAt] of identityLastAcceptedAt.entries()) {
      if (nowMs - acceptedAt > SWEEP_STALE_AFTER_MS) identityLastAcceptedAt.delete(key);
    }
  };

  const resolveIdentity = async (req: Request): Promise<IdentityResolution> => {
    const token = req.headers.get(ACTIVITY_TOKEN_HEADER);
    if (token) {
      const verified = await dependencies.verifyActivityToken(token).catch(() => null);
      if (verified) return { scope: 'user', key: `user:${verified.userId}` };
    }

    const ip = anonymizeIp(getClientIpFromHeaders(req.headers));
    if (ip) return { scope: 'ip', key: `ip:${ip}` };
    return { scope: 'unknown', key: 'unknown' };
  };

  return Object.freeze({
    acquirePublicAiRateLimit: async (
      input: AcquirePublicAiRateLimitInput,
    ): Promise<AcquirePublicAiRateLimitResult> => {
      const nowMs = typeof input.nowMs === 'number' ? input.nowMs : Date.now();
      maybeSweepExpiredStates(nowMs);
      const identity = await resolveIdentity(input.req);
      const cooldownMs = getCooldownMs(input.actionType, input.providerMode);
      const key = `${input.providerMode}:${input.actionType}:${identity.key}`;
      const lastAcceptedAt = identityLastAcceptedAt.get(key) ?? 0;

      if (lastAcceptedAt > 0) {
        const elapsed = nowMs - lastAcceptedAt;
        if (elapsed < cooldownMs) {
          return {
            allowed: false,
            retryAfterSeconds: clampRetryAfterSeconds(cooldownMs - elapsed),
            reason: 'identity_cooldown',
            identityScope: identity.scope,
          };
        }
      }

      identityLastAcceptedAt.set(key, nowMs);
      return { allowed: true, retryAfterSeconds: 0, identityScope: identity.scope };
    },
    resetForTest: () => {
      identityLastAcceptedAt.clear();
      acquireCallCount = 0;
    },
  });
};

export const inferPublicAiProviderMode = (
  customProviderPayload: unknown,
): PublicAiProviderMode => {
  if (!customProviderPayload || typeof customProviderPayload !== 'object') return 'system';
  const rawProviderId = (customProviderPayload as { providerId?: unknown }).providerId;
  const providerId = typeof rawProviderId === 'string' ? rawProviderId.trim() : '';
  return providerId && providerId !== 'system' ? 'custom' : 'system';
};

export const buildPublicAiRateLimitResponse = (
  result: PublicAiRateLimitRejectedResult,
): Response => new Response(
  JSON.stringify({
    error: `请求过于频繁，请在 ${result.retryAfterSeconds} 秒后重试`,
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

const defaultLimiter = createPublicAiRateLimiter({ verifyActivityToken });

export const acquirePublicAiRateLimit = defaultLimiter.acquirePublicAiRateLimit;
export const __resetPublicAiRateLimitForTest = defaultLimiter.resetForTest;
