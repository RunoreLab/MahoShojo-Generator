import { describe, expect, it, vi } from 'vitest';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import {
  ScenarioSession,
  SCENARIO_DRAFT_KEY,
  type ScenarioDraft,
} from '../src/features/scenario/session';
import type { ScenarioGenerationOutcome } from '../src/features/scenario/generation';

const initialDraft: ScenarioDraft = {
  answers: { '故事发生的场景是怎样的？': '' },
  fieldsToKeepEmpty: [],
  scenarioTitleHint: '',
  generationMode: 'non-stream',
  selectedLanguage: 'zh-CN',
};

const storage = () => {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
};

const repo = (putIfAbsent = vi.fn(async () => ({ written: true }))) =>
  ({ putIfAbsent }) as unknown as CardRepository;

const scenarioCard = {
  title: '雨后采访',
  scenario_type: '采访',
  description: 'd',
  elements: {
    scene: { time: '傍晚', place: '天台', features: '积水' },
    roles: [],
    events: '采访', atmosphere: '安静', development: ['和解'],
  },
  metadata: { created_at: '2026-01-01T00:00:00.000Z' },
};

const input = {
  answers: { '故事发生的场景是怎样的？': '雨后的天台' },
  language: 'zh-CN',
  fieldsToKeepEmpty: [],
  titleHint: '',
};

describe('Desktop Scenario session', () => {
  it('残余草稿（全空回答）静默应用；有回答的草稿进恢复门禁', () => {
    const s = storage();
    s.map.set(SCENARIO_DRAFT_KEY, JSON.stringify({
      version: 1, answers: { '故事发生的场景是怎样的？': '' }, fieldsToKeepEmpty: [],
      scenarioTitleHint: '', generationMode: 'stream', selectedLanguage: 'zh-CN', isAdvancedVisible: true,
    }));
    const residue = new ScenarioSession({ storage: s, repository: repo(), initialDraft });
    expect(residue.getSnapshot().pendingRestore).toBe(false);
    expect(residue.getSnapshot().draft.isAdvancedVisible).toBe(true);
    expect(residue.getSnapshot().draft.generationMode).toBe('stream');

    const s2 = storage();
    s2.map.set(SCENARIO_DRAFT_KEY, JSON.stringify({
      version: 1, answers: { '故事发生的场景是怎样的？': '钟楼' }, fieldsToKeepEmpty: ['elements.roles'],
      scenarioTitleHint: '夜雨', generationMode: 'non-stream', selectedLanguage: 'en',
    }));
    const pending = new ScenarioSession({ storage: s2, repository: repo(), initialDraft });
    expect(pending.getSnapshot().pendingRestore).toBe(true);
    pending.restoreDraft();
    expect(pending.getSnapshot().draft).toEqual({
      answers: { '故事发生的场景是怎样的？': '钟楼' },
      fieldsToKeepEmpty: ['elements.roles'],
      scenarioTitleHint: '夜雨',
      generationMode: 'non-stream',
      selectedLanguage: 'en',
    });
  });

  it('非法草稿字段判损坏并阻断；非法 cardKind 回退 scenario', () => {
    const s = storage();
    s.map.set(SCENARIO_DRAFT_KEY, JSON.stringify({
      version: 1, answers: 'x', fieldsToKeepEmpty: [], scenarioTitleHint: '',
      generationMode: 'non-stream', selectedLanguage: 'zh-CN',
    }));
    const blocked = new ScenarioSession({ storage: s, repository: repo(), initialDraft });
    expect(blocked.isDraftBlocked()).toBe(true);

    const s2 = storage();
    s2.map.set(SCENARIO_DRAFT_KEY, JSON.stringify({
      version: 1, answers: { '故事发生的场景是怎样的？': '钟楼' }, fieldsToKeepEmpty: [],
      scenarioTitleHint: '', generationMode: 'non-stream', selectedLanguage: 'zh-CN',
      // 完整合法的情景卡 + 非法 cardKind：回退后卡片须真正通过校验恢复，
      // 不能靠残缺卡让整份草稿判损坏来「碰巧」得到默认 cardKind。
      output: { mode: 'direct-local', cardKind: 'bogus', card: scenarioCard, rawText: '', phase: 'completed' },
    }));
    const pending = new ScenarioSession({ storage: s2, repository: repo(), initialDraft });
    expect(pending.isDraftBlocked()).toBe(false);
    expect(pending.getSnapshot().pendingRestore).toBe(true);
    pending.restoreDraft();
    expect(pending.getSnapshot().cardKind).toBe('scenario');
    expect(pending.getSnapshot().card).not.toBeNull();
  });

  it('hosted-json 服务器签名卡保存记 official-signed provenance', async () => {
    const putIfAbsent = vi.fn(async () => ({ written: true }));
    const signed = { ...scenarioCard, metadata: { created_at: '2026-01-01T00:00:00.000Z', signature: 'sig-1' } };
    const outcome: ScenarioGenerationOutcome = { status: 'completed', mode: 'hosted-json', card: signed, cardKind: 'scenario', rawText: 'x' };
    const session = new ScenarioSession({
      storage: storage(), repository: repo(putIfAbsent), initialDraft,
      execute: async () => outcome,
      requestId: () => 'r-1',
    });
    await session.generate({ invoke: vi.fn(), profileId: '' }, input, { mode: 'hosted-json' });
    expect(session.getSnapshot().phase).toBe('completed');
    await expect(session.saveResult()).resolves.toBe(true);
    const record = (putIfAbsent.mock.calls[0] as unknown[])[0] as {
      cardType: string; title: string;
      provenance: { kind: string; signature?: string; execution: string };
      data: Record<string, unknown>;
    };
    expect(record.cardType).toBe('scenario');
    expect(record.title).toBe('雨后采访');
    expect(record.provenance).toMatchObject({ kind: 'official-signed', signature: 'sig-1', execution: 'hosted' });
    expect((record.data.metadata as Record<string, unknown>).signature).toBe('sig-1');
  });

  it('direct 通路卡保存记 unsigned（签名归属只认 hosted-json）', async () => {
    const putIfAbsent = vi.fn(async () => ({ written: true }));
    const session = new ScenarioSession({
      storage: storage(), repository: repo(putIfAbsent), initialDraft,
      execute: async () => ({ status: 'completed', mode: 'direct-local', card: scenarioCard, cardKind: 'scenario', rawText: 'x' }),
      requestId: () => 'r-2',
    });
    await session.generate({ invoke: vi.fn(), profileId: '' }, input, { mode: 'direct-local' });
    await expect(session.saveResult()).resolves.toBe(true);
    const record = (putIfAbsent.mock.calls[0] as unknown[])[0] as { provenance: { kind: string; execution: string } };
    expect(record.provenance).toMatchObject({ kind: 'unsigned', execution: 'direct-local' });
  });

  it('恢复的 direct 草稿卡中混入的 metadata.signature 被剥除', async () => {
    const putIfAbsent = vi.fn(async () => ({ written: true }));
    const s = storage();
    s.map.set(SCENARIO_DRAFT_KEY, JSON.stringify({
      version: 1, answers: { '故事发生的场景是怎样的？': '钟楼' }, fieldsToKeepEmpty: [],
      scenarioTitleHint: '', generationMode: 'non-stream', selectedLanguage: 'zh-CN',
      output: {
        mode: 'direct-local', cardKind: 'scenario', rawText: 'x', phase: 'completed',
        card: { ...scenarioCard, metadata: { created_at: 'x', signature: 'forged' } },
      },
    }));
    const session = new ScenarioSession({ storage: s, repository: repo(putIfAbsent), initialDraft });
    session.restoreDraft();
    const card = session.getSnapshot().card as Record<string, unknown>;
    expect((card.metadata as Record<string, unknown>).signature).toBeUndefined();
    await expect(session.saveResult()).resolves.toBe(true);
    const record = (putIfAbsent.mock.calls[0] as unknown[])[0] as {
      data: Record<string, unknown>; provenance: { kind: string };
    };
    expect((record.data.metadata as Record<string, unknown>).signature).toBeUndefined();
    expect(record.provenance.kind).toBe('unsigned');
  });

  it('恢复的服务器签名卡保存记 signature-unverified（本机未验证）', async () => {
    const putIfAbsent = vi.fn(async () => ({ written: true }));
    const s = storage();
    s.map.set(SCENARIO_DRAFT_KEY, JSON.stringify({
      version: 1, answers: { '故事发生的场景是怎样的？': '钟楼' }, fieldsToKeepEmpty: [],
      scenarioTitleHint: '', generationMode: 'non-stream', selectedLanguage: 'zh-CN',
      output: {
        mode: 'hosted-json', cardKind: 'scenario', rawText: 'x', phase: 'completed',
        card: { ...scenarioCard, metadata: { created_at: 'x', signature: 'sig-restored' } },
      },
    }));
    const session = new ScenarioSession({ storage: s, repository: repo(putIfAbsent), initialDraft });
    session.restoreDraft();
    await expect(session.saveResult()).resolves.toBe(true);
    const record = (putIfAbsent.mock.calls[0] as unknown[])[0] as { provenance: { kind: string; signature?: string } };
    expect(record.provenance).toMatchObject({ kind: 'signature-unverified', signature: 'sig-restored' });
  });
});

it('persists independent Markdown draft fields, keeps extensions, and saves unsigned without replacing output', async () => {
  const s = storage(); const put = vi.fn(async () => ({ written: true }));
  const session = new ScenarioSession({ storage: s, repository: repo(put), initialDraft });
  session.applyLocalResult(scenarioCard, 'scenario');
  const general = { templateId: '通用情景', title: '夜雨', content: '# 开场', custom: { preserved: 1 }, metadata: { signature: 'untrusted', author: '保留作者' } };
  session.updateDraft({ ...initialDraft, generalScenarioDraft: general });
  const restored = new ScenarioSession({ storage: s, repository: repo(put), initialDraft });
  restored.restoreDraft(false);
  expect(restored.getSnapshot().draft.generalScenarioDraft).toEqual(general);
  expect(restored.getSnapshot().message).toBeNull();
  expect(restored.getSnapshot().card?.title).toBe(scenarioCard.title);
  await restored.saveGeneralScenarioDraft(general);
  expect(put).toHaveBeenCalledWith(expect.objectContaining({ cardType: 'scenario', data: { ...general, metadata: { author: '保留作者' } }, provenance: { kind: 'unsigned', execution: 'edited' } }));
  expect(restored.getSnapshot().card?.title).toBe(scenarioCard.title);
  restored.discardDraft();
  expect(restored.getSnapshot().draft.generalScenarioDraft).toBeUndefined();
  expect(s.getItem(SCENARIO_DRAFT_KEY)).toBeNull();
});

it('preserves malformed Markdown source without blocking a new editing session', async () => {
  const s = storage(); const invalid = JSON.stringify({ version: 1, ...initialDraft, generalScenarioDraft: { title: 'bad', content: 7 } });
  s.setItem(SCENARIO_DRAFT_KEY, invalid);
  const session = new ScenarioSession({ storage: s, repository: repo(), initialDraft });
  expect(session.isDraftBlocked()).toBe(true);
  expect(session.hasUnsavedDraft()).toBe(false);
  session.updateDraft({ ...initialDraft, scenarioTitleHint: '新内容' });
  expect(session.getSnapshot().draft.scenarioTitleHint).toBe('新内容');
  expect(session.hasUnsavedDraft()).toBe(true);
  expect(s.getItem(SCENARIO_DRAFT_KEY)).toBe(invalid);
});

it('keeps the Markdown editor draft after a failed save and retries without AI generation', async () => {
  const s = storage(); const put = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce({ written: true });
  const execute = vi.fn();
  const session = new ScenarioSession({ storage: s, repository: repo(put), initialDraft, execute });
  const general = { templateId: '通用情景', title: '草稿', content: '# 正文' };
  session.updateDraft({ ...initialDraft, generalScenarioDraft: general });
  await expect(session.saveGeneralScenarioDraft(general)).rejects.toThrow('disk full');
  expect(session.getSnapshot().draft.generalScenarioDraft).toEqual(general);
  expect(JSON.parse(s.getItem(SCENARIO_DRAFT_KEY)!).generalScenarioDraft).toEqual(general);
  await expect(session.saveGeneralScenarioDraft(general)).resolves.toBe(true);
  expect(execute).not.toHaveBeenCalled();
});
