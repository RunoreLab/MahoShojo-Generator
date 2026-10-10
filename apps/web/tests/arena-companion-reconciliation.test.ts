import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ARENA_COMPANION_PROTOCOL_HEADER, ARENA_COMPANION_PROTOCOL_VERSION, parseArenaCompanionEnvelope } from '@mahoshojo/contracts/arena-companion';
import { ARENA_RECONCILIATION_PROTOCOL_HEADER, ARENA_RECONCILIATION_PROTOCOL_VERSION, parseArenaReconciliationResponse } from '@mahoshojo/contracts/arena-reconciliation';
import { ARENA_EXPECTED_USER_ID_HEADER } from '@mahoshojo/contracts/desktop-arena-hosted';
import type { ArenaGenerationService, GenerationStreamEvent } from '@mahoshojo/hosted-api/arena-generation/service';
import {
  ARENA_GENERATION_MATERIALIZATION_VERSION, buildArenaGenerationPrompt,
  createArenaGenerationActorResolvers, createArenaGenerationRuntime, createNodeArenaGenerationFinalizationPorts,
} from '@mahoshojo/hosted-runtime/arena-generation';
import { createArenaCompanionService } from '@mahoshojo/hosted-runtime/arena-companion';
import { createEnvSignatureService } from '@mahoshojo/hosted-runtime/node-runtime/env-signature';
import type { NodeDataD1Client } from '@mahoshojo/hosted-runtime/node-runtime/data-ports';

const ports = vi.hoisted(() => ({ getD1Client: vi.fn(), resolveActor: vi.fn() }));
vi.mock('@/app/api/arena/generation-runtime', () => ({ resolveCloudflareDrArenaGenerationActor: ports.resolveActor }));
vi.mock('@/lib/hosted-dr/database-provider', () => ({ getNextHostedD1Client: ports.getD1Client }));
import { appRouteHandler } from '@/app/api/arena/update-combatants-after-stream/handler';

type Sqlite = {
  exec(sql: string): void;
  close(): void;
  prepare(sql: string): { all(...args: unknown[]): Record<string, unknown>[]; run(...args: unknown[]): { changes: number | bigint } };
};
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => Sqlite };
const adapt = (database: Sqlite): NodeDataD1Client => ({
  prepare(sql) {
    const statement = database.prepare(sql);
    let parameters: unknown[] = [];
    const adapter = {
      bind(...values: unknown[]) { parameters = values; return adapter; },
      async all() { return { success: true, results: statement.all(...parameters), meta: {} }; },
      async run() { return { success: true, results: [], meta: { changes: Number(statement.run(...parameters).changes) } }; },
    };
    return adapter;
  },
});
const generationId = `arena_${'a'.repeat(64)}`;
const secret = 'synthetic-c2-reconciliation-key';
const nativeRequestFile = process.env.MAHOSHOJO_ARENA_RECONCILIATION_NATIVE_REQUEST;
type NativeRequestFixture = {
  version: number; source: string; syntheticCredentialsOnly: boolean; expectedUserId: number; requestId: string;
  method: string; path: string; headers: Record<string, string>; body: string;
};
let expectedAuthCalls = 0;

beforeEach(() => {
  expectedAuthCalls = 0;
  vi.stubEnv('SIGNATURE_SECRET_KEY', secret);
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No network or model requests in this test'); }));
});
afterEach(() => { expect(fetch).toHaveBeenCalledTimes(expectedAuthCalls); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('C2 explicit reconciliation through actual runtime, SQLite D1 authority and Next updates', () => {
  it.each(['baseline', ...(nativeRequestFile ? ['native HTTP fixture'] : [])])('%s delivers the full report, freezes effects and independently reconciles in Next', async (source) => {
    const nativeWire = source === 'native HTTP fixture' ? readFileSync(nativeRequestFile!, 'utf8') : null;
    const native = nativeWire === null ? null : JSON.parse(nativeWire) as NativeRequestFixture;
    if (native) {
      expect(native).toMatchObject({ version: 1, source: 'actual-native-create-json-http-request', syntheticCredentialsOnly: true, expectedUserId: 123, method: 'POST', path: '/api/generate-battle-story' });
      expect(typeof native.body).toBe('string');
    }
    const baselineBody = {
      generationRequestId: 'request-c2-reconciliation', reportFormat: 'markdown', mode: 'daily', language: 'zh-CN',
      combatants: [{ type: 'general-character', sourceDataCardId: 'card-a', data: { name: 'A', templateId: '通用角色' } }],
      userGuidance: '保留完整报告元信息', writeArenaHistory: true, writeCurrentState: true,
      readArenaHistory: false, readCurrentState: false, readNarrativeHistory: false,
    };
    const rawBody = native?.body ?? JSON.stringify(baselineBody);
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const combatants = payload.combatants as Array<{ type: string; sourceDataCardId?: string; data: Record<string, unknown> }>;
    expect(combatants).toHaveLength(1);
    expect(payload).toMatchObject({ writeArenaHistory: true, writeCurrentState: true });
    const generationRequestId = String(payload.generationRequestId);
    if (native) expect(generationRequestId).toBe(native.requestId);
    const userId = native?.expectedUserId ?? 42;
    const creationHeaders = new Headers(native?.headers ?? {
      [ARENA_COMPANION_PROTOCOL_HEADER]: ARENA_COMPANION_PROTOCOL_VERSION,
      [ARENA_RECONCILIATION_PROTOCOL_HEADER]: ARENA_RECONCILIATION_PROTOCOL_VERSION,
      [ARENA_EXPECTED_USER_ID_HEADER]: `v1:${userId}`, Authorization: 'Bearer synthetic-bearer-42',
    });
    expect(creationHeaders.get(ARENA_COMPANION_PROTOCOL_HEADER)).toBe(ARENA_COMPANION_PROTOCOL_VERSION);
    expect(creationHeaders.get(ARENA_RECONCILIATION_PROTOCOL_HEADER)).toBe(ARENA_RECONCILIATION_PROTOCOL_VERSION);
    expect(creationHeaders.get(ARENA_EXPECTED_USER_ID_HEADER)).toBe(`v1:${userId}`);
    if (native) {
      expect(creationHeaders.get('cookie')).toBe('better-auth.session_token=SYNTHETIC-COOKIE-CANARY');
      expect(creationHeaders.has('authorization')).toBe(false);
      expectedAuthCalls = 2; // Actual actor resolution for C2 creation and the later Next reconciliation.
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe('https://synthetic-auth.invalid/api/auth/verify');
        expect(init?.method).toBe('POST');
        expect(new Headers(init?.headers).get('cookie')).toBe(creationHeaders.get('cookie'));
        return Response.json({ user: { id: userId } });
      }));
    }
    const requestUrl = new URL(native?.path ?? '/api/arena/generate', 'https://fixture.invalid');
    const createRequest = (headers = creationHeaders) => new Request(requestUrl, {
      method: native?.method ?? 'POST', headers, body: rawBody,
    });
    const database = new DatabaseSync(':memory:');
    try {
      database.exec(`
        CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, is_banned TEXT, auth_key TEXT);
        CREATE TABLE battle_report_generations (
          id TEXT PRIMARY KEY, started_at TEXT, ended_at TEXT, duration_ms INTEGER, status TEXT,
          generation_mode TEXT, endpoint TEXT, ip_anonymized TEXT, mode TEXT, user_id INTEGER,
          scenario_title TEXT, scenario_data_card_id TEXT, scenario_data_card_updated_at TEXT,
          language TEXT, story_length TEXT, pvp_room_id TEXT, pvp_match_id TEXT, pvp_round_id TEXT,
          read_arena_history INTEGER, arena_history_read_limit INTEGER, write_arena_history INTEGER,
          read_current_state INTEGER, write_current_state INTEGER, combatant_count INTEGER,
          has_scenario INTEGER, has_user_guidance INTEGER, has_adjudication_events INTEGER, has_teams INTEGER,
          custom_provider_id TEXT, custom_model_id TEXT, ai_provider_name TEXT, ai_provider_type TEXT,
          ai_model TEXT, headline TEXT, winner TEXT, output_chars INTEGER, output_bytes INTEGER,
          prompt_tokens INTEGER, completion_tokens INTEGER, total_tokens INTEGER, cached_tokens INTEGER,
          reasoning_tokens INTEGER, user_guidance_preview TEXT, output_preview TEXT, extra_json TEXT,
          created_at TEXT, updated_at TEXT
        );
      `);
      database.prepare('INSERT INTO users VALUES (?, ?, NULL, ?)').run(userId, 'synthetic-user', 'synthetic-bearer-42');
      const client = adapt(database);
      ports.getD1Client.mockReturnValue(client);
      const signatures = createEnvSignatureService({ env: { SIGNATURE_SECRET_KEY: secret } });
      ports.resolveActor.mockImplementation(createArenaGenerationActorResolvers({
        env: { HONO_AUTH_MODE: native ? 'hybrid' : 'bearer', BETTER_AUTH_URL: 'https://synthetic-auth.invalid' }, signatures, getD1Client: () => client,
      }).resolveActor);
      const durable = createNodeArenaGenerationFinalizationPorts({ getD1Client: () => client });
      const report = {
        headline: '真实 C2 冻结报告', article: { body: '完整正文\n## 胜利者\n仍是正文的一部分', analysis: '完整分析' },
        officialReport: { winner: String(combatants[0]!.data.name), conclusion: '完整结论' },
        impacts: [{ characterName: String(combatants[0]!.data.name), impact: 'D1 冻结历史影响', currentStateSummary: 'D1 冻结状态' }],
      };
      const generate = vi.fn(async () => ({
        body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify(report))); controller.close(); } }),
        telemetry: { model: 'synthetic-model', finishReason: 'stop', usage: { promptTokens: 7, completionTokens: 11, totalTokens: 18 } },
      }));
      const runtime = createArenaGenerationRuntime({
        preparePayload: async ({ payload }) => ({ ...payload, __arenaServerContextV1: { deliveryMode: 'non-stream', endpoint: requestUrl.pathname.slice(1), fundingMode: 'hosted-system' } }),
        checkSafety: async () => null,
        buildPrompt: buildArenaGenerationPrompt,
        generate,
        // Real D1 claim and completion SQL freeze effects; no production storage, ratings or model.
        finalize: async (input) => {
          const claim = { ...input, resultRef: null };
          expect(input.payload).toMatchObject({ writeArenaHistory: true, writeCurrentState: true });
          expect((await durable.claimTerminal(claim)).kind).toBe('created');
          await durable.completeTerminal(claim);
          return { resultRef: null, ranking: null };
        },
      });
      const unavailable = async () => new Response(null, { status: 503 });
      const generationService: ArenaGenerationService = {
        create: unavailable, createSubscription: unavailable, lookup: unavailable, resume: unavailable,
        status: unavailable, cancel: unavailable, cancelRequest: unavailable,
        async createParsedSubscription(request, command) {
          const actor = await ports.resolveActor(request);
          expect(actor).toEqual({ actorKey: `user:${userId}` });
          const input = { request, actorKey: actor.actorKey as string, generationRequestId: command.generationRequestId, payload: command.payload };
          const preflight = await runtime.preflight!(input);
          if (preflight instanceof Response) return preflight;
          const prepared = await runtime.materialize!({
            ...input, payload: preflight.materializationPayload,
            preparationSeed: '11'.repeat(32), preparationVersion: ARENA_GENERATION_MATERIALIZATION_VERSION,
          });
          if (prepared instanceof Response) return prepared;
          let sequence = 0;
          return {
            generationId, generationRequestId,
            headers: { ...prepared.responseHeaders, 'X-Mahoshojo-Generation-Id': generationId, 'X-Mahoshojo-Generation-Request-Id': generationRequestId },
            events: new ReadableStream<GenerationStreamEvent>({ async start(controller) {
              try {
                const terminal = await runtime.execute({
                  ...input, generationId, payload: prepared.executionPayload, payloadHash: 'synthetic-payload-hash',
                  producerToken: 'synthetic-producer-token', signal: request.signal,
                  emit: async (event) => { controller.enqueue({ ...event, id: `1791612000000-${sequence++}` }); },
                  claimFinalization: async () => ({ kind: 'claimed' as const }),
                });
                expect(terminal.status).toBe('completed');
                controller.enqueue({ id: `1791612000000-${sequence++}`, type: 'done', data: { ...terminal, ok: true } });
                controller.close();
              } catch (error) { controller.error(error); }
            } }),
          };
        },
      };
      const projectUpdatedCombatants = vi.fn(async () => { throw new Error('Companion must not project cards'); });
      const companion = createArenaCompanionService({ generationService, projectUpdatedCombatants });
      // The same captured request with only the new opt-in removed must fail before any dispatch.
      const missingHeader = new Headers(creationHeaders);
      missingHeader.delete(ARENA_RECONCILIATION_PROTOCOL_HEADER);
      const rejected = await companion.generate(createRequest(missingHeader));
      expect(rejected.status).toBe(400);
      expect(parseArenaCompanionEnvelope(await rejected.text()).body).toMatchObject({ code: 'ARENA_COMPANION_REPORT_ONLY_REQUIRED' });
      expect(generate).not.toHaveBeenCalled();
      expect(projectUpdatedCombatants).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(database.prepare('SELECT * FROM battle_report_generations').all()).toHaveLength(0);

      // Body, method, route and headers here are the original Native HTTP capture, unchanged.
      const response = await companion.generate(createRequest());
      const wire = await response.text();
      expect(response.status, wire.slice(0, 500)).toBe(200);
      const envelope = parseArenaCompanionEnvelope(wire);
      expect(envelope.body).toMatchObject({ report: { headline: report.headline, article: report.article, officialReport: report.officialReport }, impacts: report.impacts, updatedCombatants: [], generationId });
      expect(envelope.metadata).toMatchObject({ reportFormat: 'markdown', outputContract: 'structured-report', ...(payload.userGuidance ? { userGuidance: payload.userGuidance } : {}) });
      expect(projectUpdatedCombatants).not.toHaveBeenCalled();
      expect(generate).toHaveBeenCalledOnce();
      const stored = database.prepare('SELECT * FROM battle_report_generations WHERE id = ?').all(generationId)[0]!;
      expect(stored).toMatchObject({ status: 'completed', write_arena_history: 1, write_current_state: 1 });
      expect(JSON.parse(String(stored.extra_json))).toMatchObject({
        finalizationCompleted: true,
        localCardReconciliation: { writeArenaHistory: true, writeCurrentState: true, impacts: [expect.objectContaining(report.impacts[0])] },
      });

      const reconciliationHeaders = new Headers(creationHeaders);
      reconciliationHeaders.delete(ARENA_COMPANION_PROTOCOL_HEADER);
      reconciliationHeaders.delete('content-length');
      const updated = await appRouteHandler(new Request('https://fixture.invalid/api/arena/update-combatants-after-stream', {
        method: 'POST', headers: reconciliationHeaders, body: JSON.stringify({ generationId, combatants }),
      }) as never);
      const updatedWire = await updated.text();
      expect(updated.status, updatedWire).toBe(200);
      expect(parseArenaReconciliationResponse(updatedWire, generationId, 1)).toMatchObject({
        success: true, updatedCombatants: [{ combatantIndex: 0, data: {
          arena_history: { entries: [{ impact: report.impacts[0]!.impact }] },
          current_state: { summary: report.impacts[0]!.currentStateSummary },
        } }],
      });
      expect(generate).toHaveBeenCalledOnce();
      expect(combatants[0]!.data).not.toHaveProperty('arena_history');
      if (native && nativeWire !== null) {
        console.info('Consumed actual Native create-json HTTP capture', JSON.stringify({
          fixtureSha256: createHash('sha256').update(nativeWire, 'utf8').digest('hex'),
          bodySha256: createHash('sha256').update(rawBody, 'utf8').digest('hex'),
          bodyBytes: Buffer.byteLength(rawBody, 'utf8'),
          requestId: generationRequestId,
          expectedUserId: userId,
          syntheticGenerationCalls: generate.mock.calls.length,
        }));
      }
    } finally { database.close(); }
  });
});
