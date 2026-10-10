import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { ARENA_EXPECTED_USER_ID_HEADER, DesktopArenaHostedReadinessSchema } from '@mahoshojo/contracts/desktop-arena-hosted';
import { createMemoryGenerationReplayStore } from '@mahoshojo/hosted-api/arena-generation/memory-replay-store';
import { configureArenaGenerationService, createNodeArenaGenerationService } from '@mahoshojo/hosted-runtime/arena-generation';
import { createSignatureService } from '@mahoshojo/hosted-runtime/signature';
import { DELETE, POST } from '#/adapters/arena/generate-stream';
import { GET as lookup } from '#/adapters/arena/generation-requests/[generationRequestId]';
import { GET as status } from '#/adapters/arena/generations/[generationId]';
import { GET as resume } from '#/adapters/arena/generations/[generationId]/stream';
import { POST as cancel } from '#/adapters/arena/generations/[generationId]/cancel';
import { configureHonoArenaGenerationRuntime } from '#/arena-generation/runtime';
import { createHonoDrReadinessHandler } from '#/adapters/hosted/dr-readiness';

const requestId = 'identity_request_1234';
const generationId = `arena_${'a'.repeat(64)}`;
const base = '/api/arena';
const variants = [
  ['POST', `${base}/generate-stream`, POST],
  ['DELETE', `${base}/generate-stream`, DELETE],
  ['GET', `${base}/generation-requests/${requestId}`, lookup],
  ['GET', `${base}/generations/${generationId}`, status],
  ['GET', `${base}/generations/${generationId}/stream`, resume],
  ['POST', `${base}/generations/${generationId}/cancel`, cancel],
] as const;
const context = { params: Promise.resolve({ generationId, generationRequestId: requestId }) };
const makeD1 = (rows: Record<string, unknown>[]) => ({ prepare: vi.fn(() => ({
  bind: vi.fn().mockReturnThis(), all: vi.fn(async () => ({ success: true, results: rows, meta: {} })),
  run: vi.fn(async () => ({ success: true, results: [], meta: {} })),
})) });
const setup = async (input: { cookieStatus?: number; cookieUser?: unknown; rows?: Record<string, unknown>[]; cookieThrow?: boolean } = {}) => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('synthetic-test-arena-identity-signing'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const signatures = createSignatureService({ getSigningKey: async () => key });
  const fetcher = vi.fn(async () => {
    if (input.cookieThrow) throw new Error('synthetic offline');
    return Response.json({ user: { id: input.cookieUser ?? 42 } }, { status: input.cookieStatus ?? 200 });
  });
  const prepare = vi.fn(async ({ payload }: { payload: Record<string, unknown> }) => ({ executionPayload: payload, semanticPayload: payload }));
  const execute = vi.fn(async () => ({ status: 'completed' as const }));
  const memory = createMemoryGenerationReplayStore();
  const reserve = vi.fn(memory.reserve.bind(memory));
  const service = createNodeArenaGenerationService({
    store: { ...memory, reserve }, env: { HONO_AUTH_MODE: 'hybrid', BETTER_AUTH_URL: 'https://auth.test' },
    signatures, fetch: fetcher, getD1Client: () => makeD1(input.rows ?? [{ id: 42, isBanned: null }]),
    executor: { prepare, execute }, replayPollMs: 1,
  });
  configureArenaGenerationService(service, { expectedUserIdAssertionInstalled: true });
  const app = new Hono();
  for (const [method, path, handler] of variants) app.on(method, path, (c) => handler(c.req.raw, context));
  return { app, fetcher, prepare, execute, reserve };
};
afterEach(() => configureArenaGenerationService(null));

const credentials = { Cookie: 'better-auth.session_token=synthetic-session', [ARENA_EXPECTED_USER_ID_HEADER]: 'v1:42' };
const body = JSON.stringify({ generationRequestId: requestId, reportFormat: 'markdown', mode: 'daily', combatants: [{ name: 'Synthetic' }], writeArenaHistory: false, writeCurrentState: false });

describe('Hono Arena expected-account assertion at the real handler/default-service boundary', () => {
  it.each([
    ['missing cookie', {} , {}],
    ['wrong account', { cookieUser: 43 }, credentials],
    ['expired cookie', { cookieStatus: 401 }, credentials],
    ['banned cookie', { cookieStatus: 403 }, credentials],
    ['cookie verification unavailable', { cookieThrow: true }, credentials],
    ['malformed session identity', { cookieUser: 'bad' }, credentials],
    ['banned bearer', { rows: [{ id: 42, isBanned: '2026-10-10' }] }, { Authorization: 'Bearer synthetic-banned' }],
    ['invalid bearer', { rows: [] }, { Authorization: 'Bearer synthetic-invalid' }],
  ])('%s fails closed on every create/control surface without reserving or executing', async (_name, options, headers) => {
    const test = await setup(options);
    for (const [method, path] of variants) {
      const response = await test.app.request(path, { method, headers: { ...headers, [ARENA_EXPECTED_USER_ID_HEADER]: 'v1:42' }, ...(method !== 'GET' ? { body } : {}) });
      expect(response.status, `${method} ${path}`).toBe(401);
      expect(response.headers.get('X-Mahoshojo-Generation-Actor-Token')).toBeNull();
    }
    expect(test.prepare).not.toHaveBeenCalled(); expect(test.execute).not.toHaveBeenCalled(); expect(test.reserve).not.toHaveBeenCalled();
  });
  it.each(['', '42', 'v2:42', 'v1:0', 'v1:-1', 'v1:01', 'v1:1.0', 'v1:9007199254740992', 'v1:42,v1:43'])('rejects malformed assertion %j before authentication or business input', async (assertion) => {
    const test = await setup();
    const response = await test.app.request(`${base}/generate-stream`, { method: 'POST', headers: { ...credentials, [ARENA_EXPECTED_USER_ID_HEADER]: assertion }, body: '{bad' });
    expect(response.status).toBe(401); expect(test.fetcher).not.toHaveBeenCalled(); expect(test.prepare).not.toHaveBeenCalled();
  });
  it('requires exact authenticated identity and preserves the request actor for all successors', async () => {
    const test = await setup();
    const response = await test.app.request(`${base}/generate-stream`, { method: 'POST', headers: credentials, body });
    expect(response.status, response.status !== 200 ? await response.clone().text() : '').toBe(200); const id = response.headers.get('x-mahoshojo-generation-id')!;
    expect(id).toMatch(/^arena_[a-f0-9]{64}$/u); await response.text();
    expect(test.prepare).toHaveBeenCalledWith(expect.objectContaining({ actorKey: 'user:42' }));
    expect(test.execute).toHaveBeenCalledTimes(1);
    const found = await lookup(new Request('https://hono.test', { headers: credentials }), { params: Promise.resolve({ generationRequestId: requestId }) });
    expect(found.status).toBe(200); expect(await found.json()).toMatchObject({ generationId: id });
  });
  it('does not let an asserted account use an anonymous token as a substitute', async () => {
    const test = await setup();
    const response = await test.app.request(`${base}/generate-stream`, { method: 'POST', headers: {
      [ARENA_EXPECTED_USER_ID_HEADER]: 'v1:42', 'X-Mahoshojo-Generation-Actor-Token': 'bootstrap.123e4567-e89b-42d3-a456-426614174000',
    }, body });
    expect(response.status).toBe(401); expect(test.reserve).not.toHaveBeenCalled();
  });
  it('keeps legacy no-assertion Cookie-unavailable anonymous semantics', async () => {
    const test = await setup({ cookieStatus: 401 });
    const response = await test.app.request(`${base}/generate-stream`, { method: 'POST', headers: { Cookie: credentials.Cookie }, body });
    expect(response.status, response.status !== 200 ? await response.clone().text() : '').toBe(200); expect(response.headers.get('x-mahoshojo-generation-actor-token')).toBeTruthy(); await response.text();
    expect(test.prepare).toHaveBeenCalledWith(expect.objectContaining({ actorKey: expect.stringMatching(/^anonymous:/u) }));
  });
  it.each(['system', 'preset'] as const)('supports anonymous/account × %s without deriving identity from funding', async (funding) => {
    const test = await setup();
    for (const account of [false, true]) {
      const response = await test.app.request(`${base}/generate-stream`, { method: 'POST', headers: account ? credentials : {}, body: JSON.stringify({ ...JSON.parse(body), generationRequestId: `${requestId}_${account}`, customProvider: funding === 'system' ? { providerId: 'system', apiKey: '' } : { providerId: 'synthetic-preset', apiKey: 'synthetic-key' } }) });
      expect(response.status, response.status !== 200 ? await response.clone().text() : '').toBe(200); await response.text();
    }
    expect(test.prepare.mock.calls.map(([v]) => (v as unknown as { actorKey: string }).actorKey)).toEqual([expect.stringMatching(/^anonymous:/u), 'user:42']);
    expect(test.execute).toHaveBeenCalledTimes(2);
  });
});

const provider = { id: 'hono-d1-primary' as const, openSession: () => ({ consistency: 'replica-ok' as const, initialBookmark: null, getBookmark: () => null, client: makeD1([{ ok: 1 }]) }) };
describe('Hono public Arena capability evidence', () => {
  it('only adds the versioned capability when the assertion-aware runtime is actually registered', async () => {
    const handler = createHonoDrReadinessHandler(provider);
    const request = new Request('https://hono.test/api/hosted/dr-readiness');
    const old = await handler(request); expect(DesktopArenaHostedReadinessSchema.safeParse(await old.json()).success).toBe(false);
    await setup();
    const ready = await handler(request); expect(ready.headers.get('cache-control')).toContain('no-store');
    expect(DesktopArenaHostedReadinessSchema.safeParse(await ready.json()).success).toBe(true);
    configureArenaGenerationService(null);
    expect(DesktopArenaHostedReadinessSchema.safeParse(await (await handler(request)).json()).success).toBe(false);
  });
  it('the actual Hono composition explicitly installs the advertised assertion capability', async () => {
    configureHonoArenaGenerationRuntime({ getGenerationReplayStore: () => createMemoryGenerationReplayStore() }, {
      settleRatings: async () => undefined, readRanking: async () => null,
    });
    const response = await createHonoDrReadinessHandler(provider)(new Request('https://hono.test/api/hosted/dr-readiness'));
    expect(DesktopArenaHostedReadinessSchema.safeParse(await response.json()).success).toBe(true);
  });
  it('retains the shared unavailable response and never advertises failed readiness', async () => {
    await setup(); const response = await createHonoDrReadinessHandler({ id: 'hono-d1-primary', openSession: () => null })(new Request('https://hono.test/api/hosted/dr-readiness'));
    expect(response.status).toBe(503); expect(await response.json()).not.toHaveProperty('arenaHosted');
  });
});
