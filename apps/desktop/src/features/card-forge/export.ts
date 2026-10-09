import { capturePngBlob, DENY_SNAPDOM_MEDIA, getSafeDpr } from '@mahoshojo/ui-web/client';
import { assertForgeDimensions } from './local-media';

export const captureLocalForgeImage: typeof capturePngBlob = (element, options) => {
  const bounds = element.getBoundingClientRect();
  const factor = (options?.scale ?? 1) * getSafeDpr(options?.dprMax ?? 2);
  assertForgeDimensions(Math.ceil(Math.max(bounds.width, element.scrollWidth) * factor), Math.ceil(Math.max(bounds.height, element.scrollHeight) * factor));
  return capturePngBlob(element, { ...options, mediaAdapter: DENY_SNAPDOM_MEDIA });
};
/** WebView download with the existing Desktop delayed-revocation lifetime. */
export function downloadForgeBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.rel = 'noopener';
  try { document.body.appendChild(anchor); anchor.click(); }
  finally { anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000); }
}
