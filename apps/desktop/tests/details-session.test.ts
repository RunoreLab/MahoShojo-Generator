import { describe, expect, it, vi } from 'vitest';
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
const completed: DetailsGenerationOutcome = { status: 'completed', card, result: { status: 'completed', requestId: 'r', contractVersion: 1, mode: 'direct-local', output: { text: JSON.stringify(card) }, finishReason: 'stop' } };
const harness = (initial: string | null = null, execute?: typeof executeDetailsGeneration) => {
  let raw = initial;
  const storage: DetailsDraftStorage = { getItem: vi.fn(() => raw), setItem: vi.fn((_key, value) => { raw = value; }), removeItem: vi.fn(() => { raw = null; }) };
  const repository = { putIfAbsent: vi.fn(async () => ({ written: true as const })) } as unknown as CardRepository;
  let id = 0;
  const session = new DetailsSession({ storage, repository, initialDraft: draft, execute: execute ?? vi.fn(async () => completed), requestId: () => `request-${++id}` });
  return { session, storage, repository, raw: () => raw };
};

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
    finish({ status: 'cancelled', requestId: 'request-1', mode: 'direct-local', contractVersion: 1, rawText: '半段正文', reason: 'aborted' });
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
    expect(session.getSnapshot()).toMatchObject({ phase: 'cancelled', card: null, rawText: completed.result.output.text });
    await session.saveResult();
    expect(repository.putIfAbsent).not.toHaveBeenCalled();
  });
});

describe('Details draft protection and restoration', () => {
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
  it('retries persistence only; uses atomic existing-wins for active records and tombstones', async () => {
    const execute = vi.fn<typeof executeDetailsGeneration>(async () => completed);
    const { session, repository } = harness(null, execute);
    vi.mocked(repository.putIfAbsent).mockRejectedValueOnce(new Error('busy')).mockResolvedValueOnce({ alreadyPresent: true });
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
