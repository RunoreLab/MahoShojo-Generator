import { describe, expect, it } from 'vitest';
import {
  STORY_PENDING_LIMITS, StoryPendingInputSchema, StoryPendingManifestSchema, StoryPendingKeySchema,
  StoryPendingSnapshotSchema, StoryPendingBeginOutcomeSchema, StoryPendingAppendOutcomeSchema,
  StoryPendingUploadSchema, StoryPendingSavePreparationSchema, StoryPendingSaveRequestSchema,
  StoryPendingSaveAttemptRequestSchema, StoryNativeFailureSchema,
  StoryPendingHeaderSchema, StoryPendingMetaSchema, StoryPendingRoleResponseSchema, StoryPendingRoleSyncSchema, StoryPendingTelemetrySchema, StoryPendingCreateClaimSnapshotSchema,
  type StoryPendingManifest, type StoryPendingPartKind,
} from '../src/desktop-arena-story';
import { ArenaStoryCreateRequestSchema } from '../src/arena-story';
import { DesktopArenaHostedSseEventSchema } from '../src/desktop-arena-hosted';
import contentGolden from '../fixtures/desktop-story-pending-content.json';
import telemetryGolden from '../fixtures/desktop-story-pending-telemetry.json';

const digest = `sha256:${'0'.repeat(64)}`;
const otherDigest = `sha256:${'1'.repeat(64)}`;
const token = `${'a'.repeat(32)}-${'b'.repeat(32)}`;
const part = (kind: StoryPendingPartKind, byteLength = 1) => ({ kind, byteLength, digest });
const manifest = (): StoryPendingManifest => ({
  version: 1, product: 'battle', requestId: 'story_request_1234', actor: { kind: 'anonymous' },
  pendingRevision: 1, sessionId: 'session', operationId: 'chapter', outputCheckpointId: 'after',
  initialCheckpointId: 'before', createdAt: 0, expectedRevision: 0, expectedLastChapterId: null,
  lastInputCheckpointId: 'before', inputDigest: digest,
  writeOptions: { writeArenaHistory: false, writeCurrentState: true, writeNarrativeHistory: false },
  modelCompleted: false, roleState: 'not-requested', roleInputDigest: null,
  parts: [part('input')], commitManifest: null,
});
const frozen = (): StoryPendingManifest => {
  const value = manifest();
  const parts = (['session', 'seed', 'chapter', 'checkpoint0', 'checkpoint1'] as const).map((kind) => part(kind));
  return { ...value, modelCompleted: true, parts: [...value.parts, ...parts], commitManifest: {
    version: 1, sessionId: value.sessionId, operationId: value.operationId,
    expectedRevision: value.expectedRevision, expectedLastChapterId: value.expectedLastChapterId,
    parts: parts.map((item, i) => ({ ...item, kind: (['session', 'seed', 'chapter', 'checkpoint0', 'checkpoint1'] as const)[i]! })),
  } };
};
const input = () => ({
  version: 1 as const, sessionId: 'session', generationRequestId: 'story_request_1234',
  action: 'start' as const, chapterIndex: 1,
  chapterContext: { recentWindow: [], workingCombatants: [{ name: '雪' }] },
  seed: { combatants: [{ name: '雪' }], mode: 'daily' as const, storyLength: 'default' as const, language: 'zh-CN', settings: {
    readArenaHistory: false, writeArenaHistory: false, readCurrentState: true, writeCurrentState: true,
    readNarrativeHistory: false, writeNarrativeHistory: false,
  } },
});

describe('durable story pending closed contracts', () => {
  it('accepts both product slots and canonical original actors without credential carriers', () => {
    for (const product of ['battle', 'arena']) for (const actor of [{ kind: 'anonymous' }, { kind: 'account', expectedUserId: Number.MAX_SAFE_INTEGER }]) {
      expect(StoryPendingManifestSchema.parse({ ...manifest(), product, actor })).toEqual({ ...manifest(), product, actor });
    }
    expect(STORY_PENDING_LIMITS).toEqual({
      slotBytes: 128 * 1024 * 1024, activeSlots: 2, sharedUploadBytes: 128 * 1024 * 1024, sharedUploadCount: 2,
      metadataBytes: 64 * 1024, inputBytes: 12 * 1024 * 1024, outputContentBytes: 4 * 1024 * 1024,
      metaBytes: 24 * 1024 * 1024 + 64 * 1024, telemetryBytes: 24 * 1024 * 1024 + 64 * 1024, headerBytes: 64 * 1024, roleResponseBytes: 16 * 1024 * 1024,
    });
  });
  it.each(['customProvider', 'apiKey', 'token', 'accessToken', 'anonymousBootstrap', 'bootstrap', 'cookie', 'headers', 'url'])('rejects %s at every control boundary', (field) => {
    const value = manifest();
    for (const candidate of [
      { ...value, [field]: 'secret' }, { ...value, actor: { ...value.actor, [field]: 'secret' } },
      { ...value, writeOptions: { ...value.writeOptions, [field]: 'secret' } },
      { ...value, parts: [{ ...value.parts[0], [field]: 'secret' }] },
    ]) expect(StoryPendingManifestSchema.safeParse(candidate).success).toBe(false);
  });
  it.each([
    { product: 'story' }, { requestId: 'short' }, { requestId: 'a'.repeat(129) },
    { actor: { kind: 'account', expectedUserId: 0 } }, { actor: { kind: 'account', expectedUserId: 1.5 } },
    { actor: { kind: 'account', expectedUserId: Number.MAX_SAFE_INTEGER + 1 } },
    { pendingRevision: 0 }, { pendingRevision: Number.MAX_SAFE_INTEGER + 1 },
    { expectedRevision: Number.MAX_SAFE_INTEGER }, { createdAt: -1 }, { createdAt: 1.5 },
    { sessionId: '../path' }, { operationId: '' }, { inputDigest: otherDigest }, { inputDigest: `sha256:${'A'.repeat(64)}` },
  ])('rejects malformed manifest identity %#', (change) => {
    expect(StoryPendingManifestSchema.safeParse({ ...manifest(), ...change }).success).toBe(false);
  });
  it('requires exact start and continuation CAS baselines', () => {
    const value = manifest();
    expect(StoryPendingManifestSchema.safeParse({ ...value, initialCheckpointId: null }).success).toBe(false);
    expect(StoryPendingManifestSchema.safeParse({ ...value, lastInputCheckpointId: 'different' }).success).toBe(false);
    expect(StoryPendingManifestSchema.safeParse({ ...value, outputCheckpointId: 'before' }).success).toBe(false);
    expect(StoryPendingManifestSchema.safeParse({ ...value, expectedLastChapterId: 'previous' }).success).toBe(false);
    const continuation = { ...value, expectedRevision: 5, expectedLastChapterId: 'previous', initialCheckpointId: null };
    expect(StoryPendingManifestSchema.safeParse(continuation).success).toBe(true);
    expect(StoryPendingManifestSchema.safeParse({ ...continuation, initialCheckpointId: 'before' }).success).toBe(false);
    expect(StoryPendingManifestSchema.safeParse({ ...continuation, expectedLastChapterId: null }).success).toBe(false);
  });
  it('rejects missing, empty, duplicated, unrecognized or out-of-order part declarations', () => {
    for (const parts of [[], [part('markdown')], [part('input', 0)], [part('input'), part('input')],
      [part('input'), part('reasoning'), part('markdown')], [part('input'), { ...part('markdown'), kind: 'snapshot' }]]) {
      expect(StoryPendingManifestSchema.safeParse({ ...manifest(), parts }).success).toBe(false);
    }
  });
  it.each([
    ['input', STORY_PENDING_LIMITS.inputBytes], ['meta', STORY_PENDING_LIMITS.metaBytes], ['header', STORY_PENDING_LIMITS.headerBytes], ['telemetry', STORY_PENDING_LIMITS.telemetryBytes],
  ] as const)('enforces exact %s declaration ceiling without allocating the payload', (kind, limit) => {
    const parts = kind === 'input' ? [part(kind, limit)] : [part('input'), part(kind, limit)];
    expect(StoryPendingManifestSchema.safeParse({ ...manifest(), parts }).success).toBe(true);
    expect(StoryPendingManifestSchema.safeParse({ ...manifest(), parts: parts.map((item) => item.kind === kind ? { ...item, byteLength: limit + 1 } : item) }).success).toBe(false);
  });
  it('shares the 4 MiB markdown/reasoning budget and keeps the 16 MiB role response independent', () => {
    const value = { ...manifest(), parts: [part('input'), part('markdown', 2 * 1024 * 1024), part('reasoning', 2 * 1024 * 1024)] };
    expect(StoryPendingManifestSchema.safeParse(value).success).toBe(true);
    expect(StoryPendingManifestSchema.safeParse({ ...value, parts: [...value.parts.slice(0, 2), part('reasoning', 2 * 1024 * 1024 + 1)] }).success).toBe(false);
    const role = { ...manifest(), modelCompleted: true, roleState: 'accepted', roleInputDigest: digest, parts: [part('input'), part('roleResponse', STORY_PENDING_LIMITS.roleResponseBytes)] };
    expect(StoryPendingManifestSchema.safeParse(role).success).toBe(true);
    expect(StoryPendingManifestSchema.safeParse({ ...role, parts: [part('input'), part('roleResponse', STORY_PENDING_LIMITS.roleResponseBytes + 1)] }).success).toBe(false);
  });
  it('requires coherent role evidence and forbids frozen unresolved role results', () => {
    for (const roleState of ['unresolved', 'old-roles']) {
      expect(StoryPendingManifestSchema.safeParse({ ...manifest(), modelCompleted: true, roleState, roleInputDigest: digest }).success).toBe(true);
      expect(StoryPendingManifestSchema.safeParse({ ...manifest(), roleState }).success).toBe(false);
      expect(StoryPendingManifestSchema.safeParse({ ...manifest(), roleState, roleInputDigest: digest, parts: [part('input'), part('roleResponse')] }).success).toBe(false);
    }
    expect(StoryPendingManifestSchema.safeParse({ ...manifest(), roleInputDigest: digest }).success).toBe(false);
    expect(StoryPendingManifestSchema.safeParse({ ...manifest(), roleState: 'accepted', roleInputDigest: digest }).success).toBe(false);
    expect(StoryPendingManifestSchema.safeParse({ ...frozen(), roleState: 'unresolved', roleInputDigest: digest }).success).toBe(false);
  });
  it('requires a frozen commit to match the exact parts, identity and completed model', () => {
    const value = frozen();
    expect(StoryPendingManifestSchema.parse(value)).toEqual(value);
    for (const change of [{ sessionId: 'other' }, { operationId: 'other' }, { expectedRevision: 1 }, { expectedLastChapterId: 'other' }]) {
      expect(StoryPendingManifestSchema.safeParse({ ...value, commitManifest: { ...value.commitManifest, ...change } }).success).toBe(false);
    }
    expect(StoryPendingManifestSchema.safeParse({ ...value, modelCompleted: false }).success).toBe(false);
    expect(StoryPendingManifestSchema.safeParse({ ...value, commitManifest: null }).success).toBe(false);
    expect(StoryPendingManifestSchema.safeParse({ ...value, parts: value.parts.slice(0, -1) }).success).toBe(false);
    expect(StoryPendingManifestSchema.safeParse({ ...value, parts: value.parts.map((item) => item.kind === 'chapter' ? { ...item, digest: otherDigest } : item) }).success).toBe(false);
  });
  it('counts original carriers AND frozen parts in the same 128 MiB slot', () => {
    const value = frozen();
    const chapterBytes = STORY_PENDING_LIMITS.slotBytes - 5;
    value.parts.find((item) => item.kind === 'chapter')!.byteLength = chapterBytes;
    value.commitManifest!.parts.find((item) => item.kind === 'chapter')!.byteLength = chapterBytes;
    expect(StoryPendingManifestSchema.safeParse(value).success).toBe(true);
    value.parts.find((item) => item.kind === 'chapter')!.byteLength += 1;
    value.commitManifest!.parts.find((item) => item.kind === 'chapter')!.byteLength += 1;
    expect(StoryPendingManifestSchema.safeParse(value).success).toBe(false);
  });
  it('inserts one telemetry part without changing legacy order or increasing the shared slot budget', () => {
    const value = frozen();
    value.parts.splice(1, 0, part('telemetry', STORY_PENDING_LIMITS.telemetryBytes));
    const chapterBytes = STORY_PENDING_LIMITS.slotBytes - STORY_PENDING_LIMITS.telemetryBytes - 5;
    value.parts.find((item) => item.kind === 'chapter')!.byteLength = chapterBytes;
    value.commitManifest!.parts.find((item) => item.kind === 'chapter')!.byteLength = chapterBytes;
    expect(StoryPendingManifestSchema.safeParse(value).success).toBe(true);
    const over = structuredClone(value);
    over.parts.find((item) => item.kind === 'chapter')!.byteLength += 1;
    over.commitManifest!.parts.find((item) => item.kind === 'chapter')!.byteLength += 1;
    expect(StoryPendingManifestSchema.safeParse(over).success).toBe(false);
    expect(StoryPendingManifestSchema.safeParse({ ...manifest(), parts: [part('input'), part('telemetry'), part('header')] }).success).toBe(false);
    expect(StoryPendingManifestSchema.safeParse({ ...manifest(), parts: [part('input'), part('telemetry'), part('telemetry')] }).success).toBe(false);
  });
  it('closes snapshots, keys, attempt markers and upload offset readback', () => {
    const value = manifest(); const key = { product: value.product, requestId: value.requestId, pendingRevision: 1 };
    expect(StoryPendingKeySchema.parse(key)).toEqual(key);
    expect(StoryPendingKeySchema.safeParse({ ...key, pendingRevision: 0 }).success).toBe(false);
    expect(StoryPendingKeySchema.safeParse({ ...key, actor: value.actor }).success).toBe(false);
    expect(StoryPendingSnapshotSchema.parse({ manifest: value, saveAttemptId: token, restored: true, createClaim: null }).saveAttemptId).toBe(token);
    expect(StoryPendingSnapshotSchema.safeParse({ manifest: value, saveAttemptId: null }).success).toBe(false);
    expect(StoryPendingSavePreparationSchema.parse({ attemptId: token })).toEqual({ attemptId: token });
    expect(StoryPendingSavePreparationSchema.safeParse({ attemptId: 'reusable' }).success).toBe(false);
    expect(StoryPendingSaveRequestSchema.parse({ key, wireDigest: digest })).toEqual({ key, wireDigest: digest });
    expect(StoryPendingSaveAttemptRequestSchema.safeParse({ key, wireDigest: digest }).success).toBe(false);
    expect(StoryPendingSaveAttemptRequestSchema.parse({ key, wireDigest: digest, attemptId: token }).attemptId).toBe(token);
    expect(StoryPendingBeginOutcomeSchema.parse({ token, totalBytes: 1 })).toEqual({ token, totalBytes: 1 });
    expect(StoryPendingAppendOutcomeSchema.parse({ token, kind: 'input', receivedBytes: 1 }).receivedBytes).toBe(1);
    const upload = { token, manifest: value, receivedBytes: [{ kind: 'input', receivedBytes: 0 }] };
    expect(StoryPendingUploadSchema.parse(upload)).toEqual(upload);
    for (const receivedBytes of [[], [{ kind: 'input', receivedBytes: 2 }], [{ kind: 'input', receivedBytes: -1 }], [{ kind: 'header', receivedBytes: 0 }]]) {
      expect(StoryPendingUploadSchema.safeParse({ ...upload, receivedBytes }).success).toBe(false);
    }
  });
  it('never classifies explicit unknown as not-written', () => {
    expect(StoryNativeFailureSchema.safeParse({ code: 'story-commit-unknown', message: 'unknown', writeEvidence: 'unknown' }).success).toBe(true);
    expect(StoryNativeFailureSchema.safeParse({ code: 'story-commit-unknown', message: 'unknown', writeEvidence: 'not-written' }).success).toBe(false);
    expect(StoryNativeFailureSchema.safeParse({ code: 'story-io', message: 'failed', writeEvidence: 'unknown' }).success).toBe(false);
  });
});

describe('durable story pending non-secret canonical input', () => {
  it('reuses server linear-context rules while preserving nested card JSON and text exactly', () => {
    const original = JSON.parse('{"apiKey":"fictional card field","nested":{"token":"叙事\\u0000\\ud800𝌆","constructor":{"customProvider":"lore"}}}') as Record<string, unknown>;
    const value = input(); value.seed.combatants = [original as { name: string }]; value.chapterContext.workingCombatants = [original as { name: string }];
    const checked = StoryPendingInputSchema.parse(value);
    expect(JSON.stringify(checked)).toBe(JSON.stringify(value));
    expect(checked.seed.combatants[0]).toBe(original);
    expect(ArenaStoryCreateRequestSchema.safeParse(value).success).toBe(true);
    expect(StoryPendingInputSchema.safeParse({ ...value, chapterIndex: 2 }).success).toBe(false);
    expect(StoryPendingInputSchema.safeParse({ ...value, action: 'continue' }).success).toBe(false);
    expect(StoryPendingInputSchema.safeParse({ ...value, chapterPlan: { totalChapters: 0 } }).success).toBe(false);
  });
  it.each(['customProvider', 'apiKey', 'token', 'accessToken', 'anonymousBootstrap', 'bootstrap', 'cookie', 'internalGuidance'])('forbids %s on input control objects without stripping it', (field) => {
    const value = input();
    for (const candidate of [{ ...value, [field]: 'secret' }, { ...value, seed: { ...value.seed, [field]: 'secret' } },
      { ...value, chapterContext: { ...value.chapterContext, [field]: 'secret' } },
      { ...value, seed: { ...value.seed, settings: { ...value.seed.settings, [field]: 'secret' } } }]) {
      expect(StoryPendingInputSchema.safeParse(candidate).success).toBe(false);
    }
    expect(StoryPendingInputSchema.safeParse({ ...value, [field]: undefined }).success).toBe(false);
  });
  it('keeps valid continuation context and all 32 original cards', () => {
    const value = input();
    const cards = Array.from({ length: 32 }, (_, i) => ({ name: `角色${i}`, extension: { untouched: true } }));
    const continuation = { ...value, action: 'continue', chapterIndex: 99, sourceChapterId: 'previous', seed: { ...value.seed, combatants: cards },
      chapterContext: { workingCombatants: cards, recentWindow: [{ chapterId: 'previous', chapterIndex: 98, title: '前章', mode: 'digest', text: '摘要', truncated: true }] } };
    expect(StoryPendingInputSchema.parse(continuation).chapterIndex).toBe(99);
    expect(StoryPendingInputSchema.safeParse({ ...continuation, chapterPlan: { totalChapters: 20 } }).success).toBe(false);
    expect(StoryPendingInputSchema.safeParse({ ...continuation, sourceChapterId: 'different' }).success).toBe(false);
    expect(StoryPendingInputSchema.safeParse({ ...continuation, chapterIndex: 100 }).success).toBe(false);
  });
  it('keeps canonical questionnaire nonempty IDs and titles', () => {
    const value = input();
    for (const questionnaire of [{ id: '', title: 'title', kind: 'magical-girl' }, { id: 'id', title: '', kind: 'canshou' }]) {
      expect(StoryPendingInputSchema.safeParse({ ...value, seed: { ...value.seed, questionnaires: [questionnaire] } }).success).toBe(false);
    }
  });
  it('rejects non-JSON values rather than silently changing the durable input', () => {
    for (const card of [{ value: undefined }, { value: Number.NaN }, { value: () => 'lost' }, new Date()]) {
      const value = input();
      expect(StoryPendingInputSchema.safeParse({ ...value, seed: { ...value.seed, combatants: [card] } }).success).toBe(false);
    }
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(StoryPendingInputSchema.safeParse({ ...input(), userGuidance: cyclic }).success).toBe(false);
  });
});

describe('durable story pending public original carriers', () => {
  it.each(telemetryGolden.cases)('retains the successful telemetry original: $name', ({ originals }) => {
    expect(StoryPendingTelemetrySchema.parse(originals.telemetry)).toEqual(originals.telemetry);
  });
  it.each(telemetryGolden.invalidTelemetry)('rejects telemetry outside the existing successful branch %#', (value) => {
    expect(StoryPendingTelemetrySchema.safeParse(value).success).toBe(false);
  });
  it('has no independent model-name cap and preserves all JSON token/null/boolean values', () => {
    const value = { aiModel: '雪'.repeat(30_000), usage: { promptTokens: null, completionTokens: 0, totalTokens: Number.MAX_SAFE_INTEGER, completionTokensIncludesReasoning: false } };
    expect(StoryPendingTelemetrySchema.parse(value)).toEqual(value);
    expect(StoryPendingTelemetrySchema.safeParse({ ...value, usage: { promptTokens: undefined } }).success).toBe(false);
  });
  it.each(contentGolden.cases)('accepts every cross-runtime golden original and compact role outcome: $name', ({ originals, expected }) => {
    expect(StoryPendingInputSchema.parse(originals.input)).toEqual(originals.input);
    if (originals.header) expect(StoryPendingHeaderSchema.parse(originals.header)).toEqual(originals.header);
    if (originals.meta) expect(StoryPendingMetaSchema.parse(originals.meta)).toEqual(originals.meta);
    if (originals.roleResponse) expect(StoryPendingRoleResponseSchema.parse(originals.roleResponse)).toEqual(originals.roleResponse);
    expect(StoryPendingRoleSyncSchema.parse(expected.chapter.cardSnapshot.storyRoleSync)).toEqual(expected.chapter.cardSnapshot.storyRoleSync);
  });
  it('closes and versions the compact role outcome, with an explicit old-role reason', () => {
    const base = { version: 1, state: 'not-requested', warnings: [] };
    expect(StoryPendingRoleSyncSchema.parse(base)).toEqual(base);
    const warnings = [{ combatantIndex: 0, code: 'ARENA_RECONCILIATION_COMBATANT_UNMATCHED', message: '原样\n\ud800' }];
    expect(StoryPendingRoleSyncSchema.parse({ ...base, state: 'accepted', warnings }).warnings).toEqual(warnings);
    for (const reason of ['http-failure', 'user-kept-original']) {
      expect(StoryPendingRoleSyncSchema.parse({ ...base, state: 'old-roles', reason }).reason).toBe(reason);
    }
    for (const change of [
      { version: 2 }, { state: 'unresolved' }, { state: 'old-roles' },
      { reason: 'http-failure' }, { state: 'accepted', reason: 'user-kept-original' },
      { state: 'old-roles', reason: 'unknown' }, { warnings: [{ message: 'opaque' }] },
      { warnings }, { state: 'old-roles', reason: 'http-failure', warnings },
      { warnings: [...warnings, { ...warnings[0], token: 'secret' }] },
      { response: {} }, { metadata: {} }, { input: {} }, { authorization: 'secret' },
    ]) expect(StoryPendingRoleSyncSchema.safeParse({ ...base, ...change }).success).toBe(false);
  });
  it('treats uncovered originals as explicit not-written without permitting unknown evidence', () => {
    const failure = { code: 'story-originals-uncovered', message: '原件未被完成作品覆盖', writeEvidence: 'not-written' };
    expect(StoryNativeFailureSchema.parse(failure)).toEqual(failure);
    expect(StoryNativeFailureSchema.safeParse({ ...failure, writeEvidence: 'unknown' }).success).toBe(false);
  });
  it('accepts only closed Markdown header metadata and preserves nested public text', () => {
    const value = { reportFormat: 'markdown', outputContract: 'stream-markdown', reporterInfo: { name: '雪', extension: { token: 'fictional lore' } } };
    expect(StoryPendingHeaderSchema.parse(value)).toEqual(value);
    for (const change of [{ reportFormat: 'web' }, { outputContract: 'web-document' }, { outputContract: 'web-package-target' },
      { authorization: 'secret' }, { cookie: 'secret' }, { anonymousBootstrap: 'secret' }, { webPackageRef: {} }]) {
      expect(StoryPendingHeaderSchema.safeParse({ ...value, ...change }).success).toBe(false);
    }
    expect(StoryPendingHeaderSchema.safeParse({ 'content-type': 'text/event-stream' }).success).toBe(false);
  });
  it('retains only original meta or meta_error events, never a duplicate output snapshot', () => {
    const meta = { id: '1-0', event: 'meta', data: { parseOk: true, meta: { privateFiction: { customProvider: 'text' } }, raw: '{\n}', rawTruncated: false } };
    const error = { id: '2-0', event: 'meta_error', data: { parseOk: false, error: 'invalid metadata', raw: '\ud800', rawTruncated: true } };
    expect(StoryPendingMetaSchema.parse(meta)).toEqual(meta);
    expect(StoryPendingMetaSchema.parse(error)).toEqual(error);
    const web = { ...meta, data: { ...meta.data, webPackage: {
      packageRef: { id: 'package', version: '1', digest }, targetPath: 'index.html', targetMediaType: 'text/html', generatedDigest: digest,
    } } };
    expect(DesktopArenaHostedSseEventSchema.safeParse(web).success).toBe(true);
    expect(StoryPendingMetaSchema.safeParse(web).success).toBe(false);
    for (const value of [
      { id: '1-0', event: 'markdown', data: { chunk: 'duplicate body' } },
      { id: '1-0', event: 'snapshot', data: { status: 'completed', markdown: 'duplicate body', reasoning: '', lastEventId: null, updatedAt: '2026-10-10T00:00:00Z' } },
      { id: '1-0', event: 'done', data: { status: 'completed', ok: true } },
      { ...meta, token: 'secret' }, { ...meta, data: { ...meta.data, anonymousBootstrap: 'secret' } },
      { ...meta, data: { ...meta.data, parseOk: false } },
      { ...meta, data: { ...meta.data, raw: '𝌆'.repeat(4000) + 'x' } },
      { ...error, data: { ...error.data, error: '𝌆'.repeat(1024) + 'x' } },
    ]) expect(StoryPendingMetaSchema.safeParse(value).success).toBe(false);
  });
  it('requires the canonical successful role response rather than failure/partial acceptance', () => {
    const value = { version: 'arena-reconciliation-v1', generationId: 'generation_1234', success: true,
      updatedCombatants: [{ combatantIndex: 0, data: { signature: 'fresh-signature', extension: { apiKey: 'fictional field' } }, isNative: true }], warnings: [] };
    expect(StoryPendingRoleResponseSchema.parse(value)).toEqual(value);
    for (const response of [
      { version: value.version, generationId: value.generationId, code: 'FAILED', error: 'failed' },
      { ...value, success: false }, { ...value, token: 'secret' },
      { ...value, updatedCombatants: [{ ...value.updatedCombatants[0], data: { signature: '' } }] },
      { ...value, updatedCombatants: [...value.updatedCombatants, ...value.updatedCombatants] },
    ]) expect(StoryPendingRoleResponseSchema.safeParse(response).success).toBe(false);
  });
});

describe('read-only Native create claim evidence', () => {
  const claim = () => ({
    version: 1, attemptId: token, storyProtocolVersion: 'arena-story-v1', inputDigest: digest,
    clientBodyHash: 'b'.repeat(64), funding: { mode: 'system', providerId: 'system', modelId: 'default' }, observedGeneration: null,
  });
  it('accepts Native-owned claim and original generation observation only in snapshot readback', () => {
    const value = claim();
    expect(StoryPendingCreateClaimSnapshotSchema.parse(value)).toEqual(value);
    expect(Object.isFrozen(StoryPendingCreateClaimSnapshotSchema.parse(value))).toBe(true);
    expect(StoryPendingSnapshotSchema.parse({ manifest: manifest(), saveAttemptId: null, restored: false, createClaim: value }).createClaim).toEqual(value);
    expect(StoryPendingCreateClaimSnapshotSchema.parse({ ...value, observedGeneration: { generationId: `arena_${'c'.repeat(64)}`, serverPayloadHash: null } }).observedGeneration?.serverPayloadHash).toBe(null);
    expect(StoryPendingManifestSchema.safeParse({ ...manifest(), createClaim: value }).success).toBe(false);
  });
  it('closes claim, funding and observation and refuses cross-input binding', () => {
    for (const key of ['state', 'createdAt', 'body', 'secretRef', 'retryAllowed', 'notSent', 'modelCompletedProof']) {
      expect(StoryPendingCreateClaimSnapshotSchema.safeParse({ ...claim(), [key]: 'unexpected' }).success).toBe(false);
    }
    for (const patch of [{ version: 2 }, { attemptId: 'renderer-choice' }, { clientBodyHash: digest },
      { funding: { ...claim().funding, apiKey: 'secret' } },
      { funding: { mode: 'preset', providerId: 'system', modelId: 'default' } },
      { observedGeneration: { generationId: `arena_${'c'.repeat(64)}`, serverPayloadHash: 'short' } },
      { observedGeneration: { generationId: `arena_${'c'.repeat(64)}`, serverPayloadHash: null, completed: true } }]) {
      expect(StoryPendingCreateClaimSnapshotSchema.safeParse({ ...claim(), ...patch }).success).toBe(false);
    }
    expect(StoryPendingSnapshotSchema.safeParse({ manifest: manifest(), saveAttemptId: null, restored: false, createClaim: { ...claim(), inputDigest: otherDigest } }).success).toBe(false);
  });
});
