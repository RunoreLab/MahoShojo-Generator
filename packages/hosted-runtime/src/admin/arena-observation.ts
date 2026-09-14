import { SignJWT, jwtVerify } from 'jose';
import {
  ADMIN_ARENA_OBSERVATION_ACTION, ADMIN_ARENA_OBSERVATION_AUDIENCE, ADMIN_ARENA_OBSERVATION_ISSUER,
  ADMIN_ARENA_OBSERVATION_PATH, AdminArenaObservationQuerySchema, AdminArenaObservationResponseSchema,
  type AdminArenaObservationQuery, type AdminArenaObservationResponse,
} from '@mahoshojo/contracts/admin-arena-observation';

export type AdminArenaObservationIdentity = { principalId: string; requestId: string };
const key = (secret: string): Uint8Array => {
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 4096 || secret.trim() !== secret) throw new Error('ADMIN_ARENA_SECRET_INVALID');
  return new TextEncoder().encode(secret);
};
export async function issueAdminArenaObservationToken(secret: string, identity: AdminArenaObservationIdentity, now = Date.now()): Promise<string> {
  if (!identity.principalId.trim() || identity.principalId.length > 128 || !identity.requestId.trim() || identity.requestId.length > 128) throw new Error('ADMIN_ARENA_IDENTITY_INVALID');
  const iat = Math.floor(now / 1000);
  return new SignJWT({ action: ADMIN_ARENA_OBSERVATION_ACTION, requestId: identity.requestId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuer(ADMIN_ARENA_OBSERVATION_ISSUER)
    .setAudience(ADMIN_ARENA_OBSERVATION_AUDIENCE).setSubject(identity.principalId)
    .setJti(crypto.randomUUID()).setIssuedAt(iat).setExpirationTime(iat + 60).sign(key(secret));
}
export async function verifyAdminArenaObservationToken(secret: string, token: string, now = Date.now()): Promise<AdminArenaObservationIdentity | null> {
  try {
    if (typeof token !== 'string' || token.length > 4096) return null;
    const { payload, protectedHeader } = await jwtVerify(token, key(secret), {
      algorithms: ['HS256'], issuer: ADMIN_ARENA_OBSERVATION_ISSUER, audience: ADMIN_ARENA_OBSERVATION_AUDIENCE,
      requiredClaims: ['iat', 'exp', 'sub', 'jti'], currentDate: new Date(now),
    });
    if (protectedHeader.typ !== 'JWT' || payload.action !== ADMIN_ARENA_OBSERVATION_ACTION
      || typeof payload.iat !== 'number' || !Number.isInteger(payload.iat) || typeof payload.exp !== 'number' || !Number.isInteger(payload.exp)
      || payload.exp - payload.iat < 1 || payload.exp - payload.iat > 60 || payload.iat > Math.floor(now / 1000)
      || typeof payload.sub !== 'string' || !payload.sub.trim() || payload.sub.length > 128
      || typeof payload.requestId !== 'string' || !payload.requestId.trim() || payload.requestId.length > 128
      || typeof payload.jti !== 'string' || !payload.jti || payload.jti.length > 128) return null;
    return { principalId: payload.sub, requestId: payload.requestId };
  } catch { return null; }
}

export async function readAdminArenaObservation(input: {
  origin: string; secret: string; identity: AdminArenaObservationIdentity; query: AdminArenaObservationQuery;
  fetch?: typeof fetch; allowHttpLoopback?: boolean;
}): Promise<AdminArenaObservationResponse> {
  const origin = new URL(input.origin);
  if (origin.origin !== input.origin || origin.username || origin.password
    || (origin.protocol !== 'https:' && !(input.allowHttpLoopback === true && origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))) throw new Error('ADMIN_ARENA_ORIGIN_INVALID');
  const query = AdminArenaObservationQuerySchema.parse(input.query);
  const url = new URL(ADMIN_ARENA_OBSERVATION_PATH, origin);
  if (query.roomId) url.searchParams.set('roomId', query.roomId);
  if (query.cursor) url.searchParams.set('cursor', query.cursor);
  const token = await issueAdminArenaObservationToken(input.secret, input.identity);
  const requestOptions: RequestInit & { cache: 'no-store' } = { method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000), headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } };
  const response = await (input.fetch ?? fetch)(url, requestOptions);
  if (!response.ok || !response.body) throw new Error('ADMIN_ARENA_UNAVAILABLE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > 256 * 1024) { await reader.cancel(); throw new Error('ADMIN_ARENA_RESPONSE_TOO_LARGE'); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return AdminArenaObservationResponseSchema.parse(JSON.parse(new TextDecoder().decode(body)));
}
