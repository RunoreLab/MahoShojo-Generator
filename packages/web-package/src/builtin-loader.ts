import type { WebPackageRef } from '@mahoshojo/contracts/web-package';
import { digestWebPackageBytes, verifyWebPackage, type VerifiedWebPackage } from './verify';
import { BUILTIN_VISUAL_NOVEL_PACKAGE_REF, VISUAL_NOVEL_FILES } from './visual-novel-v1';
import { FORUM_PACKAGE_REF, FORUM_FILES, CHOICE_PACKAGE_REF, CHOICE_FILES } from './creative-presets-v1';

const revisions = [
 { ref: BUILTIN_VISUAL_NOVEL_PACKAGE_REF, name: 'Visual Novel Lite', files: VISUAL_NOVEL_FILES, assetCatalog: 'ai/assets.json' },
 { ref: FORUM_PACKAGE_REF, name: '星屑社区', files: FORUM_FILES },
 { ref: CHOICE_PACKAGE_REF, name: '命运岔路', files: CHOICE_FILES },
];
const cache = new Map<string, Promise<VerifiedWebPackage>>();
export const loadBuiltinWebPackage = async (ref: WebPackageRef): Promise<VerifiedWebPackage> => {
 const revision = revisions.find((item) => item.ref.id === ref.id && item.ref.version === ref.version && item.ref.digest === ref.digest);
 if (!revision) throw new Error('不支持的内置 Web Package revision');
 const key = `${ref.id}@${ref.version}:${ref.digest}`;
 let pending = cache.get(key);
 if (!pending) {
  pending = (async () => {
   const files = revision.files.map((file) => ({ ...file, bytes: new TextEncoder().encode(file.content) }));
   const descriptors = await Promise.all(files.map(async (file) => ({ path: file.path, mediaType: file.mediaType, digest: await digestWebPackageBytes(file.bytes), size: file.bytes.byteLength })));
   return verifyWebPackage({ format: 'mahoshojo-web-package', formatVersion: 1, id: ref.id, version: ref.version, name: revision.name, entry: 'index.html', capabilities: ['scripts'], generation: { target: 'data/story.json', mode: 'replace', mediaType: 'application/json', instructions: 'ai/instructions.md', schema: 'schemas/story.schema.json', ...(revision.assetCatalog ? { assetCatalog: revision.assetCatalog } : {}) }, files: descriptors }, files);
  })();
  cache.set(key, pending);
  pending.catch(() => { cache.delete(key); });
 }
 return pending;
};
