// @vitest-environment jsdom
import '@/tests/helpers/fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  LOCAL_LIBRARY_DB_NAME,
  resetLocalLibraryDbConnection,
} from '@/lib/local-library/db';
import {
  IndexedDbCardRepository,
  resetLocalCardRepository,
} from '@/lib/local-library/card-repository';
import { saveLocalDataCard } from '@/lib/local-library/save-local-data-card';
import {
  deriveLocalDataCardIdV1,
  digestLocalCardPayloadV1,
} from '@mahoshojo/local-library/digest';
import {
  isLocalDataCardRow,
  mapLocalCardRecordToDetailsCard,
  mapLocalCardRecordToRow,
} from '@/lib/local-library/data-card-rows';

const character = (name: string): Record<string, unknown> => ({
  name,
  codename: name,
  age: 15,
  appearance: '粉色双马尾',
  personality: '认真',
  background: '普通人',
  abilities: { special: '闪光', physical: '棒棒糖' },
  items: [{ name: '魔杖', effect: '发射光束' }],
  debutLines: '为了正义！',
  battleLog: '',
});

beforeEach(async () => {
  resetLocalLibraryDbConnection();
  resetLocalCardRepository();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(LOCAL_LIBRARY_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
});

describe('本地库消费共享摘要实现', () => {
  it('is stable across key order so an unchanged card never looks new', async () => {
    const a = await digestLocalCardPayloadV1({ name: '焰', age: 15, nested: { x: 1, y: 2 } });
    const b = await digestLocalCardPayloadV1({ nested: { y: 2, x: 1 }, age: 15, name: '焰' });
    expect(a).toBe(b);
  });

  it('ignores transport metadata and signatures that change on every save', async () => {
    const base = character('焰');
    const withMeta = await digestLocalCardPayloadV1({ ...base, _cardId: 'uuid-1', _usageCount: 7 });
    const withSignature = await digestLocalCardPayloadV1({ ...base, signature: 'sig-a' });
    const otherSignature = await digestLocalCardPayloadV1({ ...base, signature: 'sig-b' });
    expect(withMeta).toBe(await digestLocalCardPayloadV1(base));
    expect(withSignature).toBe(otherSignature);
  });

  it('changes when real content changes', async () => {
    expect(await digestLocalCardPayloadV1(character('焰'))).not.toBe(await digestLocalCardPayloadV1(character('雪')));
  });
});

describe('saveLocalDataCard', () => {
  it('dedupes identical content into one row and replaces it wholesale', async () => {
    const repository = new IndexedDbCardRepository();
    const now = (() => {
      let tick = 0;
      return () => new Date(Date.UTC(2026, 8, 29, 12, 0, 0) + tick++ * 60_000).toISOString();
    })();

    const first = await saveLocalDataCard(repository, { cardType: 'character', title: '焰', payload: character('焰') }, now);
    expect(first.updated).toBe(false);

    const second = await saveLocalDataCard(
      repository,
      { cardType: 'character', title: '焰（改名）', payload: character('焰') },
      now,
    );
    expect(second.updated).toBe(true);
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.title).toBe('焰（改名）');
    expect(second.record.createdAt).toBe(first.record.createdAt);

    const page = await repository.list({ limit: 10 });
    expect(page.items).toHaveLength(1);
  });

  it('keeps a different payload as a separate local card', async () => {
    const repository = new IndexedDbCardRepository();
    const now = () => '2026-09-29T12:00:00.000Z';
    await saveLocalDataCard(repository, { cardType: 'character', title: '焰', payload: character('焰') }, now);
    await saveLocalDataCard(repository, { cardType: 'character', title: '焰', payload: character('焰v2') }, now);
    expect((await repository.list({ limit: 10 })).items).toHaveLength(2);
  });

  it('records a cloud reference for a downloaded copy and still occupies no cloud slot', async () => {
    const repository = new IndexedDbCardRepository();
    const { record } = await saveLocalDataCard(
      repository,
      {
        cardType: 'scenario',
        title: '终局',
        payload: { content: '结局' },
        execution: 'downloaded',
        cloudRef: { cardId: 'cloud-1', cloudRevision: '2026-09-29' },
      },
      () => '2026-09-29T12:00:00.000Z',
    );
    expect(record.storageLocation).toBe('local');
    expect(record.cloudRef).toEqual({ cardId: 'cloud-1', cloudRevision: '2026-09-29', copiedAt: '2026-09-29T12:00:00.000Z' });
    expect(record.provenance).toEqual({ kind: 'unsigned', execution: 'downloaded' });
  });

  it('derives a stable id from the content digest', async () => {
    const digest = await digestLocalCardPayloadV1(character('焰'));
    const other = await digestLocalCardPayloadV1(character('雪'));
    expect(deriveLocalDataCardIdV1(digest)).toMatch(/^lc_[0-9a-f]{32}$/u);
    expect(deriveLocalDataCardIdV1(digest)).toBe(deriveLocalDataCardIdV1(digest));
    expect(deriveLocalDataCardIdV1(digest)).not.toBe(deriveLocalDataCardIdV1(other));
  });
});

describe('local data card rows', () => {
  it('marks rows as local so the UI can swap the action set', async () => {
    const repository = new IndexedDbCardRepository();
    const { record } = await saveLocalDataCard(
      repository,
      { cardType: 'character', title: '焰', payload: { ...character('焰'), description: '主角' } },
      () => '2026-09-29T12:00:00.000Z',
    );
    const row = mapLocalCardRecordToRow(record);
    expect(isLocalDataCardRow(row)).toBe(true);
    expect(row.description).toBe('主角');
    expect(row.data).toMatchObject({ name: '焰' });
  });

  it('never mistakes a cloud row for a local one', () => {
    expect(isLocalDataCardRow({ id: 'x', name: '线上卡' })).toBe(false);
    expect(isLocalDataCardRow(null)).toBe(false);
  });

  it('renders a details card that reports a local, non-public origin', async () => {
    const repository = new IndexedDbCardRepository();
    const { record } = await saveLocalDataCard(
      repository,
      { cardType: 'character', title: '焰', payload: character('焰') },
      () => '2026-09-29T12:00:00.000Z',
    );
    const details = mapLocalCardRecordToDetailsCard(record);
    expect(details.isPublic).toBe(false);
    expect(details.author).toBe('本机');
    expect(() => JSON.parse(details.data)).not.toThrow();
  });
});
