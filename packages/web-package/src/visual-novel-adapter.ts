import {
  WebPackageOverlaySchema,
  type WebPackageOverlay,
  type WebPackageRef,
} from '@mahoshojo/contracts/web-package';
import { createWebPackageInstance, resolveWebPackage } from './index';
import {
  BUILTIN_VISUAL_NOVEL_PACKAGE_REF,
  materializeVisualNovelHtml,
} from './visual-novel-v1';

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const sameRef = (left: WebPackageRef, right: WebPackageRef): boolean => (
  left.id === right.id && left.version === right.version && left.digest === right.digest
);

/**
 * Whether the transitional first-party Visual Novel Lite srcdoc adapter can
 * materialize this exact package revision. This is presentation capability,
 * not package validity or replay compatibility.
 */
export const canRenderBuiltinVisualNovelSrcdoc = (ref: WebPackageRef): boolean => (
  sameRef(ref, BUILTIN_VISUAL_NOVEL_PACKAGE_REF)
);

/**
 * Transitional first-party Visual Novel Lite srcdoc adapter / fixture renderer.
 * It is intentionally package-specific; the generic Web Package resource-space
 * renderer remains a separate migration target in SPEC-web-package-unified-v1.
 */
export const renderBuiltinVisualNovelSrcdoc = async (
  input: WebPackageOverlay,
): Promise<{ kind: 'srcdoc'; html: string }> => {
  const overlay = WebPackageOverlaySchema.parse(input);
  const base = await resolveWebPackage(overlay.packageRef);
  const instance = await createWebPackageInstance(base, overlay);
  if (!canRenderBuiltinVisualNovelSrcdoc(base.ref)) {
    throw new Error('此 Web Package revision 不受 Visual Novel Lite 过渡适配器支持');
  }
  const story = decoder.decode(instance.readFile(overlay.targetPath)!);
  return { kind: 'srcdoc', html: materializeVisualNovelHtml((path) => instance.readFile(path), story) };
};
