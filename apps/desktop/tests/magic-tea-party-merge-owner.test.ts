import { describe, expect, it, vi } from 'vitest';
import type { TeaReadRequest, TeaSessionDocument, TeaWriteRequest, TeaWriteResponse } from '@mahoshojo/contracts/desktop-magic-tea-party';
import { DesktopTeaSession, type TeaMergePreview } from '../src/features/magic-tea-party/session';
import { createIpcTeaNativePort } from '../src/platform/magic-tea-party-native';

const source = { sessionId: 'child', instance: 'a'.repeat(32), expectedRevision: 3 };
const parent = { sessionId: 'parent', instance: 'b'.repeat(32), expectedRevision: 7 };
const preview = (): TeaMergePreview => ({ action: 'merge-preview', source: { ...source }, parent: { ...parent }, anchorMessageId: 'anchor', editedMessageId: 'edited',
  sourceTitle: '分支', parentTitle: '父会话', anchorPreview: '原选择', editedPreview: '新选择', replacedMessageCount: 4, copiedMessageCount: 2 });
const session = (id: string): TeaSessionDocument => ({ id, title: id, createdAt: 1, updatedAt: 1, roles: [], settings: { providerId: 'openai', modelId: 'm' }, draft: '',
  ...(id === 'child' ? { forkedFrom: { sessionId: 'parent', messageId: 'anchor', createdAt: 1 } } : {}) });
const setup = () => {
  const records = new Map([source, parent].map(target => [target.sessionId, { session: session(target.sessionId), instance: target.instance, revision: target.expectedRevision }]));
  let receipt: TeaWriteResponse['result'] | null = null; let mode: 'saved' | 'unknown-saved' | 'unknown-empty' | 'stale' = 'saved';
  let delayPreview: (() => Promise<void>) | undefined; let failLoad = false; let sequence = 0;
  const invoke = vi.fn(async (command: string, args: Record<string, unknown>): Promise<unknown> => {
    if (command === 'read_magic_tea_party') {
      const read = (args.request as TeaReadRequest).request;
      if (read.action === 'list') return { version: 1, result: { action: 'list', catalogRevision: 1, rows: [], nextCursor: null } };
      if (read.action === 'session') {
        if (failLoad) throw new Error('read unavailable');
        return { version: 1, result: { action: 'session', catalogRevision: 1, record: records.get(read.sessionId) ?? null } };
      }
      if (read.action === 'messages') return { version: 1, result: { action: 'messages', catalogRevision: 1, sessionId: read.sessionId, instance: read.instance,
        revision: read.expectedRevision, rows: [], nextCursor: null } };
      if (read.action === 'merge-preview') { await delayPreview?.(); return { version: 1, result: preview() }; }
      if (read.action === 'receipt') return { version: 1, result: { action: 'receipt', receipt: receipt && 'operationId' in receipt ? {
        operationId: receipt.operationId, digest: '0'.repeat(64), result: receipt,
      } : null } };
    }
    if (command === 'mutate_magic_tea_party') {
      const write = (args.request as TeaWriteRequest).request;
      if (write.action !== 'merge') throw new Error('Only merge writes expected');
      if (mode === 'stale') throw { code: 'tea-stale', message: 'Local tea storage did not complete; retain the input or unsaved result', writeEvidence: 'not-written' };
      if (mode === 'unknown-empty') throw new Error('uncertain delivery');
      receipt = { action: 'merge', operationId: write.operationId, sessionId: parent.sessionId, instance: parent.instance, revision: parent.expectedRevision + 1,
        source: { sessionId: source.sessionId, instance: source.instance, revision: source.expectedRevision } };
      records.get(parent.sessionId)!.revision = parent.expectedRevision + 1;
      if (mode === 'unknown-saved') throw new Error('reply lost after commit');
      return { version: 1, result: receipt };
    }
    throw new Error(`Unexpected ${command}`);
  });
  const owner = new DesktopTeaSession(createIpcTeaNativePort(invoke), () => `operation-${++sequence}`);
  return { owner, invoke, records, setMode: (value: typeof mode) => { mode = value; }, failLoad: () => { failLoad = true; },
    delayPreview: (fn: () => Promise<void>) => { delayPreview = fn; },
    writes: () => invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party').map(([, args]) => args.request as TeaWriteRequest) };
};
const review = async (h: ReturnType<typeof setup>) => { await h.owner.select('child'); expect(await h.owner.prepareMerge()).toBe(true); return h.owner.getSnapshot().mergePreview!; };

describe('Tea reviewed merge owner', () => {
  it('cancels without writing and blocks unreviewed or copied confirmation objects', async () => {
    const h = setup(); const selection = await review(h);
    expect(await h.owner.confirmMerge({ ...selection })).toBe(false);
    h.owner.cancelMerge(); expect(await h.owner.confirmMerge(selection)).toBe(false);
    expect(h.writes()).toEqual([]); expect(h.owner.getSnapshot().record?.session.id).toBe('child');
  });
  it('freezes the two reviewed targets and commits once without model dispatch', async () => {
    const h = setup(); const selection = await review(h);
    expect(Object.isFrozen(selection)).toBe(true); expect(Object.isFrozen(selection.parent)).toBe(true);
    h.owner.setInput('not accepted during review'); expect(h.owner.getSnapshot().input).toBe('');
    const results = await Promise.all([h.owner.confirmMerge(selection), h.owner.confirmMerge(selection)]);
    expect(results).toEqual([true, false]); expect(h.writes()).toHaveLength(1);
    expect(h.writes()[0]!.request).toEqual({ action: 'merge', operationId: 'operation-1', source, parent, anchorMessageId: 'anchor', editedMessageId: 'edited' });
    expect(h.owner.getSnapshot()).toMatchObject({ mergePreview: null, pending: 'none', record: { session: { id: 'parent' }, revision: 8 } });
    expect(h.records.get('child')?.revision).toBe(3);
    expect(h.invoke.mock.calls.every(([command]) => ['read_magic_tea_party', 'mutate_magic_tea_party'].includes(command))).toBe(true);
  });
  it.each(['input', 'title', 'name', 'summary'] as const)('does not implicitly save or discard a dirty %s', async field => {
    const h = setup(); await h.owner.select('child');
    if (field === 'input') h.owner.setInput('draft');
    if (field === 'title') h.owner.stageTitle('draft');
    if (field === 'name') h.owner.stageName('draft');
    if (field === 'summary') h.owner.stageSummary('draft');
    const before = h.owner.getSnapshot(); expect(await h.owner.prepareMerge()).toBe(false);
    expect(h.writes()).toEqual([]); expect(h.owner.getSnapshot()).toMatchObject({ input: before.input, titleDraft: before.titleDraft, nameDraft: before.nameDraft, summaryDraft: before.summaryDraft });
  });
  it('invalidates a pending preview on cancel and permits later navigation without late pollution', async () => {
    const h = setup(); await h.owner.select('child'); let release!: () => void;
    h.delayPreview(() => new Promise<void>(resolve => { release = resolve; }));
    const preparing = h.owner.prepareMerge(); h.owner.cancelMerge(); await h.owner.select('parent');
    const replacement = h.owner.getSnapshot(); release(); expect(await preparing).toBe(false);
    expect(h.owner.getSnapshot()).toBe(replacement); expect(h.writes()).toEqual([]);
  });
  it('ignores a preview delivered after dispose and replacement owner activation', async () => {
    const h = setup(); await h.owner.select('child'); let release!: () => void;
    h.delayPreview(() => new Promise<void>(resolve => { release = resolve; })); const preparing = h.owner.prepareMerge();
    h.owner.dispose(); h.owner.activate(); await h.owner.select('parent'); const replacement = h.owner.getSnapshot();
    release(); await preparing; expect(h.owner.getSnapshot()).toBe(replacement);
  });
  it('resolves an unknown commit through its exact receipt without another mutation', async () => {
    const h = setup(); const selection = await review(h); h.setMode('unknown-saved');
    expect(await h.owner.confirmMerge(selection)).toBe(false); expect(h.owner.getSnapshot().pending).toBe('unknown');
    await h.owner.abandonPending(); await h.owner.retryPending(); expect(h.writes()).toHaveLength(1);
    await h.owner.resolvePending(); expect(h.owner.getSnapshot()).toMatchObject({ pending: 'none', record: { session: { id: 'parent' } } });
    expect(h.writes()).toHaveLength(1);
  });
  it('retries only the unchanged original request after receipt not-found', async () => {
    const h = setup(); const selection = await review(h); h.setMode('unknown-empty'); await h.owner.confirmMerge(selection);
    await h.owner.retryPending(); expect(h.writes()).toHaveLength(1);
    await h.owner.resolvePending(); expect(h.owner.getSnapshot().pending).toBe('save');
    h.setMode('saved'); await h.owner.retryPending(); expect(h.writes()).toHaveLength(2); expect(h.writes()[1]).toEqual(h.writes()[0]);
  });
  it('never recreates a deleted parent when resolving the committed historical receipt', async () => {
    const h = setup(); const selection = await review(h); h.setMode('unknown-saved'); await h.owner.confirmMerge(selection);
    h.records.delete('parent'); await h.owner.resolvePending();
    expect(h.owner.getSnapshot()).toMatchObject({ record: null, pending: 'none', messages: [] }); expect(h.writes()).toHaveLength(1);
    expect(h.records.has('parent')).toBe(false);
  });
  it('does not load a same-ID replacement parent from a historical receipt', async () => {
    const h = setup(); const selection = await review(h); h.setMode('unknown-saved'); await h.owner.confirmMerge(selection);
    h.records.set('parent', { session: session('parent'), instance: 'c'.repeat(32), revision: 1 });
    await h.owner.resolvePending();
    expect(h.owner.getSnapshot()).toMatchObject({ pending: 'none', record: { session: { id: 'child' } }, error: '保存已确认，但重新读取失败，请刷新会话' });
    expect(h.writes()).toHaveLength(1); expect(h.records.get('parent')?.instance).toBe('c'.repeat(32));
  });
  it.each(['immediate', 'receipt'] as const)('reports saved but refresh failed on the %s path', async path => {
    const h = setup(); const selection = await review(h);
    if (path === 'receipt') { h.setMode('unknown-saved'); await h.owner.confirmMerge(selection); h.failLoad(); await h.owner.resolvePending(); }
    else { h.failLoad(); expect(await h.owner.confirmMerge(selection)).toBe(true); }
    expect(h.owner.getSnapshot()).toMatchObject({ pending: 'none', busy: false, error: '保存已确认，但重新读取失败，请刷新会话' });
    expect(h.writes()).toHaveLength(1);
  });
  it('retains source and original CAS when parent changed; abandon requires fresh review', async () => {
    const h = setup(); const selection = await review(h); h.setMode('stale'); await h.owner.confirmMerge(selection);
    expect(h.owner.getSnapshot()).toMatchObject({ pending: 'save', record: { session: { id: 'child' } } });
    await h.owner.abandonPending(); expect(h.owner.getSnapshot()).toMatchObject({ pending: 'none', mergePreview: null, record: { session: { id: 'child' } } });
    expect(await h.owner.confirmMerge(selection)).toBe(false);
  });
});
