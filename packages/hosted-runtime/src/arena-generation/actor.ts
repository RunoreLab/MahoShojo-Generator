import type { ArenaGenerationActor } from '@mahoshojo/hosted-api/arena-generation/service';
import { createActivityTokenService } from '../node-runtime/activity-token';
import type { NodeDataD1Client } from '../node-runtime/data-ports';
import type { SignatureService } from '../signature';

export const ARENA_ANONYMOUS_TOKEN_HEADER = 'X-Mahoshojo-Generation-Actor-Token';

type ArenaAnonymousTokenPayload = {
  v: 1;
  anonymousId: string;
  issuedAt: string;
  expiresAt: string;
};

type ArenaAnonymousToken = ArenaAnonymousTokenPayload & { signature: string };

export type ArenaGenerationActorResolverOptions = {
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: typeof fetch;
  signatures: SignatureService;
  getD1Client(): NodeDataD1Client | null;
  createAnonymousId?: () => string;
  now?: () => Date;
};

type ArenaActorResolver = (_request: Request) => Promise<ArenaGenerationActor | null>;

const encodeToken = (token: ArenaAnonymousToken): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(token));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
};

const decodeBase64Url = (value: string): string => {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('INVALID_BASE64URL');
  const normalized = value.replace(/-/gu, '+').replace(/_/gu, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
};

const decodeToken = (value: string): ArenaAnonymousToken | null => {
  try {
    const parsed = JSON.parse(decodeBase64Url(value)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const token = parsed as Partial<ArenaAnonymousToken>;
    if (
      token.v !== 1
      || typeof token.anonymousId !== 'string'
      || !/^[A-Za-z0-9._:-]{8,128}$/u.test(token.anonymousId)
      || typeof token.issuedAt !== 'string'
      || !Number.isFinite(Date.parse(token.issuedAt))
      || typeof token.expiresAt !== 'string'
      || !Number.isFinite(Date.parse(token.expiresAt))
      || typeof token.signature !== 'string'
      || !token.signature
    ) return null;
    return token as ArenaAnonymousToken;
  } catch {
    return null;
  }
};

const readBootstrapAnonymousId = (value: string): string | null => {
  const match = value.match(
    /^bootstrap\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu,
  );
  return match?.[1]?.toLowerCase() ?? null;
};

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

export const createArenaGenerationActorResolver = (
  options: ArenaGenerationActorResolverOptions,
): ArenaActorResolver => {
  const env = options.env ?? process.env;
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const createAnonymousId = options.createAnonymousId ?? (() => crypto.randomUUID());
  const activityTokens = createActivityTokenService(options.signatures);

  const issueAnonymousActor = async (
    anonymousId: string,
  ): Promise<ArenaGenerationActor> => {
    const issuedAt = now();
    const payload: ArenaAnonymousTokenPayload = {
      v: 1,
      anonymousId,
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const signature = await options.signatures.generateSignature(payload);
    if (!signature) return { actorKey: `anonymous:${payload.anonymousId}` };
    return {
      actorKey: `anonymous:${payload.anonymousId}`,
      responseHeaders: {
        [ARENA_ANONYMOUS_TOKEN_HEADER]: encodeToken({ ...payload, signature }),
      },
    };
  };

  const readAnonymousActor = async (request: Request): Promise<ArenaGenerationActor | null> => {
    const raw = request.headers.get(ARENA_ANONYMOUS_TOKEN_HEADER)?.trim() ?? '';
    const token = decodeToken(raw);
    if (
      token
      && Date.parse(token.expiresAt) > now().getTime()
      && await options.signatures.verifySignature(token)
    ) {
      return { actorKey: `anonymous:${token.anonymousId}` };
    }
    const bootstrapAnonymousId = readBootstrapAnonymousId(raw);
    if (bootstrapAnonymousId) return issueAnonymousActor(bootstrapAnonymousId);
    if (raw) return null;
    return issueAnonymousActor(createAnonymousId());
  };

  return async (request): Promise<ArenaGenerationActor | null> => {
    const authorization = request.headers.get('authorization')?.trim() ?? '';
    const bearer = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : '';
    const client = options.getD1Client();
    const authMode = env.HONO_AUTH_MODE?.trim().toLowerCase() || 'hybrid';

    if (authMode === 'hybrid' && hasBetterAuthSession(request)) {
      const userId = await readSessionUser(request, env, fetcher);
      if (userId) return { actorKey: `user:${userId}` };
    }
    if (bearer) {
      if (!client) return null;
      const userId = await readD1User(client, 'auth_key', bearer).catch(() => null);
      return userId ? { actorKey: `user:${userId}` } : null;
    }

    const activityToken = request.headers.get('x-mahoshojo-activity-token')?.trim() ?? '';
    if (activityToken) {
      if (!client) return null;
      const verified = await activityTokens.verifyActivityToken(activityToken, { now: now() });
      if (!verified) return null;
      const userId = await readD1User(client, 'id', verified.userId).catch(() => null);
      return userId ? { actorKey: `user:${userId}` } : null;
    }
    return readAnonymousActor(request);
  };
};
