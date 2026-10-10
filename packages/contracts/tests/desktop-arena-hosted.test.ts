import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/desktop-arena-hosted.json';
import {
  DESKTOP_ARENA_HOSTED_LIMITS, DesktopArenaHostedOperationSchema, DesktopArenaHostedReadinessSchema,
  DesktopArenaHostedRecoveryPointerSchema, DesktopArenaHostedChannelEventSchema, DesktopArenaHostedControlResponseSchema,
  DesktopArenaHostedSseEventSchema, parseDesktopArenaHostedSseBlock, parseArenaExpectedUserIdAssertion, DesktopArenaHostedErrorSchema,
  DesktopArenaHostedRecoveryHintRequestSchema, DesktopArenaHostedRecoveryHintSchema,
} from '../src/desktop-arena-hosted';

const bytes = (s: string) => new TextEncoder().encode(s).byteLength;
const encode = (v: { id: string; event: string; data: unknown }) => `id: ${v.id}\nevent: ${v.event}\ndata: ${JSON.stringify(v.data)}\n\n`;
describe('Desktop Arena Hosted isolated TS/Rust contract fixture', () => {
  it('freezes bounded operations, explicit actors and public pointers', () => {
    expect(fixture.limits).toEqual(DESKTOP_ARENA_HOSTED_LIMITS);
    expect(DesktopArenaHostedReadinessSchema.safeParse(fixture.capability).success).toBe(true);
    for (const request of fixture.validOperations) expect(DesktopArenaHostedOperationSchema.safeParse(request).success).toBe(true);
    expect(DesktopArenaHostedRecoveryPointerSchema.safeParse(fixture.pointer).success).toBe(true);
  });
  it.each(['url', 'headers', 'cookie', 'apiKey', 'secretRef', 'customProvider'])('rejects renderer authority %s on every operation', (field) => {
    for (const request of fixture.validOperations) expect(DesktopArenaHostedOperationSchema.safeParse({ ...request, [field]: 'injected' }).success).toBe(false);
  });
  it.each(['customProvider', 'adjudicationResults', 'internalGuidance', 'pvpContext', 'multiplayerGenerationSnapshot', 'generationRequestId'])('closes business body authority %s', (field) => {
    const request = fixture.validOperations[0]!;
    expect(DesktopArenaHostedOperationSchema.safeParse({ ...request, body: { ...request.body, [field]: {} } }).success).toBe(false);
  });
  it('rejects custom funding, malformed identities, control funding and unsupported paths', () => {
    const create = fixture.validOperations[0]!;
    for (const actor of [{ kind: 'account', expectedUserId: 0 }, { kind: 'account', expectedUserId: 1.5 }, { kind: 'anonymous', expectedUserId: 42 }]) {
      expect(DesktopArenaHostedOperationSchema.safeParse({ ...create, actor }).success).toBe(false);
    }
    for (const request of fixture.validOperations.slice(1)) expect(DesktopArenaHostedOperationSchema.safeParse({ ...request, presetConfig: { providerId: 'x', modelId: 'x' } }).success).toBe(false);
    expect(DesktopArenaHostedOperationSchema.safeParse({ ...create, body: { ...create.body, writeCurrentState: true } }).success).toBe(false);
    expect(DesktopArenaHostedOperationSchema.safeParse({ ...create, body: { ...create.body, arenaFreeRankingEnabled: true } }).success).toBe(false);
    expect(DesktopArenaHostedOperationSchema.safeParse({ ...create, operation: 'generate-json' }).success).toBe(false);
    expect(DesktopArenaHostedOperationSchema.safeParse({ ...create, replaceExisting: true }).success).toBe(false);
    expect(DesktopArenaHostedOperationSchema.safeParse({ ...create, replaceRequestId: 'old_request_1234' }).success).toBe(true);
  });
  it('keeps reference count shared across all four collections without a new fifty-item cap', () => {
    const request = fixture.validOperations[0]!;
    const entry = { content: 'body' };
    const body = { ...request.body, narrativeHistory: Array(fixture.boundaryRecipes.references.historyCount).fill(entry), questionnaires: Array(fixture.boundaryRecipes.references.questionnaireCount).fill(entry) };
    expect(DesktopArenaHostedOperationSchema.safeParse({ ...request, body }).success).toBe(true);
    expect(DesktopArenaHostedOperationSchema.safeParse({ ...request, body: { ...body, materials: Array(154).fill(entry) } }).success).toBe(true);
    expect(DesktopArenaHostedOperationSchema.safeParse({ ...request, body: { ...body, materials: Array(155).fill(entry) } }).success).toBe(false);
  });
  it('only explicit lookup may request same-actor session restoration', () => {
    for (const request of fixture.validOperations) {
      const expected = request.operation === 'lookup-request';
      expect(DesktopArenaHostedOperationSchema.safeParse({ ...request, restoreSession: true }).success).toBe(expected);
      expect(DesktopArenaHostedOperationSchema.safeParse({ ...request, restoreSession: false }).success).toBe(false);
    }
  });
  it('old/missing/inexact capability cannot prove assertion support', () => {
    for (const value of [{ ...fixture.capability, arenaHosted: undefined }, { ...fixture.capability, placement: 'next-dr' }, { ...fixture.capability, arenaHosted: { ...fixture.capability.arenaHosted, expectedUserIdAssertion: 'v0' } }]) {
      expect(DesktopArenaHostedReadinessSchema.safeParse(value).success).toBe(false);
    }
  });
  it('validates real SSE public field families and rejects private telemetry/terminal drift', () => {
    for (const value of fixture.validSseEvents) expect(parseDesktopArenaHostedSseBlock(encode(value))).toEqual(value);
    expect(DesktopArenaHostedSseEventSchema.safeParse({ id: '2-0', event: 'snapshot', data: { status: 'failed', markdown: '', reasoning: '', lastEventId: null, updatedAt: '2026-10-10T00:00:00.000Z', telemetry: { errorClass: 'TypeError' } } }).success).toBe(true);
    expect(DesktopArenaHostedSseEventSchema.safeParse({ id: '2-0', event: 'telemetry', data: { errorClass: 'TypeError', providerName: 'private' } }).success).toBe(false);
    const done = { id: '2-0', event: 'done', data: { ok: true, status: 'cancelled' } };
    expect(DesktopArenaHostedSseEventSchema.safeParse(done).success).toBe(false);
    expect(DesktopArenaHostedSseEventSchema.safeParse({ id: '2-0', event: 'telemetry', data: { model: 'private', reasoning: 'private' } }).success).toBe(false);
    expect(() => parseDesktopArenaHostedSseBlock('id: 1-0\nid: 2-0\nevent: done\ndata: {}\n\n')).toThrow();
    expect(() => parseDesktopArenaHostedSseBlock(encode(fixture.validSseEvents[0]!).slice(0, -1))).toThrow();
  });
  it('proves the exact worst JSON escaping recipe without weakening decoded output', () => {
    const r = fixture.boundaryRecipes.snapshot;
    const data = { status: 'completed', markdown: r.character.repeat(r.repeat), reasoning: '', lastEventId: null, updatedAt: r.updatedAt };
    const value = { id: r.id, event: 'snapshot', data };
    const wire = encode(value);
    expect(bytes(data.markdown)).toBe(DESKTOP_ARENA_HOSTED_LIMITS.outputContentBytes);
    expect(bytes(wire)).toBeGreaterThan(6 * DESKTOP_ARENA_HOSTED_LIMITS.outputContentBytes);
    expect(bytes(wire)).toBeLessThanOrEqual(DESKTOP_ARENA_HOSTED_LIMITS.eventWireBytes);
    expect(DesktopArenaHostedSseEventSchema.safeParse(value).success).toBe(true);
    expect(DesktopArenaHostedSseEventSchema.safeParse({ ...value, data: { ...data, reasoning: 'x' } }).success).toBe(false);
  });
  it('measures final IPC envelopes at control-escape and unicode limits', () => {
    for (const r of [fixture.boundaryRecipes.ipc, fixture.boundaryRecipes.unicodeIpc]) {
      const text = r.character.repeat(r.repeat);
      const value = { kind: 'sse-fragment', requestId: 'arena_request_1234', sequence: 1, text, final: true };
      expect(bytes(text)).toBe(65536); expect(bytes(JSON.stringify(value))).toBeLessThan(524288);
      expect(DesktopArenaHostedChannelEventSchema.safeParse(value).success).toBe(true);
      expect(DesktopArenaHostedChannelEventSchema.safeParse({ ...value, text: text + 'x' }).success).toBe(false);
    }
  });
  it('never exposes credentials in public heads, short bodies or pointers', () => {
    expect(DesktopArenaHostedControlResponseSchema.safeParse({ status: 401, recoveryCredentialState: 'stored', body: { code: 'UNAUTHORIZED', cookie: 'secret' } }).success).toBe(false);
    expect(DesktopArenaHostedRecoveryPointerSchema.safeParse({ ...fixture.pointer, anonymousBootstrap: 'secret' }).success).toBe(false);
    expect(DesktopArenaHostedChannelEventSchema.safeParse({ kind: 'response', requestId: 'arena_request_1234', sequence: 0, status: 200, metadataState: 'missing', recoveryCredentialState: 'stored', body: { code: 'UNAUTHORIZED' } }).success).toBe(false);
  });
  it('requires independent native intent-ownership evidence on every error', () => {
    for (const value of fixture.validErrors) expect(DesktopArenaHostedErrorSchema.safeParse(value).success).toBe(true);
    const value = fixture.validErrors[0]!;
    const { intentOwnership: _ownership, ...legacy } = value;
    expect(_ownership).toBe('prior-retained');
    expect(DesktopArenaHostedErrorSchema.safeParse(legacy).success).toBe(false);
    for (const intentOwnership of ['', 'not-dispatched', 'retained', null, true]) {
      expect(DesktopArenaHostedErrorSchema.safeParse({ ...value, intentOwnership }).success).toBe(false);
    }
    expect(DesktopArenaHostedErrorSchema.safeParse({ ...value, priorCredential: 'secret' }).success).toBe(false);
  });
  it('limits recovery hints to two local products and public identities in available/expired states', () => {
    for (const request of fixture.validRecoveryHintRequests) expect(DesktopArenaHostedRecoveryHintRequestSchema.safeParse(request).success).toBe(true);
    for (const value of fixture.validRecoveryHints) expect(DesktopArenaHostedRecoveryHintSchema.safeParse(value).success).toBe(true);
    for (const extra of [{ requestId: 'arena_request_1234' }, { actor: { kind: 'account', expectedUserId: 42 } }, { secretRef: 'injected' }, { operation: 'delete' }, { restoreSession: true }]) {
      expect(DesktopArenaHostedRecoveryHintRequestSchema.safeParse({ product: 'battle', ...extra }).success).toBe(false);
    }
    expect(DesktopArenaHostedRecoveryHintRequestSchema.safeParse({ product: 'custom' }).success).toBe(false);
    for (const state of ['none', 'unavailable']) {
      expect(DesktopArenaHostedRecoveryHintSchema.safeParse({ product: 'battle', state, requestId: 'arena_request_1234', actorKind: 'anonymous' }).success).toBe(false);
    }
    for (const state of ['available', 'expired']) {
      expect(DesktopArenaHostedRecoveryHintSchema.safeParse({ product: 'battle', state }).success).toBe(false);
    }
    for (const value of fixture.validRecoveryHints) {
      for (const field of ['token', 'bootstrap', 'secretRef', 'expectedUserId', 'cookie', 'generationId']) {
        expect(DesktopArenaHostedRecoveryHintSchema.safeParse({ ...value, [field]: 'injected' }).success).toBe(false);
      }
    }
    expect(DesktopArenaHostedRecoveryHintSchema.safeParse({ product: 'battle', state: 'completed' }).success).toBe(false);
  });
  it('requires canonical versioned positive-safe integer assertions', () => {
    expect(parseArenaExpectedUserIdAssertion('v1:42')).toBe(42);
    expect(parseArenaExpectedUserIdAssertion('v1:9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
    for (const value of ['v1:9007199254740992', 'v1:00', 'v1:1e2', '42', 'v2:42', 'v1:42, v1:42']) expect(parseArenaExpectedUserIdAssertion(value)).toBeNull();
  });
});
