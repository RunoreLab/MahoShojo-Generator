import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildUnsignedMagicalGirlDetailsCard } from '@mahoshojo/ai-core/magical-girl-details-generation';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import { DetailsGenerationError, type DetailsGenerationOutcome, type executeDetailsGeneration } from '../src/features/details/generation';
import { DETAILS_DRAFT_KEY, DetailsSession, type DetailsDraftStorage } from '../src/features/details/session';

const answers = [{ question: '信念', answer: '守护' }];
const input = { answers, language: '中文', loreText: '' };
const draft = { answers: { belief: '守护' }, language: '中文' };
const options = { profileId: 'profile', invoke: async <T,>() => undefined as T };
const intent = { mode: 'direct-local' as const, flowers: '百合' };
const card = buildUnsignedMagicalGirlDetailsCard({
  codename: '百合', appearance: { outfit: '', accessories: '', colorScheme: '', overallLook: '' },
  magicConstruct: { name: '', form: '', basicAbilities: [], description: '' },
  wonderlandRule: { name: '', description: '', tendency: '', activation: '' },
  blooming: { name: '', evolvedAbilities: [], evolvedForm: '', evolvedOutfit: '', powerLevel: '' },
  analysis: { personalityAnalysis: '', abilityReasoning: '', coreTraits: [], predictionBasis: '', background: { belief: '', bonds: '' } },
}, answers);
const completed: DetailsGenerationOutcome = {
  status: 'completed',
  mode: 'direct-local',
  card,
  cardKind: 'magical-girl',
  rawText: JSON.stringify(card),
  result: { status: 'completed', requestId: 'r', contractVersion: 1, mode: 'direct-local', output: { text: JSON.stringify(card) }, finishReason: 'stop' },
};
const harness = (initial: string | null = null, execute?: typeof executeDetailsGeneration) => {
  let raw = initial;
  const storage: DetailsDraftStorage = { getItem: vi.fn(() => raw), setItem: vi.fn((_key, value) => { raw = value; }), removeItem: vi.fn(() => { raw = null; }) };
  const repository = { putIfAbsent: vi.fn(async () => ({ written: true as const })) } as unknown as CardRepository;
  let id = 0;
  const session = new DetailsSession({ storage, repository, initialDraft: draft, execute: execute ?? vi.fn(async () => completed), requestId: () => `request-${++id}` });
  return { session, storage, repository, raw: () => raw };
};
afterEach(() => vi.useRealTimers());

describe('Details session intent ownership', () => {
  it('locks synchronously against double clicks; cancellation retains partial and retry gets new identity', async () => {
    let finish!: (result: DetailsGenerationOutcome) => void;
    const execute = vi.fn<typeof executeDetailsGeneration>((_options, _input, _intent, _signal, onPartial) => {
      onPartial?.('半段正文');
      return new Promise((resolve) => { finish = resolve; });
    });
    const { session } = harness(null, execute);
    const first = session.generate(options, input, intent);
    await session.generate(options, input, intent);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().rawText).toBe('半段正文');
    session.cancel();
    expect(execute.mock.calls[0]![3].aborted).toBe(true);
    finish({ status: 'cancelled', mode: 'direct-local', rawText: '半段正文', reason: 'aborted' });
    await first;
    expect(session.getSnapshot()).toMatchObject({ phase: 'cancelled', rawText: '半段正文' });
    const second = session.generate(options, input, intent);
    expect(execute.mock.calls[1]![2].requestId).toBe('request-2');
    finish(completed);
    await second;
  });
  it('dispose aborts and ignores late completion, flushing accepted partial to recoverable draft', async () => {
    let finish!: (result: DetailsGenerationOutcome) => void;
    const execute = vi.fn<typeof executeDetailsGeneration>((_o, _i, _t, _s, partial) => { partial?.('保留'); return new Promise((resolve) => { finish = resolve; }); });
    const { session, raw } = harness(null, execute);
    const pending = session.generate(options, input, intent);
    session.dispose();
    const snapshot = session.getSnapshot();
    finish(completed);
    await pending;
    expect(session.getSnapshot()).toBe(snapshot);
    expect(execute.mock.calls[0]![3].aborted).toBe(true);
    expect(JSON.parse(raw()!).output).toMatchObject({ phase: 'cancelled', rawText: '保留', card: null });
  });
  it('preserves transport error raw text without redispatch', async () => {
    const execute = vi.fn<typeof executeDetailsGeneration>(async () => { throw new DetailsGenerationError('断线正文', new Error('offline')); });
    const { session } = harness(null, execute);
    await session.generate(options, input, intent);
    expect(session.getSnapshot()).toMatchObject({ phase: 'failed', rawText: '断线正文', card: null });
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('cancel wins over a late completed response and cannot become a savable card', async () => {
    let finish!: (result: DetailsGenerationOutcome) => void;
    const { session, repository } = harness(null, async () => new Promise((resolve) => { finish = resolve; }));
    const pending = session.generate(options, input, intent);
    session.cancel(); finish(completed); await pending;
    expect(session.getSnapshot()).toMatchObject({ phase: 'cancelled', card: null, rawText: completed.rawText });
    await session.saveResult();
    expect(repository.putIfAbsent).not.toHaveBeenCalled();
  });
});

describe('Details draft protection and restoration', () => {
  it('coalesces streaming writes on a fixed interval and flushes the latest terminal output', async () => {
    vi.useFakeTimers();
    let partial!: (text: string) => void;
    let finish!: (result: DetailsGenerationOutcome) => void;
    const { session, storage, raw } = harness(null, (_o, _i, _t, _s, onPartial) => {
      partial = onPartial!;
      return new Promise((resolve) => { finish = resolve; });
    });
    const pending = session.generate(options, input, intent);
    for (let i = 1; i <= 24; i++) { partial(`正文${i}`); await vi.advanceTimersByTimeAsync(40); }
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().draftSaved).toBe(false);
    await vi.advanceTimersByTimeAsync(40);
    expect(storage.setItem).toHaveBeenCalledTimes(2);
    expect(JSON.parse(raw()!).output.rawText).toBe('正文24');
    partial('最终前的正文');
    finish(completed); await pending;
    expect(JSON.parse(raw()!).output).toMatchObject({ phase: 'completed', card });
    const writes = vi.mocked(storage.setItem).mock.calls.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(storage.setItem).toHaveBeenCalledTimes(writes);
  });
  it('flushes on cancellation and reports a failed scheduled save without dropping live output', async () => {
    vi.useFakeTimers();
    let partial!: (text: string) => void;
    let finish!: (result: DetailsGenerationOutcome) => void;
    const { session, storage, raw } = harness(null, (_o, _i, _t, _s, onPartial) => {
      partial = onPartial!; return new Promise((resolve) => { finish = resolve; });
    });
    const pending = session.generate(options, input, intent);
    vi.mocked(storage.setItem).mockImplementationOnce(() => { throw new Error('quota'); });
    partial('未落盘'); await vi.advanceTimersByTimeAsync(1000);
    expect(session.getSnapshot()).toMatchObject({ rawText: '未落盘', draftSaved: false });
    expect(session.getSnapshot().draftError).toBeTruthy();
    partial('取消时最新正文'); session.cancel();
    expect(JSON.parse(raw()!).output).toMatchObject({ phase: 'cancelled', rawText: '取消时最新正文' });
    finish({ status: 'cancelled', mode: 'direct-local', rawText: '取消时最新正文', reason: 'aborted' });
    await pending;
  });
  it('requires explicit restoration, never writes over pending data or auto-generates', () => {
    const raw = JSON.stringify({ version: 1, ...draft });
    const { session, storage } = harness(raw);
    session.updateDraft({ answers: {}, language: 'English' });
    session.retryDraftSave();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(session.getSnapshot().pendingRestore).toBe(true);
    session.restoreDraft();
    expect(session.getSnapshot()).toMatchObject({ draft, phase: 'idle', pendingRestore: false, draftSaved: true });
  });
  it.each(['invalid json', JSON.stringify({ version: 2, ...draft }), 'x'.repeat(4 * 1024 * 1024 + 1)])('blocks corrupt/future/oversized draft until explicit discard', (raw) => {
    const { session, storage } = harness(raw);
    session.updateDraft({ ...draft, language: 'English' });
    session.retryDraftSave();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(session.getSnapshot().draftError).toBeTruthy();
    session.discardDraft();
    expect(storage.removeItem).toHaveBeenCalledWith(DETAILS_DRAFT_KEY);
    session.updateDraft(draft);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });
  it('keeps corrupt storage intact while allowing new memory-only work and guarding departure', async () => {
    const raw = 'original broken draft';
    const { session, storage, repository, raw: read } = harness(raw);
    expect(session.isDraftBlocked()).toBe(true);
    expect(session.hasUnsavedDraft()).toBe(false);
    session.updateDraft({ ...draft, language: 'English' });
    expect(session.getSnapshot().draft.language).toBe('English');
    expect(session.hasUnsavedDraft()).toBe(true);
    await session.generate(options, input, intent);
    expect(session.getSnapshot().phase).toBe('completed');
    expect(session.getSnapshot().draftSaved).toBe(false);
    await expect(session.saveResult()).resolves.toBe(true);
    expect(repository.putIfAbsent).toHaveBeenCalledTimes(1);
    session.retryDraftSave(); session.dispose();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(read()).toBe(raw);
  });
  it('does not make memory-only generation reentrant or bypass unsaved-result confirmation', async () => {
    let finish!: (result: DetailsGenerationOutcome) => void;
    const execute = vi.fn<typeof executeDetailsGeneration>(() => new Promise((resolve) => { finish = resolve; }));
    const { session, storage } = harness('bad original', execute);
    const first = session.generate(options, input, intent);
    await session.generate(options, input, intent);
    expect(execute).toHaveBeenCalledTimes(1);
    finish(completed); await first;
    await session.generate(options, input, intent);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(session.hasUnsavedDraft()).toBe(true);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('allows local output and clearing the current result without deleting the protected original', () => {
    const { session, storage, raw } = harness('protected invalid value');
    session.applyLocalResult(card, 'magical-girl');
    expect(session.getSnapshot().phase).toBe('completed');
    session.clearOutput();
    expect(session.getSnapshot().card).toBeNull();
    expect(session.hasUnsavedDraft()).toBe(true);
    expect(raw()).toBe('protected invalid value');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
  it('records real successful save time and restores it without inventing legacy timestamps', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-09T07:00:00Z'));
    const { session, raw } = harness();
    expect(session.getSnapshot().draftSavedAt).toBeNull();
    session.updateDraft(draft);
    expect(session.getSnapshot().draftSavedAt).toBe(Date.now());
    const restored = harness(raw()).session;
    restored.restoreDraft();
    expect(restored.getSnapshot().draftSavedAt).toBe(Date.now());
    expect(restored.getSnapshot().draft).not.toHaveProperty('savedAt');
    const legacy = harness(JSON.stringify({ version: 1, ...draft })).session;
    legacy.restoreDraft();
    expect(legacy.getSnapshot().draftSavedAt).toBeNull();
  });
  it('silences ordinary automatic restoration but retains uncertain execution warnings', () => {
    const completedRaw = JSON.stringify({ version: 1, ...draft, output: { mode: 'direct-local', phase: 'completed', rawText: 'body', card } });
    const restored = harness(completedRaw).session;
    restored.restoreDraft(false);
    expect(restored.getSnapshot().message).toBeNull();
    const uncertain = harness(JSON.stringify({ version: 1, ...draft, output: { mode: 'hosted-json', phase: 'uncertain', rawText: 'partial', card: null } })).session;
    uncertain.restoreDraft(false);
    expect(uncertain.getSnapshot().message).toContain('未能确认');
    expect(uncertain.getSnapshot().phase).toBe('uncertain');
  });
  it('read and remove failures protect existing storage', () => {
    const storage = { getItem: () => { throw new Error('denied'); }, setItem: vi.fn(), removeItem: () => { throw new Error('denied'); } };
    const { repository } = harness();
    const session = new DetailsSession({ storage, repository, initialDraft: draft });
    session.discardDraft(); session.retryDraftSave();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(session.getSnapshot().draftSaved).toBe(false);
  });
  it('does not claim saved after quota failure and supports explicit write-only retry', () => {
    const { session, storage } = harness();
    vi.mocked(storage.setItem).mockImplementationOnce(() => { throw new Error('quota'); });
    session.updateDraft(draft);
    expect(session.getSnapshot()).toMatchObject({ draftSaved: false });
    expect(session.getSnapshot().draftError).toBeTruthy();
    session.retryDraftSave();
    expect(session.getSnapshot()).toMatchObject({ draftSaved: true, draftError: null });
  });
  it('restores validated unsigned result and strips unexpected signature fields', async () => {
    const stored = JSON.stringify({ version: 1, ...draft, output: { mode: 'direct-remote', phase: 'completed', rawText: 'original', card: { ...card, signature: 'fake' } } });
    const { session, repository } = harness(stored);
    session.restoreDraft();
    expect(session.getSnapshot().card).not.toHaveProperty('signature');
    await session.saveResult();
    expect(repository.putIfAbsent).toHaveBeenCalledWith(expect.objectContaining({ provenance: { kind: 'unsigned', execution: 'direct-remote' } }));
  });
  it('rejects a malformed completed card and restores interrupted text without a new request', () => {
    const invalid = harness(JSON.stringify({ version: 1, ...draft, output: { mode: 'direct-local', phase: 'completed', rawText: '', card: {} } }));
    expect(invalid.session.getSnapshot().draftError).toBeTruthy();
    const execute = vi.fn<typeof executeDetailsGeneration>(async () => completed);
    const valid = harness(JSON.stringify({ version: 1, ...draft, output: { mode: 'direct-local', phase: 'cancelled', rawText: '中断正文', card: null } }), execute);
    valid.session.restoreDraft();
    expect(valid.session.getSnapshot()).toMatchObject({ phase: 'cancelled', rawText: '中断正文' });
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('Details local card save', () => {
  it('refuses to replace an unsaved successful result without explicit discard, including after save failure', async () => {
    const execute = vi.fn<typeof executeDetailsGeneration>(async () => completed);
    const { session, repository } = harness(null, execute);
    await session.generate(options, input, intent);
    await session.generate(options, input, intent);
    expect(execute).toHaveBeenCalledTimes(1);
    vi.mocked(repository.putIfAbsent).mockRejectedValueOnce(new Error('disk'));
    expect(await session.saveResult()).toBe(false);
    await session.generate(options, input, intent);
    expect(session.getSnapshot().card).toEqual(card);
    expect(execute).toHaveBeenCalledTimes(1);
    await session.generate(options, input, intent, true);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(await session.saveResult()).toBe(true);
    await session.generate(options, input, intent);
    expect(execute).toHaveBeenCalledTimes(3);
  });
  it('owns an in-flight save synchronously and prevents generate from replacing its result', async () => {
    let finish!: (result: { written: true }) => void;
    const execute = vi.fn<typeof executeDetailsGeneration>(async () => completed);
    const { session, repository } = harness(null, execute);
    vi.mocked(repository.putIfAbsent).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await session.generate(options, input, intent);
    const pending = session.saveResult();
    await session.saveResult();
    await session.generate(options, input, intent);
    await vi.waitFor(() => expect(repository.putIfAbsent).toHaveBeenCalledTimes(1));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(session.isBusy()).toBe(true);
    finish({ written: true }); await pending;
    expect(session.getSnapshot()).toMatchObject({ saving: false, saveStatus: 'saved' });
  });
  it('retries persistence only; uses atomic existing-wins for verified active records', async () => {
    const execute = vi.fn<typeof executeDetailsGeneration>(async () => completed);
    const { session, repository } = harness(null, execute);
    vi.mocked(repository.putIfAbsent).mockRejectedValueOnce(new Error('busy')).mockResolvedValueOnce({ alreadyPresent: true });
    repository.get = vi.fn(async (id) => {
      const existing = vi.mocked(repository.putIfAbsent).mock.calls.at(-1)![0];
      expect(id).toBe(existing.id);
      return existing;
    });
    await session.generate(options, input, intent);
    await session.saveResult();
    expect(session.getSnapshot()).toMatchObject({ saveStatus: 'failed', card });
    await session.saveResult();
    expect(session.getSnapshot()).toMatchObject({ saveStatus: 'already-present', saveError: null });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(repository.putIfAbsent).toHaveBeenCalledWith(expect.objectContaining({ id: expect.stringMatching(/^lc_[a-f0-9]{32}$/), provenance: { kind: 'unsigned', execution: 'direct-local' } }));
  });
  it('never saves incomplete output and explicit clear removes result from persisted draft', async () => {
    const { session, repository, raw } = harness();
    await session.saveResult();
    expect(repository.putIfAbsent).not.toHaveBeenCalled();
    await session.generate(options, input, intent);
    session.clearOutput();
    await session.saveResult();
    expect(repository.putIfAbsent).not.toHaveBeenCalled();
    expect(JSON.parse(raw()!).output).toMatchObject({ phase: 'idle', rawText: '', card: null });
  });
});

describe('Details hosted execution outcomes', () => {
  it('saves a hosted-json signed card as official-signed with hosted execution provenance', async () => {
    const signedCard = { ...card, signature: 'server-issued-signature' };
    const execute = vi.fn<typeof executeDetailsGeneration>(async () => ({
      status: 'completed', mode: 'hosted-json', card: signedCard, cardKind: 'magical-girl',
      rawText: JSON.stringify(signedCard), reasoning: { status: 'done', source: 'sdk', text: '推理' },
    }));
    const { session, repository } = harness(null, execute);
    await session.generate(options, input, { mode: 'hosted-json', flowers: '百合' });
    expect(session.getSnapshot()).toMatchObject({ phase: 'completed', cardKind: 'magical-girl' });
    expect(session.getSnapshot().reasoning).toMatchObject({ status: 'done', text: '推理' });
    await session.saveResult();
    expect(repository.putIfAbsent).toHaveBeenCalledWith(expect.objectContaining({
      provenance: { kind: 'official-signed', signature: 'server-issued-signature', execution: 'hosted' },
    }));
  });

  it('saves a hosted-stream general card as unsigned hosted and survives draft round-trip', async () => {
    const generalCard = { templateId: '通用角色', name: '潮汐花', content: '## 介绍\n守护', userAnswers: [{ question: '信念', answer: '守护' }] };
    const execute = vi.fn<typeof executeDetailsGeneration>(async () => ({
      status: 'completed', mode: 'hosted-stream', card: generalCard, cardKind: 'general', rawText: generalCard.content,
    }));
    const { session, repository, raw } = harness(null, execute);
    await session.generate(options, input, { mode: 'hosted-stream', flowers: '百合' });
    expect(session.getSnapshot().cardKind).toBe('general');
    await session.saveResult();
    expect(repository.putIfAbsent).toHaveBeenCalledWith(expect.objectContaining({
      title: '潮汐花',
      provenance: { kind: 'unsigned', execution: 'hosted' },
    }));
    // 草稿持久化带 cardKind；恢复时按 general 校验，不做问卷 schema 检查。
    const stored = JSON.parse(raw()!);
    expect(stored.output).toMatchObject({ mode: 'hosted-stream', cardKind: 'general', phase: 'completed' });
    const restored = harness(raw()!);
    restored.session.restoreDraft();
    expect(restored.session.getSnapshot()).toMatchObject({ cardKind: 'general', phase: 'completed' });
  });

  it('strips a forged signature from a hosted-stream general draft card', () => {
    const forged = JSON.stringify({ version: 1, ...draft, output: { mode: 'hosted-stream', cardKind: 'general', phase: 'completed', rawText: '', card: { name: 'x', content: 'y', signature: 'fake' } } });
    const { session } = harness(forged);
    session.restoreDraft();
    expect(session.getSnapshot().card).not.toHaveProperty('signature');
  });

  it('surfaces hosted-json uncertain outcome without auto-replay', async () => {
    const execute = vi.fn<typeof executeDetailsGeneration>(async () => ({
      status: 'uncertain', mode: 'hosted-json', rawText: '',
      message: '无法确认这次生成是否在服务器执行——请求可能已发送。不会自动重试；再次生成会发起新请求，可能产生重复调用与费用。',
    }));
    const { session, repository } = harness(null, execute);
    await session.generate(options, input, { mode: 'hosted-json', flowers: '百合' });
    expect(session.getSnapshot()).toMatchObject({ phase: 'uncertain', card: null });
    expect(session.getSnapshot().message).toContain('重复调用与费用');
    // uncertain 不是 completed：不可保存、不自动重放。
    await session.saveResult();
    expect(repository.putIfAbsent).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('persists an in-flight hosted-json abort as uncertain, not clean cancelled', async () => {
    let finish!: (result: DetailsGenerationOutcome) => void;
    const execute = vi.fn<typeof executeDetailsGeneration>(() => new Promise((resolve) => { finish = resolve; }));
    const { session, raw } = harness(null, execute);
    const pending = session.generate(options, input, { mode: 'hosted-json', flowers: '百合' });
    session.cancel();
    expect(JSON.parse(raw()!).output).toMatchObject({ phase: 'uncertain' });
    finish({ status: 'uncertain', mode: 'hosted-json', rawText: '', message: 'uncertain' });
    await pending;
    expect(session.getSnapshot().phase).toBe('uncertain');
  });

  it('restores a persisted uncertain phase instead of auto-regenerating', () => {
    const stored = JSON.stringify({ version: 1, ...draft, output: { mode: 'hosted-json', phase: 'uncertain', rawText: '', card: null } });
    const execute = vi.fn<typeof executeDetailsGeneration>();
    const { session } = harness(stored, execute);
    session.restoreDraft();
    expect(session.getSnapshot()).toMatchObject({ phase: 'uncertain', card: null });
    expect(session.getSnapshot().message).toContain('未能确认');
    expect(execute).not.toHaveBeenCalled();
  });

  it('saves a signed card restored from editable draft as signature-unverified', async () => {
    const signedCard = { ...card, signature: 'server-issued-signature' };
    const stored = JSON.stringify({ version: 1, ...draft, output: { mode: 'hosted-json', phase: 'completed', rawText: JSON.stringify(signedCard), card: signedCard } });
    const { session, repository } = harness(stored);
    session.restoreDraft();
    expect(session.getSnapshot()).toMatchObject({ phase: 'completed', resultRestored: true });
    expect(session.getSnapshot().card).toMatchObject({ signature: 'server-issued-signature' });
    await session.saveResult();
    expect(repository.putIfAbsent).toHaveBeenCalledWith(expect.objectContaining({
      provenance: { kind: 'signature-unverified', signature: 'server-issued-signature', execution: 'hosted' },
    }));
  });

  it('keeps a fresh hosted-json signed card as official-signed after a restore round-trip elsewhere', async () => {
    const signedCard = { ...card, signature: 'server-issued-signature' };
    const execute = vi.fn<typeof executeDetailsGeneration>(async () => ({
      status: 'completed', mode: 'hosted-json', card: signedCard, cardKind: 'magical-girl', rawText: JSON.stringify(signedCard),
    }));
    const { session, repository } = harness(null, execute);
    await session.generate(options, input, { mode: 'hosted-json', flowers: '百合' });
    expect(session.getSnapshot().resultRestored).toBe(false);
    await session.saveResult();
    expect(repository.putIfAbsent).toHaveBeenCalledWith(expect.objectContaining({
      provenance: { kind: 'official-signed', signature: 'server-issued-signature', execution: 'hosted' },
    }));
  });
});

it.each(['tombstone', 'missing', 'read-error'] as const)('共享保存结果不把 %s 当作可用的已保存副本', async (caseKind) => {
  const execute = vi.fn<typeof executeDetailsGeneration>(async () => completed);
  const { session, repository } = harness(null, execute);
  vi.mocked(repository.putIfAbsent).mockResolvedValue({ alreadyPresent: true });
  repository.get = vi.fn(async (id) => {
    if (caseKind === 'read-error') throw new Error('disk');
    if (caseKind === 'missing') return null;
    const written = vi.mocked(repository.putIfAbsent).mock.calls.at(-1)![0];
    expect(id).toBe(written.id);
    return { ...written, deletedAt: written.updatedAt };
  });
  await session.generate(options, input, intent);
  expect(await session.saveResult()).toBe(false);
  expect(session.getSnapshot()).toMatchObject({ saveStatus: 'failed', card });
  if (caseKind === 'tombstone') expect(session.getSnapshot().saveError).toContain('回收站');
  expect(session.hasUnsavedResult()).toBe(true);
  await session.generate(options, input, intent);
  expect(execute).toHaveBeenCalledTimes(1);
});
