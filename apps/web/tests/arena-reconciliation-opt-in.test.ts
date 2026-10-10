import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ARENA_RECONCILIATION_CAPABILITY,
  ARENA_RECONCILIATION_LIMITS,
  ARENA_RECONCILIATION_PROTOCOL_HEADER,
  ARENA_RECONCILIATION_PROTOCOL_VERSION,
  parseArenaReconciliationResponse,
} from '@mahoshojo/contracts/arena-reconciliation';
import { ARENA_EXPECTED_USER_ID_HEADER } from '@mahoshojo/contracts/desktop-arena-hosted';
import { createEnvSignatureService } from '@mahoshojo/hosted-runtime/node-runtime/env-signature';
import { ARENA_ANONYMOUS_TOKEN_HEADER, createArenaGenerationActorResolvers } from '@mahoshojo/hosted-runtime/arena-generation';

const ports = vi.hoisted(() => ({ getD1Client: vi.fn(), resolveActor: vi.fn() }));
vi.mock('@/app/api/arena/generation-runtime', () => ({ resolveCloudflareDrArenaGenerationActor: ports.resolveActor }));
vi.mock('@/lib/hosted-dr/database-provider', () => ({ getNextHostedD1Client: ports.getD1Client }));
vi.mock('@/lib/signature', async () => {
  const actual = await vi.importActual<typeof import('@/lib/signature')>('@/lib/signature');
  return { ...actual, generateSignature: vi.fn(actual.generateSignature) };
});
import { generateSignature } from '@/lib/signature';
import * as arenaService from '@/lib/arena/service';
import { appRouteHandler } from '@/app/api/arena/update-combatants-after-stream/handler';

const secret = 'synthetic-reconciliation-test-key';
const generationId = `arena_${'a'.repeat(64)}`;
const endpoint = 'https://example.test/api/arena/update-combatants-after-stream';
const cards = [{ type: 'general-character', sourceDataCardId: 'card-a', data: { name: 'A', templateId: '通用角色' } }];
const signatures = createEnvSignatureService({ env: { SIGNATURE_SECRET_KEY: secret } });
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), (byte) => byte.toString(16).padStart(2, '0')).join('');
const manifest = () => ({
  report: { headline: '冻结战报', mode: 'daily', officialReport: { winner: 'A' } },
  impacts: [{ combatantIndex: 0, characterName: 'A', impact: '冻结影响', currentStateSummary: '战后平静' }],
  scenario: { title: null, isNative: false }, userGuidance: null,
  writeArenaHistory: true, writeCurrentState: true,
});
const frozenRoster = () => [{ sortIndex: 0, name: 'A', type: 'general-character', dataCardId: 'card-a', isNative: false }];
let terminal: Record<string, unknown> | null;
let extra: Record<string, unknown>;
const createAnonymousId = vi.fn(() => 'must-never-create-a-new-actor');
const query = vi.fn();
const client = {
  prepare: vi.fn((sql: string) => {
    let values: unknown[] = [];
    const statement = {
      bind: vi.fn((...input: unknown[]) => { values = input; return statement; }),
      all: vi.fn(async () => {
        query(sql, values);
        const results = sql.includes('FROM users')
          ? values[0] === 'synthetic-bearer-42' ? [{ id: 42, username: 'synthetic-user', isBanned: null }] : []
          : values[0] === generationId && terminal ? [{ ...terminal, extra_json: JSON.stringify(extra) }] : [];
        return { success: true, results, meta: {} };
      }),
    };
    return statement;
  }),
};
const request = (body: unknown = { generationId, combatants: cards }, headers: HeadersInit = {}, optIn = true) => new Request(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(optIn ? { [ARENA_RECONCILIATION_PROTOCOL_HEADER]: ARENA_RECONCILIATION_PROTOCOL_VERSION } : {}), ...Object.fromEntries(new Headers(headers)) },
  body: JSON.stringify(body),
});
const accountHeaders = { Authorization: 'Bearer synthetic-bearer-42', [ARENA_EXPECTED_USER_ID_HEADER]: 'v1:42' };
const send = (req: Request) => appRouteHandler(req as never);
const assertExternalArtifactDirectory = (directory: string) => {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const output = resolve(directory);
  const relativeOutput = relative(repositoryRoot, output);
  expect(relativeOutput === '..' || relativeOutput.startsWith(`..${sep}`) || isAbsolute(relativeOutput)).toBe(true);
  return output;
};
const originalAnonymousToken = async () => {
  const issued = await createArenaGenerationActorResolvers({
    env: { HONO_AUTH_MODE: 'bearer' }, signatures, getD1Client: () => client as never,
    createAnonymousId: () => 'synthetic-original-actor',
  }).resolveActor(new Request(endpoint));
  return new Headers(issued!.responseHeaders).get(ARENA_ANONYMOUS_TOKEN_HEADER)!;
};

describe('Next arena-reconciliation-v1 boundary with real actor, D1 ownership reader and update producer', () => {
  beforeEach(async () => {
    vi.stubEnv('SIGNATURE_SECRET_KEY', secret);
    vi.clearAllMocks();
    ports.getD1Client.mockReturnValue(client);
    const resolver = createArenaGenerationActorResolvers({
      env: { HONO_AUTH_MODE: 'bearer' }, signatures, getD1Client: () => client as never, createAnonymousId,
    });
    ports.resolveActor.mockImplementation(resolver.resolveActor);
    terminal = { status: 'completed' };
    extra = {
      generationOwnerHash: await sha256('user:42'), finalizationCompleted: true,
      localCardReconciliation: manifest(), combatantsFallback: frozenRoster(),
    };
  });
  afterEach(() => vi.unstubAllEnvs());

  it('GET is exact local capability with no credentials, actor resolution, D1 query or Hono readiness', async () => {
    const response = await send(new Request(endpoint));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get(ARENA_RECONCILIATION_PROTOCOL_HEADER)).toBe(ARENA_RECONCILIATION_PROTOCOL_VERSION);
    expect(await response.json()).toEqual(ARENA_RECONCILIATION_CAPABILITY);
    expect(ports.resolveActor).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(generateSignature).toHaveBeenCalledWith({ purpose: 'arena-reconciliation-capability-v1' });
  });

  it.each(['d1', 'secret', 'signing'] as const)('GET/POST fail closed when local %s capability is absent', async (missing) => {
    if (missing === 'd1') ports.getD1Client.mockReturnValue(null);
    if (missing === 'secret') vi.stubEnv('SIGNATURE_SECRET_KEY', '  ');
    if (missing === 'signing') vi.mocked(generateSignature).mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    for (const req of [new Request(endpoint), request(undefined, accountHeaders)]) {
      const response = await send(req);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: 'ARENA_RECONCILIATION_CAPABILITY_UNAVAILABLE' });
    }
    expect(ports.resolveActor).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it.each(['', 'arena-reconciliation-v0', 'arena-reconciliation-v1, arena-reconciliation-v1'])('present invalid version %j never falls back to Web', async (version) => {
    const response = await send(request(undefined, { ...accountHeaders, [ARENA_RECONCILIATION_PROTOCOL_HEADER]: version }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ version: ARENA_RECONCILIATION_PROTOCOL_VERSION, code: 'ARENA_RECONCILIATION_PROTOCOL_UNSUPPORTED', error: expect.any(String) });
    expect(ports.resolveActor).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('successful account flow verifies actual expectedUserId, reads generation authority and uses the original producer', async () => {
    const response = await send(request(undefined, accountHeaders));
    expect(response.status).toBe(200);
    const body = parseArenaReconciliationResponse(await response.text(), generationId, cards.length);
    expect(body).toMatchObject({
      version: ARENA_RECONCILIATION_PROTOCOL_VERSION, generationId, success: true,
      updatedCombatants: [{ combatantIndex: 0, isNative: false, data: {
        arena_history: { entries: [{ title: '冻结战报', impact: '冻结影响', metadata: { generation_id: generationId } }] },
        current_state: { summary: '战后平静', generation_id: generationId },
      } }], warnings: [],
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]![1]).toEqual([generationId]);
    expect(createAnonymousId).not.toHaveBeenCalled();
    expect(cards[0]!.data).not.toHaveProperty('arena_history');
  });

  it.each(['v1:7', 'v2:42', 'v1:042', '42', ''])('actual wrong expectedUserId %j cannot read the owned manifest', async (assertion) => {
    const response = await send(request(undefined, { ...accountHeaders, [ARENA_EXPECTED_USER_ID_HEADER]: assertion }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ version: ARENA_RECONCILIATION_PROTOCOL_VERSION, generationId, code: 'UNAUTHORIZED' });
    expect(query.mock.calls.every(([sql]) => sql.includes('FROM users'))).toBe(true);
    expect(createAnonymousId).not.toHaveBeenCalled();
  });

  it('invalid bearer never falls back to a valid anonymous token or missing assertion', async () => {
    const token = await originalAnonymousToken();
    query.mockClear();
    for (const headers of [
      { ...accountHeaders, Authorization: 'Bearer synthetic-invalid', [ARENA_ANONYMOUS_TOKEN_HEADER]: token },
      { Authorization: 'Bearer synthetic-bearer-42' },
      { Authorization: 'Bearer synthetic-bearer-42', [ARENA_ANONYMOUS_TOKEN_HEADER]: token },
    ]) {
      expect((await send(request(undefined, headers))).status).toBe(401);
    }
    expect(query.mock.calls.every(([sql]) => sql.includes('FROM users'))).toBe(true);
    expect(createAnonymousId).not.toHaveBeenCalled();
  });

  it('only the signed original anonymous actor works; absent, bootstrap, corrupt and expired tokens fail closed', async () => {
    const token = await originalAnonymousToken();
    extra.generationOwnerHash = await sha256('anonymous:synthetic-original-actor');
    const headers = { [ARENA_ANONYMOUS_TOKEN_HEADER]: token };
    expect((await send(request(undefined, headers))).status).toBe(200);
    const expiredPayload = { v: 1, anonymousId: 'synthetic-original-actor', issuedAt: '2000-01-01T00:00:00.000Z', expiresAt: '2000-01-02T00:00:00.000Z' };
    const expired = Buffer.from(JSON.stringify({ ...expiredPayload, signature: await signatures.generateSignature(expiredPayload) })).toString('base64url');
    for (const bad of ['', 'bootstrap.00000000-0000-4000-8000-000000000000', 'synthetic-invalid', expired]) {
      const response = await send(request(undefined, bad ? { [ARENA_ANONYMOUS_TOKEN_HEADER]: bad } : {}));
      expect(response.status).toBe(401);
      expect(response.headers.has(ARENA_ANONYMOUS_TOKEN_HEADER)).toBe(false);
    }
    expect(createAnonymousId).not.toHaveBeenCalled();
  });

  it.each([
    ['owner mismatch', 404, 'ARENA_RECONCILIATION_NOT_FOUND'],
    ['generation missing', 404, 'ARENA_RECONCILIATION_NOT_FOUND'],
    ['not completed', 409, 'ARENA_RECONCILIATION_GENERATION_NOT_COMPLETED'],
    ['finalization pending', 503, 'ARENA_RECONCILIATION_FINALIZATION_PENDING'],
    ['manifest missing', 409, 'ARENA_RECONCILIATION_MANIFEST_UNAVAILABLE'],
    ['manifest overflow', 409, 'ARENA_RECONCILIATION_MANIFEST_UNAVAILABLE'],
  ] as const)('%s is still decided by actual D1 authority after successful GET', async (kind, status, code) => {
    expect((await send(new Request(endpoint))).status).toBe(200);
    if (kind === 'owner mismatch') extra.generationOwnerHash = await sha256('user:7');
    if (kind === 'generation missing') terminal = null;
    if (kind === 'not completed') terminal = { status: 'running' };
    if (kind === 'finalization pending') extra.finalizationCompleted = false;
    if (kind === 'manifest missing') delete extra.localCardReconciliation;
    if (kind === 'manifest overflow') extra.localCardReconciliation = { available: false, reason: 'manifest_budget_exceeded' };
    const response = await send(request(undefined, accountHeaders));
    expect(response.status).toBe(status);
    expect(parseArenaReconciliationResponse(await response.text(), generationId, 1)).toMatchObject({ generationId, code });
  });

  it('real handler warnings and roster-mismatch errors all satisfy the strict protocol, including null names', async () => {
    extra.combatantsFallback = [
      ...frozenRoster(),
      { sortIndex: 1, name: '同名', type: 'general-character', dataCardId: 'card-b', isNative: false },
      { sortIndex: 2, name: '同名', type: 'general-character', dataCardId: 'card-c', isNative: false },
      { sortIndex: 3, type: 'general-character', dataCardId: 'card-d', isNative: false },
    ];
    extra.localCardReconciliation = { ...manifest(), impacts: [{ characterName: '同名', impact: '无法唯一分配' }] };
    const unknown = { type: 'general-character', sourceDataCardId: 'unknown-card', data: { name: '外部角色' } };
    const response = await send(request({ generationId, combatants: [...cards, unknown] }, accountHeaders));
    expect(response.status).toBe(200);
    const result = parseArenaReconciliationResponse(await response.text(), generationId, 2);
    expect(result).toMatchObject({
      warnings: expect.arrayContaining([
        expect.objectContaining({ combatantIndex: 1, code: 'ARENA_RECONCILIATION_COMBATANT_UNMATCHED' }),
        expect.objectContaining({ rosterIndex: 3, characterName: null, code: 'ARENA_RECONCILIATION_ROSTER_COMBATANT_MISSING' }),
        expect.objectContaining({ characterName: '同名', code: 'ARENA_RECONCILIATION_IMPACT_AMBIGUOUS' }),
      ]),
    });
    const mismatch = await send(request({ generationId, combatants: [unknown] }, accountHeaders));
    expect(mismatch.status).toBe(409);
    expect(parseArenaReconciliationResponse(await mismatch.text(), generationId, 1)).toMatchObject({
      code: 'ARENA_RECONCILIATION_ROSTER_MISMATCH', errors: expect.arrayContaining([
        expect.objectContaining({ combatantIndex: 0 }), expect.objectContaining({ rosterIndex: 3, characterName: null }),
      ]),
    });
  });

  it('accepts all 32 canonical combatants and the inclusive raw input byte boundary', async () => {
    const combatants = Array.from({ length: 32 }, (_, index) => ({
      type: 'general-character', sourceDataCardId: `card-${index}`, data: { name: `角色${index}`, templateId: '通用角色' },
    }));
    extra.combatantsFallback = combatants.map((card, sortIndex) => ({
      sortIndex, name: card.data.name, type: card.type, dataCardId: card.sourceDataCardId, isNative: false,
    }));
    const wire = JSON.stringify({ generationId, combatants });
    const response = await send(new Request(endpoint, {
      method: 'POST', headers: { ...accountHeaders, [ARENA_RECONCILIATION_PROTOCOL_HEADER]: ARENA_RECONCILIATION_PROTOCOL_VERSION },
      body: wire + ' '.repeat(ARENA_RECONCILIATION_LIMITS.requestBodyBytes - new TextEncoder().encode(wire).byteLength),
    }));
    expect(response.status).toBe(200);
    const result = parseArenaReconciliationResponse(await response.text(), generationId, 32);
    expect(result).toMatchObject({ updatedCombatants: expect.arrayContaining([expect.objectContaining({ combatantIndex: 31 })]) });
    expect('success' in result && result.updatedCombatants.length).toBe(32);
  });

  it('frozen switches remain authoritative even when currently submitted data asks for mutation', async () => {
    extra.localCardReconciliation = { ...manifest(), writeArenaHistory: false, writeCurrentState: false };
    const response = await send(request({ generationId, combatants: [{ ...cards[0], data: { ...cards[0]!.data, writeArenaHistory: true } }] }, accountHeaders));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ updatedCombatants: [] });
    expect((await send(request({ generationId, combatants: cards, writeArenaHistory: true }, accountHeaders))).status).toBe(400);
  });

  it('retains native evidence only after the original matching and signature pipeline verifies it', async () => {
    const data = { ...cards[0]!.data, signature: await signatures.generateSignature(cards[0]!.data) };
    extra.combatantsFallback = [{ ...frozenRoster()[0], isNative: true, nativeSignature: data.signature }];
    const response = await send(request({ generationId, combatants: [{ ...cards[0], data }] }, accountHeaders));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.updatedCombatants[0].isNative).toBe(true);
    expect(await signatures.verifySignature(result.updatedCombatants[0].data)).toBe(true);
    expect(result.updatedCombatants[0].data.signature).not.toBe(data.signature);
  });

  it('new role-count and raw UTF-8 input gates apply only to opt-in and cover lying or absent Content-Length', async () => {
    expect((await send(request({ generationId, combatants: Array.from({ length: 33 }, () => cards[0]) }, accountHeaders))).status).toBe(400);
    const oversized = { generationId, combatants: [{ ...cards[0], data: { note: '界'.repeat(Math.floor(ARENA_RECONCILIATION_LIMITS.requestBodyBytes / 3)) } }] };
    for (const length of [undefined, '1', String(ARENA_RECONCILIATION_LIMITS.requestBodyBytes + 1)]) {
      const response = await send(request(oversized, { ...accountHeaders, ...(length ? { 'Content-Length': length } : {}) }));
      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ code: 'ARENA_RECONCILIATION_REQUEST_TOO_LARGE' });
    }
    expect(ports.resolveActor).not.toHaveBeenCalled();
  });

  it('real producer preserves a legacy 9 MiB ID within a near-12 MiB request without duplicating it', async () => {
    const artifactDirectory = process.env.MAHOSHOJO_ARENA_RECONCILIATION_CAPACITY_DIR;
    const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;
    const legacyId = 'x'.repeat(9 * 1024 * 1024);
    const data = { ...cards[0]!.data, arena_history: { attributes: {}, entries: [{ id: legacyId }] }, padding: '' };
    const body = { generationId, combatants: [{ ...cards[0], data }] };
    data.padding = 'p'.repeat(ARENA_RECONCILIATION_LIMITS.requestBodyBytes - byteLength(JSON.stringify(body)) - 1);
    const inputBytes = byteLength(JSON.stringify(body));
    expect(inputBytes).toBe(ARENA_RECONCILIATION_LIMITS.requestBodyBytes - 1);
    const response = await send(request(body, accountHeaders));
    const raw = await response.text();
    expect(response.status).toBe(200);
    const result = parseArenaReconciliationResponse(raw, generationId, 1);
    expect(result).toMatchObject({ success: true, updatedCombatants: [{ data: {
      arena_history: { entries: [{ id: legacyId }, { id: 1 }] }, padding: data.padding,
    } }] });
    expect(byteLength(raw)).toBeLessThan(inputBytes + 8192);
    expect(byteLength(raw)).toBeLessThan(ARENA_RECONCILIATION_LIMITS.responseBodyBytes);
    expect(data.arena_history.entries).toEqual([{ id: legacyId }]);
    expect(query).toHaveBeenCalledTimes(2);
    expect(ports.resolveActor).toHaveBeenCalledTimes(1);
    if (artifactDirectory) {
      const output = assertExternalArtifactDirectory(artifactDirectory);
      await mkdir(output, { recursive: true });
      const filename = 'response-near-request-limit.json';
      await writeFile(resolve(output, filename), raw, 'utf8');
      await writeFile(resolve(output, 'producer-manifest.json'), `${JSON.stringify({
        version: 2, recipe: 'real producer near-12MiB request; no legacy-ID amplification',
        protocolVersion: ARENA_RECONCILIATION_PROTOCOL_VERSION, generationId, combatantCount: 1,
        inputBytes, legacyIdCodeUnits: legacyId.length,
        fixtures: [{ filename, bytes: byteLength(raw), sha256: await sha256(raw), httpStatus: 200, source: 'actual-opt-in-handler-and-unmodified-producer' }],
      }, null, 2)}\n`, 'utf8');
    }
  });

  it('synthetic expanded reply probes the real handler and parser at exact 16 MiB and +1 byte', async () => {
    // The fixed producer no longer amplifies legacy IDs. This is explicitly a transport
    // defense fixture, not evidence that a legal request reaches the producer's 16 MiB limit.
    // Real near-12 MiB producer bytes are emitted by the independent test above.
    const artifactDirectory = process.env.MAHOSHOJO_ARENA_RECONCILIATION_CAPACITY_DIR;
    const output = artifactDirectory ? assertExternalArtifactDirectory(artifactDirectory) : null;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T00:00:00.000Z'));
    const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;
    const actualProducer = arenaService.applyPostBattleUpdates;
    let padding = '', expandedRaw = '';
    const producer = vi.spyOn(arenaService, 'applyPostBattleUpdates').mockImplementation(async (...args) => {
      const updatedCombatants = await actualProducer(...args);
      updatedCombatants[0]!.data.transportBoundaryPadding = padding;
      expandedRaw = JSON.stringify({
        version: ARENA_RECONCILIATION_PROTOCOL_VERSION,
        generationId, updatedCombatants, warnings: [], success: true,
      });
      return updatedCombatants;
    });
    try {
      const baseline = await send(request(undefined, accountHeaders));
      expect(baseline.status).toBe(200);
      const remaining = ARENA_RECONCILIATION_LIMITS.responseBodyBytes - byteLength(await baseline.text());
      expect(remaining).toBeGreaterThan(0);
      padding = 'p'.repeat(remaining);
      const atLimit = await send(request(undefined, accountHeaders));
      expect(atLimit.status).toBe(200);
      const atLimitRaw = await atLimit.text();
      expect(byteLength(atLimitRaw)).toBe(ARENA_RECONCILIATION_LIMITS.responseBodyBytes);
      expect(await sha256(expandedRaw)).toBe(await sha256(atLimitRaw));
      expect(parseArenaReconciliationResponse(atLimitRaw, generationId, 1)).toMatchObject({ success: true });

      padding += 'p';
      const overLimit = await send(request(undefined, accountHeaders));
      const overLimitRaw = await overLimit.text();
      const overLimitExpandedRaw = expandedRaw;
      expect(byteLength(overLimitExpandedRaw)).toBe(ARENA_RECONCILIATION_LIMITS.responseBodyBytes + 1);
      expect(overLimit.status).toBe(503);
      const error = parseArenaReconciliationResponse(overLimitRaw, generationId, 1);
      expect(error).toMatchObject({ code: 'ARENA_RECONCILIATION_RESPONSE_TOO_LARGE' });
      expect(error).not.toHaveProperty('updatedCombatants');
      expect(() => parseArenaReconciliationResponse(overLimitExpandedRaw, generationId, 1)).toThrow('RESPONSE_TOO_LARGE');
      expect(producer).toHaveBeenCalledTimes(3);
      expect(ports.resolveActor).toHaveBeenCalledTimes(3);
      expect(query).toHaveBeenCalledTimes(6);

      if (output) {
        await mkdir(output, { recursive: true });
        const fixtures = [
          { filename: 'transport-at-limit.json', raw: atLimitRaw, httpStatus: 200, source: 'synthetic-expanded-reply-through-actual-handler' },
          { filename: 'transport-over-limit.json', raw: overLimitExpandedRaw, httpStatus: null, source: 'synthetic-expanded-reply-before-handler-budget-rejection' },
          { filename: 'response-over-limit.json', raw: overLimitRaw, httpStatus: 503, source: 'actual-handler-rejection-of-synthetic-expanded-reply' },
        ];
        const records = [];
        for (const fixture of fixtures) {
          await writeFile(resolve(output, fixture.filename), fixture.raw, 'utf8');
          records.push({ filename: fixture.filename, bytes: byteLength(fixture.raw), sha256: await sha256(fixture.raw), httpStatus: fixture.httpStatus, source: fixture.source });
        }
        await writeFile(resolve(output, 'transport-manifest.json'), `${JSON.stringify({
          version: 2, recipe: 'synthetic expanded reply for transport defense, not evidence of a producer-reachable size',
          protocolVersion: ARENA_RECONCILIATION_PROTOCOL_VERSION, generationId,
          requestId: 'arena_request_1234', combatantCount: 1, frozenTime: new Date().toISOString(),
          paddingCodeUnits: remaining, fixtures: records,
        }, null, 2)}\n`, 'utf8');
      }
    } finally {
      producer.mockRestore();
      vi.useRealTimers();
    }
  });

  it('headerless Web keeps its old success/error envelope, bootstrap behavior and no signature readiness gate', async () => {
    vi.stubEnv('SIGNATURE_SECRET_KEY', '');
    const response = await send(request(undefined, { Authorization: accountHeaders.Authorization }, false));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(['success', 'updatedCombatants', 'warnings']);
    expect(response.headers.has(ARENA_RECONCILIATION_PROTOCOL_HEADER)).toBe(false);
    const invalid = await send(request({}, {}, false));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: 'generationId 无效' });
    extra.generationOwnerHash = await sha256('anonymous:must-never-create-a-new-actor');
    expect((await send(request(undefined, {}, false))).status).toBe(200);
    expect(createAnonymousId).toHaveBeenCalledTimes(1);
  });
});
