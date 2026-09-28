import { WebPackageOverlaySchema, type WebPackageOverlay } from '@mahoshojo/contracts/web-package';
import { createWebPackageInstance, resolveWebPackage } from './index';
import { canRenderArenaNewsSrcdoc, materializeArenaNewsHtml } from './arena-news-adapter';

/** Exact first-party capability; this is not a generic local-package renderer. */
export const canRenderBuiltinWebPackageSrcdoc = canRenderArenaNewsSrcdoc;

export const renderBuiltinWebPackageSrcdoc = async (
  input: WebPackageOverlay,
): Promise<{ kind: 'srcdoc'; html: string }> => {
  const overlay = WebPackageOverlaySchema.parse(input);
  const base = await resolveWebPackage(overlay.packageRef);
  const instance = await createWebPackageInstance(base, overlay);
  const html = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(instance.readFile(overlay.targetPath)!);
  return { kind: 'srcdoc', html: materializeArenaNewsHtml(base.ref, (path) => instance.readFile(path), html) };
};
