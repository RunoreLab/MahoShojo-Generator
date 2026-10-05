import type {
  CardRepository,
  CardWriteOutcome,
  LocalCardPage,
  LocalCardQuery,
} from '@mahoshojo/local-library/repository';
import { LocalCardRecordV1Schema, type LocalCardRecordV1 } from '@mahoshojo/local-library/record';

import { createLocalCardRecord } from './fixtures';

class InMemoryCardRepository implements CardRepository {
  readonly #records = new Map<string, LocalCardRecordV1>();
  readonly #now: () => string;

  constructor(now: () => string) {
    this.#now = now;
  }

  async get(id: string): Promise<LocalCardRecordV1 | null> {
    const record = this.#records.get(id);
    return record === undefined ? null : LocalCardRecordV1Schema.parse(record);
  }

  async list(query: LocalCardQuery): Promise<LocalCardPage> {
    const offset = query.cursor === undefined ? 0 : Number(query.cursor);
    const matching = [...this.#records.values()]
      .filter((record) => query.includeDeleted === true || record.deletedAt === undefined)
      .filter((record) => query.cardTypes === undefined || query.cardTypes.includes(record.cardType))
      .sort((left, right) => left.id.localeCompare(right.id));
    const items = matching.slice(offset, offset + query.limit);
    const nextOffset = offset + items.length;
    return {
      items: items.map((record) => LocalCardRecordV1Schema.parse(record)),
      nextCursor: nextOffset < matching.length ? String(nextOffset) : undefined,
    };
  }

  async put(record: LocalCardRecordV1): Promise<void> {
    const parsed = LocalCardRecordV1Schema.parse(record);
    const existing = this.#records.get(parsed.id);
    if (existing?.deletedAt !== undefined && parsed.deletedAt === undefined) {
      throw new Error('cannot overwrite a tombstone; use restore');
    }
    this.#records.set(parsed.id, parsed);
  }

  /**
   * `CardRepository` 的 `putIfAbsent` 是导入侧 existing-wins 唯一的判定依据
   * （见 `src/repository.ts` 的说明：与 `put` 的差别是**原子性**，不是覆不覆盖）。
   * 这个内存实现原先没有它，`tsc` 因此报 `TS2420`——测试替身落后于接口。
   *
   * 语义按接口文档实现：id **当前不存在**才写入；已存在（含墓碑）则整条不动并回报已存在。
   */
  async putIfAbsent(record: LocalCardRecordV1): Promise<CardWriteOutcome> {
    const parsed = LocalCardRecordV1Schema.parse(record);
    if (this.#records.has(parsed.id)) return { alreadyPresent: true };
    this.#records.set(parsed.id, parsed);
    return { written: true };
  }

  async delete(id: string): Promise<void> {
    const existing = this.#records.get(id);
    if (existing === undefined || existing.deletedAt !== undefined) return;
    const deletedAt = this.#now();
    this.#records.set(id, {
      ...existing,
      updatedAt: deletedAt,
      deletedAt,
    });
  }

  async restore(id: string): Promise<void> {
    const existing = this.#records.get(id);
    if (existing?.deletedAt === undefined) return;
    const restored = { ...existing };
    delete restored.deletedAt;
    restored.updatedAt = this.#now();
    this.#records.set(id, LocalCardRecordV1Schema.parse(restored));
  }
}

describe('CardRepository', () => {
  it('is implementable without IndexedDB, SQLite, slot policy, or network access', async () => {
    const repository: CardRepository = new InMemoryCardRepository(
      () => '2026-08-23T13:00:00.000Z',
    );
    await repository.put(createLocalCardRecord({ id: 'local-card-1' }));
    await repository.put(createLocalCardRecord({ id: 'local-card-2', cardType: 'scenario' }));
    await repository.put(createLocalCardRecord({ id: 'local-card-3' }));

    const firstPage = await repository.list({ limit: 2 });
    expect(firstPage.items.map((record) => record.id)).toEqual(['local-card-1', 'local-card-2']);
    await expect(repository.list({ limit: 2, cursor: firstPage.nextCursor })).resolves.toMatchObject({
      items: [{ id: 'local-card-3' }],
      nextCursor: undefined,
    });
    await expect(repository.list({ limit: 10, cardTypes: ['scenario'] })).resolves.toMatchObject({
      items: [{ id: 'local-card-2' }],
    });
  });

  it('defines delete as idempotent soft deletion that list excludes by default', async () => {
    const timestamps = [
      '2026-08-23T13:00:00.000Z',
      '2026-08-23T14:00:00.000Z',
    ];
    const repository: CardRepository = new InMemoryCardRepository(
      () => timestamps.shift() ?? '2026-08-23T15:00:00.000Z',
    );
    await repository.put(createLocalCardRecord());

    await repository.delete('local-card-1');
    await repository.delete('local-card-1');

    await expect(repository.get('local-card-1')).resolves.toMatchObject({
      deletedAt: '2026-08-23T13:00:00.000Z',
    });
    await expect(repository.list({ limit: 10 })).resolves.toMatchObject({ items: [] });
    await expect(repository.list({ limit: 10, includeDeleted: true })).resolves.toMatchObject({
      items: [{ id: 'local-card-1' }],
    });

    await expect(repository.put(createLocalCardRecord())).rejects.toThrow('cannot overwrite a tombstone');
    await repository.restore('local-card-1');
    const restoredPage = await repository.list({ limit: 10 });
    expect(restoredPage.items).toMatchObject([{ id: 'local-card-1' }]);
    expect(restoredPage.items[0]).not.toHaveProperty('deletedAt');
  });

  it('validates and defensively copies records at the persistence boundary', async () => {
    const repository: CardRepository = new InMemoryCardRepository(
      () => '2026-08-23T13:00:00.000Z',
    );
    const input = createLocalCardRecord({ data: { nested: { value: 'original' } } });

    await repository.put(input);
    (input.data as { nested: { value: string } }).nested.value = 'mutated';

    await expect(repository.get(input.id)).resolves.toMatchObject({
      data: { nested: { value: 'original' } },
    });
    await expect(repository.put({ ...input, storageLocation: 'cloud' } as unknown as LocalCardRecordV1))
      .rejects.toThrow();
  });
});
