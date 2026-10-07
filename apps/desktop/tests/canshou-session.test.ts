import { describe, expect, it, vi } from 'vitest';
import { buildUnsignedCanshouCard } from '@mahoshojo/ai-core/canshou-generation';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import {
  CanshouGenerationError,
  type CanshouGenerationOutcome,
  type executeCanshouGeneration,
} from '../src/features/canshou/generation';
import { CANSHOU_DRAFT_KEY, CanshouSession, type CanshouDraftStorage } from '../src/features/canshou/session';

const answers = [{ question: '起源？', answer: '巢穴' }];
const input = { answers, language: '中文', loreText: '' };
const draft = { answers: { q1: '巢穴' }, language: '中文' };
const options = { profileId: 'profile', invoke: async <T,>() => undefined as T };
const intent = { mode: 'direct-local' as const };
const structuredData = {
  name: '巢穴回声', coreConcept: '思念成兽', coreEmotion: '孤独', evolutionStage: '幼年期',
  appearance: '雾状', materialAndSkin: '雾', featuresAndAppendages: '风铃尾',
  attackMethod: '回声震荡', specialAbility: '声音重现', origin: '废弃巢穴',
  birthEnvironment: '地下空洞', researcherNotes: '观察',
};
const card = buildUnsignedCanshouCard(structuredData, answers);
const completed: CanshouGenerationOutcome = {
  status: 'completed',
  mode: 'direct-local',
  card,
  cardKind: 'canshou',
  rawText: JSON.stringify(card),
  result: { status: 'completed', requestId: 'r', contractVersion: 1, mode: 'direct-local', output: { text: JSON.stringify(card) }, finishReason: 'stop' },
};
const harness = (initial: string | null = null, execute?: typeof executeCanshouGeneration) => {
  let raw = initial;
  const setItem = vi.fn((_key: string, value: string) => { raw = value; });
  const storage: CanshouDraftStorage = { getItem: vi.fn(() => raw), setItem, removeItem: vi.fn(() => { raw = null; }) };
  const repository = { putIfAbsent: vi.fn(async () => ({ written: true as const })) } as unknown as CardRepository;
  let id = 0;
  const session = new CanshouSession({ storage, repository, initialDraft: draft, execute: execute ?? vi.fn(async () => completed), requestId: () => `request-${++id}` });
  return { session, storage, setItem, repository, raw: () => raw };
};

describe('Canshou session intent ownership', () => {
  it('uses a family-scoped draft key distinct from /details', async () => {
    const { session, setItem } = harness();
    session.updateDraft({ ...session.getSnapshot().draft, language: 'English' });
    expect(setItem.mock.calls.every(([key]) => key === CANSHOU_DRAFT_KEY)).toBe(true);
    expect(CANSHOU_DRAFT_KEY).not.toBe('mahoshojo.desktop.details.draft.v1');
    session.dispose();
  });

  it('locks synchronously against double clicks; cancellation retains partial', async () => {
    let finish!: (result: CanshouGenerationOutcome) => void;
    const execute = vi.fn<typeof executeCanshouGeneration>((_o, _i, _t, _s, onPartial) => {
      onPartial?.('半段正文');
      return new Promise((resolve) => { finish = resolve; });
    });
    const { session } = harness(null, execute);
    const first = session.generate(options, input, intent);
    await session.generate(options, input, intent);
    expect(execute).toHaveBeenCalledTimes(1);
    session.cancel();
    finish({ status: 'cancelled', mode: 'direct-local', rawText: '半段正文', reason: 'aborted' });
    await first;
    expect(session.getSnapshot()).toMatchObject({ phase: 'cancelled', rawText: '半段正文' });
    session.dispose();
  });

  it('preserves transport error raw text via the family error wrapper', async () => {
    const execute = vi.fn<typeof executeCanshouGeneration>(async () => { throw new CanshouGenerationError('断线正文', new Error('offline')); });
    const { session } = harness(null, execute);
    await session.generate(options, input, intent);
    expect(session.getSnapshot()).toMatchObject({ phase: 'failed', rawText: '断线正文', card: null });
    session.dispose();
  });
});

describe('Canshou applyLocalResult (快速随机)', () => {
  it('strips any carried signature and records direct-local unsigned provenance', async () => {
    const { session, repository } = harness();
    session.applyLocalResult({ ...card, signature: 'forged-sig' } as never, 'canshou');
    expect(session.getSnapshot().card).not.toHaveProperty('signature');
    await session.saveResult();
    const record = vi.mocked(repository.putIfAbsent).mock.calls[0]![0] as { provenance: { kind: string; execution: string; signature?: string } };
    expect(record.provenance).toMatchObject({ kind: 'unsigned', execution: 'direct-local' });
    expect(record.provenance).not.toHaveProperty('signature');
    session.dispose();
  });

  it('defaults missing userAnswers to the compacted empty list', () => {
    const { session } = harness();
    const { userAnswers: _omit, ...rest } = card;
    session.applyLocalResult(rest as never, 'canshou');
    expect(session.getSnapshot().card?.userAnswers).toEqual([]);
    session.dispose();
  });
});

describe('Canshou hosted-json signature provenance', () => {
  it('fresh hosted-json signed card saves as official-signed', async () => {
    const hostedCard = { ...card, signature: 'server-sig' };
    const execute = vi.fn<typeof executeCanshouGeneration>(async () => ({
      status: 'completed', mode: 'hosted-json', card: hostedCard, cardKind: 'canshou', rawText: JSON.stringify(hostedCard),
    }));
    const { session, repository } = harness(null, execute);
    await session.generate(options, input, { mode: 'hosted-json' });
    await session.saveResult();
    const record = vi.mocked(repository.putIfAbsent).mock.calls[0]![0] as { provenance: { kind: string; signature?: string; execution: string } };
    expect(record.provenance).toMatchObject({ kind: 'official-signed', signature: 'server-sig', execution: 'hosted' });
    session.dispose();
  });

  it('restored signed card downgrades to signature-unverified', async () => {
    const stored = JSON.stringify({
      version: 1,
      answers: { q1: '巢穴' },
      language: '中文',
      output: { mode: 'hosted-json', cardKind: 'canshou', card: { ...card, signature: 'server-sig' }, rawText: '', phase: 'completed' },
    });
    const { session, repository } = harness(stored);
    session.restoreDraft();
    expect(session.getSnapshot().resultRestored).toBe(true);
    await session.saveResult();
    const record = vi.mocked(repository.putIfAbsent).mock.calls[0]![0] as { provenance: { kind: string } };
    expect(record.provenance.kind).toBe('signature-unverified');
    session.dispose();
  });

  it('hosted-stream general card saves unsigned with hosted provenance', async () => {
    const generalCard = { name: '巢穴回声', content: '## 角色介绍\n守护巢穴', userAnswers: [] };
    const execute = vi.fn<typeof executeCanshouGeneration>(async () => ({
      status: 'completed', mode: 'hosted-stream', card: generalCard, cardKind: 'general', rawText: '正文',
    }));
    const { session, repository } = harness(null, execute);
    await session.generate(options, input, { mode: 'hosted-stream' });
    expect(session.getSnapshot().cardKind).toBe('general');
    await session.saveResult();
    const record = vi.mocked(repository.putIfAbsent).mock.calls[0]![0] as { title: string; provenance: { kind: string; execution: string } };
    expect(record.provenance).toMatchObject({ kind: 'unsigned', execution: 'hosted' });
    expect(record.title).toBe('巢穴回声');
    session.dispose();
  });
});

describe('Canshou draft protection and restoration', () => {
  it('restores draft output preserving cardKind without auto-regenerating', async () => {
    const stored = JSON.stringify({
      version: 1,
      answers: { q1: '巢穴' },
      language: '中文',
      output: { mode: 'hosted-stream', cardKind: 'general', card: { name: '回声', content: '正文', userAnswers: [] }, rawText: '正文', phase: 'completed' },
    });
    const { session } = harness(stored);
    expect(session.getSnapshot().pendingRestore).toBe(true);
    session.restoreDraft();
    expect(session.getSnapshot()).toMatchObject({ phase: 'completed', cardKind: 'general', resultRestored: true });
    session.dispose();
  });

  it('in-flight hosted-json persists as uncertain rather than clean cancelled', async () => {
    let finish!: (result: CanshouGenerationOutcome) => void;
    const execute = vi.fn<typeof executeCanshouGeneration>(() => new Promise((resolve) => { finish = resolve; }));
    const { session, raw } = harness(null, execute);
    const pending = session.generate(options, input, { mode: 'hosted-json' });
    session.cancel();
    expect(JSON.parse(raw()!).output.phase).toBe('uncertain');
    finish({ status: 'uncertain', mode: 'hosted-json', rawText: '', message: '无法确认' });
    await pending;
    session.dispose();
  });
});
