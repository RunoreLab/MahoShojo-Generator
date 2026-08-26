import { describe, expect, it, vi } from 'vitest';

import { createActivityTokenService } from '../src/node-runtime/activity-token';
import {
  ARENA_ANONYMOUS_TOKEN_HEADER,
  createArenaGenerationActorResolver,
} from '../src/arena-generation/actor';
import {
  ARENA_PVP_GENERATION_SIGNATURE_HEADER,
  createArenaPvpGenerationAuthority,
} from '../src/arena-generation/internal-authority';
import { createSignatureService } from '../src/signature';

const createSignatures = async () => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('test-only-arena-actor-key'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  return createSignatureService({ getSigningKey: async () => key });
};

const d1 = (rows: Record<string, unknown>[]) => ({
  prepare: vi.fn(() => ({
    bind: vi.fn().mockReturnThis(),
    all: vi.fn(async () => ({ success: true, results: rows, meta: {} })),
    run: vi.fn(async () => ({ success: true, results: rows, meta: {} })),
  })),
});

describe('Arena generation actor resolver', () => {
  it('maps signed PVP requests from different callers to one room-scoped operation actor', async () => {
    const signatures = await createSignatures();
    const authority = createArenaPvpGenerationAuthority(signatures);
    const pvpContext = { roomId: 'room-1', matchId: 'match-1', roundId: 'round-1' };
    const generationRequestId = 'pvp_request_1234';
    const internalGuidance = 'server-owned-guidance';
    const payload = { internalGuidance, pvpContext, combatants: ['A', 'B'] };
    const signature = await authority.sign({
      generationRequestId,
      payload,
    });
    const resolveActor = createArenaGenerationActorResolver({
      env: { HONO_AUTH_MODE: 'bearer' },
      signatures,
      pvpSignatures: signatures,
      getD1Client: () => d1([{ id: 42 }]),
    });
    const request = (authorization: string) => new Request('https://example.test', {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
        [ARENA_PVP_GENERATION_SIGNATURE_HEADER]: signature!,
      },
      body: JSON.stringify({ generationRequestId, ...payload }),
    });

    await expect(resolveActor(request('Bearer caller-one'))).resolves.toEqual({
      actorKey: 'pvp-room:room-1',
    });
    await expect(resolveActor(request('Bearer caller-two'))).resolves.toEqual({
      actorKey: 'pvp-room:room-1',
    });
    await expect(resolveActor(new Request('https://example.test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [ARENA_PVP_GENERATION_SIGNATURE_HEADER]: signature!,
      },
      body: JSON.stringify({ generationRequestId, ...payload }),
    }))).resolves.toBeNull();

    const rejectInvalidBearer = createArenaGenerationActorResolver({
      env: { HONO_AUTH_MODE: 'bearer' },
      signatures,
      pvpSignatures: signatures,
      getD1Client: () => d1([]),
    });
    await expect(rejectInvalidBearer(request('Bearer invalid-caller'))).resolves.toBeNull();
  });

  it('keeps anonymous ownership stable across network changes with a signed token', async () => {
    const signatures = await createSignatures();
    const resolveActor = createArenaGenerationActorResolver({
      env: { HONO_AUTH_MODE: 'bearer' },
      signatures,
      getD1Client: () => d1([]),
      createAnonymousId: () => 'anon-id-1',
      now: () => new Date('2026-08-25T00:00:00.000Z'),
    });
    const first = await resolveActor(new Request('https://example.test', {
      headers: { 'cf-connecting-ip': '192.0.2.1' },
    }));
    const token = first?.responseHeaders?.[ARENA_ANONYMOUS_TOKEN_HEADER];

    expect(first?.actorKey).toBe('anonymous:anon-id-1');
    expect(token).toBeTruthy();
    const resumed = await resolveActor(new Request('https://example.test', {
      headers: {
        'cf-connecting-ip': '198.51.100.2',
        [ARENA_ANONYMOUS_TOKEN_HEADER]: token!,
      },
    }));
    expect(resumed?.actorKey).toBe(first?.actorKey);
    expect(resumed?.responseHeaders).toBeUndefined();
  });

  it('fails closed when a supplied anonymous credential is invalid', async () => {
    const signatures = await createSignatures();
    const resolveActor = createArenaGenerationActorResolver({
      env: { HONO_AUTH_MODE: 'bearer' },
      signatures,
      getD1Client: () => d1([]),
      createAnonymousId: () => 'must-not-be-issued',
    });

    await expect(resolveActor(new Request('https://example.test', {
      headers: { [ARENA_ANONYMOUS_TOKEN_HEADER]: 'forged-token' },
    }))).resolves.toBeNull();
  });

  it('upgrades a high-entropy bootstrap credential without changing ownership', async () => {
    const signatures = await createSignatures();
    const resolveActor = createArenaGenerationActorResolver({
      env: { HONO_AUTH_MODE: 'bearer' },
      signatures,
      getD1Client: () => d1([]),
      createAnonymousId: () => 'must-not-be-used',
      now: () => new Date('2026-08-25T00:00:00.000Z'),
    });
    const bootstrap = 'bootstrap.123e4567-e89b-42d3-a456-426614174000';
    const first = await resolveActor(new Request('https://example.test', {
      headers: { [ARENA_ANONYMOUS_TOKEN_HEADER]: bootstrap },
    }));
    const signed = first?.responseHeaders?.[ARENA_ANONYMOUS_TOKEN_HEADER];

    expect(first?.actorKey).toBe('anonymous:123e4567-e89b-42d3-a456-426614174000');
    expect(signed).toBeTruthy();
    const retry = await resolveActor(new Request('https://example.test', {
      headers: { [ARENA_ANONYMOUS_TOKEN_HEADER]: bootstrap },
    }));
    const resumed = await resolveActor(new Request('https://example.test', {
      headers: { [ARENA_ANONYMOUS_TOKEN_HEADER]: signed! },
    }));
    expect(retry?.actorKey).toBe(first?.actorKey);
    expect(resumed?.actorKey).toBe(first?.actorKey);
  });

  it('preserves legacy Bearer and ignores an unverified user-id header', async () => {
    const signatures = await createSignatures();
    const client = d1([{ id: 42, username: 'legacy-user', isBanned: null }]);
    const resolveActor = createArenaGenerationActorResolver({
      env: { HONO_AUTH_MODE: 'bearer' },
      signatures,
      getD1Client: () => client,
      createAnonymousId: () => 'anon-id-2',
    });

    const bearer = await resolveActor(new Request('https://example.test', {
      headers: { Authorization: 'Bearer legacy-secret' },
    }));
    expect(bearer?.actorKey).toBe('user:42');

    const forged = await resolveActor(new Request('https://example.test', {
      headers: { 'x-mahoshojo-user-id': '42' },
    }));
    expect(forged?.actorKey).toBe('anonymous:anon-id-2');
  });

  it('拒绝已封禁用户的 Legacy Bearer，不降级为匿名 actor', async () => {
    const signatures = await createSignatures();
    const resolveActor = createArenaGenerationActorResolver({
      env: { HONO_AUTH_MODE: 'bearer' },
      signatures,
      getD1Client: () => d1([{
        id: 42,
        username: 'banned-legacy-user',
        isBanned: '2026-08-26T00:00:00.000Z',
      }]),
      createAnonymousId: () => 'must-not-be-issued',
    });

    await expect(resolveActor(new Request('https://example.test', {
      headers: { Authorization: 'Bearer banned-legacy-secret' },
    }))).resolves.toBeNull();
  });

  it('accepts verified activity identity and uses only configured Better Auth origin', async () => {
    const signatures = await createSignatures();
    const activity = createActivityTokenService(signatures);
    const activityToken = await activity.issueActivityToken(7);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      user: { id: 9, username: 'session-user' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const resolveActor = createArenaGenerationActorResolver({
      env: {
        HONO_AUTH_MODE: 'hybrid',
        BETTER_AUTH_URL: 'https://auth.example.test',
      },
      fetch: fetcher,
      signatures,
      getD1Client: () => d1([{ id: 7, username: 'activity-user' }]),
    });

    const activityActor = await resolveActor(new Request('https://evil.example.test', {
      headers: { 'x-mahoshojo-activity-token': activityToken! },
    }));
    expect(activityActor?.actorKey).toBe('user:7');

    const sessionActor = await resolveActor(new Request('https://evil.example.test', {
      headers: { cookie: 'better-auth.session_token=session' },
    }));
    expect(sessionActor?.actorKey).toBe('user:9');
    expect(fetcher).toHaveBeenCalledWith(
      'https://auth.example.test/api/auth/verify',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('拒绝已封禁用户的 activity token，不降级为匿名 actor', async () => {
    const signatures = await createSignatures();
    const activity = createActivityTokenService(signatures);
    const activityToken = await activity.issueActivityToken(7);
    const resolveActor = createArenaGenerationActorResolver({
      env: { HONO_AUTH_MODE: 'bearer' },
      signatures,
      getD1Client: () => d1([{
        id: 7,
        username: 'banned-activity-user',
        isBanned: '2026-08-26T00:00:00.000Z',
      }]),
      createAnonymousId: () => 'must-not-be-issued',
    });

    await expect(resolveActor(new Request('https://example.test', {
      headers: { 'x-mahoshojo-activity-token': activityToken! },
    }))).resolves.toBeNull();
  });

  it('Better Auth 明确 403 时终止 Legacy Bearer fallback', async () => {
    const signatures = await createSignatures();
    const client = d1([{ id: 42, username: 'legacy-user', isBanned: null }]);
    const resolveActor = createArenaGenerationActorResolver({
      env: {
        HONO_AUTH_MODE: 'hybrid',
        BETTER_AUTH_URL: 'https://auth.example.test',
      },
      fetch: vi.fn(async () => new Response(null, { status: 403 })),
      signatures,
      getD1Client: () => client,
    });

    await expect(resolveActor(new Request('https://example.test', {
      headers: {
        Authorization: 'Bearer legacy-secret',
        cookie: 'better-auth.session_token=banned',
      },
    }))).resolves.toBeNull();
    expect(client.prepare).not.toHaveBeenCalled();

    await expect(resolveActor(new Request('https://example.test', {
      headers: { cookie: 'better-auth.session_token=banned-without-bearer' },
    }))).resolves.toBeNull();
  });

  it('falls back to a valid legacy Bearer when a stale Better Auth cookie is rejected', async () => {
    const signatures = await createSignatures();
    const client = d1([{ id: 42, username: 'legacy-user', isBanned: null }]);
    const resolveActor = createArenaGenerationActorResolver({
      env: {
        HONO_AUTH_MODE: 'hybrid',
        BETTER_AUTH_URL: 'https://auth.example.test',
      },
      fetch: vi.fn(async () => new Response(null, { status: 401 })),
      signatures,
      getD1Client: () => client,
    });

    await expect(resolveActor(new Request('https://example.test', {
      headers: {
        Authorization: 'Bearer legacy-secret',
        cookie: 'better-auth.session_token=expired',
      },
    }))).resolves.toMatchObject({ actorKey: 'user:42' });
  });
});
