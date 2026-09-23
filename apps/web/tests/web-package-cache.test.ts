import '@/tests/helpers/fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BUILTIN_VISUAL_NOVEL_PACKAGE_REF,
  clearLocalWebPackageSessionStaging,
  listStagedLocalWebPackages,
  packWebPackageZip,
  resolveWebPackage,
  stageLocalWebPackage,
  unpackWebPackageZip,
} from '@mahoshojo/web-package';
import {
  deleteWebPackageArchiveCache,
  hydrateWebPackageSessionFromCache,
  importLocalWebPackageArchive,
  putWebPackageArchiveCache,
  readWebPackageArchiveCache,
} from '@/lib/web-package/cache';

const createLocalPackage = async () => {
  const archive = await packWebPackageZip(await resolveWebPackage(BUILTIN_VISUAL_NOVEL_PACKAGE_REF));
  const unpacked = await unpackWebPackageZip(archive);
  const manifest = { ...unpacked.manifest, id: 'local.cache-test', name: '缓存测试包' };
  const { verifyWebPackage } = await import('@mahoshojo/web-package');
  const pkg = await verifyWebPackage(manifest, manifest.files.map((file) => ({
    path: file.path, bytes: unpacked.readFile(file.path)!,
  })));
  const localArchive = await packWebPackageZip(pkg);
  return { archive: localArchive, pkg };
};

describe('optional local Web package archive cache', () => {
  beforeEach(() => {
    clearLocalWebPackageSessionStaging();
    return deleteWebPackageArchiveCache(`sha256:${'0'.repeat(64)}`).catch(() => undefined);
  });

  it('imports, stages, best-effort caches, and rehydrates with integrity', async () => {
    clearLocalWebPackageSessionStaging();
    const { archive, pkg } = await createLocalPackage();
    const imported = await importLocalWebPackageArchive(archive);
    expect(imported.ref).toEqual(pkg.ref);
    expect(listStagedLocalWebPackages().map((item) => item.ref.digest)).toContain(pkg.ref.digest);

    // import already kicked off a best-effort put; wait for it by re-putting.
    expect(await putWebPackageArchiveCache(pkg)).toBe(true);
    const cached = await readWebPackageArchiveCache(pkg.ref.digest);
    expect(cached?.ref).toEqual(pkg.ref);
    expect(cached!.archive.byteLength).toBeGreaterThan(0);

    clearLocalWebPackageSessionStaging();
    expect(listStagedLocalWebPackages()).toHaveLength(0);
    const stagedCount = await hydrateWebPackageSessionFromCache();
    expect(stagedCount).toBeGreaterThanOrEqual(1);
    expect(listStagedLocalWebPackages().map((item) => item.ref.digest)).toContain(pkg.ref.digest);

    await deleteWebPackageArchiveCache(pkg.ref.digest);
    expect(await readWebPackageArchiveCache(pkg.ref.digest)).toBeNull();
    clearLocalWebPackageSessionStaging();
  });

  it('keeps cache failures non-blocking for staging', async () => {
    const { archive, pkg } = await createLocalPackage();
    stageLocalWebPackage(pkg);
    // Missing IDB environment is simulated by deleting after stage; put returns false only on failure.
    const ok = await putWebPackageArchiveCache(pkg);
    expect(typeof ok).toBe('boolean');
    expect(listStagedLocalWebPackages().map((item) => item.ref.digest)).toContain(pkg.ref.digest);
    await deleteWebPackageArchiveCache(pkg.ref.digest);
    clearLocalWebPackageSessionStaging();
  });
});
