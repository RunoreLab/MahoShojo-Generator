// @vitest-environment jsdom
import '@/tests/helpers/fake-indexeddb';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { packWebPackageZip, resolveWebPackage, BUILTIN_ARENA_NEWS_PACKAGE_REF, verifyWebPackage, type ResolvedWebPackage } from '@mahoshojo/web-package';
import {
  drainWebPackageArchiveCache,
  importLocalWebPackageArchive,
  LEGACY_WEB_PACKAGE_CACHE_DB_NAME,
  readAllWebPackageArchiveCache,
  verifyCachedWebPackageArchive,
} from '@/lib/web-package/cache';
import { getLocalWebPackageRepository, resetLocalWebPackageRepository } from '@/lib/local-library/web-package-repository';
import {
  LOCAL_LIBRARY_DB_NAME,
  LOCAL_LIBRARY_SCHEMA_VERSION,
  getLocalLibraryRecord,
  resetLocalLibraryDbConnection,
  runLocalLibraryTransaction,
} from '@/lib/local-library/db';
import {
  ensureLocalLibrarySchemaRecord,
  hasCompletedLegacyWebPackageMigration,
  hydrateExactWebPackageFromLibrary,
  hydrateWebPackageSessionFromLibrary,
  migrateLegacyWebPackageCache,
  readWebPackageFromLibrary,
  saveWebPackageToLibrary,
} from '@/lib/local-library/web-package-library';
import { clearLocalWebPackageSessionStaging, listStagedLocalWebPackages } from '@mahoshojo/web-package';

const makePackage = async (id: string): Promise<ResolvedWebPackage> => {
  const builtin = await resolveWebPackage(BUILTIN_ARENA_NEWS_PACKAGE_REF);
  const manifest = { ...builtin.manifest, id, name: `本地包 ${id}` };
  return verifyWebPackage(manifest, manifest.files.map((file) => ({ path: file.path, bytes: builtin.readFile(file.path)! })));
};

const deleteDatabase = (name: string): Promise<void> =>
  new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });

const resetAll = async (): Promise<void> => {
  clearLocalWebPackageSessionStaging();
  resetLocalLibraryDbConnection();
  resetLocalWebPackageRepository();
  await deleteDatabase(LOCAL_LIBRARY_DB_NAME);
  await deleteDatabase(LEGACY_WEB_PACKAGE_CACHE_DB_NAME);
};

beforeEach(resetAll);
afterEach(resetAll);

it('导入只写会话 staging，不再无条件写旧缓存', async () => {
  const pkg = await makePackage('local.import-only');
  const archive = await packWebPackageZip(pkg);
  const { pkg: imported } = await importLocalWebPackageArchive(archive);

  expect(imported.ref.digest).toBe(pkg.ref.digest);
  expect(listStagedLocalWebPackages().some((item) => item.ref.digest === imported.ref.digest)).toBe(true);
  // 旧缓存曾无上限、无删除入口且被用户无法清理；它不再是默认落点。
  expect(await readAllWebPackageArchiveCache()).toEqual([]);
  expect((await getLocalWebPackageRepository().list({ limit: 10 })).items).toEqual([]);
});

it('重新导入同一份 ZIP 视为同一行并整卡替换', async () => {
  const pkg = await makePackage('local.same-bytes');
  const archive = await packWebPackageZip(pkg);
  const first = await saveWebPackageToLibrary({ pkg, archive });
  const second = await saveWebPackageToLibrary({ pkg, archive }, () => '2026-09-30T00:00:00.000Z');

  expect(first.updated).toBe(false);
  expect(second.updated).toBe(true);
  expect(second.record.id).toBe(first.record.id);
  expect((await getLocalWebPackageRepository().list({ limit: 10 })).items).toHaveLength(1);
});

it('记录仍在但字节缺失时读回为 null，而不是给出半个包', async () => {
  const pkg = await makePackage('local.missing-bytes');
  const { record } = await saveWebPackageToLibrary({ pkg, archive: await packWebPackageZip(pkg) });
  expect(await readWebPackageFromLibrary(record)).not.toBeNull();

  await getLocalWebPackageRepository().delete(record.id);
  expect(await readWebPackageFromLibrary(record)).toBeNull();
});

it('会话水合从本地库恢复，并且复核 digest', async () => {
  const pkg = await makePackage('local.hydrate');
  await saveWebPackageToLibrary({ pkg, archive: await packWebPackageZip(pkg) });
  clearLocalWebPackageSessionStaging();
  expect(listStagedLocalWebPackages()).toHaveLength(0);

  expect(await hydrateWebPackageSessionFromLibrary()).toBe(1);
  expect(listStagedLocalWebPackages().some((item) => item.ref.digest === pkg.ref.digest)).toBe(true);
});

it('历史回放只恢复 exact revision，删除后不再可用', async () => {
  const pkg = await makePackage('local.replay');
  const { record } = await saveWebPackageToLibrary({ pkg, archive: await packWebPackageZip(pkg) });
  clearLocalWebPackageSessionStaging();

  expect(await hydrateExactWebPackageFromLibrary(pkg.ref)).toBe(true);
  expect(listStagedLocalWebPackages().some((item) => item.ref.digest === pkg.ref.digest)).toBe(true);

  // 同 digest 但 id/version 不同：不得被当成同一个包。
  expect(await hydrateExactWebPackageFromLibrary({ ...pkg.ref, id: 'local.impersonated' })).toBe(false);

  await getLocalWebPackageRepository().delete(record.id);
  expect(await hydrateExactWebPackageFromLibrary(pkg.ref)).toBe(false);
});

it('旧缓存一次性迁入本地库并清空；重复执行是幂等的', async () => {
  const first = await makePackage('local.legacy-a');
  const second = await makePackage('local.legacy-b');
  const legacy = [
    { ref: { ...first.ref }, archive: (await packWebPackageZip(first)).slice().buffer as ArrayBuffer, cachedAt: 1 },
    { ref: { ...second.ref }, archive: (await packWebPackageZip(second)).slice().buffer as ArrayBuffer, cachedAt: 2 },
  ];
  let remaining = legacy;
  const readLegacy = async () => remaining;
  const drainLegacy = async () => { remaining = []; return true; };

  const outcome = await migrateLegacyWebPackageCache(readLegacy, drainLegacy, () => '2026-09-29T12:00:00.000Z');
  expect(outcome).toMatchObject({ migrated: 2, skipped: 0, failed: 0, drained: true });
  expect((await getLocalWebPackageRepository().list({ limit: 10 })).items).toHaveLength(2);

  const again = await migrateLegacyWebPackageCache(readLegacy, drainLegacy);
  expect(again).toMatchObject({ migrated: 0, drained: true });
  expect((await getLocalWebPackageRepository().list({ limit: 10 })).items).toHaveLength(2);
});

it('旧库读不到时保留旧数据并报告未清空', async () => {
  const readLegacy = async () => { throw new Error('IndexedDB 不可用'); };
  let drained = false;
  const drainLegacy = async () => { drained = true; return true; };

  const outcome = await migrateLegacyWebPackageCache(readLegacy, drainLegacy);
  expect(outcome.drained).toBe(false);
  // 迁移机会必须留到下次：读不到旧库时绝不能清空它。
  expect(drained).toBe(false);
});

it('旧库中 digest 与字节不符的行被跳过，而不是冒充成那个包', async () => {
  const pkg = await makePackage('local.mismatch');
  const forged = await makePackage('local.forged');
  const readLegacy = async () => [{
    ref: { ...pkg.ref },
    archive: (await packWebPackageZip(forged)).slice().buffer as ArrayBuffer,
    cachedAt: 1,
  }];

  const outcome = await migrateLegacyWebPackageCache(readLegacy, async () => true);
  expect(outcome).toMatchObject({ migrated: 0, skipped: 1, failed: 0 });
  expect(await verifyCachedWebPackageArchive({ ref: { ...pkg.ref }, archive: (await packWebPackageZip(forged)).slice().buffer as ArrayBuffer, cachedAt: 1 })).toBeNull();
});

it('旧库里有行没搬成功时不清空、也不写完成标记', async () => {
  const good = await makePackage('local.legacy-good');
  const bad = await makePackage('local.legacy-bad');
  let remaining = [
    { ref: { ...good.ref }, archive: (await packWebPackageZip(good)).slice().buffer as ArrayBuffer, cachedAt: 1 },
    { ref: { ...bad.ref }, archive: new Uint8Array([1, 2, 3]).buffer, cachedAt: 2 },
  ];
  let drained = false;
  const outcome = await migrateLegacyWebPackageCache(
    async () => remaining,
    async () => { drained = true; return true; },
  );
  expect(outcome.migrated).toBe(1);
  expect(outcome.failed).toBe(1);
  // 一行失败就绝不能清空：那可能是配额拒绝，清空等于删掉用户唯一的一份拷贝。
  expect(drained).toBe(false);
  expect(outcome.drained).toBe(false);
  expect(remaining).toHaveLength(2);
  expect(await hasCompletedLegacyWebPackageMigration()).toBe(false);
});

it('删除后重新导入同一份 ZIP 会显式恢复该行，而不是被 tombstone 拒绝', async () => {
  const pkg = await makePackage('local.reimport-after-delete');
  const archive = await packWebPackageZip(pkg);
  const first = await saveWebPackageToLibrary({ pkg, archive });
  await getLocalWebPackageRepository().delete(first.record.id);

  const second = await saveWebPackageToLibrary({ pkg, archive });
  expect(second.restored).toBe(true);
  expect(second.record.id).toBe(first.record.id);
  const page = await getLocalWebPackageRepository().list({ limit: 10 });
  expect(page.items).toHaveLength(1);
  expect(page.items[0]?.deletedAt).toBeUndefined();
  expect(await readWebPackageFromLibrary(second.record)).not.toBeNull();
});

it('未删除过的行不会被误判为恢复', async () => {
  const pkg = await makePackage('local.fresh');
  const archive = await packWebPackageZip(pkg);
  expect((await saveWebPackageToLibrary({ pkg, archive })).restored).toBe(false);
  expect((await saveWebPackageToLibrary({ pkg, archive })).restored).toBe(false);
});

it('记录本地库 schema 版本，供迁移与恢复判断读到的数据属于哪一版', async () => {
  await ensureLocalLibrarySchemaRecord(() => '2026-09-29T12:00:00.000Z');
  const row = await runLocalLibraryTransaction('meta', 'readonly', (transaction) =>
    getLocalLibraryRecord<{ key: string; value: string }>(transaction.objectStore('meta'), 'schemaVersion'),
  );
  expect(row?.value).toBe(String(LOCAL_LIBRARY_SCHEMA_VERSION));
});

it('水合在 IndexedDB 不可用时返回 false 而不是抛出（战报重放不能被它带崩）', async () => {
  const pkg = await makePackage('local.no-idb');
  await saveWebPackageToLibrary({ pkg, archive: await packWebPackageZip(pkg) });
  resetLocalLibraryDbConnection();
  resetLocalWebPackageRepository();
  const originalIndexedDb = globalThis.indexedDB;
  // @ts-expect-error 故意模拟浏览器拒绝提供 IndexedDB
  delete globalThis.indexedDB;
  try {
    await expect(hydrateExactWebPackageFromLibrary(pkg.ref)).resolves.toBe(false);
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
});

it('旧缓存桥在库不存在时读取为空、可安全清空', async () => {
  expect(await readAllWebPackageArchiveCache()).toEqual([]);
  expect(await drainWebPackageArchiveCache()).toBe(true);
});
