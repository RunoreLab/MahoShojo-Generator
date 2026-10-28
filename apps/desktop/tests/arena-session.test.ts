import { requireArenaRealCombatants } from '../src/features/arena/roster-types';
import { projectDesktopArenaReport } from '../src/features/arena/report-presentation';
import { withFixtureStreamReceipt } from './helpers/stream-receipt-fixture';
import { describe, expect, it, vi } from 'vitest';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import type { AiExecutionRequest } from '@mahoshojo/contracts/ai-execution';
import type { AiStreamEvent } from '@mahoshojo/ai-core/stream-events';
import { MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES } from '@mahoshojo/contracts/desktop-ipc';
import { BUILTIN_ARENA_NEWS_PACKAGE_REF, resolveWebPackage } from '@mahoshojo/web-package';
import { localLibraryRecordBytes } from '@mahoshojo/local-library/archive-export';
import { ARENA_DRAFT_KEY, DesktopArenaSession, createInitialArenaDraft, type ArenaDraft } from '../src/features/arena/session';
import { addAdvancedAuxScenario, addAdvancedCombatants, addAdvancedLore, importAdvancedHistory, setAdvancedMainScenario } from '../src/features/arena/advanced-input';
import { readSublimationHistorySource } from '../src/features/sublimation/history-source';

const memory = () => {
  const values = new Map<string, string>();
  return { values, get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
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
  const invoke = vi.fn(withFixtureStreamReceipt(async (command: string, args?: Record<string, unknown>) => {
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
  }));
  return { invoke, profileId: 'loopback-profile', createChannel: () => ({}) };
};
const build = () => { const repo = repository(), storage = memory(); const session = new DesktopArenaSession({ repository: repo.port, storage, requestId: () => 'arena-fixed', now: () => '2026-10-09T23:00:00.000Z' }); session.setScope('account-A:target-A'); session.setNarrativeDraftScope('account:A'); session.narrativeDrafts.setAutoRetain(true); return { session, storage, ...repo }; };

describe('未完成草稿保留与已有会话存储', () => {
  it.each(['stream', 'non-stream'] as const)('%s 重开保留展示元数据而不恢复执行或角色写入权限', async mode => {
    const f = build(), base = makeDraft('daily', mode);
    const source = { ...base, settings: { ...base.settings, userGuidance: '原任务引导' },
      combatants: base.combatants.map((item, index) => index === 0 ? { ...item, characterGuidance: '勇敢前进' } : item) };
    f.session.updateDraft(source);
    await f.session.generate(native(valid(mode === 'stream')), source, intent(mode));
    const original = projectDesktopArenaReport(f.session.getSnapshot());
    expect(original).toMatchObject({ mode: 'daily', aiModel: 'fixture', userGuidance: '原任务引导', reporterInfo: { name: '记者' } });
    const saved = JSON.parse(f.storage.getItem(ARENA_DRAFT_KEY)!);
    expect(saved.output.presentation).toMatchObject({ version: 1, aiModel: 'fixture', userGuidance: '原任务引导' });
    expect(saved.output.presentation).not.toHaveProperty('content');
    f.session.dispose();
    const reopened = new DesktopArenaSession({ repository: f.port, storage: f.storage });
    reopened.setScope('different-account-and-model'); reopened.restoreDraft();
    reopened.updateDraft({ ...source, battleMode: 'classic', settings: { ...source.settings, userGuidance: '新草稿' } });
    const state = reopened.getSnapshot(), projected = projectDesktopArenaReport(state);
    expect(projected).toMatchObject({ mode: 'daily', aiModel: 'fixture', userGuidance: '原任务引导', reporterInfo: original.reporterInfo, characterGuidances: original.characterGuidances });
    expect(state.generation).toBeNull(); expect(state.candidates).toBeNull();
    expect(JSON.parse(reopened.exportDocument()).result.presentation).toMatchObject({ version: 1, aiModel: 'fixture' });
    reopened.discardDraft(); expect(reopened.getSnapshot().presentation).toBeNull(); reopened.dispose();
  });

  it('自动写入关闭时只有显式保存，并可重新打开独立归档', async () => {
    const f = build(), base = makeDraft('daily', 'stream');
    f.session.narrativeDrafts.setAutoRetain(false);
    const source: ArenaDraft = { ...base, settings: { ...base.settings, writeNarrativeHistory: false } };
    f.session.updateDraft(source); await f.session.generate(native(valid(true), 'length'), source, intent('stream'));
    expect(f.session.getSnapshot().narrativeDraftStatus).toBe('available'); expect(f.session.getSnapshot().draft.narrativeDrafts).toBeUndefined();
    expect(f.session.saveNarrativeDraft()).toBe(true); expect(f.session.saveNarrativeDraft()).toBe(true);
    expect(f.session.getSnapshot().draft.narrativeDrafts).toHaveLength(1); expect(f.session.getSnapshot().draft.narrativeHistoryEntries).toEqual([]);
    const archive = JSON.parse(f.session.exportNarrativeDrafts()); expect(archive.kind).toBe('arena-narrative-draft-archive');
    expect(archive).not.toHaveProperty('entries'); expect(JSON.stringify(archive)).not.toContain('独立思考');
    f.session.dispose(); const reopened = new DesktopArenaSession({ repository: f.port, storage: f.storage }); reopened.setNarrativeDraftScope('account:A'); reopened.restoreDraft();
    expect(reopened.getSnapshot().draft.narrativeDrafts).toEqual(archive.drafts); reopened.dispose();
  });
  it('quota写入失败保留旧磁盘、内存导出，并只在真实重试成功后显示已保存', async () => {
    const f = build(), source = makeDraft('daily', 'stream'); f.session.updateDraft(source);
    const previous = f.storage.values.get(ARENA_DRAFT_KEY), setItem = f.storage.setItem;
    f.storage.setItem = () => { throw new Error('quota'); };
    await f.session.generate(native(valid(true), 'length'), source, intent('stream'));
    expect(f.session.getSnapshot().narrativeDraftStatus).toBe('memory-only'); expect(f.storage.values.get(ARENA_DRAFT_KEY)).toBe(previous);
    expect(JSON.parse(f.session.exportNarrativeDrafts()).drafts).toHaveLength(1);
    f.storage.setItem = setItem; f.session.retryDraftSave(); f.session.saveNarrativeDraft(); expect(f.session.getSnapshot().narrativeDraftStatus).toBe('stored'); f.session.dispose();
  });
  it('损坏的旧草稿不被失败归档覆盖', async () => {
    const saved = memory(), repo = repository(); saved.values.set(ARENA_DRAFT_KEY, '{broken');
    const session = new DesktopArenaSession({ repository: repo.port, storage: saved, requestId: () => 'new-request' }); session.setScope('A'); session.setNarrativeDraftScope('account:A'); session.narrativeDrafts.setAutoRetain(true);
    const source = makeDraft('daily', 'stream'); session.updateDraft(source);
    await session.generate(native(valid(true), 'length'), source, intent('stream'));
    expect(saved.values.get(ARENA_DRAFT_KEY)).toBe('{broken'); expect(session.getSnapshot().narrativeDraftStatus).toBe('stored');
    expect(JSON.parse(session.exportNarrativeDrafts()).drafts).toHaveLength(1); session.dispose();
  });
  it('页面草稿与独立叙事归档分别限额，正文不重复嵌入页面草稿', async () => {
    const f = build(), source = makeDraft('daily', 'stream'); f.session.updateDraft(source);
    const text = 'x'.repeat(1_450_000); await f.session.generate(native(text, 'length'), source, intent('stream'));
    expect(f.session.getSnapshot().narrativeDraftStatus).toBe('stored'); expect(f.session.getSnapshot().draftError).toBeNull();
    expect(JSON.parse(f.session.exportNarrativeDrafts()).drafts[0].markdown).toBe(text);
    expect(JSON.parse(f.storage.values.get(ARENA_DRAFT_KEY)!).draft.narrativeDrafts).toBeUndefined(); f.session.dispose();
  });
  it('成功请求屏障跨重新打开生效，不把晚到失败复活为草稿', async () => {
    const f = build(), base = makeDraft('daily', 'stream');
    const source: ArenaDraft = { ...base, settings: { ...base.settings, writeNarrativeHistory: false } };
    f.session.updateDraft(source); await f.session.generate(native(valid(true)), source, intent('stream')); f.session.dispose();
    const reopened = new DesktopArenaSession({ repository: f.port, storage: f.storage, requestId: () => 'arena-fixed' });
    reopened.setNarrativeDraftScope('account:A'); reopened.restoreDraft(); reopened.setScope('A');
    await reopened.generate(native(valid(true), 'length'), reopened.getSnapshot().draft, intent('stream'));
    expect(reopened.getSnapshot().narrativeDraftCandidate).toBeNull(); expect(reopened.getSnapshot().draft.narrativeDrafts).toBeUndefined(); reopened.dispose();
  });
  it('失败草稿从不进入下一次请求或角色更新，正常成功清除同request草稿', async () => {
    const f = build(), source = makeDraft('daily', 'stream'); f.session.updateDraft(source);
    await f.session.generate(native('FAILED-DRAFT-BODY', 'length'), source, intent('stream'));
    const next = native(valid(true)); await f.session.generate(next, f.session.getSnapshot().draft, intent('stream'));
    const sent = next.invoke.mock.calls.find(([command]) => command.startsWith('stream_'))?.[1]?.request as AiExecutionRequest;
    expect(sent.arenaInputJson).not.toContain('FAILED-DRAFT-BODY'); expect(JSON.stringify(sent.messages)).not.toContain('FAILED-DRAFT-BODY');
    expect(f.session.getSnapshot().draft.narrativeDrafts ?? []).toEqual([]); expect(f.session.getSnapshot().draft.narrativeHistoryEntries).toHaveLength(1); f.session.dispose();
  });
  it('同request冲突保旧正文，不能因旧id存在而谎报新候选已存', async () => {
    const f = build(), source = makeDraft('daily', 'stream'); f.session.updateDraft(source);
    await f.session.generate(native('原失败正文', 'length'), source, intent('stream'));
    await f.session.generate(native('不同而且更长的失败正文', 'length'), f.session.getSnapshot().draft, intent('stream'));
    expect(f.session.getSnapshot().draft.narrativeDrafts?.[0]?.markdown).toBe('原失败正文');
    expect(f.session.getSnapshot().narrativeDraftStatus).toBe('memory-only'); expect(f.session.saveNarrativeDraft()).toBe(false);
    expect(f.session.narrativeDrafts.getState().drafts[0].markdown).toBe('原失败正文'); f.session.dispose();
  });
});

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
      expect(requireArenaRealCombatants(session.getSnapshot().draft.combatants)[0]!.data).not.toHaveProperty('signature');
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
    const draft: ArenaDraft = { ...base, combatants: requireArenaRealCombatants(base.combatants).map((item, index) => ({ ...item, data: { ...item.data, ...(index === 0 ? { adjudicationEvents: [{ type: 'binary', description: '角色判定', probability: 0 }] } : {}) } })),
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
    expect(session.getSnapshot().candidates).toBeNull();
    const { narrativeDrafts, ...unchanged } = session.getSnapshot().draft;
    expect(unchanged).toEqual(draft); expect(narrativeDrafts).toHaveLength(1);
    expect(narrativeDrafts?.[0]?.completion.kind).toBe(finish === 'EOF' ? 'missing-terminal' : 'trusted-length');
    expect(records.size).toBe(0); session.dispose();
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
  it.each(['idle', 'completed', 'failed', 'cancelled'] as const)('exports the pending %s draft before restoration without changing storage or granting authority', phase => {
    const storage = memory(), repo = repository(), draft = makeDraft();
    const output = { phase, rawText: '完整原始响应', markdown: '# 已保存的正文', reasoning: '完整思考', executionMode: 'hosted', generationMode: 'non-stream', hosted: null, hostedGenerationId: null, extraMetadata: { retained: true } };
    const raw = JSON.stringify({ version: 1, draft, output }); storage.values.set(ARENA_DRAFT_KEY, raw);
    const session = new DesktopArenaSession({ storage, repository: repo.port });
    const exported = JSON.parse(session.exportDocument());
    expect(exported.draft).toEqual(draft); expect(exported.result).toMatchObject(output);
    expect(exported.generation).toBeNull(); expect(exported.candidates).toBeNull();
    expect(exported).not.toHaveProperty('protectedLocalDraft');
    expect(session.getSnapshot().pendingRestore).toBe(true); expect(storage.getItem(ARENA_DRAFT_KEY)).toBe(raw);
    session.restoreDraft(); expect(session.isBusy()).toBe(false); expect(session.getSnapshot().phase).toBe(phase);
    expect(JSON.parse(session.exportDocument()).result).toMatchObject({ phase, rawText: output.rawText, markdown: output.markdown, reasoning: output.reasoning });
    expect(repo.port.putIfAbsent).not.toHaveBeenCalled(); expect(storage.getItem(ARENA_DRAFT_KEY)).toBe(raw); session.dispose();
  });
  it('exports a protected unreadable local draft intact alongside new in-memory work', () => {
    const storage = memory(), repo = repository(), raw = '{unreadable old draft'; storage.values.set(ARENA_DRAFT_KEY, raw);
    const session = new DesktopArenaSession({ storage, repository: repo.port }); session.restoreDraft(); session.updateDraft(makeDraft());
    const exported = JSON.parse(session.exportDocument());
    expect(exported.protectedLocalDraft).toEqual({ format: 'arena-local-draft-raw', raw });
    expect(exported.draft.combatants).toHaveLength(2); expect(storage.getItem(ARENA_DRAFT_KEY)).toBe(raw);
    expect(repo.port.putIfAbsent).not.toHaveBeenCalled(); session.dispose();
  });
  it('bad draft is protected while memory work continues; explicit restore never replays generation or library effects', async () => {
    const { session, storage, port } = build(); const draft = makeDraft(); session.updateDraft(draft); await session.generate(native(valid(false)), draft, intent()); session.dispose();
    const restored = new DesktopArenaSession({ storage, repository: port }); restored.setScope('restored'); expect(restored.getSnapshot().pendingRestore).toBe(true); restored.restoreDraft();
    expect(restored.getSnapshot().rawText).toContain('新旅途'); expect(restored.getSnapshot().candidates).toBeNull(); expect(port.putIfAbsent).not.toHaveBeenCalled();
    expect(await restored.save('history')).toBe(true); restored.dispose();
    storage.values.set(ARENA_DRAFT_KEY, '{broken'); const broken = new DesktopArenaSession({ storage, repository: port }); broken.updateDraft(draft);
    expect(storage.values.get(ARENA_DRAFT_KEY)).toBe('{broken'); expect(broken.hasUnsavedDraft()).toBe(true); expect(broken.exportDocument()).toContain('源卡设定'); broken.dispose();
  });
  it.each(['direct-remote', undefined] as const)('restored editable history does not attribute its whole collection to the last execution %s', async (executionMode) => {
    const { session, storage, port, records } = build(); const draft = makeDraft(); session.updateDraft(draft);
    await session.generate(native(valid(false)), draft, { ...intent(), mode: 'direct-remote' }); session.dispose();
    const stored = JSON.parse(storage.values.get(ARENA_DRAFT_KEY)!);
    if (executionMode === undefined) delete stored.output.executionMode;
    storage.values.set(ARENA_DRAFT_KEY, JSON.stringify(stored));
    const restored = new DesktopArenaSession({ storage, repository: port }); restored.setScope('restored'); restored.restoreDraft();
    expect(await restored.save('history')).toBe(true);
    const card = [...records.values()][0]!; expect(card.provenance.kind).toBe('unsigned');
    expect(card.provenance).not.toHaveProperty('execution');
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
  it('advanced freezes manual and role/main/auxiliary events once without reintroducing deleted sources', async () => {
    const repo = repository(), storage = memory(), random = vi.fn(() => 0);
    const session = new DesktopArenaSession({ repository: repo.port, storage, product: 'arena', random, requestId: () => 'advanced-roll', now: () => '2026-10-10T00:00:00Z' }); session.setScope('A');
    const event = (description: string) => ({ type: 'binary' as const, description, probability: 100 });
    const base = makeDraft('scenario', 'stream'); let draft: ArenaDraft = { ...base, combatants: [], adjudicationEvents: [event('手动')], historyUpdatedAt: '2000-01-01T00:00:00Z' };
    draft = addAdvancedCombatants(draft, requireArenaRealCombatants(base.combatants).map((item) => ({ ...item, data: { ...item.data, adjudicationEvents: [event(item.filename)] } })));
    draft = setAdvancedMainScenario(draft, { title: '主', adjudicationEvents: [event('主')] }, 'main');
    draft = addAdvancedAuxScenario(draft, { title: '辅', adjudicationEvents: [event('辅')] }, 'aux', 'aux');
    draft = { ...draft, adjudicationEvents: draft.adjudicationEvents.filter((item) => (item as { description: string }).description !== '甲.json') };
    draft = addAdvancedLore(draft, { source: 'upload', questionnaire: { id: 'lore', title: 'Lore', kind: 'magical-girl', questions: [], loreMarkdown: '参考设定' } }, () => 'lore');
    session.updateDraft(draft); let release!: () => void; const wait = new Promise<void>((resolve) => { release = resolve; }); const options = native(valid(true), 'stop', wait);
    const run = session.generate(options, draft, intent('stream')); await session.generate(options, draft, intent('stream'));
    await vi.waitFor(() => expect(session.getSnapshot().rawText).not.toBe('')); expect(random).toHaveBeenCalledTimes(4);
    expect(session.getSnapshot().generation?.adjudicationResults.map((item) => item.description)).toEqual(['手动', '乙.json', '主', '辅']);
    release(); await run; expect(session.getSnapshot().phase).toBe('completed'); expect(session.getSnapshot().draft.historyUpdatedAt).toBe('2026-10-10T00:00:00Z');
    await session.save('history'); await session.save('characters'); expect(random).toHaveBeenCalledTimes(4);
    const history = [...repo.records.values()].find((record) => record.cardType === 'history')!; expect(history.provenance).toEqual({ kind: 'unsigned' });
    expect([...repo.records.values()].find((record) => record.cardType === 'character')?.provenance).toEqual({ kind: 'unsigned', execution: 'direct-local' }); session.dispose();
  });
  it('advanced raw import can exceed draft persistence without truncation or source-library writes', async () => {
    const repo = repository(), storage = memory(); const session = new DesktopArenaSession({ repository: repo.port, storage, product: 'arena' }); session.setScope('A');
    session.updateDraft(createInitialArenaDraft()); const originalDraft = [...storage.values.values()][0];
    const raw = JSON.stringify({ entries: [{ id: 'original-id', content: '正文' }], unknown: 'x'.repeat(4 * 1024 * 1024) });
    await session.importInput(async () => (draft) => importAdvancedHistory(draft, raw, 'append', { name: 'raw.json', now: '2026-10-10T00:00:00Z', createId: () => 'raw' }));
    expect(session.getSnapshot().draftSaved).toBe(false); expect(session.getSnapshot().draftError).toContain('4 MiB'); expect([...storage.values.values()][0]).toBe(originalDraft);
    expect(JSON.parse(session.exportDocument()).draft.historyOriginals[0].text).toBe(raw); expect(repo.records.size).toBe(0);
    expect(await session.save('history')).toBe(true); expect(repo.records.size).toBe(1); session.dispose();
  });

});


it.each(['stream', 'non-stream'] as const)('keeps a %s package fallback and opted-in body history without applying role effects', async (generationMode) => {
  const storage = memory(), { port, records } = repository();
  const base = await resolveWebPackage(BUILTIN_ARENA_NEWS_PACKAGE_REF);
  const initial = makeDraft('daily', generationMode);
  const draft = { ...initial, reportFormat: 'web' as const, webPackageRef: base.ref,
    settings: { ...initial.settings, writeArenaHistory: true, writeCurrentState: true, writeNarrativeHistory: true } };
  const source = '<!doctype html><html><body>可体验的原始故事</body></html>';
  const session = new DesktopArenaSession({ repository: port, storage, resolveWebPackage: async () => base }); session.setScope('one'); session.updateDraft(draft);
  await session.generate(native(source), draft, intent(generationMode));
  expect(session.getSnapshot()).toMatchObject({ phase: 'completed', rawText: source, markdown: source,
    report: { headline: '', officialReport: { winner: '' } }, renderSnapshot: { reportFormat: 'web', webPackage: { packageRef: base.ref } } });
  expect(session.getSnapshot().draft.combatants).toEqual(draft.combatants); expect(session.getSnapshot().candidates?.characterEffects).toEqual([]);
  expect(session.getSnapshot().draft.narrativeHistoryEntries).toHaveLength(1); expect(session.getSnapshot().draft.narrativeHistoryEntries[0]?.content).toBe(source);
  expect(session.getSnapshot().message).toContain('可体验和导出');
  await session.save('characters'); expect(port.putIfAbsent).not.toHaveBeenCalled(); expect(await session.save('history')).toBe(true); expect(records.size).toBe(1); expect([...records.values()][0]?.cardType).toBe('history');
  expect(JSON.parse(session.exportDocument()).result.renderSnapshot.webPackage.packageRef).toEqual(base.ref); session.dispose();
});

it('keeps completed Web source and narrative history without inventing character effects or executable history', async () => {
  const storage = memory(), { port, records } = repository();
  const draft = { ...makeDraft(), reportFormat: 'web' as const };
  const original = structuredClone(draft.combatants), source = '<html><body><script>untrusted()</script>故事</body></html>';
  const session = new DesktopArenaSession({ repository: port, storage }); session.setScope('one'); session.updateDraft(draft);
  await session.generate(native(source), draft, intent());
  expect(session.getSnapshot()).toMatchObject({ phase: 'completed', resultFormat: 'web', renderSnapshot: { version: 1, reportFormat: 'web' } });
  expect(session.getSnapshot().candidates?.characterEffects).toEqual([]); expect(session.getSnapshot().draft.combatants).toEqual(original);
  expect(session.getSnapshot().draft.narrativeHistoryEntries[0]?.content).toBe(source);
  expect(records.size).toBe(0); expect(await session.save('history')).toBe(true);
  expect([...records.values()][0]?.cardType).toBe('history');
  const exportValue = JSON.parse(session.exportDocument()); expect(exportValue.result.renderSnapshot).toEqual({ version: 1, reportFormat: 'web' });
  session.updateDraft({ ...session.getSnapshot().draft, reportFormat: 'markdown' }); session.dispose();
  const restored = new DesktopArenaSession({ repository: port, storage }); restored.restoreDraft();
  expect(restored.getSnapshot().draft.reportFormat).toBe('markdown'); expect(restored.getSnapshot().resultFormat).toBe('web');
  expect(restored.getSnapshot().markdown).toBe(source); expect(restored.getSnapshot().candidates).toBeNull(); restored.dispose();
});

it.each([
  { reportFormat: ['web'] },
  { reportFormat: 'web', renderSnapshot: { version: 2, reportFormat: 'web' } },
  { reportFormat: 'markdown', renderSnapshot: { version: 1, reportFormat: 'web' } },
  { reportFormat: 'web', renderSnapshot: { version: 1, reportFormat: 'web', webPackage: { packageRef: 'fake' } } },
])('protects malformed Web result drafts without overwriting the original bytes: %j', (output) => {
  const storage = memory(), { port } = repository();
  const raw = JSON.stringify({ version: 1, draft: makeDraft(), output: { phase: 'completed', rawText: '<html>source', markdown: '<html>source', reasoning: '', ...output } });
  storage.setItem(ARENA_DRAFT_KEY, raw);
  const session = new DesktopArenaSession({ repository: port, storage });
  expect(session.getSnapshot().pendingRestore).toBe(false); expect(session.getSnapshot().draftError).toBeTruthy();
  session.updateDraft(makeDraft()); expect(storage.getItem(ARENA_DRAFT_KEY)).toBe(raw); expect(port.putIfAbsent).not.toHaveBeenCalled(); session.dispose();
});


describe('safe failure evidence survives Arena export and restore', () => {
  it('preserves the actual Direct failure category without a native message or stale prior failure', async () => {
    const f = build(), source = makeDraft('daily', 'stream'); f.session.updateDraft(source);
    await f.session.generate({ ...native(''), invoke: async () => { throw { code: 'missing-secret', message: 'private-key-canary' }; } }, source, intent('stream'));
    const failure = { source: 'client', stage: 'native-stream', code: 'missing-secret', terminalStatus: 'unconfirmed', outputChars: 0 };
    expect(f.session.getSnapshot().failureDiagnostic).toEqual(failure);
    expect(JSON.parse(f.session.exportDocument()).result.failureDiagnostic).toEqual(failure);
    expect(f.session.exportDocument()).not.toContain('private-key-canary'); f.session.dispose();
    const reopened = new DesktopArenaSession({ repository: f.port, storage: f.storage, requestId: () => 'new-request' });
    expect(JSON.parse(reopened.exportDocument()).result.failureDiagnostic).toEqual(failure);
    reopened.restoreDraft(); reopened.setScope('A');
    expect(reopened.getSnapshot().failureDiagnostic).toEqual(failure);
    await reopened.generate(native(valid(true)), reopened.getSnapshot().draft, intent('stream'));
    expect(reopened.getSnapshot().phase).toBe('completed');
    expect(JSON.parse(reopened.exportDocument()).result.failureDiagnostic).toBeNull(); reopened.dispose();
  });
  it.each(['length', 'content-filter', 'tool-calls', 'other'])('keeps %s evidence after reopening without promoting the partial report', async finishReason => {
    const f = build(), source = makeDraft('daily', 'stream'), text = '尚未确认完整的正文';
    f.session.updateDraft(source);
    await f.session.generate(native(text, finishReason), source, intent('stream'));
    const failure = { source: 'client', stage: 'output', code: 'incomplete-output', terminalStatus: 'completed', finishReason, outputChars: text.length };
    expect(f.session.getSnapshot()).toMatchObject({ phase: 'failed', rawText: text, candidates: null, failureDiagnostic: failure });
    expect(JSON.parse(f.session.exportDocument()).result.failureDiagnostic).toEqual(failure);
    expect(f.port.putIfAbsent).not.toHaveBeenCalled();
    f.session.dispose();
    const reopened = new DesktopArenaSession({ repository: f.port, storage: f.storage });
    reopened.restoreDraft();
    expect(reopened.getSnapshot()).toMatchObject({ rawText: text, candidates: null, failureDiagnostic: failure });
    expect(JSON.parse(reopened.exportDocument()).result.failureDiagnostic).toEqual(failure);
    reopened.dispose();
  });
});

describe('逐卡本地另存只从当前 owner 候选选择', () => {
  it('generation/index/reference 仅定位候选；克隆、旧 generation、换 scope 均不能写入', async () => {
    const f = build(), draft = makeDraft(); f.session.updateDraft(draft);
    await f.session.generate(native(valid(false)), draft, intent());
    const candidates = f.session.getSnapshot().candidates!, effect = candidates.characterEffects[0]!;
    const selected = { generationId: candidates.generationId, combatantIndex: effect.combatantIndex, data: effect.data };
    expect(f.session.canSaveCharacter(selected)).toBe(true);
    expect(await f.session.saveCharacter({ ...selected, generationId: 'old-generation' })).toBe(false);
    expect(await f.session.saveCharacter({ ...selected, data: structuredClone(selected.data) })).toBe(false);
    expect(await f.session.saveCharacter({ ...selected, combatantIndex: 999 })).toBe(false);
    expect(f.records.size).toBe(0);
    expect(await f.session.saveCharacter(selected)).toBe(true);
    expect(f.records.size).toBe(1);
    expect([...f.records.values()][0]!.data).toEqual(effect.data);
    expect([...f.records.values()][0]!.provenance).toMatchObject({ kind: 'unsigned' });
    expect(await f.session.saveCharacter(selected)).toBe(true); expect(f.records.size).toBe(1);
    f.session.setScope('other-account');
    expect(f.session.canSaveCharacter(selected)).toBe(false);
    expect(await f.session.saveCharacter(selected)).toBe(false); expect(f.records.size).toBe(1);
    f.session.dispose();
  });
  it('沿用回收站与完整文档大小保护；不通过单卡入口覆盖旧记录', async () => {
    const f = build(), draft = makeDraft(); f.session.updateDraft(draft);
    await f.session.generate(native(valid(false)), draft, intent());
    const candidates = f.session.getSnapshot().candidates!, effect = candidates.characterEffects[0]!;
    const selected = { generationId: candidates.generationId, combatantIndex: effect.combatantIndex, data: effect.data };
    expect(await f.session.saveCharacter(selected)).toBe(true);
    const saved = [...f.records.values()][0]!;
    f.records.set(saved.id, { ...saved, deletedAt: '2026-10-21T00:00:00Z' });
    expect(await f.session.saveCharacter(selected)).toBe(false);
    expect(f.session.getSnapshot().saveError).toContain('回收站');
    effect.data.oversizedFixture = '大'.repeat(4 * 1024 * 1024);
    expect(await f.session.saveCharacter(selected)).toBe(false);
    expect(f.session.getSnapshot().saveError).toContain('4 MiB'); expect(f.records.size).toBe(1);
    f.session.dispose();
  });
});
