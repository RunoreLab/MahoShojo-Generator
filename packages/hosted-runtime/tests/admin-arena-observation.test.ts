import { describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { ADMIN_ARENA_OBSERVATION_ACTION, ADMIN_ARENA_OBSERVATION_AUDIENCE, ADMIN_ARENA_OBSERVATION_ISSUER, ADMIN_ARENA_OBSERVATION_PATH } from '@mahoshojo/contracts/admin-arena-observation';
import { issueAdminArenaObservationToken, readAdminArenaObservation, verifyAdminArenaObservationToken } from '../src/admin/arena-observation';

const secret = 'dedicated-admin-observation-test-key-0123456789';
const identity = { principalId: 'operator', requestId: 'request-1' };
const now = 1_800_000_000_000;
const claims = { iss: ADMIN_ARENA_OBSERVATION_ISSUER, aud: ADMIN_ARENA_OBSERVATION_AUDIENCE, sub: identity.principalId, requestId: identity.requestId,
  action: ADMIN_ARENA_OBSERVATION_ACTION, iat: now / 1000, exp: now / 1000 + 60, jti: 'fixture' };

describe('Admin-to-Arena service authentication', () => {
  it('issues a signed fixed-purpose token that expires at 60 seconds', async () => {
    const token = await issueAdminArenaObservationToken(secret, identity, now);
    expect(await verifyAdminArenaObservationToken(secret, token, now)).toEqual(identity);
    expect(await verifyAdminArenaObservationToken(secret, token, now + 60_000)).toBeNull();
    expect(await verifyAdminArenaObservationToken(`${secret}-different`, token, now)).toBeNull();
  });
  it('rejects wrong audience, action, issuer, algorithm, future issuance and excessive lifetime', async () => {
    for (const override of [{ aud: 'web' }, { action: 'arena.rooms.delete' }, { iss: 'public-web' }, { iat: now / 1000 + 1 }, { exp: now / 1000 + 61 }, { sub: '' }, { jti: '' }]) {
      const token = await new SignJWT({ ...claims, ...override }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).sign(new TextEncoder().encode(secret));
      expect(await verifyAdminArenaObservationToken(secret, token, now)).toBeNull();
    }
    const wrongAlgorithm = await new SignJWT(claims).setProtectedHeader({ alg: 'HS384', typ: 'JWT' }).sign(new TextEncoder().encode(secret));
    expect(await verifyAdminArenaObservationToken(secret, wrongAlgorithm, now)).toBeNull();
  });
});

describe('Admin Arena observation client', () => {
  it('uses one fixed path, no redirects, bounded lifetime and validates the safe response contract', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ protocolVersion: 1, items: [], nextCursor: null, observedAt: new Date().toISOString() })));
    await readAdminArenaObservation({ origin: 'https://arena.example.test', secret, identity, query: { roomId: 'room-1' }, fetch: fetcher });
    const [url, init] = fetcher.mock.calls[0];
    expect(new URL(String(url)).pathname).toBe(ADMIN_ARENA_OBSERVATION_PATH);
    expect(new URL(String(url)).searchParams.get('roomId')).toBe('room-1');
    expect(init).toMatchObject({ method: 'GET', redirect: 'error', cache: 'no-store' });
    const token = new Headers(init?.headers).get('Authorization')!.slice(7);
    expect(await verifyAdminArenaObservationToken(secret, token)).toEqual(identity);
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ protocolVersion: 1, items: [], nextCursor: null, observedAt: '', checkpointSecret: 'private' })));
    await expect(readAdminArenaObservation({ origin: 'https://arena.example.test', secret, identity, query: {}, fetch: fetcher })).rejects.toThrow();
  });
  it('rejects untrusted origins and oversized bodies', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('x'.repeat(256 * 1024 + 1)));
    for (const origin of ['http://arena.example.test', 'https://user:pass@arena.example.test', 'https://arena.example.test/path', 'http://127.0.0.1']) {
      await expect(readAdminArenaObservation({ origin, secret, identity, query: {}, fetch: fetcher })).rejects.toThrow();
    }
    expect(fetcher).not.toHaveBeenCalled();
    await expect(readAdminArenaObservation({ origin: 'https://arena.example.test', secret, identity, query: {}, fetch: fetcher })).rejects.toThrow('ADMIN_ARENA_RESPONSE_TOO_LARGE');
  });
});
