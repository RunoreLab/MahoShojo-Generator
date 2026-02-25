import type { AuthenticatedUser } from '@/lib/auth/server';
import { getAuthUser } from '@/lib/auth/server';
import { hasBetterAuthSessionCookie } from '@/lib/auth/better-auth';
import { ACTIVITY_TOKEN_HEADER, ACTIVITY_USER_ID_HEADER } from '@/lib/auth/activity-token';

type RequestAuthUserResolver = {
  getUser: () => Promise<AuthenticatedUser | null>;
};

const toPositiveInteger = (value: unknown): number | null => {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
    return parsed;
  }

  return null;
};

const toOptionalInteger = (value: unknown): number | undefined => {
  if (value == null) return undefined;

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) return undefined;
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^-?\d+$/.test(trimmed)) return undefined;
    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed)) return undefined;
    return parsed;
  }

  return undefined;
};

const toOptionalStringOrNull = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string') return value;
  return undefined;
};

const parseVerifiedUser = (payload: unknown): AuthenticatedUser | null => {
  if (!payload || typeof payload !== 'object') return null;
  const userRecord = (payload as { user?: unknown }).user;
  if (!userRecord || typeof userRecord !== 'object') return null;

  const record = userRecord as Record<string, unknown>;
  const id = toPositiveInteger(record.id);
  const username = typeof record.username === 'string' ? record.username.trim() : '';
  if (!id || !username) return null;

  return {
    id,
    username,
    prefix: toOptionalStringOrNull(record.prefix),
    is_banned: toOptionalStringOrNull(record.is_banned),
    is_admin: toOptionalInteger(record.is_admin),
    is_review_exempt: toOptionalInteger(record.is_review_exempt),
  };
};

const copyHeader = (source: Headers, target: Headers, key: string): void => {
  const value = source.get(key);
  if (value && value.trim().length > 0) {
    target.set(key, value);
  }
};

const getSessionAuthUserFromVerifyRoute = async (req: Request): Promise<AuthenticatedUser | null> => {
  const requestUrl = new URL(req.url);
  const verifyUrl = new URL('/api/auth/verify', requestUrl.origin);
  const headers = new Headers();

  copyHeader(req.headers, headers, 'cookie');
  copyHeader(req.headers, headers, 'authorization');
  copyHeader(req.headers, headers, 'origin');
  copyHeader(req.headers, headers, 'referer');
  copyHeader(req.headers, headers, 'user-agent');
  copyHeader(req.headers, headers, 'x-forwarded-for');
  copyHeader(req.headers, headers, 'x-real-ip');
  copyHeader(req.headers, headers, 'cf-connecting-ip');
  copyHeader(req.headers, headers, ACTIVITY_TOKEN_HEADER);
  copyHeader(req.headers, headers, ACTIVITY_USER_ID_HEADER);

  const response = await fetch(verifyUrl.toString(), {
    method: 'POST',
    headers,
  });

  if (!response.ok) return null;

  const payload = await response.json().catch(() => null);
  return parseVerifiedUser(payload);
};

const hasSessionAuthHint = (req: Request): boolean => {
  if (hasBetterAuthSessionCookie(req)) return true;
  if (req.headers.get(ACTIVITY_TOKEN_HEADER)?.trim()) return true;
  if (req.headers.get(ACTIVITY_USER_ID_HEADER)?.trim()) return true;
  return false;
};

const resolveRequestAuthUser = async (req: Request): Promise<AuthenticatedUser | null> => {
  const context = await getAuthUser(req);
  if (context) {
    return context.user;
  }

  if (!hasSessionAuthHint(req) || hasBetterAuthSessionCookie(req)) {
    return null;
  }

  return getSessionAuthUserFromVerifyRoute(req);
};

export const createRequestAuthUserResolver = (req: Request): RequestAuthUserResolver => {
  let cachedUserPromise: Promise<AuthenticatedUser | null> | null = null;

  return {
    getUser: async () => {
      if (!cachedUserPromise) {
        cachedUserPromise = resolveRequestAuthUser(req);
      }
      return cachedUserPromise;
    },
  };
};
