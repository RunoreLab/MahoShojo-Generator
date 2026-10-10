import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { ArenaGenerationService, ArenaGenerationSubscription, GenerationStreamEvent } from '@mahoshojo/hosted-api/arena-generation/service';
import { ARENA_COMPANION_PROTOCOL_HEADER, ARENA_COMPANION_PROTOCOL_VERSION, parseArenaCompanionEnvelope } from '@mahoshojo/contracts/arena-companion';
import { createArenaCompanionService, type ArenaCompanionServiceOptions } from '../src/arena-companion/service';
import { createArenaPostBattleProjector } from '../src/arena-companion/post-battle';
const fixture = JSON.parse(readFileSync(new URL('../../contracts/fixtures/arena-companion.json', import.meta.url), 'utf8'));
import { createArenaCompanionResponseWriter } from '../src/arena-companion/response';
import { configureArenaCompanionRouteService, isArenaCompanionProtocolInstalled, registeredArenaCompanionRouteService } from '../src/arena-companion/service-registry';

const generationId = fixture.successEnvelopes[0]!.body.generationId;
const requestId = 'request-12345678';
const request = (optIn = true, body: unknown = { mode: 'classic', writeArenaHistory: false, writeCurrentState: false }) => new Request('https://fixture.invalid/api/generate-battle-story', {
  method: 'POST', headers: optIn ? { [ARENA_COMPANION_PROTOCOL_HEADER]: ARENA_COMPANION_PROTOCOL_VERSION } : {}, body: JSON.stringify(body),
});
const events = (items: GenerationStreamEvent[]) => new ReadableStream<GenerationStreamEvent>({ start(controller) { for (const item of items) controller.enqueue(item); controller.close(); } });
const fakeService = (createParsedSubscription: NonNullable<ArenaGenerationService['createParsedSubscription']>): ArenaGenerationService => {
  const forbidden = async () => { throw new Error('Only one parsed subscription may be used'); };
  return { createParsedSubscription, createSubscription: forbidden, create: forbidden, cancelRequest: forbidden, lookup: forbidden, resume: forbidden, status: forbidden, cancel: forbidden };
};
const baseReport = { headline: '结构化战报', article: { body: '正文中自由出现\n## 胜利者\n不截断。', analysis: '独立点评' }, officialReport: { winner: '角色甲', conclusion: '约定延续' } };
const makeSubscription = (index = 0, extraTelemetry: Record<string, unknown> = {}, overrides: Partial<ArenaGenerationSubscription> = {}): ArenaGenerationSubscription => {
  const value = fixture.successEnvelopes[index]!;
  const report = value.body.report;
  const webPackage = 'webPackage' in report ? report.webPackage : undefined;
  return {
    generationId, generationRequestId: requestId,
    headers: {
      'X-Mahoshojo-Generation-Id': generationId, 'X-Mahoshojo-Generation-Request-Id': requestId,
      'X-Mahoshojo-Generation-Actor-Token': 'synthetic-actor-token', 'X-Mahoshojo-Generation-Payload-Hash': 'a'.repeat(64),
      'X-Mahoshojo-Stream-Meta': encodeURIComponent(JSON.stringify(value.metadata)),
      'x-mahoshojo-generation-terminal-status': 'completed',
    },
    events: events([
      { id: '1-0', type: 'snapshot', data: { markdown: index ? report.article.body : JSON.stringify(baseReport) } },
      { id: '2-0', type: 'meta', data: { meta: { report: { headline: baseReport.headline, winner: '角色甲' } }, ...(webPackage ? { webPackage } : {}) } },
      { id: '3-0', type: 'telemetry', data: { model: 'test-model', usage: { candidatesTokenCount: Number.MAX_SAFE_INTEGER, thoughtsTokenCount: Number.MAX_SAFE_INTEGER }, reasoning: report.aiReasoning, ...extraTelemetry } },
      { id: '4-0', type: 'done', data: { ok: true, status: 'completed', ...(webPackage ? { webPackage } : {}) } },
    ]), ...overrides,
  };
};
const makeCompanion = (create: () => ArenaGenerationSubscription | Response, project: ArenaCompanionServiceOptions['projectUpdatedCombatants'] = vi.fn(async () => [] as Record<string, unknown>[])) => createArenaCompanionService({
  generationService: fakeService(async () => create()), createGenerationRequestId: () => requestId, projectUpdatedCombatants: project,
});

describe('Arena companion exact opt-in delivery', () => {
  it.each([0, 1, 2])('legacy and v1 share the exact public body and every metadata field (%s)', async (index) => {
    const companion = makeCompanion(() => makeSubscription(index));
    const legacy = await companion.generate(request(false));
    const legacyText = await legacy.text();
    const modern = await companion.generate(request());
    const envelope = parseArenaCompanionEnvelope(await modern.text());
    expect(legacy.status).toBe(200); expect(modern.status).toBe(200);
    expect(envelope.body).toEqual(JSON.parse(legacyText));
    expect(envelope.metadata).toEqual(JSON.parse(decodeURIComponent(legacy.headers.get('x-mahoshojo-stream-meta')!)));
    expect(modern.headers.get('x-mahoshojo-stream-meta')).toBeNull();
    expect(modern.headers.get(ARENA_COMPANION_PROTOCOL_HEADER)).toBe(ARENA_COMPANION_PROTOCOL_VERSION);
    expect(legacy.headers.get(ARENA_COMPANION_PROTOCOL_HEADER)).toBeNull();
    for (const [name, value] of legacy.headers) if (name !== 'x-mahoshojo-stream-meta') expect(modern.headers.get(name)).toBe(value);
    expect(envelope.metadata).toEqual(fixture.successEnvelopes[index]!.metadata);
    if (!index) expect(envelope.body).toEqual(fixture.successEnvelopes[0]!.body);
    expect(modern.headers.get('x-mahoshojo-generation-terminal-status')).toBe('completed');
  });
  it('retains original public preflight errors and never leaks unknown upstream fields', async () => {
    const known = { code: 'UNAUTHORIZED', error: 'Unauthorized' };
    const legacy = await makeCompanion(() => Response.json(known, { status: 401 })).generate(request(false));
    expect(legacy.status).toBe(401); expect(await legacy.json()).toEqual(known);
    const modern = await makeCompanion(() => Response.json(known, { status: 401 })).generate(request());
    expect(modern.status).toBe(401); expect(await modern.json()).toEqual({ version: ARENA_COMPANION_PROTOCOL_VERSION, body: known, metadata: null });
    const rejected = await makeCompanion(() => Response.json({ ...known, providerError: 'synthetic-secret' }, { status: 401 })).generate(request());
    expect(rejected.status).toBe(502); expect(await rejected.text()).not.toContain('synthetic-secret');
  });
  it.each(['model-length', 'model-trim', 'reasoning-parts', 'metadata-extra', 'metadata-missing', 'malformed-report', 'projection'])('diagnoses completed delivery %s without changing generation state or losing its identity', async (failure) => {
    
    const subscription = () => {
      const value = { ...makeSubscription(0, failure === 'model-length' ? { model: 'm'.repeat(201) }
        : failure === 'model-trim' ? { model: ' test-model ' }
        : failure === 'reasoning-parts' ? { reasoning: { ...fixture.successEnvelopes[0]!.body.report.aiReasoning, parts: [{ text: 'unsupported' }] } } : {}) };
      if (failure === 'metadata-extra') value.headers = { ...value.headers, 'X-Mahoshojo-Stream-Meta': encodeURIComponent(JSON.stringify({ ...fixture.successEnvelopes[0]!.metadata, unsupported: 'synthetic-secret' })) };
      if (failure === 'metadata-missing') { const headers = { ...value.headers }; delete headers['X-Mahoshojo-Stream-Meta']; value.headers = headers; }
      if (failure === 'malformed-report') value.events = events([{ id: '1-0', type: 'snapshot', data: { markdown: '{"invalid":true}' } }, { id: '2-0', type: 'done', data: { status: 'completed' } }]);
      return value;
    };
    const response = await makeCompanion(subscription, vi.fn(async () => { if (failure === 'projection') throw new Error('synthetic-secret'); return []; })).generate(request());
    expect(response.status).toBeGreaterThanOrEqual(500);
    const text = await response.text(); expect(text).not.toContain('synthetic-secret');
    expect(parseArenaCompanionEnvelope(text).body).toMatchObject({ generationId, status: 'completed' });
    expect(response.headers.get('x-mahoshojo-stream-meta')).toBeNull();
    expect(response.headers.get('x-mahoshojo-generation-terminal-status')).toBe('completed');
  });
  it('rejects writes/unknown opt-ins before creating, retaining unchanged no-opt-in semantics', async () => {
    const create = vi.fn(() => makeSubscription()); const companion = makeCompanion(create);
    for (const body of [{}, { writeArenaHistory: true, writeCurrentState: false }, { writeArenaHistory: false, writeCurrentState: true }]) {
      const response = await companion.generate(request(true, body)); expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ body: { code: 'ARENA_COMPANION_REPORT_ONLY_REQUIRED' }, metadata: null });
    }
    const wrongVersion = request(); wrongVersion.headers.set(ARENA_COMPANION_PROTOCOL_HEADER, 'unknown');
    expect((await companion.generate(wrongVersion)).status).toBe(400); expect(create).not.toHaveBeenCalled();
    expect((await companion.generate(request(false))).status).toBe(200); expect(create).toHaveBeenCalledOnce();
  });
  it('wraps invalid JSON, failed/throwing streams and huge or malformed upstream errors without a Stream-Meta header', async () => {
    const companion = makeCompanion(() => makeSubscription());
    const invalid = request(); const invalidRequest = new Request(invalid.url, { method: 'POST', headers: invalid.headers, body: '{' });
    expect(await (await companion.generate(invalidRequest)).json()).toMatchObject({ body: { code: 'INVALID_JSON' }, metadata: null });
    for (const subscription of [
      makeSubscription(0, {}, { events: events([{ id: '1-0', type: 'error', data: { code: 'GENERATION_FAILED', error: 'Generation failed' } }]) }),
      makeSubscription(0, {}, { events: new ReadableStream({ start(controller) { controller.error(new Error('synthetic-secret')); } }) }),
    ]) {
      const response = await makeCompanion(() => subscription).generate(request());
      expect(response.status).toBe(502); expect(response.headers.get('x-mahoshojo-stream-meta')).toBeNull();
      const value = parseArenaCompanionEnvelope(await response.text()); expect(value.body).not.toHaveProperty('status', 'completed');
    }
    for (const text of ['not-json', JSON.stringify({ error: 'x'.repeat(65537) })]) {
      const response = await makeCompanion(() => new Response(text, { status: 500, headers: { 'x-mahoshojo-stream-meta': encodeURIComponent(JSON.stringify(fixture.successEnvelopes[0]!.metadata)) } })).generate(request());
      expect(response.status).toBe(502); expect(response.headers.get('x-mahoshojo-stream-meta')).toBeNull();
      expect(parseArenaCompanionEnvelope(await response.text()).body).toMatchObject({ code: 'ARENA_COMPANION_PROTOCOL_UNSUPPORTED' });
    }
  });
  it('wraps registry/unexpected failures and removes stale transport lengths', async () => {
    configureArenaCompanionRouteService(null);
    expect(isArenaCompanionProtocolInstalled()).toBe(false);
    const unavailable = await registeredArenaCompanionRouteService.generate(request());
    expect(unavailable.status).toBe(503);
    expect(parseArenaCompanionEnvelope(await unavailable.text()).body).toMatchObject({ code: 'ARENA_COMPANION_SERVICE_UNAVAILABLE' });
    const failure = await makeCompanion(() => { throw new Error('synthetic-secret'); }).generate(request());
    expect(failure.status).toBe(502); expect(await failure.text()).not.toContain('synthetic-secret');
    const upstream = await makeCompanion(() => new Response(JSON.stringify({ code: 'UNAUTHORIZED', error: 'Unauthorized' }), { status: 401, headers: { 'content-length': '1', 'content-encoding': 'gzip' } })).generate(request());
    expect(upstream.headers.has('content-length')).toBe(false); expect(upstream.headers.has('content-encoding')).toBe(false);
    expect(parseArenaCompanionEnvelope(await upstream.text()).body).toMatchObject({ code: 'UNAUTHORIZED' });
  });
  it('the actual error writer preserves bounded lone UTF-16 surrogate strings', async () => {
    const wire = readFileSync(new URL('../../contracts/fixtures/arena-companion-error-utf16.json', import.meta.url), 'utf8').trimEnd();
    const original = JSON.parse(wire);
    expect(parseArenaCompanionEnvelope(wire)).toEqual(original);
    const response = createArenaCompanionResponseWriter(true).write(original.body, 502);
    expect(response.status).toBe(502);
    expect(await response.text()).toBe(wire);
    expect(original.body).toMatchObject({ error: '失败\ud800', message: '提示\ud800', resultRef: 'r2:\ud800' });
  });
  it('the actual report-only character projector yields no cards or signatures', async () => {
    const signatures = { verifySignature: vi.fn(async () => false), generateSignature: vi.fn(async () => 'forbidden') };
    const companion = makeCompanion(() => makeSubscription(), vi.fn(createArenaPostBattleProjector({ signatures })));
    const response = await companion.generate(request(true, { mode: 'classic', combatants: [{ data: { name: '角色甲' } }], writeArenaHistory: false, writeCurrentState: false }));
    expect(parseArenaCompanionEnvelope(await response.text()).body).toMatchObject({ updatedCombatants: [] });
    expect(signatures.generateSignature).not.toHaveBeenCalled();
  });
});
