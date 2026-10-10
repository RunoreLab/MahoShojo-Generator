import { describe, expect, it, vi } from 'vitest';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import { ARENA_COMPANION_PROTOCOL_VERSION } from '@mahoshojo/contracts/arena-companion';
import { DesktopArenaSession, createInitialArenaDraft, ARENA_DRAFT_KEY } from '../src/features/arena/session';
const id = `arena_${'d'.repeat(64)}`, requestId = 'json-session-one', now = '2026-10-10T07:00:00.000Z';
const report = { headline: '原标题', article: { body: '正文', analysis: '分析完整保留' }, officialReport: { winner: '甲', conclusion: '结论完整保留' },
  mode: 'daily', reporterInfo: { name: '记者', publication: '刊物' }, aiReasoning: { status: 'complete', text: '独立推理' } };
const full = { version: ARENA_COMPANION_PROTOCOL_VERSION, body: { generationId: id, report, updatedCombatants: [] },
  metadata: { reportFormat: 'markdown', outputContract: 'structured-report', mode: 'daily', language: 'zh-CN', storyLength: 'long', scenarioDisplayName: '原主情景' } };
const task = { mode: 'hosted' as const, generationMode: 'non-stream' as const, modelId: 'default', systemConfig: {} }, actor = { kind: 'anonymous' as const };
function fixture(values = new Map<string, string>(), value = full) {
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, raw: string) => { values.set(key, raw); }, removeItem: (key: string) => { values.delete(key); } };
  const records = new Map<string, LocalCardRecordV1>(); let fail = false;
  const repository = { get: async (key: string) => records.get(key) ?? null, putIfAbsent: vi.fn(async (record: LocalCardRecordV1) => {
    if (fail) throw new Error('disk failure'); if (records.has(record.id)) return { alreadyPresent: true }; records.set(record.id, record); return { written: true };
  }) } as unknown as CardRepository;
  const session = new DesktopArenaSession({ storage, repository, requestId: () => requestId, now: () => now,
    hostedTestPorts: { createChannel: () => ({ onmessage: () => undefined }), wait: async () => undefined, maxReconnectAttempts: 0 } }); session.setScope('A');
  const initial = createInitialArenaDraft(); const draft = { ...initial, battleMode: 'daily' as const, generationMode: 'non-stream' as const,
    settings: { ...initial.settings, writeNarrativeHistory: true, writeArenaHistory: false, writeCurrentState: false }, combatants: [{ type: 'general-character' as const, isValid: true, isPreset: false, filename: '甲.json', data: { name: '甲', content: '原角色', signature: 'original-signature' } }] };
  const operations: Record<string, unknown>[] = [];
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'arena_hosted_detach') return;
    const request = args!.request as Record<string, unknown>; operations.push(request);
    if (request.operation === 'lookup-request') return { status: 200, body: { generationId: id, generationRequestId: requestId, status: 'completed' }, recoveryCredentialState: 'stored' };
    const channel = args!.onEvent as { onmessage(value: unknown): void }; let sequence = 0;
    const send = (message: Record<string, unknown>) => channel.onmessage({ requestId, sequence: sequence++, ...message });
    if (request.operation === 'create-json') {
      send({ kind: 'json-response', status: 200, generationId: id, generationRequestId: requestId, recoveryCredentialState: 'stored' });
      const raw = JSON.stringify(value);
      for (let offset = 0; offset < raw.length; offset += 16000) send({ kind: 'json-fragment', text: raw.slice(offset, offset + 16000), final: offset + 16000 >= raw.length });
      send({ kind: 'json-end' });
    } else if (request.operation === 'resume') {
      send({ kind: 'response', status: 200, generationId: id, generationRequestId: requestId, metadataState: 'missing', recoveryCredentialState: 'stored' });
      send({ kind: 'sse-fragment', final: true, text: `id: 1-0\nevent: markdown\ndata: ${JSON.stringify({ chunk: JSON.stringify({ headline: report.headline, article: report.article, officialReport: report.officialReport }) })}\n\n` });
      send({ kind: 'sse-fragment', final: true, text: 'id: 2-0\nevent: done\ndata: {"status":"completed","ok":true}\n\n' }); send({ kind: 'stream-end' });
    } else throw new Error('unexpected operation');
  });
  return { session, storage, values, records, repository, invoke, operations, draft, setFail: (value: boolean) => { fail = value; } };
}
describe('complete JSON in the shared Arena session', () => {
  it('freezes one JSON task, retains every field for export, appends activity once and explicitly saves idempotently', async () => {
    const f = fixture(); f.session.updateDraft(f.draft);
    const pending = f.session.generateHosted({ invoke: f.invoke }, f.draft, task, actor); await f.session.generateHosted({ invoke: f.invoke }, f.draft, task, actor); await pending;
    const result = f.session.getSnapshot(); expect(result).toMatchObject({ phase: 'completed', activeGenerationMode: 'non-stream', report: { article: report.article }, hosted: { companion: full, terminal: null } });
    expect(result.report!.article).toBe((result.hosted!.companion!.body as { report: typeof report }).report.article);
    expect(result.draft.combatants).toEqual(f.draft.combatants); expect(result.candidates).toBeNull(); expect(f.operations).toHaveLength(1);
    expect(result.draft.narrativeHistoryEntries).toHaveLength(1); expect(f.records.size).toBe(0);
    expect(await f.session.save('history')).toBe(true); expect(await f.session.save('history')).toBe(true); expect(f.records.size).toBe(1);
    const exported = JSON.parse(f.session.exportDocument()); expect(exported.result.hosted.companion).toEqual(full); expect(exported.result.report.aiReasoning.status).toBe('done');
    expect(exported.result.hosted.companion.body.report.aiReasoning.status).toBe('complete');
    f.session.dispose();
  });
  it('save failure keeps the complete response and successful generation; explicit retry keeps the candidate identity', async () => {
    const f = fixture(); f.session.updateDraft(f.draft); await f.session.generateHosted({ invoke: f.invoke }, f.draft, task, actor);
    f.setFail(true); expect(await f.session.save('history')).toBe(false); expect(f.session.getSnapshot()).toMatchObject({ phase: 'completed', saveStatus: 'failed', hosted: { companion: full } });
    f.setFail(false); expect(await f.session.save('history')).toBe(true); expect(f.records.size).toBe(1); expect(f.operations).toHaveLength(1); f.session.dispose();
  });
  it('reopens the new pointer without another create, parses structured replay, preserves missing-full-JSON state and does not auto-append', async () => {
    const f = fixture(); f.session.updateDraft(f.draft); await f.session.generateHosted({ invoke: f.invoke }, f.draft, task, actor); f.session.dispose();
    const reopened = fixture(f.values); reopened.session.restoreDraft();
    expect(reopened.session.canAppendHostedHistory()).toBe(false); expect(reopened.session.getSnapshot().hosted?.companion).toEqual(full);
    await reopened.session.restoreHosted({ invoke: reopened.invoke }, requestId);
    expect(reopened.operations.map(value => value.operation)).toEqual(['lookup-request', 'resume']);
    expect(reopened.session.getSnapshot()).toMatchObject({ phase: 'completed', activeGenerationMode: 'non-stream', report: { article: report.article }, hosted: { companionState: 'recovered-model-only', companion: null } });
    expect(reopened.session.getSnapshot().draft.narrativeHistoryEntries).toHaveLength(1);
    reopened.session.setScope('B'); reopened.session.setScope('A'); expect(reopened.session.canAppendHostedHistory()).toBe(false); reopened.session.dispose();
  });
  it('preserves the complete object and export when ordinary draft storage budget is exceeded', async () => {
    const big = { ...full, body: { ...full.body, report: { ...report, article: { ...report.article, body: 'x'.repeat(1500000) } } } };
    const f = fixture(undefined, big); f.session.updateDraft(f.draft); const old = f.values.get(ARENA_DRAFT_KEY);
    await f.session.generateHosted({ invoke: f.invoke }, f.draft, task, actor);
    expect(f.session.getSnapshot()).toMatchObject({ phase: 'completed', draftSaved: false }); expect(f.session.getSnapshot().draftError).toBeTruthy();
    expect(f.values.get(ARENA_DRAFT_KEY)).not.toBeUndefined(); expect(JSON.parse(f.session.exportDocument()).result.hosted.companion).toEqual(big);
    expect(old).toBeDefined(); f.session.dispose();
  });
});
