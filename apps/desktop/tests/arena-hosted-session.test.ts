import { describe, expect, it, vi } from 'vitest';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import type { DesktopArenaHostedChannelEvent, DesktopArenaHostedOperation } from '@mahoshojo/contracts/desktop-arena-hosted';
import { DesktopArenaSession, createInitialArenaDraft, type ArenaDraft } from '../src/features/arena/session';
import { ARENA_HOSTED_RECOVERY_KEYS } from '../src/features/arena/hosted-recovery';

const generationId = `arena_${'b'.repeat(64)}`;
const now = '2026-10-10T05:00:00.000Z';
const intent = { mode: 'hosted' as const, generationMode: 'stream' as const, modelId: 'default', systemConfig: {} };
const actor = { kind: 'anonymous' as const };
const body = '# 服务器故事\n\n完整正文';
const draft = (): ArenaDraft => ({ ...createInitialArenaDraft(), generationMode: 'stream', battleMode: 'daily',
  combatants: [{ type: 'general-character', filename: '甲.json', isValid: false, isPreset: false, data: { name: '甲', content: '源设定', signature: 'source-authority', adjudicationEvents: [{ type: 'binary', description: '源判定', probability: 50 }] } }],
  settings: { ...createInitialArenaDraft().settings, writeNarrativeHistory: true } });
function storage() {
  const data = new Map<string, string>(); let fail = false;
  return { data, fail: () => { fail = true; }, recover: () => { fail = false; }, getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { if (fail) throw new Error('disk failed'); data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
function fixture(product: 'battle' | 'arena' = 'battle', saved = storage()) {
  const records = new Map<string, LocalCardRecordV1>(); let failSave = false, hold = false, release: (() => void) | undefined;
  const repository = { get: async (id: string) => records.get(id) ?? null, putIfAbsent: vi.fn(async (record: LocalCardRecordV1) => {
    if (failSave) throw new Error('disk failed'); if (records.has(record.id)) return { alreadyPresent: true }; records.set(record.id, record); return { written: true };
  }) } as unknown as CardRepository;
  const random = vi.fn(() => 0);
  const session = new DesktopArenaSession({ product, repository, storage: saved, now: () => now, requestId: () => 'hosted-session-1', random,
    hostedTestPorts: { createChannel: () => ({ onmessage: () => undefined }), wait: async () => undefined, maxReconnectAttempts: 0 } }); session.setScope('actor-A:target-A');
  const operations: DesktopArenaHostedOperation[] = [];
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'arena_hosted_detach') { release?.(); return; }
    const request = args!.request as DesktopArenaHostedOperation; operations.push(request);
    if (request.operation === 'lookup-request' || request.operation === 'stop') return { status: request.operation === 'stop' ? 202 : 200,
      recoveryCredentialState: 'stored', body: { generationId, generationRequestId: request.requestId, status: request.operation === 'stop' ? 'cancelling' : 'completed' } };
    if (request.operation !== 'create-stream' && request.operation !== 'resume') throw new Error('unexpected command');
    const channel = args!.onEvent as { onmessage(event: DesktopArenaHostedChannelEvent): void }; let sequence = 0;
    const send = (value: Record<string, unknown>) => channel.onmessage({ requestId: request.requestId, sequence: sequence++, ...value } as DesktopArenaHostedChannelEvent);
    send({ kind: 'response', status: 200, generationId, generationRequestId: request.requestId, metadataState: 'missing', recoveryCredentialState: 'stored' });
    send({ kind: 'sse-fragment', final: true, text: `id: 1-0\nevent: snapshot\ndata: ${JSON.stringify({ markdown: body, reasoning: '独立推理', status: hold ? 'running' : 'completed', telemetry: null, lastEventId: '1-0', updatedAt: now })}\n\n` });
    if (hold) await new Promise<void>((resolve) => { release = resolve; });
    send({ kind: 'sse-fragment', final: true, text: 'id: 2-0\nevent: done\ndata: {"status":"completed","ok":true}\n\n' }); send({ kind: 'stream-end' });
  });
  return { session, saved, records, repository, invoke, operations, random, setHold: () => { hold = true; }, failSave: () => { failSave = true; }, recoverSave: () => { failSave = false; } };
}

describe('same Arena session with Hosted completion ownership', () => {
  it.each(['battle', 'arena'] as const)('%s preserves source cards and Direct preferences; history appends once then explicitly saves', async (product) => {
    const f = fixture(product), source = draft(); f.session.updateDraft(source);
    const run = f.session.generateHosted({ invoke: f.invoke }, source, intent, actor);
    await f.session.generateHosted({ invoke: f.invoke }, source, intent, actor); await run;
    const state = f.session.getSnapshot(); expect(state.phase).toBe('completed'); expect(f.random).not.toHaveBeenCalled();
    expect(state.draft.combatants).toEqual(source.combatants); expect(state.draft.settings).toEqual(source.settings); expect(state.candidates).toBeNull();
    expect(f.operations.filter((op) => op.operation === 'create-stream')).toHaveLength(1);
    const request = f.operations.find((op) => op.operation === 'create-stream')!;
    if (request.operation !== 'create-stream') throw new Error('fixture');
    expect(request.body).toMatchObject({ writeArenaHistory: false, writeCurrentState: false }); expect(request.body).not.toHaveProperty('adjudicationResults');
    expect(state.report?.officialReport.winner).toBe(''); expect(state.draft.narrativeHistoryEntries).toHaveLength(1);
    expect(state.draft.narrativeHistoryEntries[0]).toMatchObject({ id: `arena-generation:${generationId}`, content: body, hostedSource: { metadataState: 'missing', signedCharacterUpdates: false } });
    expect(f.records.size).toBe(0); f.session.appendHostedHistory(); expect(state.draft.narrativeHistoryEntries).toHaveLength(1);
    expect(await f.session.save('characters')).toBe(false); expect(await f.session.save('history')).toBe(true); expect(await f.session.save('history')).toBe(true); expect(f.records.size).toBe(1);
    expect(JSON.parse(f.session.exportDocument()).result).toMatchObject({ rawText: body, reasoning: '独立推理', hostedGenerationId: generationId }); f.session.dispose();
  });
  it('requires stream selection instead of silently translating JSON into streaming', async () => {
    const f = fixture(), input = { ...draft(), generationMode: 'non-stream' as const };
    await f.session.generateHosted({ invoke: f.invoke }, input, intent, actor); expect(f.invoke).not.toHaveBeenCalled(); expect(f.session.getSnapshot().message).toContain('仅接入流式'); f.session.dispose();
  });
  it('a failed prewritten pointer means no Native create or local roll', async () => {
    const f = fixture(); f.saved.fail(); await f.session.generateHosted({ invoke: f.invoke }, draft(), intent, actor);
    expect(f.invoke).not.toHaveBeenCalled(); expect(f.random).not.toHaveBeenCalled(); expect(f.session.getSnapshot().phase).toBe('failed'); f.session.dispose();
  });
  it('stop accepts only cancellation state and keeps partial text without history or character effects', async () => {
    const f = fixture(); f.session.updateDraft(draft()); f.setHold();
    const run = f.session.generateHosted({ invoke: f.invoke }, draft(), intent, actor); await vi.waitFor(() => expect(f.session.getSnapshot().markdown).toBe(body));
    f.session.cancel(); await run; expect(f.session.getSnapshot()).toMatchObject({ phase: 'cancelled', rawText: body, candidates: null, hosted: { connectionState: 'cancelled' } });
    expect(f.session.getSnapshot().draft.narrativeHistoryEntries).toHaveLength(0); expect(f.records.size).toBe(0);
    expect(f.operations.filter((op) => op.operation === 'stop')).toHaveLength(1); f.session.dispose();
  });
  it('scope change detaches without server stop and does not accept a late terminal or write the old pointer', async () => {
    const f = fixture(); f.session.updateDraft(draft()); f.setHold();
    const run = f.session.generateHosted({ invoke: f.invoke }, draft(), intent, actor); await vi.waitFor(() => expect(f.session.getSnapshot().markdown).toBe(body));
    const pointer = f.saved.data.get(ARENA_HOSTED_RECOVERY_KEYS.battle); f.session.setScope('account-B:target-B'); await run;
    expect(f.session.getSnapshot().phase).toBe('cancelled'); expect(f.operations.some((op) => op.operation === 'stop')).toBe(false);
    expect(f.session.getSnapshot().draft.narrativeHistoryEntries).toHaveLength(0); expect(f.saved.data.get(ARENA_HOSTED_RECOVERY_KEYS.battle)).toBe(pointer); f.session.dispose();
  });
  it('explicit restart recovery reuses the same actor and only appends history on a separate action', async () => {
    const first = fixture(); const input = { ...draft(), settings: { ...draft().settings, writeNarrativeHistory: false } }; first.session.updateDraft(input);
    await first.session.generateHosted({ invoke: first.invoke }, input, intent, actor); first.session.dispose();
    const next = fixture('battle', first.saved); next.session.restoreDraft(); await next.session.restoreHosted({ invoke: next.invoke }, 'hosted-session-1');
    expect(next.operations.map((op) => op.operation)).toEqual(['lookup-request', 'resume']); expect(next.operations[0]).toMatchObject({ actor, restoreSession: true });
    expect(next.operations[1]).not.toHaveProperty('after'); expect(next.operations[1]).not.toHaveProperty('presetConfig');
    expect(next.session.getSnapshot().phase).toBe('completed'); expect(next.session.getSnapshot().draft.narrativeHistoryEntries).toHaveLength(0);
    next.session.appendHostedHistory(); next.session.appendHostedHistory(); expect(next.session.getSnapshot().draft.narrativeHistoryEntries).toHaveLength(1); next.session.dispose();
  });
  it('save failure preserves full output and retries the same unsigned history document', async () => {
    const f = fixture(); f.session.updateDraft(draft()); await f.session.generateHosted({ invoke: f.invoke }, draft(), intent, actor);
    f.failSave(); expect(await f.session.save('history')).toBe(false); expect(f.session.getSnapshot().saveError).toContain('完整原文仍在内存');
    expect(JSON.parse(f.session.exportDocument()).result.rawText).toBe(body); f.recoverSave(); expect(await f.session.save('history')).toBe(true); expect(f.records.size).toBe(1); f.session.dispose();
  });
  it('changing account after completion cannot append the previous active result', async () => {
    const f = fixture(), input = { ...draft(), settings: { ...draft().settings, writeNarrativeHistory: false } }; f.session.updateDraft(input);
    await f.session.generateHosted({ invoke: f.invoke }, input, intent, actor); f.session.setScope('account-B'); f.session.setScope('actor-A:target-A'); f.session.appendHostedHistory();
    expect(f.session.canAppendHostedHistory()).toBe(false); expect(f.session.getSnapshot().draft.narrativeHistoryEntries).toHaveLength(0); f.session.dispose();
  });
});

it.each(['cancel', 'detach', 'scope'] as const)('clears the transient soft warning immediately on %s without fabricating server termination', async action => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); const f = fixture(); f.setHold();
  const run = f.session.generateHosted({ invoke: f.invoke }, draft(), intent, actor);
  try {
    await vi.waitFor(() => expect(f.session.getSnapshot().markdown).toBe(body));
    await vi.advanceTimersByTimeAsync(300_000); expect(f.session.getSnapshot().hosted?.softTimeoutWarning).toContain('300 秒');
    if (action === 'scope') f.session.setScope('actor-B:target-B'); else f.session[action]();
    expect(f.session.getSnapshot().hosted?.softTimeoutWarning).toBeNull(); await run;
    expect(f.session.getSnapshot().phase).toBe('cancelled');
    expect(f.operations.filter(op => op.operation === 'stop')).toHaveLength(action === 'cancel' ? 1 : 0);
  } finally { f.session.detach(); await run; f.session.dispose(); vi.useRealTimers(); }
});
