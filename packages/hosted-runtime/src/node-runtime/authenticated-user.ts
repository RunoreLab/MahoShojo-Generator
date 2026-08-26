import { createActivityTokenService } from './activity-token';
import type { NodeDataD1Client } from './data-ports';
import type { SignatureService } from '../signature';

export type AuthenticatedUserIdResolverOptions = {
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: typeof fetch;
  signatures: SignatureService;
  getD1Client(): NodeDataD1Client | null;
  now?: () => Date;
  allowActivityToken?: boolean;
};

export type AuthenticationResolution =
  | Readonly<{ status: 'authenticated'; userId: number }>
  | Readonly<{ status: 'anonymous' }>
  | Readonly<{ status: 'denied' }>;

export type AuthenticationResolver = (_request: Request) => Promise<AuthenticationResolution>;
export type AuthenticatedUserIdResolver = (_request: Request) => Promise<number | null>;

const ANONYMOUS_AUTHENTICATION = Object.freeze({ status: 'anonymous' } as const);
const DENIED_AUTHENTICATION = Object.freeze({ status: 'denied' } as const);

const readUserId = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

const readD1User = async (
  client: NodeDataD1Client,
  where: 'auth_key' | 'id',
  value: string | number,
): Promise<AuthenticationResolution> => {
  const result = await client.prepare(`
SELECT id, username, is_banned
FROM users
WHERE ${where} = ?
LIMIT 1
  `.trim()).bind(value).all({ retry: 'safe-read' });
  const row = result.results[0];
  const userId = readUserId(row?.id);
  if (!row || !userId) return DENIED_AUTHENTICATION;
  if (typeof row.is_banned === 'string' && row.is_banned.trim()) {
    return DENIED_AUTHENTICATION;
  }
  return Object.freeze({ status: 'authenticated', userId });
};

const hasBetterAuthSession = (request: Request): boolean => {
  const cookie = request.headers.get('cookie') ?? '';
  return /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=[^;]+/u.test(cookie);
};

const parseTrustedBetterAuthUrl = (
  env: Readonly<Record<string, string | undefined>>,
): URL | null => {
  const raw = env.BETTER_AUTH_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const localHttp = env.NODE_ENV !== 'production'
      && url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' && !localHttp)
      || url.username
      || url.password
      || url.pathname !== '/'
      || url.search
      || url.hash
    ) return null;
    return url;
  } catch {
    return null;
  }
};

const readSessionUser = async (
  request: Request,
  env: Readonly<Record<string, string | undefined>>,
  fetcher: typeof fetch,
): Promise<AuthenticationResolution> => {
  const base = parseTrustedBetterAuthUrl(env);
  if (!base) return ANONYMOUS_AUTHENTICATION;
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const name of [
    'cookie',
    'user-agent',
    'x-forwarded-for',
    'x-real-ip',
    'cf-connecting-ip',
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (env.CF_ACCESS_CLIENT_ID?.trim() && env.CF_ACCESS_CLIENT_SECRET?.trim()) {
    headers.set('cf-access-client-id', env.CF_ACCESS_CLIENT_ID.trim());
    headers.set('cf-access-client-secret', env.CF_ACCESS_CLIENT_SECRET.trim());
  }
  try {
    const response = await fetcher(new URL('/api/auth/verify', base).toString(), {
      method: 'POST',
      headers,
    });
    if (!response.ok) {
      return response.status === 403
        ? DENIED_AUTHENTICATION
        : ANONYMOUS_AUTHENTICATION;
    }
    const payload = await response.json().catch(() => null) as {
      user?: { id?: unknown };
    } | null;
    const userId = readUserId(payload?.user?.id);
    return userId
      ? Object.freeze({ status: 'authenticated', userId })
      : ANONYMOUS_AUTHENTICATION;
  } catch {
    return ANONYMOUS_AUTHENTICATION;
  }
};

export const createAuthenticationResolver = (
  options: AuthenticatedUserIdResolverOptions,
): AuthenticationResolver => {
  const env = options.env ?? process.env;
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const activityTokens = createActivityTokenService(options.signatures);

  return async (request): Promise<AuthenticationResolution> => {
    const authorization = request.headers.get('authorization')?.trim() ?? '';
    const bearer = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : '';
    const client = options.getD1Client();
    const authMode = env.HONO_AUTH_MODE?.trim().toLowerCase() || 'hybrid';

    if (authMode === 'hybrid' && hasBetterAuthSession(request)) {
      const resolution = await readSessionUser(request, env, fetcher);
      if (resolution.status !== 'anonymous') return resolution;
    }
    if (bearer) {
      if (!client) return DENIED_AUTHENTICATION;
      return readD1User(client, 'auth_key', bearer).catch(() => DENIED_AUTHENTICATION);
    }

    if (!options.allowActivityToken) return ANONYMOUS_AUTHENTICATION;
    const activityToken = request.headers.get('x-mahoshojo-activity-token')?.trim() ?? '';
    if (!activityToken) return ANONYMOUS_AUTHENTICATION;
    if (!client) return DENIED_AUTHENTICATION;
    const verified = await activityTokens.verifyActivityToken(activityToken, { now: now() });
    if (!verified) return DENIED_AUTHENTICATION;
    return readD1User(client, 'id', verified.userId).catch(() => DENIED_AUTHENTICATION);
  };
};

export const createAuthenticatedUserIdResolver = (
  options: AuthenticatedUserIdResolverOptions,
): AuthenticatedUserIdResolver => {
  const resolveAuthentication = createAuthenticationResolver(options);
  return async (request): Promise<number | null> => {
    const resolution = await resolveAuthentication(request);
    return resolution.status === 'authenticated' ? resolution.userId : null;
  };
};
