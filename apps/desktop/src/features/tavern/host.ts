import { renderTavernDefaultBase } from '@mahoshojo/ui-web/tavern';
import { saveImportedUnsignedCharacter } from '@mahoshojo/local-library/imported-unsigned-card';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import type { TavernExportFile, TavernGeneralProjection } from '@mahoshojo/ui-web/tavern';

/** Uses the existing WebView2 download flow; no new native filesystem or network permission. */
export function exportTavernFile({ name, bytes, mimeType }: TavernExportFile): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  try { anchor.click(); } finally { anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000); }
}

export function saveDesktopTavernCard(repository: CardRepository, data: TavernGeneralProjection) {
  return saveImportedUnsignedCharacter(repository, data, data.name);
}

let defaultBase: Promise<Uint8Array> | undefined;
/** Fixed packaged asset only; never a user-selected remote URL. */
export function getDesktopTavernBase(): Promise<Uint8Array> {
  return defaultBase ??= renderTavernDefaultBase(async () => {
    const response = await fetch('/logo.svg');
    if (!response.ok) throw new Error('默认 Logo 获取失败');
    return response.text();
  });
}
