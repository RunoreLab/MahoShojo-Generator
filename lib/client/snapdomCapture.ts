import { snapdom } from '@zumer/snapdom';

export const getSnapdomProxyUrl = () => {
  if (typeof window === 'undefined') return '';
  return '/api/media-proxy?url=';
};

export function getSafeDpr(maxDpr = 2): number {
  if (typeof window === 'undefined') return 1;
  const dpr = typeof window.devicePixelRatio === 'number' ? window.devicePixelRatio : 1;
  return Math.min(Math.max(dpr, 1), maxDpr);
}

export async function capturePngBlob(
  element: HTMLElement,
  options?: {
    scale?: number;
    dprMax?: number;
    fast?: boolean;
    exclude?: string[];
    excludeMode?: 'hide' | 'remove';
    filter?: (el: Element) => boolean;
    filterMode?: 'hide' | 'remove';
  }
): Promise<Blob> {
  const scale = options?.scale ?? 1;
  const dpr = getSafeDpr(options?.dprMax ?? 2);
  const useProxy = getSnapdomProxyUrl();

  return snapdom.toBlob(element, {
    type: 'png',
    scale,
    dpr,
    fast: options?.fast,
    useProxy,
    exclude: options?.exclude,
    excludeMode: options?.excludeMode,
    filter: options?.filter,
    filterMode: options?.filterMode,
  });
}
