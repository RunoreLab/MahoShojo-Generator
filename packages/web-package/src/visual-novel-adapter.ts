import {
  WebPackageOverlaySchema,
  type WebPackageOverlay,
} from '@mahoshojo/contracts/web-package';
import { createWebPackageInstance, resolveWebPackage } from './index';
import {
  BUILTIN_VISUAL_NOVEL_PACKAGE_REF,
  materializeVisualNovelHtml,
} from './visual-novel-v1';

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const sameRef = (left: { id: string; version: string; digest: string }, right: { id: string; version: string; digest: string }): boolean => (
  left.id === right.id && left.version === right.version && left.digest === right.digest
);

/**
 * Transitional first-party Visual Novel Lite srcdoc adapter / fixture renderer.
 * Production mounts use the generic resource-space URL path; this must not become
 * the generic `renderWebPackage()` implementation for arbitrary packages.
 */
export const renderWebPackage = async (
  input: WebPackageOverlay,
): Promise<{ kind: 'srcdoc'; html: string }> => {
  const overlay = WebPackageOverlaySchema.parse(input);
  const base = await resolveWebPackage(overlay.packageRef);
  const instance = await createWebPackageInstance(base, overlay);
  if (!sameRef(base.ref, BUILTIN_VISUAL_NOVEL_PACKAGE_REF)) {
    throw new Error('此 Web Package revision 尚无 first-party 渲染器');
  }
  const story = decoder.decode(instance.readFile(overlay.targetPath)!);
  return { kind: 'srcdoc', html: materializeVisualNovelHtml((path) => instance.readFile(path), story) };
};
