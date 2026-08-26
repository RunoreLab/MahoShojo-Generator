import { createActivityTokenService } from './activity-token';
import type { NodeDataD1Client } from './data-ports';
import type { SignatureService } from '../signature';

export type AuthenticatedUserIdResolverOptions = {
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: typeof fetch;
  signatures: SignatureService;
  getD1Client(): NodeDataD1Client | null;
  now?: () => Date;
};

export type AuthenticatedUserIdResolver = (_request: Request) => Promise<number | null>;

const readUserId = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

const readD1User = async (
  client: NodeDataD1Client,
  where: 'auth_key' | 'id',
  value: string | number,
): Promise<number | null> => {
  const result = await client.prepare(`
SELECT id, username, is_banned
FROM users
WHERE ${where} = ?
LIMIT 1
  `.trim()).bind(value).all({ retry: 'safe-read' });
  return readUserId(result.results[0]?.id);
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
): Promise<number | null> => {
  const base = parseTrustedBetterAuthUrl(env);
  if (!base) return null;
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
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null) as {
      user?: { id?: unknown };
    } | null;
    return readUserId(payload?.user?.id);
  } catch {
    return null;
  }
};

export const createAuthenticatedUserIdResolver = (
  options: AuthenticatedUserIdResolverOptions,
): AuthenticatedUserIdResolver => {
  const env = options.env ?? process.env;
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const activityTokens = createActivityTokenService(options.signatures);

  return async (request): Promise<number | null> => {
    const authorization = request.headers.get('authorization')?.trim() ?? '';
    const bearer = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : '';
    const client = options.getD1Client();
    const authMode = env.HONO_AUTH_MODE?.trim().toLowerCase() || 'hybrid';

    if (authMode === 'hybrid' && hasBetterAuthSession(request)) {
      const userId = await readSessionUser(request, env, fetcher);
      if (userId) return userId;
    }
    if (bearer) {
      if (!client) return null;
      const userId = await readD1User(client, 'auth_key', bearer).catch(() => null);
      if (userId) return userId;
      return null;
    }

    const activityToken = request.headers.get('x-mahoshojo-activity-token')?.trim() ?? '';
    if (!activityToken) return null;
    if (!client) return null;
    const verified = await activityTokens.verifyActivityToken(activityToken, { now: now() });
    if (!verified) return null;
    return readD1User(client, 'id', verified.userId).catch(() => null);
  };
};
