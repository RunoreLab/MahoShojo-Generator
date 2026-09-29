// @vitest-environment jsdom
import '@/tests/helpers/fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalCardRecordV1Schema, type LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import type { LocalWebPackageRecordV1 } from '@mahoshojo/local-library/web-package-record';
import {
  LOCAL_LIBRARY_DB_NAME,
  resetLocalLibraryDbConnection,
} from '@/lib/local-library/db';
import { IndexedDbCardRepository, resetLocalCardRepository } from '@/lib/local-library/card-repository';
import {
  IndexedDbWebPackageRepository,
  deriveLocalWebPackageId,
  resetLocalWebPackageRepository,
} from '@/lib/local-library/web-package-repository';

// 契约要求 createdAt <= updatedAt <= deletedAt，而仓储用真实时钟写 tombstone；
// 夹具必须相对当下取时间，否则本机时钟落在夹具时间之前会写出一条自身非法的行。
const ago = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();

const createRecord = (overrides: Partial<LocalCardRecordV1> = {}): LocalCardRecordV1 => ({
  id: 'local-card-1',
  schemaVersion: 1,
  storageLocation: 'local',
  cardType: 'character',
  title: '测试角色',
  data: { name: '焰' },
  contentDigest: `sha256:${'a'.repeat(64)}`,
  provenance: { kind: 'unsigned', execution: 'direct-local' },
  // createdAt 跟随 updatedAt，否则单独覆盖 updatedAt 会写出一条自身非法的记录。
  createdAt: ago(10),
  updatedAt: ago(10),
  ...overrides,
});
const createRecordAt = (updatedAt: string, overrides: Partial<LocalCardRecordV1> = {}): LocalCardRecordV1 =>
  createRecord({ createdAt: updatedAt, updatedAt, ...overrides });

const DIGEST = `sha256:${'b'.repeat(64)}`;

const createWebPackageRecord = (overrides: Partial<LocalWebPackageRecordV1> = {}): LocalWebPackageRecordV1 => ({
  id: deriveLocalWebPackageId(DIGEST),
  schemaVersion: 1,
  storageLocation: 'local',
  entityKind: 'web-package',
  title: '本地包',
  summary: 'local.demo@1.0.0',
  ref: { id: 'local.demo', version: '1.0.0', digest: DIGEST },
  manifest: {
    format: 'mahoshojo-web-package',
    formatVersion: 1,
    id: 'local.demo',
    version: '1.0.0',
    name: '本地包',
    entry: 'index.html',
    generation: { target: 'index.html', mode: 'replace', mediaType: 'text/html' },
    capabilities: [],
    files: [{ path: 'index.html', mediaType: 'text/html', digest: DIGEST, size: 1 }],
  },
  contentDigest: DIGEST,
  archiveByteLength: 3,
  provenance: { kind: 'unsigned', execution: 'imported' },
  createdAt: ago(10),
  updatedAt: ago(10),
  ...overrides,
});
const createWebPackageRecordAt = (updatedAt: string, overrides: Partial<LocalWebPackageRecordV1> = {}): LocalWebPackageRecordV1 =>
  createWebPackageRecord({ createdAt: updatedAt, updatedAt, ...overrides });

beforeEach(async () => {
  resetLocalLibraryDbConnection();
  resetLocalCardRepository();
  resetLocalWebPackageRepository();
  // fake-indexeddb 在同一进程内按名字共享数据库；每个用例从干净状态开始。
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(LOCAL_LIBRARY_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
});

describe('IndexedDbCardRepository', () => {
  it('round-trips a validated local card without a cloud round trip', async () => {
    const repository = new IndexedDbCardRepository();
    const record = createRecord();
    await repository.put(record);

    const stored = await repository.get(record.id);
    expect(stored).toEqual(record);
    expect(await repository.get('missing')).toBeNull();
  });

  it('hides tombstones from list but keeps them addressable through get', async () => {
    const repository = new IndexedDbCardRepository();
    await repository.put(createRecord());
    await repository.delete('local-card-1');

    expect((await repository.list({ limit: 10 })).items).toEqual([]);
    const tombstone = await repository.get('local-card-1');
    expect(tombstone?.deletedAt).toEqual(expect.any(String));
    expect((await repository.list({ limit: 10, includeDeleted: true })).items).toHaveLength(1);

    // 删除幂等：重复删除不得改变首次 tombstone 的时间。
    const firstDeletedAt = tombstone?.deletedAt;
    await repository.delete('local-card-1');
    expect((await repository.get('local-card-1'))?.deletedAt).toBe(firstDeletedAt);
  });

  it('keeps a tombstone valid when the device clock runs behind the record', async () => {
    const repository = new IndexedDbCardRepository();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    await repository.put(createRecordAt(future));
    await repository.delete('local-card-1');
    expect((await repository.get('local-card-1'))?.deletedAt).toBe(future);
  });

  it('refuses to resurrect a tombstone through a normal put', async () => {
    const repository = new IndexedDbCardRepository();
    await repository.put(createRecord());
    await repository.delete('local-card-1');
    await expect(repository.put(createRecord())).rejects.toThrow('已被删除');
  });

  it('filters by card type and pages with a stable order', async () => {
    const repository = new IndexedDbCardRepository();
    const sameInstant = ago(10);
    await repository.put(createRecordAt(sameInstant, { id: 'c1' }));
    await repository.put(createRecordAt(ago(5), { id: 'c2', cardType: 'scenario' }));
    await repository.put(createRecordAt(sameInstant, { id: 'c3' }));

    const firstPage = await repository.list({ limit: 2 });
    expect(firstPage.items.map((item) => item.id)).toEqual(['c2', 'c1']);
    expect(firstPage.nextCursor).toBe('2');

    const secondPage = await repository.list({ limit: 2, cursor: firstPage.nextCursor });
    expect(secondPage.items.map((item) => item.id)).toEqual(['c3']);
    expect(secondPage.nextCursor).toBeUndefined();

    const scenarios = await repository.list({ limit: 10, cardTypes: ['scenario'] });
    expect(scenarios.items.map((item) => item.id)).toEqual(['c2']);
  });

  it('reports an unreadable row instead of silently presenting an empty library', async () => {
    const repository = new IndexedDbCardRepository();
    await repository.put(createRecord());
    const { runLocalLibraryTransaction, LOCAL_LIBRARY_STORE_NAMES, putLocalLibraryRecord } = await import(
      '@/lib/local-library/db'
    );
    await runLocalLibraryTransaction(LOCAL_LIBRARY_STORE_NAMES.dataCards, 'readwrite', (transaction) =>
      putLocalLibraryRecord(transaction.objectStore(LOCAL_LIBRARY_STORE_NAMES.dataCards), { id: 'broken' }),
    );
    await expect(repository.get('broken')).rejects.toThrow('无法解析');
  });
});

describe('IndexedDbWebPackageRepository', () => {
  it('stores the record and its ZIP bytes in one transaction', async () => {
    const repository = new IndexedDbWebPackageRepository();
    const record = createWebPackageRecord();
    await repository.put(record, new Uint8Array([1, 2, 3]));

    expect(await repository.get(record.id)).toEqual(record);
    expect(await repository.findByDigest(DIGEST)).toEqual(record);
    expect([...(await repository.readArchive(DIGEST))!]).toEqual([1, 2, 3]);
  });

  it('treats a re-import of identical bytes as the same row instead of a new package', async () => {
    const repository = new IndexedDbWebPackageRepository();
    const firstImport = ago(1);
    await repository.put(createWebPackageRecord(), new Uint8Array([1, 2, 3]));
    await repository.put(createWebPackageRecordAt(firstImport), new Uint8Array([1, 2, 3]));

    const page = await repository.list({ limit: 10 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.updatedAt).toBe(firstImport);
  });

  it('rejects a record whose id was not derived from its own digest', async () => {
    const repository = new IndexedDbWebPackageRepository();
    await expect(
      repository.put(createWebPackageRecord({ id: 'wp_forged' }), new Uint8Array([1])),
    ).rejects.toThrow('内容摘要不一致');
  });

  it('drops the archive bytes on soft delete and keeps the tombstone addressable', async () => {
    const repository = new IndexedDbWebPackageRepository();
    const record = createWebPackageRecord();
    await repository.put(record, new Uint8Array([1, 2, 3]));
    await repository.delete(record.id);

    expect((await repository.list({ limit: 10 })).items).toEqual([]);
    expect((await repository.get(record.id))?.deletedAt).toEqual(expect.any(String));
    expect(await repository.readArchive(DIGEST)).toBeNull();
    await expect(repository.put(record, new Uint8Array([1, 2, 3]))).rejects.toThrow('已被删除');
  });

  it('reports a missing archive instead of returning truncated bytes', async () => {
    const repository = new IndexedDbWebPackageRepository();
    expect(await repository.readArchive(`sha256:${'e'.repeat(64)}`)).toBeNull();
  });

  it('copies the archive slice so a larger backing buffer is not persisted', async () => {
    const repository = new IndexedDbWebPackageRepository();
    const record = createWebPackageRecord();
    const view = new Uint8Array([9, 9, 1, 2, 3, 9]).subarray(2, 5);
    await repository.put(record, view);
    const restored = await repository.readArchive(DIGEST);
    expect([...restored!]).toEqual([1, 2, 3]);
  });
});

it('keeps a single IndexedDB factory across suites', () => {
  // fake-indexeddb/auto 在 jsdom 环境下安装全局；显式断言避免该前提被静默破坏。
  expect(typeof globalThis.indexedDB.open).toBe('function');
  expect(LocalCardRecordV1Schema.parse(createRecord())).toBeTruthy();
});
