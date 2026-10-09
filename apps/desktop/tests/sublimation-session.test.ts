import { describe, expect, it, vi } from 'vitest';
import type { AiExecutionRequest } from '@mahoshojo/contracts/ai-execution';
import type { AiStreamEvent } from '@mahoshojo/ai-core/stream-events';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import { SublimationSession, SUBLIMATION_DRAFT_KEY, buildSublimationInput, createInitialSublimationDraft, type SublimationDraft } from '../src/features/sublimation/session';
import { STREAM_DIRECT_AI_COMMAND, CANCEL_DIRECT_AI_COMMAND } from '../src/platform/direct-ai-bridge';
import { HOSTED_AI_REQUEST_COMMAND } from '../src/platform/cloud-bridge';

const source = { templateId: '通用角色', name: '源角色', content: '完整原稿', _custom: { value: '保留' } };
const draft = (): SublimationDraft => ({ ...createInitialSublimationDraft(), originalData: structuredClone(source), writeArenaHistory: false, writeCurrentState: false });
const card = { ...source, name: '升华角色', content: '新的完整设定', _nested: { value: [1, 2] } };
const storage = () => {
  const map = new Map<string, string>();
  return { map, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value), removeItem: (key: string) => void map.delete(key) };
};
const repository = () => {
  const records = new Map<string, LocalCardRecordV1>();
  const putIfAbsent = vi.fn(async (record: LocalCardRecordV1) => {
    if (records.has(record.id)) return { alreadyPresent: true };
    records.set(record.id, record); return { written: true };
  });
  const get = vi.fn(async (id: string) => records.get(id) ?? null);
  const restore = vi.fn();
  return { records, putIfAbsent, get, restore, port: { putIfAbsent, get, restore } as unknown as CardRepository };
};
const direct = () => {
  const text = JSON.stringify({ updatedCharacterData: { name: card.name, content: card.content }, sublimationEvent: { title: '成长', impact: '变得勇敢' } });
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    expect(command).toBe(STREAM_DIRECT_AI_COMMAND);
    const request = args!.request as AiExecutionRequest;
    const channel = args!.onEvent as { onmessage: (event: AiStreamEvent) => void };
    const identity = { requestId: request.requestId, contractVersion: 1 as const, mode: request.mode };
    channel.onmessage({ ...identity, sequence: 0, type: 'started' });
    channel.onmessage({ ...identity, sequence: 1, type: 'text-delta', delta: text });
    channel.onmessage({ ...identity, sequence: 2, type: 'result', result: { ...identity, status: 'completed', finishReason: 'stop', output: { text } } });
  });
  return { invoke, profileId: 'profile-test', createChannel: () => ({}) };
};
const hosted = (signed = true) => ({
  invoke: vi.fn(async (command: string) => {
    expect(command).toBe(HOSTED_AI_REQUEST_COMMAND);
    return { status: 200, body: { data: { sublimatedData: { ...card, ...(signed ? { signature: ' official-sig ' } : {}) }, targetTemplate: 'general', unchangedFields: [] }, aiMeta: null } };
  }), profileId: '',
});

it('draft builder combines a retained selected-history snapshot with manual input only once', () => {
  const value = { ...draft(), selectedHistoryReference: '选中叙事原文', narrativeHistory: '手动补充', sourceLabel: '角色.json' };
  const input = buildSublimationInput(value);
  expect(input.narrativeHistory).toBe('选中叙事原文\n\n手动补充');
  expect(input).not.toHaveProperty('sourceLabel');
  expect(input).not.toHaveProperty('selectedHistoryReference');
  expect(value.selectedHistoryReference).toBe('选中叙事原文');
});

describe('Sublimation generic session journey with real executor and fake IPC', () => {
  it('edit → generate → save → restore → re-save retains original draft and unsigned execution evidence', async () => {
    const store = storage(); const repo = repository(); const options = direct();
    const session = new SublimationSession({ storage: store, repository: repo.port, initialDraft: createInitialSublimationDraft(), requestId: () => 'journey-1' });
    const value = { ...draft(), selectedHistoryReference: '选中历史', sourceLabel: '角色.json', userGuidance: '成长' };
    session.updateDraft(value);
    await session.generate(options, buildSublimationInput(value), { mode: 'direct-local' });
    expect(session.getSnapshot()).toMatchObject({ phase: 'completed', cardKind: 'general', draft: value });
    expect(session.resultSignatureKind()).toBe('unsigned');
    expect(session.hasUnsavedResult()).toBe(true);
    expect(await session.saveResult()).toBe(true);
    expect(repo.records.size).toBe(1);
    expect([...repo.records.values()][0]).toMatchObject({ cardType: 'character', title: '升华角色', provenance: { kind: 'unsigned', execution: 'direct-local' } });
    expect(session.hasUnsavedResult()).toBe(false);
    const restored = new SublimationSession({ storage: store, repository: repo.port, initialDraft: createInitialSublimationDraft() });
    expect(restored.getSnapshot().pendingRestore).toBe(true);
    expect(restored.getSnapshot().card).toBeNull();
    restored.restoreDraft();
    expect(restored.getSnapshot()).toMatchObject({ phase: 'completed', resultRestored: true, draft: value });
    expect(await restored.saveResult()).toBe(true);
    expect(restored.getSnapshot().saveStatus).toBe('already-present');
    expect(options.invoke).toHaveBeenCalledTimes(1);
    expect(repo.records.size).toBe(1);
  });

  it('fresh hosted signature stays exact, restored hosted signature becomes unverified', async () => {
    const store = storage(); const repo = repository(); const options = hosted();
    const session = new SublimationSession({ storage: store, repository: repo.port, initialDraft: draft(), requestId: () => 'signed-1' });
    await session.generate(options, buildSublimationInput(draft()), { mode: 'hosted-json' });
    expect(session.resultSignatureKind()).toBe('official-signed');
    const freshCard = structuredClone(session.getSnapshot().card);
    expect(await session.saveResult()).toBe(true);
    expect([...repo.records.values()][0]).toMatchObject({ data: freshCard, provenance: { kind: 'official-signed', signature: ' official-sig ', execution: 'hosted' } });
    const restoredRepo = repository();
    const restored = new SublimationSession({ storage: store, repository: restoredRepo.port, initialDraft: draft() });
    restored.restoreDraft();
    expect(restored.resultSignatureKind()).toBe('signature-unverified');
    expect(restored.getSnapshot().card).toEqual(freshCard);
    expect(await restored.saveResult()).toBe(true);
    expect([...restoredRepo.records.values()][0]).toMatchObject({ data: freshCard, provenance: { kind: 'signature-unverified', signature: ' official-sig ' } });
  });

  it('unsigned hosted response stays unsigned', async () => {
    const repo = repository(); const session = new SublimationSession({ storage: storage(), repository: repo.port, initialDraft: draft() });
    await session.generate(hosted(false), buildSublimationInput(draft()), { mode: 'hosted-json' });
    expect(session.resultSignatureKind()).toBe('unsigned');
    expect(await session.saveResult()).toBe(true);
    expect([...repo.records.values()][0].provenance).toEqual({ kind: 'unsigned', execution: 'hosted' });
  });

  it('restore strips forged direct signatures without rewriting unknown body fields', async () => {
    const store = storage(); const repo = repository();
    store.setItem(SUBLIMATION_DRAFT_KEY, JSON.stringify({ version: 1, ...draft(), output: { mode: 'direct-remote', phase: 'completed', cardKind: 'general', rawText: 'raw', card: { ...card, signature: 'forged', metadata: { signature: 'forged-nested', author: 'keep' } } } }));
    const session = new SublimationSession({ storage: store, repository: repo.port, initialDraft: draft() });
    session.restoreDraft();
    expect(session.getSnapshot().card).toEqual({ ...card, metadata: { author: 'keep' } });
    expect(await session.saveResult()).toBe(true);
    expect([...repo.records.values()][0].provenance).toEqual({ kind: 'unsigned', execution: 'direct-remote' });
  });

  it('bad draft is protected while new work continues in memory; discard is explicit', async () => {
    const store = storage(); const repo = repository(); const original = '{broken-old-draft';
    store.setItem(SUBLIMATION_DRAFT_KEY, original);
    const session = new SublimationSession({ storage: store, repository: repo.port, initialDraft: createInitialSublimationDraft() });
    expect(session.isDraftBlocked()).toBe(true);
    session.updateDraft(draft());
    await session.generate(direct(), buildSublimationInput(draft()), { mode: 'direct-local' });
    expect(session.getSnapshot().phase).toBe('completed');
    expect(store.getItem(SUBLIMATION_DRAFT_KEY)).toBe(original);
    expect(await session.saveResult()).toBe(true);
    session.discardDraft();
    expect(store.getItem(SUBLIMATION_DRAFT_KEY)).toBeNull();
    expect(session.isDraftBlocked()).toBe(false);
  });

  it('non-empty draft requires restore; empty preference residue restores silently', async () => {
    const store = storage(); const repo = repository(); const options = direct();
    store.setItem(SUBLIMATION_DRAFT_KEY, JSON.stringify({ version: 1, ...draft() }));
    const pending = new SublimationSession({ storage: store, repository: repo.port, initialDraft: createInitialSublimationDraft() });
    pending.updateDraft({ ...draft(), userGuidance: '不应覆盖' });
    await pending.generate(options, buildSublimationInput(draft()), { mode: 'direct-local' });
    expect(options.invoke).not.toHaveBeenCalled();
    expect(JSON.parse(store.getItem(SUBLIMATION_DRAFT_KEY)!).userGuidance).toBe('');
    store.setItem(SUBLIMATION_DRAFT_KEY, JSON.stringify({ version: 1, ...createInitialSublimationDraft(), generationMode: 'stream', selectedLanguage: 'en', isAdvancedVisible: true }));
    const residue = new SublimationSession({ storage: store, repository: repo.port, initialDraft: createInitialSublimationDraft() });
    expect(residue.getSnapshot()).toMatchObject({ pendingRestore: false, message: null, draft: { generationMode: 'stream', selectedLanguage: 'en', isAdvancedVisible: true } });
  });

  it('save failure retries without generation and tombstone never masquerades as active copy', async () => {
    const store = storage(); const repo = repository(); const options = direct();
    repo.putIfAbsent.mockRejectedValueOnce(new Error('disk full'));
    const session = new SublimationSession({ storage: store, repository: repo.port, initialDraft: draft() });
    await session.generate(options, buildSublimationInput(draft()), { mode: 'direct-local' });
    const result = structuredClone(session.getSnapshot().card);
    expect(await session.saveResult()).toBe(false);
    expect(session.getSnapshot().card).toEqual(result);
    expect(await session.saveResult()).toBe(true);
    const existing = [...repo.records.values()][0];
    repo.records.set(existing.id, { ...existing, deletedAt: existing.updatedAt });
    expect(await session.saveResult()).toBe(false);
    expect(session.getSnapshot().saveError).toContain('回收站');
    expect(session.getSnapshot().card).toEqual(result);
    expect(repo.restore).not.toHaveBeenCalled();
    expect(options.invoke).toHaveBeenCalledTimes(1);
  });

  it('duplicate submit and unsaved-result replacement require the existing generic gates', async () => {
    const repo = repository(); const options = hosted();
    let release: (() => void) | undefined;
    options.invoke.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return { status: 200, body: { data: { sublimatedData: { ...card, signature: 'sig' }, targetTemplate: 'general', unchangedFields: [] }, aiMeta: null } };
    });
    const session = new SublimationSession({ storage: storage(), repository: repo.port, initialDraft: draft() });
    const pending = session.generate(options, buildSublimationInput(draft()), { mode: 'hosted-json' });
    await session.generate(options, buildSublimationInput(draft()), { mode: 'hosted-json' });
    expect(options.invoke).toHaveBeenCalledTimes(1);
    release!(); await pending;
    await session.generate(options, buildSublimationInput(draft()), { mode: 'hosted-json' });
    expect(options.invoke).toHaveBeenCalledTimes(1);
    await session.generate(options, buildSublimationInput(draft()), { mode: 'hosted-json' }, true);
    expect(options.invoke).toHaveBeenCalledTimes(2);
  });

  it('cancel preserves consumed stream text, sends exactly one native cancel, and discards late completion', async () => {
    let release: (() => void) | undefined;
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === CANCEL_DIRECT_AI_COMMAND) { release?.(); return true; }
      const request = args!.request as AiExecutionRequest;
      const channel = args!.onEvent as { onmessage: (event: AiStreamEvent) => void };
      const identity = { requestId: request.requestId, contractVersion: 1 as const, mode: request.mode };
      channel.onmessage({ ...identity, sequence: 0, type: 'started' });
      channel.onmessage({ ...identity, sequence: 1, type: 'text-delta', delta: '# 部分正文' });
      await new Promise<void>((resolve) => { release = resolve; });
      channel.onmessage({ ...identity, sequence: 2, type: 'result', result: { ...identity, status: 'completed', finishReason: 'stop', output: { text: '# 迟到结果' } } });
    });
    const session = new SublimationSession({ storage: storage(), repository: repository().port, initialDraft: draft(), requestId: () => 'cancel-1' });
    const pending = session.generate({ invoke, profileId: 'p', createChannel: () => ({}) }, buildSublimationInput(draft()), { mode: 'direct-local', generationMode: 'stream' });
    await vi.waitFor(() => expect(session.getSnapshot().rawText).toBe('# 部分正文'));
    session.cancel(); session.cancel(); await pending;
    expect(session.getSnapshot()).toMatchObject({ phase: 'cancelled', rawText: '# 部分正文', card: null });
    expect(invoke.mock.calls.filter(([command]) => command === CANCEL_DIRECT_AI_COMMAND)).toHaveLength(1);
  });

  it('uncertain hosted operation persists without replay after restore', async () => {
    const store = storage(); const options = { invoke: vi.fn(async () => { throw new Error('network lost'); }), profileId: '' };
    const session = new SublimationSession({ storage: store, repository: repository().port, initialDraft: draft() });
    await session.generate(options, buildSublimationInput(draft()), { mode: 'hosted-json' });
    expect(session.getSnapshot().phase).toBe('uncertain');
    const restored = new SublimationSession({ storage: store, repository: repository().port, initialDraft: draft() });
    restored.restoreDraft();
    expect(restored.getSnapshot().phase).toBe('uncertain');
    expect(restored.getSnapshot().message).toContain('不会自动重新生成');
    expect(options.invoke).toHaveBeenCalledTimes(1);
  });
});
