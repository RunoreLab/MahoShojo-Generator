import { describe, expect, it, vi } from 'vitest';
import { deriveLocalDataCardIdV1, digestLocalCardPayloadV1 } from '@mahoshojo/local-library/digest';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import type { CardWriteOutcome } from '@mahoshojo/local-library/repository';

import {
  asMagicalGirlPreview,
  draftFromRecord,
  inferEditableCardType,
  isEditableLocalCard,
  parseImportedCard,
  saveCardDraft,
} from '../src/features/character-manager/editor';

const NOW = Date.parse('2026-10-04T08:00:00.000Z');

const storedRecord = async (data: Record<string, unknown>, overrides: Partial<LocalCardRecordV1> = {}): Promise<LocalCardRecordV1> => {
  const contentDigest = await digestLocalCardPayloadV1(data);
  return {
    id: deriveLocalDataCardIdV1(contentDigest),
    schemaVersion: 1,
    storageLocation: 'local',
    cardType: 'character',
    title: '星光',
    data: data as LocalCardRecordV1['data'],
    contentDigest,
    provenance: { kind: 'official-signed', signature: 'sig', execution: 'downloaded' },
    cloudRef: { cardId: 'cloud-1', copiedAt: '2026-10-01T00:00:00.000Z' },
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
    ...overrides,
  };
};

const memoryRepository = (rows: LocalCardRecordV1[] = []) => {
  const map = new Map(rows.map((row) => [row.id, row]));
  return {
    map,
    get: vi.fn(async (id: string) => map.get(id) ?? null),
    put: vi.fn(async (record: LocalCardRecordV1) => { map.set(record.id, record); }),
    putIfAbsent: vi.fn(async (record: LocalCardRecordV1): Promise<CardWriteOutcome> => {
      if (map.has(record.id)) return { alreadyPresent: true };
      map.set(record.id, record);
      return { written: true };
    }),
  };
};

describe('单卡导入解析', () => {
  it('接受 JSON 对象并推断类型与标题', () => {
    const parsed = parseImportedCard(JSON.stringify({ codename: '星光', appearance: {} }));
    expect(parsed).toMatchObject({ ok: true, draft: { original: null, cardType: 'character', title: '星光' } });
    expect(inferEditableCardType({ templateId: '通用情景', title: '雾港' })).toBe('scenario');
  });

  it('拒绝非法 JSON、非对象、叙事历史与危险键', () => {
    expect(parseImportedCard('{')).toEqual({ ok: false, error: '内容不是合法的 JSON。' });
    expect(parseImportedCard('[1]')).toMatchObject({ ok: false });
    expect(parseImportedCard(JSON.stringify({ templateId: 'narrative-history' }))).toMatchObject({ ok: false });
    expect(parseImportedCard('{"__proto__": {"x": 1}}')).toMatchObject({ ok: false });
  });

  it('只把角色与情景卡视为可编辑', async () => {
    expect(isEditableLocalCard(await storedRecord({ codename: 'a' }))).toBe(true);
    expect(isEditableLocalCard(await storedRecord({ questions: [] }, { cardType: 'questionnaire' }))).toBe(false);
  });
});

describe('保存规则', () => {
  it('正文与标题都没变时不写入', async () => {
    const record = await storedRecord({ codename: '星光' });
    const repository = memoryRepository([record]);
    await expect(saveCardDraft(repository, draftFromRecord(record), () => NOW)).resolves.toEqual({ kind: 'unchanged' });
    expect(repository.put).not.toHaveBeenCalled();
    expect(repository.putIfAbsent).not.toHaveBeenCalled();
  });

  it('只改标题时整卡替换原记录并保留 provenance 与 cloudRef', async () => {
    const record = await storedRecord({ codename: '星光' });
    const repository = memoryRepository([record]);
    const outcome = await saveCardDraft(repository, { ...draftFromRecord(record), title: '  新标题 ' }, () => NOW);
    expect(outcome.kind).toBe('updated');
    const saved = repository.map.get(record.id)!;
    expect(saved).toMatchObject({ id: record.id, title: '新标题', provenance: record.provenance, cloudRef: record.cloudRef, createdAt: record.createdAt });
    expect(saved.updatedAt).toBe('2026-10-04T08:00:00.000Z');
  });

  it('正文改变时以新摘要另存为 unsigned/edited 新记录，原记录不动', async () => {
    const record = await storedRecord({ codename: '星光', signature: 'sig' });
    const repository = memoryRepository([record]);
    const outcome = await saveCardDraft(repository, { ...draftFromRecord(record), data: { codename: '月影', signature: 'sig' } }, () => NOW);
    expect(outcome.kind).toBe('created');
    if (outcome.kind !== 'created') return;
    expect(outcome.record.id).not.toBe(record.id);
    expect(outcome.record.provenance).toEqual({ kind: 'unsigned', execution: 'edited' });
    expect(outcome.record.cloudRef).toBeUndefined();
    expect(outcome.record.data).toEqual({ codename: '月影', signature: 'sig' });
    expect(repository.map.get(record.id)).toEqual(record);
  });

  it('导入命中活动记录与回收站记录分别报告，不覆盖也不复活', async () => {
    const active = await storedRecord({ codename: '星光' });
    const tombstone = await storedRecord({ codename: '雾港' }, { deletedAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z' });
    const repository = memoryRepository([active, tombstone]);
    const importDraft = (data: Record<string, unknown>) => ({ original: null, cardType: 'character' as const, title: '导入', data });

    await expect(saveCardDraft(repository, importDraft({ codename: '星光' }), () => NOW)).resolves.toEqual({ kind: 'exists', id: active.id });
    await expect(saveCardDraft(repository, importDraft({ codename: '雾港' }), () => NOW)).resolves.toEqual({ kind: 'in-recycle-bin', id: tombstone.id });
    expect(repository.put).not.toHaveBeenCalled();
    expect(repository.map.get(tombstone.id)?.deletedAt).toBeDefined();

    const created = await saveCardDraft(repository, importDraft({ codename: '新角色' }), () => NOW);
    expect(created).toMatchObject({ kind: 'created', record: { provenance: { kind: 'unsigned', execution: 'imported' }, title: '导入' } });
  });
});

describe('魔法少女预览', () => {
  it('只在五段结构齐全时提供预览', async () => {
    const full = { codename: '星光', appearance: {}, magicConstruct: {}, wonderlandRule: {}, blooming: {}, analysis: {} };
    const record = await storedRecord(full);
    expect(asMagicalGirlPreview(draftFromRecord(record))).not.toBeNull();
    expect(asMagicalGirlPreview({ ...draftFromRecord(record), data: { codename: '星光', appearance: {} } })).toBeNull();
    expect(asMagicalGirlPreview({ ...draftFromRecord(record), cardType: 'scenario' })).toBeNull();
  });
});
