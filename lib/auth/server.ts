import { getUserByAuthKey } from '@/lib/d1';
import { hasBetterAuthSessionCookie } from '@/lib/auth/better-auth';

export interface AuthenticatedUser {
  id: number;
  username: string;
  prefix?: string | null;
  is_banned?: string | null;
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

  return user;
};

const getSessionAuthUser = async (req: Request): Promise<AuthenticatedUser | null> => {
  if (!hasBetterAuthSessionCookie(req)) return null;
  // 阶段 A：仅预留会话探测入口。真正的 Better Auth Session 校验会在后续适配中接入。
  return null;
};

const getBearerAuthKey = (req: Request): string | null => {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const authKey = authHeader.slice('Bearer '.length).trim();
  if (!authKey) return null;
  return authKey;
};

const getLegacyBearerAuthUser = async (req: Request): Promise<AuthenticatedUser | null> => {
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
