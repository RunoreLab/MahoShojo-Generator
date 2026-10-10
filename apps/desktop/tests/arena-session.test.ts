import { describe, expect, it, vi } from 'vitest';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import type { AiExecutionRequest } from '@mahoshojo/contracts/ai-execution';
import type { AiStreamEvent } from '@mahoshojo/ai-core/stream-events';
import { MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES } from '@mahoshojo/contracts/desktop-ipc';
import { localLibraryRecordBytes } from '@mahoshojo/local-library/archive-export';
import { ARENA_DRAFT_KEY, DesktopArenaSession, createInitialArenaDraft, type ArenaDraft } from '../src/features/arena/session';
import { readSublimationHistorySource } from '../src/features/sublimation/history-source';

const memory = () => {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
};
const repository = () => {
  const records = new Map<string, LocalCardRecordV1>();
  const port = { get: vi.fn(async (id: string) => records.get(id) ?? null),
    list: vi.fn(async (query: { cardTypes?: string[] }) => ({ items: [...records.values()].filter((item) => !query.cardTypes || query.cardTypes.includes(item.cardType)) })),
    putIfAbsent: vi.fn(async (record: LocalCardRecordV1) => {
      if (records.has(record.id)) return { alreadyPresent: true };
      records.set(record.id, structuredClone(record)); return { written: true };
    }) } as unknown as CardRepository;
  return { records, port };
};
const makeDraft = (battleMode: ArenaDraft['battleMode'] = 'classic', generationMode: ArenaDraft['generationMode'] = 'non-stream'): ArenaDraft => ({
  ...createInitialArenaDraft(), battleMode, generationMode,
  combatants: ['甲', '乙'].map((name) => ({ type: 'general-character', data: { templateId: '通用角色', name, content: '源卡设定', signature: 'old-authority' }, isPreset: false, isValid: false, filename: `${name}.json` })),
  scenario: { content: battleMode === 'scenario' ? { title: '重逢', content: '车站' } : null, fileName: null },
  settings: { ...createInitialArenaDraft().settings, writeNarrativeHistory: true },
});
const intent = (generationMode: ArenaDraft['generationMode'] = 'non-stream') => ({ mode: 'direct-local' as const, generationMode, modelId: 'fixture' });
const valid = (stream: boolean, text = '两位角色共同踏上旅途。') => stream ? `# 新旅途\n\n${text}\n<!-- MAHOSHOJO_ARENA_META {"version":1,"report":{"headline":"新旅途","winner":"甲"},"impacts":[{"characterName":"甲","impact":"互相信任","currentStateSummary":"平静"}]} -->`
  : JSON.stringify({ headline: '新旅途', article: { body: text, analysis: '彼此理解' }, officialReport: { winner: '甲', conclusion: '合作' }, impacts: [{ characterName: '甲', impact: '互相信任', currentStateSummary: '平静' }] });
const native = (text: string, finishReason = 'stop', wait?: Promise<void>) => {
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'cancel_direct_ai') return;
    const request = args!.request as AiExecutionRequest;
    const channel = args!.onEvent as { onmessage(event: AiStreamEvent): void };
    const identity = { requestId: request.requestId, contractVersion: 1 as const, mode: request.mode };
    let sequence = 0;
    channel.onmessage({ ...identity, sequence: sequence++, type: 'started' });
    channel.onmessage({ ...identity, sequence: sequence++, type: 'reasoning-delta', delta: '独立思考' });
    for (const delta of text.match(/[\s\S]{1,60000}/g) ?? []) channel.onmessage({ ...identity, sequence: sequence++, type: 'text-delta', delta });
    if (wait) await wait;
    if (finishReason === 'EOF') return;
    channel.onmessage({ ...identity, sequence: sequence++, type: 'result', result: { ...identity, status: 'completed', finishReason: finishReason as 'stop', output: { text, reasoning: '独立思考' } } });
  });
  return { invoke, profileId: 'loopback-profile', createChannel: () => ({}) };
};
const build = () => { const repo = repository(), storage = memory(); const session = new DesktopArenaSession({ repository: repo.port, storage, requestId: () => 'arena-fixed', now: () => '2026-10-09T23:00:00.000Z' }); session.setScope('account-A:target-A'); return { session, storage, ...repo }; };

describe('Desktop Arena independent session', () => {
  it.each(['classic', 'kizuna', 'daily', 'scenario'] as const)('%s structured and Markdown execute → work copy → explicit save → reopen history', async (mode) => {
    for (const output of ['non-stream', 'stream'] as const) {
      const { session, records, port } = build(); const draft = makeDraft(mode, output), source = structuredClone(draft.combatants);
      session.updateDraft(draft);
      const options = native(valid(output === 'stream'));
      await session.generate(options, draft, intent(output));
      expect(session.getSnapshot().phase).toBe('completed'); expect(options.invoke).toHaveBeenCalledTimes(1);
      expect(records.size).toBe(0);
      expect(session.getSnapshot().draft.narrativeHistoryEntries).toHaveLength(1);
      expect(session.getSnapshot().draft.combatants[0]!.data).not.toHaveProperty('signature');
      expect(draft.combatants).toEqual(source);
      expect(session.getSnapshot().markdown).not.toContain('MAHOSHOJO'); expect(session.getSnapshot().markdown).not.toContain('独立思考');
      expect(session.exportDocument()).toContain('独立思考');
      expect(await session.save('history')).toBe(true); expect(await session.save('characters')).toBe(true); expect(records.size).toBe(3);
      const first = [...records.values()]; await session.save('history'); await session.save('characters'); expect([...records.values()]).toEqual(first);
      expect(first.every((record) => record.provenance.kind === 'unsigned')).toBe(true);
      const reopened = await readSublimationHistorySource(port); expect(reopened.status).toBe('ready'); expect(reopened.entries).toHaveLength(1);
      expect(reopened.entries[0]?.content).toContain('两位角色');
      session.dispose();
    }
  });
  it('freezes inherited role/main-scenario rolls once; material events are never executed', async () => {
    const repo = repository(), storage = memory(), random = vi.fn(() => 0);
    const session = new DesktopArenaSession({ repository: repo.port, storage, random, requestId: () => 'roll-once' }); session.setScope('A');
    const base = makeDraft('scenario', 'stream');
    const draft: ArenaDraft = { ...base, combatants: base.combatants.map((item, index) => ({ ...item, data: { ...item.data, ...(index === 0 ? { adjudicationEvents: [{ type: 'binary', description: '角色判定', probability: 0 }] } : {}) } })),
      scenario: { ...base.scenario, content: { ...base.scenario.content, adjudicationEvents: [{ type: 'binary', description: '情景判定', probability: 100 }] } },
      materials: [{ id: 'material-1', name: '仅参考', sourceType: 'raw-json', sourceKind: 'raw-json', fileName: null, content: { adjudicationEvents: [{ type: 'binary', description: '不得执行', probability: 100 }] } }] };
    session.updateDraft(draft); const options = native(valid(true)); const run = session.generate(options, draft, intent('stream')); await session.generate(options, draft, intent('stream')); await run;
    expect(random).toHaveBeenCalledTimes(2); expect(session.getSnapshot().generation?.adjudicationResults).toMatchObject([{ outcome: '失败' }, { outcome: '成功' }]);
    expect(session.getSnapshot().report?.adjudicationResults).toHaveLength(2); await session.save('history'); await session.save('history'); expect(random).toHaveBeenCalledTimes(2);
    expect(JSON.parse(session.exportDocument()).generation.input.combatants[0].data.adjudicationEvents).toHaveLength(1); session.dispose();
  });
  it('defaults match Web: no narrative append without opt-in; references never become persisted history IDs', async () => {
    const { session } = build(); const base = makeDraft('daily');
    const draft: ArenaDraft = { ...base, settings: { ...base.settings, writeNarrativeHistory: false, readNarrativeHistory: true }, historyReferences: [{ id: '["library-card",0,"real-id"]', title: '前情', content: '引用', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }] };
    session.updateDraft(draft); const options = native(valid(false)); await session.generate(options, draft, intent());
    expect(session.getSnapshot().draft.narrativeHistoryEntries).toEqual([]); expect(await session.save('history')).toBe(false);
    const request = options.invoke.mock.calls[0]![1]!.request as AiExecutionRequest;
    expect(request.messages.map((entry) => entry.content).join('')).toContain('引用'); session.dispose();
  });
  it.each(['EOF', 'length'])('incomplete %s retains originals with no candidates/history side effects', async (finish) => {
    const { session, records } = build(); const draft = makeDraft('daily', 'stream'); session.updateDraft(draft);
    await session.generate(native(valid(true), finish), draft, intent('stream'));
    expect(session.getSnapshot().phase).toBe('failed'); expect(session.getSnapshot().rawText).toContain('新旅途');
    expect(session.getSnapshot().candidates).toBeNull(); expect(session.getSnapshot().draft).toEqual(draft); expect(records.size).toBe(0); session.dispose();
  });
  it('double-click synchronous lock; cancel and late terminal do not apply history or source changes', async () => {
    const { session, records } = build(); let release!: () => void; const wait = new Promise<void>((resolve) => { release = resolve; });
    const draft = makeDraft('daily', 'stream'); session.updateDraft(draft); const options = native(valid(true), 'stop', wait);
    const pending = session.generate(options, draft, intent('stream')); await session.generate(options, draft, intent('stream'));
    await vi.waitFor(() => expect(session.getSnapshot().rawText).not.toBe('')); session.cancel(); release(); await pending;
    expect(options.invoke.mock.calls.filter(([command]) => command.startsWith('stream_'))).toHaveLength(1);
    expect(session.getSnapshot().phase).toBe('cancelled'); expect(session.getSnapshot().candidates).toBeNull(); expect(records.size).toBe(0); expect(session.getSnapshot().draft).toEqual(draft); session.dispose();
  });
  it('switching account/config fences late generation, pending import and async digest before writes', async () => {
    const { session, port } = build(); let release!: () => void; const wait = new Promise<void>((resolve) => { release = resolve; });
    const draft = makeDraft('daily', 'stream'); session.updateDraft(draft);
    const pending = session.generate(native(valid(true), 'stop', wait), draft, intent('stream'));
    session.setScope('account-B:target-B'); release(); await pending;
    expect(session.getSnapshot().phase).toBe('cancelled'); expect(session.getSnapshot().candidates).toBeNull(); expect(port.putIfAbsent).not.toHaveBeenCalled();
    await session.generate(native(valid(true)), draft, intent('stream'));
    const save = session.save('characters'); session.setScope('account-C:target-C'); expect(await save).toBe(false); expect(port.putIfAbsent).not.toHaveBeenCalled();
    const imported = session.importInput(async () => { await Promise.resolve(); return (next) => ({ ...next, combatants: [] }); }); session.setScope('D'); await expect(imported).rejects.toThrow('失效'); expect(session.getSnapshot().draft.combatants).toHaveLength(2); session.dispose();
  });
  it('fixed candidates permit safe disk retry and existing-wins tombstone does not revive', async () => {
    const { session, port, records } = build(); const draft = makeDraft(); session.updateDraft(draft); await session.generate(native(valid(false)), draft, intent());
    vi.mocked(port.putIfAbsent).mockRejectedValueOnce(new Error('磁盘写入失败'));
    expect(await session.save('characters')).toBe(false); expect(session.getSnapshot().saveError).toContain('完整原文');
    expect(await session.save('characters')).toBe(true); const card = [...records.values()][0]!; records.set(card.id, { ...card, deletedAt: '2026-10-10T00:00:00.000Z' });
    expect(await session.save('characters')).toBe(false); expect(session.getSnapshot().saveError).toContain('回收站'); expect(records.get(card.id)?.deletedAt).toBeTruthy(); session.dispose();
  });
  it('strict draft admission protects wrong enums and null view records without overwriting storage', () => {
    const repo = repository();
    for (const patch of [{ battleMode: ['classic'] }, { generationMode: ['stream'] }, { materials: [null] }, { auxScenarios: [null] }, { teams: [null] }, { combatants: [{ data: {}, type: 'general-character' }] }]) {
      const storage = memory(), raw = JSON.stringify({ version: 1, draft: { ...makeDraft(), ...patch } }); storage.values.set(ARENA_DRAFT_KEY, raw);
      const session = new DesktopArenaSession({ repository: repo.port, storage }); expect(session.getSnapshot().pendingRestore).toBe(false); expect(session.getSnapshot().draftError).toContain('旧草稿');
      session.updateDraft(makeDraft()); expect(storage.values.get(ARENA_DRAFT_KEY)).toBe(raw); session.dispose();
    }
    const storage = memory(), raw = JSON.stringify({ version: 1, draft: makeDraft(), output: { phase: ['completed'], rawText: '', markdown: '', reasoning: '' } }); storage.values.set(ARENA_DRAFT_KEY, raw);
    const session = new DesktopArenaSession({ repository: repo.port, storage }); expect(session.getSnapshot().draftError).toContain('旧草稿'); expect(storage.values.get(ARENA_DRAFT_KEY)).toBe(raw); session.dispose();
  });
  it('a delayed existing-wins lookup cannot publish success after scope changes', async () => {
    const { session, port } = build(); const value = makeDraft(); session.updateDraft(value); await session.generate(native(valid(false)), value, intent()); await session.save('history');
    let resolve!: (value: LocalCardRecordV1 | null) => void; let entered = false;
    vi.mocked(port.get).mockImplementationOnce(async () => { entered = true; return new Promise((done) => { resolve = done; }); });
    const pending = session.save('history'); await vi.waitFor(() => expect(entered).toBe(true)); session.setScope('replacement'); resolve(null);
    expect(await pending).toBe(false); expect(session.getSnapshot().saveStatus).toBe('idle'); expect(session.getSnapshot().saveError).toBeNull(); session.dispose();
  });
  it('bad draft is protected while memory work continues; explicit restore never replays generation or library effects', async () => {
    const { session, storage, port } = build(); const draft = makeDraft(); session.updateDraft(draft); await session.generate(native(valid(false)), draft, intent()); session.dispose();
    const restored = new DesktopArenaSession({ storage, repository: port }); restored.setScope('restored'); expect(restored.getSnapshot().pendingRestore).toBe(true); restored.restoreDraft();
    expect(restored.getSnapshot().rawText).toContain('新旅途'); expect(restored.getSnapshot().candidates).toBeNull(); expect(port.putIfAbsent).not.toHaveBeenCalled();
    expect(await restored.save('history')).toBe(true); restored.dispose();
    storage.values.set(ARENA_DRAFT_KEY, '{broken'); const broken = new DesktopArenaSession({ storage, repository: port }); broken.updateDraft(draft);
    expect(storage.values.get(ARENA_DRAFT_KEY)).toBe('{broken'); expect(broken.hasUnsavedDraft()).toBe(true); expect(broken.exportDocument()).toContain('源卡设定'); broken.dispose();
  });
  it.each(['direct-remote', undefined] as const)('restored history preserves known execution %s without inventing a default', async (executionMode) => {
    const { session, storage, port, records } = build(); const draft = makeDraft(); session.updateDraft(draft);
    await session.generate(native(valid(false)), draft, { ...intent(), mode: 'direct-remote' }); session.dispose();
    const stored = JSON.parse(storage.values.get(ARENA_DRAFT_KEY)!);
    if (executionMode === undefined) delete stored.output.executionMode;
    storage.values.set(ARENA_DRAFT_KEY, JSON.stringify(stored));
    const restored = new DesktopArenaSession({ storage, repository: port }); restored.setScope('restored'); restored.restoreDraft();
    expect(await restored.save('history')).toBe(true);
    const card = [...records.values()][0]!; expect(card.provenance.kind).toBe('unsigned');
    if (executionMode) expect(card.provenance).toMatchObject({ execution: executionMode });
    else expect(card.provenance).not.toHaveProperty('execution');
    restored.dispose();
  });
  it('successful near-output-limit report can exceed storage envelope, remains complete and exportable', async () => {
    const { session, records } = build(); const draft = makeDraft('daily', 'stream'); session.updateDraft(draft);
    // Less than the 4 MiB decoded output budget, but pretty-printed history enclosure exceeds its separate 4 MiB bound.
    const body = 'x'.repeat(MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES - 160); await session.generate(native(body), draft, intent('stream'));
    expect(session.getSnapshot().phase).toBe('completed'); expect(session.getSnapshot().rawText).toBe(body);
    expect(await session.save('history')).toBe(false); expect(records.size).toBe(0); expect(session.getSnapshot().saveError).toContain('4 MiB');
    expect(JSON.parse(session.exportDocument()).result.rawText).toBe(body); expect(session.getSnapshot().draftSaved).toBe(false); session.dispose();
  });
  it('actual serialized history envelopes accept 4 MiB and reject 4 MiB + 1 with no truncation', async () => {
    for (const delta of [0, 1]) {
      const { session, records } = build(); const draft = makeDraft('daily', 'stream'); session.updateDraft(draft); await session.generate(native('hello'), draft, intent('stream'));
      await session.save('history'); const saved = [...records.values()].find((item) => item.cardType === 'history')!;
      const base = localLibraryRecordBytes(saved).byteLength; records.clear();
      const current = session.getSnapshot().draft; session.updateDraft({ ...current, narrativeHistoryEntries: current.narrativeHistoryEntries.map((entry) => ({ ...entry, content: entry.content + 'x'.repeat(MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES - base + delta) })) });
      expect(await session.save('history')).toBe(delta === 0); expect(records.size).toBe(delta === 0 ? 1 : 0);
      if (delta === 0) expect(localLibraryRecordBytes([...records.values()][0]!).byteLength).toBe(MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES);
      session.dispose();
    }
  });
});
