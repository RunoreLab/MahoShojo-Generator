import { renderTavernDefaultBase } from '@mahoshojo/ui-web/tavern-default-base';
export { createTavernV3Card, encodeTavernCardAsBase64Json, writeTavernCardToPngBytes, getPlaceholderPngBytes } from '@mahoshojo/domain/tavern-card';
let defaultBasePngPromise: Promise<Uint8Array> | null = null;
export function getDefaultTavernBasePngBytes(): Promise<Uint8Array> {
  return defaultBasePngPromise ??= renderTavernDefaultBase(async () => {
    const response = await fetch('/logo.svg', { cache: 'force-cache' });
    if (!response.ok) throw new Error('默认 Logo 获取失败');
    return response.text();
  });
}
