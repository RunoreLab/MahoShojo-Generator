import { ARENA_RECONCILIATION_PROTOCOL_HEADER, ARENA_RECONCILIATION_PROTOCOL_VERSION } from '@mahoshojo/contracts/arena-reconciliation';
import { configureArenaCompanionRouteService, createArenaCompanionRouteService } from '@mahoshojo/hosted-runtime/arena-companion';
import type { ArenaGenerationService } from '@mahoshojo/hosted-api/arena-generation/service';
import { ARENA_COMPANION_PROTOCOL_HEADER, ARENA_COMPANION_PROTOCOL_VERSION } from '@mahoshojo/contracts/arena-companion';
import { DesktopArenaHostedReadinessSchema } from '@mahoshojo/contracts/desktop-arena-hosted';
import { describe, expect, it } from 'vitest';
import type { DatabaseProvider } from '@mahoshojo/hosted-runtime/database-provider';
import { createHonoDrReadinessHandler } from '#/adapters/hosted/dr-readiness';

const provider: DatabaseProvider = {
  id: 'hono-d1-primary',
  openSession: ({ consistency }) => ({
    consistency,
    initialBookmark: null,
    getBookmark: () => null,
    client: {
      prepare: () => {
        const statement = {
          bind: () => statement,
          run: async () => ({ success: true, results: [], meta: {} }),
          all: async () => ({ success: true, results: [{ ok: 1 }], meta: {} }),
        };
        return statement;
      },
    },
  }),
};

describe('Hono Hosted DR readiness adapter', () => {
  it('只注入 hono placement/provider 并保留 shared response', async () => {
    const handler = createHonoDrReadinessHandler(provider);
    const response = await handler(new Request('https://hono.test/api/hosted/dr-readiness'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      contractVersion: 'g25e1-v1',
      placement: 'hono-primary',
      databaseProvider: 'hono-d1-primary',
      consistency: 'replica-ok',
    });
  });

  it('provider unavailable 时返回 shared 503 wire', async () => {
    const handler = createHonoDrReadinessHandler({
      id: 'hono-d1-primary',
      openSession: () => null,
    });
    const response = await handler(new Request('https://hono.test/api/hosted/dr-readiness'));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'HOSTED_DR_CAPABILITY_UNAVAILABLE',
      contractVersion: 'g25e1-v1',
    });
  });
});

// The old C1 parser is strict: JSON capability must never be added to its body.
describe('Arena companion supplemental readiness header', () => {
  it('keeps the exact C1 body and adds only the dedicated successful GET header', async () => {
    const handler = createHonoDrReadinessHandler(provider, () => true, () => true);
    const response = await handler(new Request('https://hono.test/api/hosted/dr-readiness'));
    expect(response.headers.get(ARENA_COMPANION_PROTOCOL_HEADER)).toBe(ARENA_COMPANION_PROTOCOL_VERSION);
    const expected = { ok: true, contractVersion: 'g25e1-v1', placement: 'hono-primary', databaseProvider: 'hono-d1-primary', consistency: 'replica-ok', arenaHosted: { contractVersion: 'arena-hosted-sse-v1', expectedUserIdAssertion: 'v1', stream: 'sse-v1' } };
    expect(await response.text()).toBe(JSON.stringify(expected));
    expect(DesktopArenaHostedReadinessSchema.parse(expected)).toEqual(expected);
    const head = await handler(new Request('https://hono.test/api/hosted/dr-readiness', { method: 'HEAD' }));
    expect(head.headers.get(ARENA_COMPANION_PROTOCOL_HEADER)).toBeNull();
    expect(await head.text()).toBe('');
  });
  it('leaves C1 ready when the companion protocol alone is absent', async () => {
    const response = await createHonoDrReadinessHandler(provider, () => true, () => false)(new Request('https://hono.test/api/hosted/dr-readiness'));
    expect(response.headers.get(ARENA_COMPANION_PROTOCOL_HEADER)).toBeNull();
    expect(DesktopArenaHostedReadinessSchema.safeParse(await response.json()).success).toBe(true);
  });
  it('does not advertise JSON without C1 identity or when readiness fails', async () => {
    const legacy = await createHonoDrReadinessHandler(provider, () => false)(new Request('https://hono.test/api/hosted/dr-readiness'));
    expect(legacy.headers.get(ARENA_COMPANION_PROTOCOL_HEADER)).toBeNull();
    const failed = await createHonoDrReadinessHandler({ id: 'hono-d1-primary', openSession: () => null }, () => true)(new Request('https://hono.test/api/hosted/dr-readiness'));
    expect(failed.status).toBe(503); expect(failed.headers.get(ARENA_COMPANION_PROTOCOL_HEADER)).toBeNull();
  });
});


describe('Arena reconciliation creation readiness header', () => {
  it('comes from actual registered service installation, not importing the protocol constant', async () => {
    const request = () => new Request('https://hono.test/api/hosted/dr-readiness');
    configureArenaCompanionRouteService(null);
    const handler = createHonoDrReadinessHandler(provider, () => true);
    expect((await handler(request())).headers.has(ARENA_RECONCILIATION_PROTOCOL_HEADER)).toBe(false);
    const unavailable = async () => new Response(null, { status: 503 });
    const generationService: ArenaGenerationService = { create: unavailable, createSubscription: unavailable, lookup: unavailable, resume: unavailable, status: unavailable, cancel: unavailable, cancelRequest: unavailable };
    const service = createArenaCompanionRouteService({ generationService, placement: 'hono-primary', signatures: { verifySignature: async () => false, generateSignature: async () => null } });
    try {
      configureArenaCompanionRouteService({ ...service, reconciliationProtocolVersion: undefined });
      const old = await handler(request());
      expect(old.headers.get(ARENA_COMPANION_PROTOCOL_HEADER)).toBe(ARENA_COMPANION_PROTOCOL_VERSION);
      expect(old.headers.has(ARENA_RECONCILIATION_PROTOCOL_HEADER)).toBe(false);
      configureArenaCompanionRouteService(service);
      const ready = await handler(request());
      expect(ready.headers.get(ARENA_RECONCILIATION_PROTOCOL_HEADER)).toBe(ARENA_RECONCILIATION_PROTOCOL_VERSION);
      expect(DesktopArenaHostedReadinessSchema.safeParse(await ready.json()).success).toBe(true);
      const head = await handler(new Request(request().url, { method: 'HEAD' }));
      expect(head.headers.has(ARENA_RECONCILIATION_PROTOCOL_HEADER)).toBe(false);
      const failed = await createHonoDrReadinessHandler({ id: 'hono-d1-primary', openSession: () => null }, () => true)(request());
      expect(failed.headers.has(ARENA_RECONCILIATION_PROTOCOL_HEADER)).toBe(false);
    } finally {
      configureArenaCompanionRouteService(null);
    }
    expect((await handler(request())).headers.has(ARENA_RECONCILIATION_PROTOCOL_HEADER)).toBe(false);
  });
});
