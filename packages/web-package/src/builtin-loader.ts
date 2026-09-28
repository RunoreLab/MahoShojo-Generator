import type { WebPackageRef } from '@mahoshojo/contracts/web-package';
import { verifyWebPackage, type VerifiedWebPackage } from './verify';

const cache = new Map<string, Promise<VerifiedWebPackage>>();
export const loadBuiltinWebPackage = async (ref: WebPackageRef): Promise<VerifiedWebPackage> => {
  const key = `${ref.id}@${ref.version}:${ref.digest}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = (async () => {
      const { PRESET_REVISIONS } = await import('./generated/preset-files');
      const revision = PRESET_REVISIONS.find((item) => item.ref.id === ref.id && item.ref.version === ref.version && item.ref.digest === ref.digest);
      if (!revision) throw new Error('不支持的内置 Web Package revision');
      const files = revision.files.map(({ path, base64 }) => ({ path, bytes: Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)) }));
      const base = await verifyWebPackage(revision.manifest, files);
      if (base.ref.digest !== ref.digest) throw new Error('内置 Web Package revision 完整性校验失败');
      return base;
    })();
    cache.set(key, pending);
    pending.catch(() => { cache.delete(key); });
  }
  return pending;
};
