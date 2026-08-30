import { getAuthUser, type AuthUserContext } from '@/lib/auth/server';
import { ACTIVITY_TOKEN_HEADER, verifyActivityToken } from '@/lib/auth/activity-token';
import { anonymizeIp, getClientIpFromHeaders } from '@/lib/arena/battle-report-log-utils';
import type { DataCardInteractionActorScope } from '@/lib/db/schema';

export type DataCardStatsActor = {
  actorScope: DataCardInteractionActorScope;
  actorKeyHash: string;
};

export type ResolveDataCardStatsActorDeps = {
  getAuthUser?: (req: Request) => Promise<AuthUserContext | null>;
  verifyActivityToken?: (token: string) => Promise<{ userId: number; expiresAt: string } | null>;
  hashActorKey?: (value: string) => Promise<string>;
};

const ACTOR_HASH_NAMESPACE = 'data-card-stats-actor-v1';
const MAX_USER_AGENT_LENGTH = 200;

const bytesToHex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

const importHmacKey = async (secret: string): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(digest);
};

export const hashDataCardStatsActorKey = async (value: string): Promise<string> => {
  const normalized = `${ACTOR_HASH_NAMESPACE}:${value}`;
  const secret = (process.env.DATA_CARD_STATS_HASH_SECRET ?? process.env.SIGNATURE_SECRET_KEY ?? '').trim();
  if (!secret) return sha256Hex(normalized);

  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(normalized));
  return bytesToHex(signature);
};

const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const normalizeUserAgent = (headers: Headers): string => {
  const value = headers.get('user-agent')?.trim() ?? '';
  if (!value) return 'unknown-ua';
  return value.slice(0, MAX_USER_AGENT_LENGTH);
};

const hashScopedActor = async (
  actorScope: DataCardInteractionActorScope,
  actorKey: string,
  hashActorKey: (value: string) => Promise<string>,
): Promise<DataCardStatsActor> => ({
  actorScope,
  actorKeyHash: await hashActorKey(`${actorScope}:${actorKey}`),
});

export const resolveDataCardStatsActor = async (
  req: Request,
  deps: ResolveDataCardStatsActorDeps = {},
): Promise<DataCardStatsActor> => {
  const readAuthUser = deps.getAuthUser ?? getAuthUser;
  const verifyToken = deps.verifyActivityToken ?? verifyActivityToken;
  const hashActorKey = deps.hashActorKey ?? hashDataCardStatsActorKey;

  const auth = await readAuthUser(req).catch(() => null);
  if (isPositiveSafeInteger(auth?.user.id)) {
    return hashScopedActor('auth_user', String(auth.user.id), hashActorKey);
  }

  const activityToken = req.headers.get(ACTIVITY_TOKEN_HEADER)?.trim();
  if (activityToken) {
    const verified = await verifyToken(activityToken).catch(() => null);
    if (isPositiveSafeInteger(verified?.userId)) {
      return hashScopedActor('activity_user', String(verified.userId), hashActorKey);
    }
  }

  const anonymizedIp = anonymizeIp(getClientIpFromHeaders(req.headers)) ?? 'unknown-ip';
  const userAgent = normalizeUserAgent(req.headers);
  return hashScopedActor('anonymous', `${anonymizedIp}:${userAgent}`, hashActorKey);
};
