import { zipSync } from 'fflate';
import { WEB_PACKAGE_MANIFEST_PATH } from '@mahoshojo/contracts/web-package';
import { ZIP_DOS_EPOCH } from '@mahoshojo/contracts/zip';
import { importWebPackageArchive } from './import';
import type { VerifiedWebPackage } from './verify';

const encoder = new TextEncoder();
/**
 * 固定条目时间让打包输出可复现。
 *
 * 纪元的构造方式（本地时间 vs UTC 字面量）不是风格问题：在 UTC 以西的时区，UTC 字面量会让
 * `zipSync` 直接抛 `date not in range 1980-2099`，也就是**当前所有美洲用户都无法导出 Web 包**。
 * 理由与实测见 {@link ZIP_DOS_EPOCH}。
 */
const ZIP_MTIME = ZIP_DOS_EPOCH;

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
