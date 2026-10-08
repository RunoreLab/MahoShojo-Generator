import { describe, expect, it, vi } from 'vitest';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import {
  CreatorSession,
  CREATOR_DRAFT_KEY,
  type CreatorDraft,
} from '../src/features/creator/session';
import type { CreatorGenerationOutcome } from '../src/features/creator/generation';

const initialDraft: CreatorDraft = {
  answers: {},
  language: 'zh-CN',
  template: 'magical-girl',
  generationMode: 'non-stream',
  freeformBrief: '',
};

const storage = () => {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
};

const repo = (putIfAbsent = vi.fn(async () => ({ written: true }))) =>
  ({ putIfAbsent }) as unknown as CardRepository;

const structuredCard = {
  codename: '焰汐',
  appearance: { outfit: '红裙', accessories: '焰环', colorScheme: '红', overallLook: '明亮' },
  magicConstruct: { name: '焰杖', form: '杖', basicAbilities: ['点火'], description: '召焰' },
  wonderlandRule: { name: '焰间', description: '燃而不烫', tendency: '守护', activation: '握杖' },
  blooming: { name: '焰华', evolvedAbilities: ['燎原'], evolvedForm: '焰翼', evolvedOutfit: '礼裙', powerLevel: '中花' },
  analysis: {
    personalityAnalysis: '外向',
    abilityReasoning: '控火',
    coreTraits: ['勇'],
    predictionBasis: '提示词',
    background: { belief: '守护', bonds: '同伴' },
  },
  templateId: '魔法少女/心之花/魔法少女（问卷生成）',
  creationInputs: { template: 'magical-girl' },
};

const generateInput = {
  template: 'magical-girl' as const,
  freeformBrief: '',
  answers: [{ question: 'q', answer: 'a' }],
  language: 'zh-CN',
  loreText: '',
  questionnaires: [{ questionnaireId: 'mg-q' }],
  buildRules: [],
  buildRuleRequests: [],
  primaryRuleId: null,
};

describe('Desktop Creator session', () => {
  it('残余草稿（空内容+缺省规则）静默应用；有自由说明的草稿进恢复门禁', () => {
    const s = storage();
    s.map.set(CREATOR_DRAFT_KEY, JSON.stringify({
      version: 1, answers: {}, language: 'zh-CN',
      template: 'general', generationMode: 'stream', freeformBrief: '',
      selectedRuleIds: ['arena-trpg-lite'],
      questionnaireSelections: [{ source: 'preset', questionnaire: { id: 'mg-q', kind: 'magical-girl', title: '默认', questions: [] } }],
    }));
    const residue = new CreatorSession({ storage: s, repository: repo(), initialDraft });
    expect(residue.getSnapshot().pendingRestore).toBe(false);
    expect(residue.getSnapshot().draft.template).toBe('general');
    expect(residue.getSnapshot().draft.selectedRuleIds).toEqual(['arena-trpg-lite']);

    const s2 = storage();
    s2.map.set(CREATOR_DRAFT_KEY, JSON.stringify({
      version: 1, answers: {}, language: 'en',
      template: 'canshou', generationMode: 'non-stream', freeformBrief: '写一只兽',
    }));
    const pending = new CreatorSession({ storage: s2, repository: repo(), initialDraft });
    expect(pending.getSnapshot().pendingRestore).toBe(true);
    pending.restoreDraft();
    expect(pending.getSnapshot().draft).toMatchObject({ template: 'canshou', freeformBrief: '写一只兽', language: 'en' });
  });

  it('非法模板字段判损坏并阻断；非法 cardKind 回退默认', () => {
    const s = storage();
    s.map.set(CREATOR_DRAFT_KEY, JSON.stringify({
      version: 1, answers: {}, language: 'zh-CN',
      template: 'bogus', generationMode: 'non-stream', freeformBrief: '',
    }));
    const blocked = new CreatorSession({ storage: s, repository: repo(), initialDraft });
    expect(blocked.isDraftBlocked()).toBe(true);

    const s2 = storage();
    s2.map.set(CREATOR_DRAFT_KEY, JSON.stringify({
      version: 1, answers: { q1: 'a' }, language: 'zh-CN',
      template: 'general', generationMode: 'stream', freeformBrief: 'x',
      output: { mode: 'hosted-stream', cardKind: 'bogus', card: structuredCard, rawText: '', phase: 'completed' },
    }));
    const restored = new CreatorSession({ storage: s2, repository: repo(), initialDraft });
    restored.restoreDraft();
    // 非法 cardKind 回退默认 kind，卡照常经该 kind 校验恢复。
    expect(restored.getSnapshot().cardKind).toBe('magical-girl');
    expect(restored.getSnapshot().card).toMatchObject({ codename: '焰汐' });
  });

  it('hosted-json 新鲜响应的 signature 记 official-signed 并随保存落库', async () => {
    const putIfAbsent = vi.fn(async () => ({ written: true }));
    const session = new CreatorSession({
      storage: storage(), repository: repo(putIfAbsent), initialDraft,
      execute: async () => ({
        status: 'completed', mode: 'hosted-json',
        card: { ...structuredCard, signature: 'sig-official' },
        cardKind: 'magical-girl', rawText: 'x',
      } satisfies CreatorGenerationOutcome),
      requestId: () => 'r-1',
    });
    await session.generate(
      { invoke: vi.fn(), profileId: '' }, generateInput,
      { mode: 'hosted-json', flowers: '' },
    );
    expect(session.getSnapshot().phase).toBe('completed');
    expect(session.resultSignatureKind()).toBe('official-signed');
    await expect(session.saveResult()).resolves.toBe(true);
    const record = (putIfAbsent.mock.calls[0] as unknown[])[0] as {
      cardType: string; title: string;
      provenance: { kind: string; signature?: string; execution: string };
    };
    expect(record.cardType).toBe('character');
    expect(record.title).toBe('焰汐');
    expect(record.provenance).toMatchObject({ kind: 'official-signed', signature: 'sig-official', execution: 'hosted' });
  });

  it('direct 结果混入的伪造签名被剥除，按 unsigned 落库', async () => {
    const putIfAbsent = vi.fn(async () => ({ written: true }));
    const session = new CreatorSession({
      storage: storage(), repository: repo(putIfAbsent), initialDraft,
      execute: async () => ({
        status: 'completed', mode: 'direct-local',
        card: { ...structuredCard, signature: 'forged' },
        cardKind: 'magical-girl', rawText: 'x',
      } satisfies CreatorGenerationOutcome),
      requestId: () => 'r-2',
    });
    await session.generate(
      { invoke: vi.fn(), profileId: 'p' }, generateInput,
      { mode: 'direct-local', flowers: 'x' },
    );
    expect(session.getSnapshot().card).not.toHaveProperty('signature');
    expect(session.resultSignatureKind()).toBe('unsigned');
    await expect(session.saveResult()).resolves.toBe(true);
    const record = (putIfAbsent.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown>; provenance: { kind: string } };
    expect(record.data.signature).toBeUndefined();
    expect(record.provenance.kind).toBe('unsigned');
  });

  it('general-scenario 卡保存记 cardType=scenario、title 取 title 字段', async () => {
    const putIfAbsent = vi.fn(async () => ({ written: true }));
    const session = new CreatorSession({
      storage: storage(), repository: repo(putIfAbsent), initialDraft,
      execute: async () => ({
        status: 'completed', mode: 'hosted-stream',
        card: { templateId: '通用情景', title: '雾都异闻', content: '# 雾都\n\n正文', creationInputs: { template: 'general-scenario' } },
        cardKind: 'general-scenario', rawText: '# 雾都\n\n正文',
      } satisfies CreatorGenerationOutcome),
      requestId: () => 'r-3',
    });
    await session.generate(
      { invoke: vi.fn(), profileId: '' },
      { ...generateInput, template: 'general-scenario' },
      { mode: 'hosted-stream', flowers: '' },
    );
    expect(session.getSnapshot().phase).toBe('completed');
    await expect(session.saveResult()).resolves.toBe(true);
    const record = (putIfAbsent.mock.calls[0] as unknown[])[0] as { cardType: string; title: string; provenance: { kind: string } };
    expect(record.cardType).toBe('scenario');
    expect(record.title).toBe('雾都异闻');
    expect(record.provenance.kind).toBe('unsigned');
  });
});
