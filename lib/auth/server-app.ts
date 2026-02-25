import { getUserByEmail, getUserById, getUserByUsername } from '@/lib/d1';
import { getBetterAuthInstance } from '@/lib/auth/better-auth-app';
import { ensureAuthUserLink, getLinkedBusinessUserByAuthUserId } from '@/lib/auth/user-auth-linking';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { getBusinessUserByEmail, getBusinessUserByUsername } from '@/lib/db/repositories/business-users';
import { getLegacyBearerAuthUser, type AuthUserContext, type AuthenticatedUser } from '@/lib/auth/server';

type BetterAuthSession = {
  user?: {
    id?: unknown;
    email?: unknown;
    name?: unknown;
  };
  session?: {
    userId?: unknown;
  };
};

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });

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

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const toAuthenticatedUser = (raw: unknown): AuthenticatedUser | null => {
  if (!raw || typeof raw !== 'object') return null;

  const record = raw as Record<string, unknown>;
  const id = toPositiveInteger(record.id);
  if (!id || !isNonEmptyString(record.username)) return null;

  const bannedField = record.is_banned ?? record.isBanned ?? null;

  return {
    id,
    username: record.username.trim(),
    prefix: typeof record.prefix === 'string' || record.prefix === null ? (record.prefix as string | null) : undefined,
    is_banned: typeof bannedField === 'string' || bannedField === null ? (bannedField as string | null) : undefined,
    is_admin: toOptionalInteger(record.is_admin),
    is_review_exempt: toOptionalInteger(record.is_review_exempt),
  };
};

const isBannedUser = (user: AuthenticatedUser): boolean =>
  typeof user.is_banned === 'string' && user.is_banned.trim().length > 0;

const normalizeSessionAuthUserId = (session: BetterAuthSession): string | null => {
  const candidate = session.session?.userId ?? session.user?.id;
  if (typeof candidate === 'number') return String(candidate);
  if (typeof candidate !== 'string') return null;
  const trimmed = candidate.trim();
  if (!trimmed) return null;
  return trimmed;
};

const normalizeSessionEmail = (session: BetterAuthSession): string | null => {
  if (!isNonEmptyString(session.user?.email)) return null;
  return session.user.email.trim().toLowerCase();
};

const normalizeSessionName = (session: BetterAuthSession): string | null => {
  if (!isNonEmptyString(session.user?.name)) return null;
  return session.user.name.trim();
};

const getSessionAuthUserFromDrizzle = async (session: BetterAuthSession): Promise<AuthenticatedUser | null> => {
  const db = getDrizzleDbFromRuntime();
  if (!db) return null;

  const authUserId = normalizeSessionAuthUserId(session);
  if (authUserId) {
    const linked = toAuthenticatedUser(await getLinkedBusinessUserByAuthUserId(authUserId));
    if (linked) return linked;

    const linkedAfterHeal = toAuthenticatedUser(
      await ensureAuthUserLink({
        authUserId,
        email: normalizeSessionEmail(session),
        name: normalizeSessionName(session),
      }),
    );
    if (linkedAfterHeal) return linkedAfterHeal;
  }

  const sessionEmail = normalizeSessionEmail(session);
  if (sessionEmail) {
    const byEmail = toAuthenticatedUser(await getBusinessUserByEmail(db, sessionEmail));
    if (byEmail) return byEmail;
  }

  const sessionName = normalizeSessionName(session);
  if (sessionName) {
    const byName = toAuthenticatedUser(await getBusinessUserByUsername(db, sessionName));
    if (byName) return byName;
  }

  return null;
};

const getSessionAuthUserFromLegacyRead = async (session: BetterAuthSession): Promise<AuthenticatedUser | null> => {
  const sessionUser = session.user;
  const userId = toPositiveInteger(session.session?.userId ?? sessionUser?.id);
  if (userId) {
    const byId = toAuthenticatedUser(await getUserById(userId));
    if (byId) return byId;
  }

  if (isNonEmptyString(sessionUser?.email)) {
    const byEmail = toAuthenticatedUser(await getUserByEmail(sessionUser.email.trim()));
    if (byEmail) return byEmail;
  }

  if (isNonEmptyString(sessionUser?.name)) {
    const byName = toAuthenticatedUser(await getUserByUsername(sessionUser.name.trim()));
    if (byName) return byName;
  }

  return null;
};

const getSessionAuthUser = async (req: Request): Promise<AuthenticatedUser | null> => {
  const auth = getBetterAuthInstance();
  if (!auth) return null;

  try {
    const session = (await auth.api.getSession({
      headers: req.headers,
    })) as BetterAuthSession | null;

    if (!session) return null;

    const fromDrizzle = await getSessionAuthUserFromDrizzle(session);
    if (fromDrizzle) return fromDrizzle;

    return getSessionAuthUserFromLegacyRead(session);
  } catch (error) {
    console.error('[auth][app] Better Auth session 解析失败:', error);
    return null;
  }
};

export const requireAuthUserForApp = async (
  req: Request,
): Promise<AuthUserContext | { response: Response }> => {
  const context = await getAuthUserForApp(req);
  if (!context) {
    return { response: json({ error: '未授权' }, 401) };
  }

  if (isBannedUser(context.user)) {
    return { response: json({ error: '账号已被封禁' }, 403) };
  }

  return context;
};

export const getAuthUserForApp = async (req: Request): Promise<AuthUserContext | null> => {
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
