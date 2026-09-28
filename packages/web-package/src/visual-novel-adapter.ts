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

import { FORUM_PACKAGE_REF, CHOICE_PACKAGE_REF, materializeCreativePreset } from './creative-presets-v1';
import { canRenderArenaNewsSrcdoc, materializeArenaNewsHtml } from './arena-news-adapter';

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
 * Transitional first-party builtin srcdoc adapter / fixture renderer.
 * It is intentionally package-specific; the generic Web Package resource-space
 * renderer remains a separate migration target in SPEC-web-package-unified-v1.
 */
export const renderBuiltinWebPackageSrcdoc = async (
  input: WebPackageOverlay,
): Promise<{ kind: 'srcdoc'; html: string }> => {
  const overlay = WebPackageOverlaySchema.parse(input);
  const base = await resolveWebPackage(overlay.packageRef);
  const instance = await createWebPackageInstance(base, overlay);
  if (!canRenderBuiltinWebPackageSrcdoc(base.ref)) {
    throw new Error('此 Web Package revision 不受内置包过渡适配器支持');
  }
  const story = decoder.decode(instance.readFile(overlay.targetPath)!);
  if (canRenderArenaNewsSrcdoc(base.ref)) {
    return { kind: 'srcdoc', html: materializeArenaNewsHtml(base.ref, (path) => instance.readFile(path), story) };
  }
  const materialize = canRenderBuiltinVisualNovelSrcdoc(base.ref) ? materializeVisualNovelHtml : materializeCreativePreset;
  return { kind: 'srcdoc', html: materialize((path) => instance.readFile(path), story) };
};

/** Presentation capability is an exact first-party allowlist, never arbitrary local HTML. */
export const canRenderBuiltinWebPackageSrcdoc = (ref: WebPackageRef): boolean => (
  canRenderArenaNewsSrcdoc(ref) || [BUILTIN_VISUAL_NOVEL_PACKAGE_REF, FORUM_PACKAGE_REF, CHOICE_PACKAGE_REF].some((known) => sameRef(ref, known))
);

/** Retained compatibility entry point for Visual Novel Lite consumers. */
export const renderBuiltinVisualNovelSrcdoc = renderBuiltinWebPackageSrcdoc;
