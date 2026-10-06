import { describe, expect, it, vi } from 'vitest';
import { deriveLocalDataCardIdV1, digestLocalCardPayloadV1 } from '@mahoshojo/local-library/digest';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import type { CardWriteOutcome } from '@mahoshojo/local-library/repository';

import {
  asCharacterCardPreview,
  asMagicalGirlPreview,
  cardTypeForTemplate,
  convertEditableCardData,
  createBlankEditableCardData,
  draftFromRecord,
  exceedsUtf8ByteLimit,
  inferEditableCardType,
  isEditableLocalCard,
  MAX_IMPORT_FILE_BYTES,
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
    expect(inferEditableCardType({ templateId: '通用情景', title: '雾港', content: 'x' })).toBe('scenario');
  });

  it('inferEditableCardType 按共源 inferDataCardTemplate 判定：elements 是对象即情景', () => {
    // 结构化情景卡的 elements 是对象（不是数组）——旧实现按 Array.isArray 判定是错的。
    expect(inferEditableCardType({ title: '雾港', elements: { scene: { time: '夜' } } })).toBe('scenario');
    // 缺 templateId 的 legacy 通用情景（title+content、无 name）也是情景。
    expect(inferEditableCardType({ title: '雾港', content: '设定' })).toBe('scenario');
    // 显式模板标记的角色/情景卡。
    expect(inferEditableCardType({ templateId: '通用角色', name: '调查员', content: 'x' })).toBe('character');
    expect(inferEditableCardType({ templateId: '通用情景', title: '雾港', content: 'x' })).toBe('scenario');
    // 角色特征与 unknown 都落到宽松的 character。
    expect(inferEditableCardType({ codename: '星光' })).toBe('character');
    expect(inferEditableCardType({})).toBe('character');
  });

  it('cardTypeForTemplate：两个情景模板归 scenario，三个角色模板归 character', () => {
    expect(cardTypeForTemplate('scenario')).toBe('scenario');
    expect(cardTypeForTemplate('general-scenario')).toBe('scenario');
    expect(cardTypeForTemplate('magical-girl')).toBe('character');
    expect(cardTypeForTemplate('canshou')).toBe('character');
    expect(cardTypeForTemplate('general')).toBe('character');
  });

  it('拒绝非法 JSON、非对象、叙事历史与危险键', () => {
    expect(parseImportedCard('{')).toEqual({ ok: false, error: '内容不是合法的 JSON。' });
    expect(parseImportedCard('[1]')).toMatchObject({ ok: false });
    expect(parseImportedCard(JSON.stringify({ templateId: 'narrative-history' }))).toMatchObject({ ok: false });
    expect(parseImportedCard('{"__proto__": {"x": 1}}')).toMatchObject({ ok: false });
  });

  it('UTF-8 字节数按真实编码计：孤立代理按 U+FFFD、ASCII 1 字节、CJK 3 字节', () => {
    expect(exceedsUtf8ByteLimit('abcd', 4)).toBe(false);
    expect(exceedsUtf8ByteLimit('abcde', 4)).toBe(true);
    // '汉' 3 字节：字符串长度 2 < 5，字节数 6 > 5。
    expect(exceedsUtf8ByteLimit('汉汉', 5)).toBe(true);
    expect(exceedsUtf8ByteLimit('汉汉', 6)).toBe(false);
    // 孤立高代理 → U+FFFD（3 字节）；成对代理 → 4 字节。
    expect(exceedsUtf8ByteLimit('\ud800a', 3)).toBe(true);
    expect(exceedsUtf8ByteLimit('\ud800a', 4)).toBe(false);
    expect(exceedsUtf8ByteLimit('\ud83d\ude00', 4)).toBe(false);
    expect(exceedsUtf8ByteLimit('\ud83d\ude00x', 4)).toBe(true);
  });

  it('粘贴与文件共用同一字节上限：超限文本在解析前拒绝，恰在上限接受', () => {
    // {"a":"…"} 包装 8 字节；填满恰好 4 MiB 应通过，多一字节应拒绝。
    const wrap = (payload: string) => `{"a":"${payload}"}`;
    expect(parseImportedCard(wrap('x'.repeat(MAX_IMPORT_FILE_BYTES - 8)))).toMatchObject({ ok: true });
    expect(parseImportedCard(wrap('x'.repeat(MAX_IMPORT_FILE_BYTES - 7))))
      .toEqual({ ok: false, error: '内容超过单张数据卡的大小上限（4 MiB）。' });
    // CJK 文本字符串长度远低于 4 MiB，但 UTF-8 字节数超限：按字节而非字符计数。
    expect(parseImportedCard(wrap('汉'.repeat(Math.ceil(MAX_IMPORT_FILE_BYTES / 3)))))
      .toEqual({ ok: false, error: '内容超过单张数据卡的大小上限（4 MiB）。' });
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

  it('已有记录的 cardType 不可改：草稿里的不同类型被忽略，新记录也继承原类型', async () => {
    const record = await storedRecord({ codename: '星光' });
    const repository = memoryRepository([record]);
    // 只有类型不同的草稿没有任何可写内容。
    await expect(saveCardDraft(repository, { ...draftFromRecord(record), cardType: 'scenario' }, () => NOW))
      .resolves.toEqual({ kind: 'unchanged' });
    // 标题变化时整卡替换仍保留原类型。
    const updated = await saveCardDraft(repository, { ...draftFromRecord(record), cardType: 'scenario', title: '新标题' }, () => NOW);
    expect(updated.kind).toBe('updated');
    expect(repository.map.get(record.id)?.cardType).toBe('character');
    // 正文改变时另存的新记录同样继承原类型。
    const created = await saveCardDraft(repository, { ...draftFromRecord(record), cardType: 'scenario', data: { codename: '月影' } }, () => NOW);
    expect(created.kind).toBe('created');
    if (created.kind === 'created') expect(created.record.cardType).toBe('character');
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

  it('组装后的 document 超出单条上限时返回 document-too-large，不写入', async () => {
    const repository = memoryRepository();
    // 4 MiB 原文加上 envelope（id/title/provenance/时间戳）必然超过 4 MiB document 上限。
    const draft = { original: null, cardType: 'character' as const, title: '大卡', data: { content: 'x'.repeat(MAX_IMPORT_FILE_BYTES) } };
    await expect(saveCardDraft(repository, draft, () => NOW)).resolves.toEqual({ kind: 'document-too-large' });
    expect(repository.put).not.toHaveBeenCalled();
    expect(repository.putIfAbsent).not.toHaveBeenCalled();
    expect(repository.map.size).toBe(0);
  });
});

describe('模板转换 schema 门禁（与 Web 同一组 parse）', () => {
  it('空白卡按目标模板过 schema：情景含 elements 对象、通用情景含 templateId', () => {
    const scenario = createBlankEditableCardData('scenario');
    expect(scenario.title).toBe('未命名情景');
    expect(typeof scenario.elements).toBe('object');
    const generalScenario = createBlankEditableCardData('general-scenario');
    expect(generalScenario.templateId).toBe('通用情景');
    const general = createBlankEditableCardData('general');
    expect(general.templateId).toBe('通用角色');
  });

  it('角色转情景产出合法情景结构（title/elements），情景转角色产出 codename', () => {
    const toScenario = convertEditableCardData({ codename: '星光', appearance: { outfit: '白裙' } }, 'scenario', 'magical-girl');
    expect(toScenario.data.title).toBe('星光');
    expect(typeof toScenario.data.elements).toBe('object');
    // 反向转换同样过门禁——若实现回归产出非法结构，这里会直接抛错。
    const back = convertEditableCardData(toScenario.data, 'magical-girl', 'scenario');
    expect(back.data.codename).toBe('星光');
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

describe('角色卡预览（三模板判别）', () => {
  const canshouData = {
    name: '噬梦',
    coreConcept: '吞噬梦境',
    coreEmotion: '恐惧',
    evolutionStage: '幼体',
    appearance: '雾状身躯',
    materialAndSkin: '暗色薄膜',
    featuresAndAppendages: '细长触肢',
    attackMethod: '精神侵蚀',
    specialAbility: '梦境抽取',
    origin: '废弃剧场',
    birthEnvironment: '深夜',
    researcherNotes: '观察记录',
  };

  it('按正文特征分发：general 卡要名字与正文，canshou 卡要全部必填段', async () => {
    const general = await storedRecord({ name: '调查员', content: '背景正文' });
    expect(asCharacterCardPreview(draftFromRecord(general))).toMatchObject({ kind: 'general' });

    const canshou = await storedRecord(canshouData);
    expect(asCharacterCardPreview(draftFromRecord(canshou))).toMatchObject({ kind: 'canshou' });

    const magical = await storedRecord({ codename: '星光', appearance: {}, magicConstruct: {}, wonderlandRule: {}, blooming: {}, analysis: {} });
    expect(asCharacterCardPreview(draftFromRecord(magical))).toMatchObject({ kind: 'magical-girl' });
  });

  it('残缺数据不渲染预览：宁缺毋假', async () => {
    // general 缺 content；canshou 缺 researcherNotes——都不允许半成品进整卡组件。
    const brokenGeneral = await storedRecord({ name: '调查员' });
    expect(asCharacterCardPreview(draftFromRecord(brokenGeneral))).toBeNull();

    const { researcherNotes: _drop, ...brokenCanshou } = canshouData;
    const record = await storedRecord(brokenCanshou);
    expect(asCharacterCardPreview(draftFromRecord(record))).toBeNull();

    // 情景卡没有对应的整卡组件——和 Web 侧一样不预览。
    const scenario = await storedRecord({ title: '雾港' }, { cardType: 'scenario' });
    expect(asCharacterCardPreview({ ...draftFromRecord(scenario), cardType: 'scenario' })).toBeNull();
  });
});
