import { zipSync } from 'fflate';
import { WEB_PACKAGE_MANIFEST_PATH } from '@mahoshojo/contracts/web-package';
import { importWebPackageArchive } from './import';
import type { VerifiedWebPackage } from './verify';

const encoder = new TextEncoder();
// ZIP local time must fall within 1980–2099; fixed epoch keeps packing deterministic.
const ZIP_MTIME = new Date('1980-01-01T00:00:00.000Z');

/** Deterministic logical layout: root web-package.json plus sorted payload paths. */
export const packWebPackageZip = async (base: VerifiedWebPackage): Promise<Uint8Array> => {
  const entries: Record<string, Uint8Array> = {
    [WEB_PACKAGE_MANIFEST_PATH]: encoder.encode(JSON.stringify(base.manifest, null, 2)),
  };
  for (const file of [...base.manifest.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const bytes = base.readFile(file.path);
    if (!bytes) throw new Error(`Web Package 文件不存在：${file.path}`);
    entries[file.path] = bytes;
  }
  return zipSync(entries, { level: 6, mtime: ZIP_MTIME });
};

/**
 * Re-import parity path: same verifyWebPackage contract as builtins/local
 * staging. Discards import diagnostics; callers that report normalization or
 * applied defaults to users should call importWebPackageArchive directly.
 */
export const unpackWebPackageZip = async (archive: Uint8Array): Promise<VerifiedWebPackage> =>
  (await importWebPackageArchive(archive)).pkg;
