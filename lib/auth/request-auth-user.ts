import type { AuthenticatedUser } from '@/lib/auth/server';
import { getAuthUser } from '@/lib/auth/server';
import { ACTIVITY_TOKEN_HEADER, verifyActivityToken } from '@/lib/auth/activity-token';
import { getUserById } from '@/lib/database/users';

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

const parseAuthUserRecord = (value: unknown): AuthenticatedUser | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
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

const getAuthUserFromVerifiedActivityToken = async (req: Request): Promise<AuthenticatedUser | null> => {
  const activityToken = req.headers.get(ACTIVITY_TOKEN_HEADER)?.trim() ?? '';
  if (!activityToken) return null;

  const verified = await verifyActivityToken(activityToken);
  if (!verified) return null;

  const user = await getUserById(verified.userId);
  return parseAuthUserRecord(user);
};

const resolveRequestAuthUser = async (req: Request): Promise<AuthenticatedUser | null> => {
  const context = await getAuthUser(req);
  if (context) {
    return context.user;
  }

  return getAuthUserFromVerifiedActivityToken(req);
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
