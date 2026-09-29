'use client';

import { packWebPackageZip, unpackWebPackageZip } from '@mahoshojo/web-package';
import type { LocalWebPackageRecordV1 } from '@mahoshojo/local-library/web-package-record';

import {
  deriveLocalWebPackageId,
  getLocalWebPackageRepository,
} from './web-package-repository';
import { LOCAL_LIBRARY_META_KEYS, getLocalLibraryRecord, putLocalLibraryRecord, runLocalLibraryTransaction } from './db';
import { LOCAL_LIBRARY_STORE_NAMES } from './db';

export interface SaveWebPackageToLibraryInput {
  pkg: { ref: { id: string; version: string; digest: string }; manifest: LocalWebPackageRecordV1['manifest'] };
  /** 原始 ZIP 字节；记录与字节在同一事务写入。 */
  archive: Uint8Array;
  execution?: 'imported' | 'downloaded';
}

/**
 * 写入本地库。内容身份就是 `ref.digest`，所以「重新导入同一个 ZIP」永远落在同一行，
 * 命中即整卡替换——这正是避免本地库堆满近似副本的机制。
 */
export const saveWebPackageToLibrary = async (
  input: SaveWebPackageToLibraryInput,
  now: () => string = () => new Date().toISOString(),
): Promise<{ record: LocalWebPackageRecordV1; updated: boolean }> => {
  const repository = getLocalWebPackageRepository();
  const id = deriveLocalWebPackageId(input.pkg.ref.digest);
  const existing = await repository.get(id);
  const timestamp = now();
  const record: LocalWebPackageRecordV1 = {
    id,
    schemaVersion: 1,
    storageLocation: 'local',
    entityKind: 'web-package',
    title: input.pkg.manifest.name,
    summary: `${input.pkg.ref.id}@${input.pkg.ref.version}`,
    ref: input.pkg.ref,
    manifest: input.pkg.manifest,
    contentDigest: input.pkg.ref.digest,
    archiveByteLength: input.archive.byteLength,
    provenance: { kind: 'unsigned', execution: input.execution ?? 'imported' },
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  await repository.put(record, input.archive);
  return { record, updated: existing !== null };
};

/** 从本地库记录还原可解析的包；记录存在但字节缺失时返回 null（损坏行）。 */
export const readWebPackageFromLibrary = async (
  record: LocalWebPackageRecordV1,
): Promise<Awaited<ReturnType<typeof unpackWebPackageZip>> | null> => {
  const repository = getLocalWebPackageRepository();
  const archive = await repository.readArchive(record.ref.digest);
  if (!archive) return null;
  try {
    const pkg = await unpackWebPackageZip(archive);
    // 记录与字节必须仍是同一个包，否则说明二者被分别改写过。
    if (pkg.ref.digest !== record.ref.digest) return null;
    return pkg;
  } catch {
    return null;
  }
};

export const exportWebPackageArchive = async (record: LocalWebPackageRecordV1): Promise<Uint8Array | null> => {
  const archive = await getLocalWebPackageRepository().readArchive(record.ref.digest);
  if (archive) return archive;
  const pkg = await readWebPackageFromLibrary(record);
  return pkg ? packWebPackageZip(pkg) : null;
};

export interface LegacyCacheMigrationResult {
  migrated: number;
  skipped: number;
  failed: number;
  /** 旧缓存库已无内容或读取失败时为 true；读取失败时不得删除旧库。 */
  drained: boolean;
}

/**
 * 一次性把旧的 Web 包 IndexedDB 缓存搬进本地库，然后清空旧表。
 *
 * 只在旧表非空且本地库还没有这些 digest 时写入，因此重复执行是幂等的。
 * 读不到旧库（不支持/被拒）时 `drained` 为 false：这时绝不能删旧库，
 * 否则用户会同时失去旧缓存和迁移机会。
 */
export const migrateLegacyWebPackageCache = async (
  readLegacy: () => Promise<{ ref: { id: string; version: string; digest: string }; archive: ArrayBuffer }[]>,
  drainLegacy: () => Promise<boolean>,
  now: () => string = () => new Date().toISOString(),
): Promise<LegacyCacheMigrationResult> => {
  let entries: { ref: { id: string; version: string; digest: string }; archive: ArrayBuffer }[];
  try {
    entries = await readLegacy();
  } catch {
    return { migrated: 0, skipped: 0, failed: 0, drained: false };
  }
  if (entries.length === 0) return { migrated: 0, skipped: 0, failed: 0, drained: true };

  const result: LegacyCacheMigrationResult = { migrated: 0, skipped: 0, failed: 0, drained: true };
  for (const entry of entries) {
    try {
      const pkg = await unpackWebPackageZip(new Uint8Array(entry.archive));
      if (pkg.ref.digest !== entry.ref.digest) {
        result.skipped += 1;
        continue;
      }
      await saveWebPackageToLibrary({ pkg, archive: new Uint8Array(entry.archive) }, now);
      result.migrated += 1;
    } catch {
      // 损坏行不是迁移失败的理由：其余行仍应进入本地库。
      result.failed += 1;
    }
  }

  try {
    result.drained = await drainLegacy();
  } catch {
    result.drained = false;
  }
  return result;
};

const LEGACY_MIGRATION_META_KEY = LOCAL_LIBRARY_META_KEYS.legacyWebPackageCacheMigratedAt;
export const hasCompletedLegacyWebPackageMigration = async (): Promise<boolean> => {
  try {
    const row = await runLocalLibraryTransaction(LOCAL_LIBRARY_STORE_NAMES.meta, 'readonly', (transaction) =>
      getLocalLibraryRecord<{ key: string; value: string }>(
        transaction.objectStore(LOCAL_LIBRARY_STORE_NAMES.meta),
        LEGACY_MIGRATION_META_KEY,
      ),
    );
    return row !== undefined;
  } catch {
    // 读不到标记时宁可再跑一次：迁移本身幂等。
    return false;
  }
};

export const markLegacyWebPackageMigrationCompleted = async (now: () => string = () => new Date().toISOString()): Promise<void> => {
  await runLocalLibraryTransaction(LOCAL_LIBRARY_STORE_NAMES.meta, 'readwrite', (transaction) =>
    putLocalLibraryRecord(transaction.objectStore(LOCAL_LIBRARY_STORE_NAMES.meta), {
      key: LEGACY_MIGRATION_META_KEY,
      value: now(),
    }),
  );
};

const readAllLibraryRecords = async (): Promise<LocalWebPackageRecordV1[]> => {
  const repository = getLocalWebPackageRepository();
  const items: LocalWebPackageRecordV1[] = [];
  let cursor: string | undefined;
  do {
    const page = await repository.list({ limit: 100, ...(cursor ? { cursor } : {}) });
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
};

/**
 * 把本地库中的 Web 包恢复进当前会话的 staging。
 *
 * 每次都重新解包并复核 digest：本地库条目可能来自上一次会话，宿主不能假设它仍然可用。
 * 损坏或缺字节的条目被静默跳过——用户可以在模态框里重新导入。
 */
export const hydrateWebPackageSessionFromLibrary = async (): Promise<number> => {
  const { stageLocalWebPackage } = await import('@mahoshojo/web-package');
  let records: LocalWebPackageRecordV1[];
  try {
    records = await readAllLibraryRecords();
  } catch {
    return 0;
  }
  let staged = 0;
  for (const record of records) {
    const pkg = await readWebPackageFromLibrary(record);
    if (!pkg) continue;
    stageLocalWebPackage(pkg);
    staged += 1;
  }
  return staged;
};

/**
 * 历史详情专用：只恢复那一个 exact revision，不要求先水合整个本地库。
 * 战报历史引用的 digest 若已被用户删除，这里返回 false，由既有的「重新导入」流程兜底。
 */
export const hydrateExactWebPackageFromLibrary = async (ref: {
  id: string; version: string; digest: string;
}): Promise<boolean> => {
  const { stageLocalWebPackage } = await import('@mahoshojo/web-package');
  const record = await getLocalWebPackageRepository().findByDigest(ref.digest);
  if (!record) return false;
  if (record.ref.id !== ref.id || record.ref.version !== ref.version) return false;
  const pkg = await readWebPackageFromLibrary(record);
  if (!pkg) return false;
  stageLocalWebPackage(pkg);
  return true;
};
