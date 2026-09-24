import { unzipSync, zipSync } from 'fflate';
import { WEB_PACKAGE_MANIFEST_PATH } from '@mahoshojo/contracts/web-package';
import { verifyWebPackage, type VerifiedWebPackage } from './verify';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
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

/** Re-import parity path: same verifyWebPackage contract as builtins/local staging. */
export const unpackWebPackageZip = async (archive: Uint8Array): Promise<VerifiedWebPackage> => {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(archive);
  } catch {
    throw new Error('Web Package ZIP 无法解析');
  }
  const manifestBytes = entries[WEB_PACKAGE_MANIFEST_PATH];
  if (!manifestBytes) throw new Error(`Web Package 缺少 ${WEB_PACKAGE_MANIFEST_PATH}`);
  let manifest: unknown;
  try {
    manifest = JSON.parse(decoder.decode(manifestBytes));
  } catch {
    throw new Error(`Web Package ${WEB_PACKAGE_MANIFEST_PATH} 不是合法 JSON`);
  }
  const rawFiles = (manifest as { files?: Array<{ path?: unknown }> }).files;
  if (!Array.isArray(rawFiles)) throw new Error(`Web Package ${WEB_PACKAGE_MANIFEST_PATH} 缺少 files`);
  const files = rawFiles.map((file) => {
    if (typeof file?.path !== 'string') throw new Error(`Web Package ${WEB_PACKAGE_MANIFEST_PATH} 文件条目非法`);
    const bytes = entries[file.path];
    if (!bytes) throw new Error(`Web Package ZIP 缺少文件：${file.path}`);
    return { path: file.path, bytes };
  });
  return verifyWebPackage(manifest, files);
};
