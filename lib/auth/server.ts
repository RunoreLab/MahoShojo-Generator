import { getUserByAuthKey } from '@/lib/database/users';
import { ACTIVITY_TOKEN_HEADER, ACTIVITY_USER_ID_HEADER } from '@/lib/auth/activity-token';
import { hasBetterAuthSessionCookie } from '@/lib/auth/better-auth';

export interface AuthenticatedUser {
  id: number;
  username: string;
  prefix?: string | null;
  is_banned?: string | null;
  is_admin?: number | null;
  is_review_exempt?: number | null;
}

export type AuthUserSource = 'better-auth-session' | 'legacy-bearer';

export type AuthUserContext = {
  user: AuthenticatedUser;
  source: AuthUserSource;
};

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const toPositiveInteger = (value: unknown): number | null => {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!/^\d+$/.test(normalized)) return null;
    const parsed = Number(normalized);
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
    const normalized = value.trim();
    if (!/^-?\d+$/.test(normalized)) return undefined;
    const parsed = Number(normalized);
    if (!Number.isSafeInteger(parsed)) return undefined;
    return parsed;
  }

  return undefined;
};

const toAuthenticatedUser = (raw: unknown): AuthenticatedUser | null => {
  if (!raw || typeof raw !== 'object') return null;

  const record = raw as Record<string, unknown>;
  const id = toPositiveInteger(record.id);
  if (!id || !isNonEmptyString(record.username)) return null;

  const user: AuthenticatedUser = {
    id,
    username: record.username.trim(),
  };

  if (record.prefix == null || typeof record.prefix === 'string') {
    user.prefix = record.prefix as string | null | undefined;
  }

  if (record.is_banned == null || typeof record.is_banned === 'string') {
    user.is_banned = record.is_banned as string | null | undefined;
  }

  const isAdmin = toOptionalInteger(record.is_admin);
  if (isAdmin !== undefined) {
    user.is_admin = isAdmin;
  }

  const isReviewExempt = toOptionalInteger(record.is_review_exempt);
  if (isReviewExempt !== undefined) {
    user.is_review_exempt = isReviewExempt;
  }

  return user;
};

const parseVerifiedUser = (payload: unknown): AuthenticatedUser | null => {
  if (!payload || typeof payload !== 'object') return null;
  const userRecord = (payload as { user?: unknown }).user;
  return toAuthenticatedUser(userRecord);
};

const copyHeader = (source: Headers, target: Headers, key: string): void => {
  const value = source.get(key);
  if (value && value.trim().length > 0) {
    target.set(key, value);
  }
};

const getSessionAuthUser = async (req: Request): Promise<AuthenticatedUser | null> => {
  if (!hasBetterAuthSessionCookie(req)) return null;

  try {
    const requestUrl = new URL(req.url);
    if (requestUrl.pathname === '/api/auth/verify') return null;

    const verifyUrl = new URL('/api/auth/verify', requestUrl.origin);
    const headers = new Headers({
      'Content-Type': 'application/json',
    });

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
  } catch (error) {
    console.error('[auth][server] 会话探测失败:', error);
    return null;
  }
};

const getBearerAuthKey = (req: Request): string | null => {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const authKey = authHeader.slice('Bearer '.length).trim();
  if (!authKey) return null;
  return authKey;
};

export const getLegacyBearerAuthUser = async (req: Request): Promise<AuthenticatedUser | null> => {
  const authKey = getBearerAuthKey(req);
  if (!authKey) return null;
  return toAuthenticatedUser(await getUserByAuthKey(authKey));
};

const isBannedUser = (user: AuthenticatedUser): boolean =>
  typeof user.is_banned === 'string' && user.is_banned.trim().length > 0;

export const getAuthUser = async (req: Request): Promise<AuthUserContext | null> => {
  const sessionUser = await getSessionAuthUser(req);
  if (sessionUser) {
    return { user: sessionUser, source: 'better-auth-session' };
  }

  const legacyUser = await getLegacyBearerAuthUser(req);
  if (legacyUser) {
    return { user: legacyUser, source: 'legacy-bearer' };
  }

  return null;
};

export const requireAuthUser = async (req: Request): Promise<{ user: AuthenticatedUser; source: AuthUserSource } | { response: Response }> => {
  const context = await getAuthUser(req);
  if (!context) {
    return { response: json({ error: '未授权' }, 401) };
  }

  if (isBannedUser(context.user)) {
    return { response: json({ error: '账号已被封禁' }, 403) };
  }

  return context;
};
