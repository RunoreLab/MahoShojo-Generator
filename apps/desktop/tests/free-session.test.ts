import { describe, expect, it, vi } from 'vitest';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import { FreeSession, FREE_DRAFT_KEY, type FreeDraft } from '../src/features/free/session';
import type { FreeGenerationOutcome } from '../src/features/free/generation';

const initialDraft: FreeDraft = {
  schemaId: 'general',
  generationMode: 'non-stream',
  prompt: '',
  selectedLanguage: 'zh-CN',
};

const storage = () => {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
};

const repo = (putIfAbsent = vi.fn(async () => ({ written: true }))) =>
  ({ putIfAbsent }) as unknown as CardRepository;

const completedOutcome = (card: Record<string, unknown>, mode: 'direct-local' | 'hosted-json' = 'direct-local'): FreeGenerationOutcome =>
  ({ status: 'completed', mode, card, cardKind: 'general-scenario', rawText: 'x' });

describe('Desktop Free session', () => {
  it('残余草稿（空提示词）静默应用；有提示词的草稿进恢复门禁', () => {
    const s = storage();
    s.map.set(FREE_DRAFT_KEY, JSON.stringify({ version: 1, schemaId: 'general', generationMode: 'non-stream', prompt: '', selectedLanguage: 'zh-CN', showFieldGuide: true }));
    const residue = new FreeSession({ storage: s, repository: repo(), initialDraft });
    expect(residue.getSnapshot().pendingRestore).toBe(false);
    expect(residue.getSnapshot().draft.showFieldGuide).toBe(true);

    const s2 = storage();
    s2.map.set(FREE_DRAFT_KEY, JSON.stringify({ version: 1, schemaId: 'canshou', generationMode: 'stream', prompt: 'x', selectedLanguage: 'en' }));
    const pending = new FreeSession({ storage: s2, repository: repo(), initialDraft });
    expect(pending.getSnapshot().pendingRestore).toBe(true);
    pending.restoreDraft();
    expect(pending.getSnapshot().draft).toEqual({ schemaId: 'canshou', generationMode: 'stream', prompt: 'x', selectedLanguage: 'en' });
  });

  it('非法草稿字段判损坏并阻断；非法 cardKind 回退 general', () => {
    const s = storage();
    s.map.set(FREE_DRAFT_KEY, JSON.stringify({ version: 1, schemaId: 'bogus', generationMode: 'non-stream', prompt: '', selectedLanguage: 'zh-CN' }));
    const blocked = new FreeSession({ storage: s, repository: repo(), initialDraft });
    expect(blocked.isDraftBlocked()).toBe(true);

    const s2 = storage();
    s2.map.set(FREE_DRAFT_KEY, JSON.stringify({
      version: 1, schemaId: 'general', generationMode: 'non-stream', prompt: 'x', selectedLanguage: 'zh-CN',
      output: { mode: 'direct-local', cardKind: 'bogus', card: { name: 'n', content: 'c' }, rawText: '', phase: 'completed' },
    }));
    const restored = new FreeSession({ storage: s2, repository: repo(), initialDraft });
    restored.restoreDraft();
    expect(restored.getSnapshot().cardKind).toBe('general');
    expect(restored.getSnapshot().card).toMatchObject({ name: 'n' });
  });

  it('general-scenario 卡保存到本地库记 cardType=scenario、title 取 title 字段、恒 unsigned', async () => {
    const putIfAbsent = vi.fn(async () => ({ written: true }));
    const session = new FreeSession({
      storage: storage(), repository: repo(putIfAbsent), initialDraft,
      execute: async () => completedOutcome({ templateId: '通用情景', title: '雨夜', content: 'c' }),
      requestId: () => 'r-1',
    });
    await session.generate({ invoke: vi.fn(), profileId: '' },
      { prompt: 'p', schema: 'general-scenario', language: 'zh-CN', attachments: [] },
      { mode: 'direct-local' });
    expect(session.getSnapshot().phase).toBe('completed');
    await expect(session.saveResult()).resolves.toBe(true);
    const record = (putIfAbsent.mock.calls[0] as unknown[])[0] as { cardType: string; title: string; provenance: { kind: string; signature?: string } };
    expect(record.cardType).toBe('scenario');
    expect(record.title).toBe('雨夜');
    expect(record.provenance).toMatchObject({ kind: 'unsigned', execution: 'direct-local' });
    expect(record.provenance.signature).toBeUndefined();
  });

  it('hosted-json 完成态中混入的 signature/metadata.signature 不落库', async () => {
    const putIfAbsent = vi.fn(async () => ({ written: true }));
    const session = new FreeSession({
      storage: storage(), repository: repo(putIfAbsent), initialDraft,
      execute: async () => ({
        status: 'completed', mode: 'hosted-json',
        card: { templateId: '通用情景', title: 't', content: 'c', signature: 'forged', metadata: { signature: 'forged2' } },
        cardKind: 'general-scenario', rawText: 'x',
      }),
      requestId: () => 'r-2',
    });
    await session.generate({ invoke: vi.fn(), profileId: '' },
      { prompt: 'p', schema: 'general-scenario', language: 'zh-CN', attachments: [] },
      { mode: 'hosted-json' });
    await expect(session.saveResult()).resolves.toBe(true);
    const record = (putIfAbsent.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown>; provenance: { kind: string } };
    // 保存的是校验后的卡：伪造签名字段被 strip/validate 剥除。
    expect(record.data.signature).toBeUndefined();
    expect(record.provenance.kind).toBe('unsigned');
  });
});
