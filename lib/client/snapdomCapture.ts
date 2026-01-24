import { snapdom } from '@zumer/snapdom';

import { isAllowedExternalMediaUrl } from '@/lib/markdown/externalMedia';

export const getSnapdomProxyUrl = () => {
  if (typeof window === 'undefined') return '';
  return '/api/media-proxy?url=';
};

export function getSafeDpr(maxDpr = 2): number {
  if (typeof window === 'undefined') return 1;
  const dpr = typeof window.devicePixelRatio === 'number' ? window.devicePixelRatio : 1;
  return Math.min(Math.max(dpr, 1), maxDpr);
}

const DEFAULT_IMAGE_INLINE_TIMEOUT_MS = 20_000;
const DEFAULT_IMAGE_INLINE_CONCURRENCY = 4;

type ImageRestoreSnapshot = {
  element: HTMLImageElement;
  src: string | null;
  srcset: string | null;
  sizes: string | null;
};

const isSpecialImageUrl = (value: string) => /^data:|^blob:|^about:blank$/i.test(value);

const isMediaProxyUrl = (value: string) => {
  if (!value) return false;
  if (value.includes('/api/media-proxy')) return true;
  return false;
};

const buildMediaProxyUrl = (targetUrl: string) => {
  const base = getSnapdomProxyUrl() || '/api/media-proxy?url=';
  if (/[?&]url=?$/.test(base)) return `${base}${encodeURIComponent(targetUrl)}`;
  if (base.endsWith('?')) return `${base}url=${encodeURIComponent(targetUrl)}`;
  if (base.endsWith('/')) return `${base}${encodeURIComponent(targetUrl)}`;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}url=${encodeURIComponent(targetUrl)}`;
};

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('读取图片数据失败'));
    reader.readAsDataURL(blob);
  });

async function fetchAsDataUrl(fetchUrl: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort('timeout'), timeoutMs);

  try {
    const resp = await fetch(fetchUrl, { signal: controller.signal, credentials: 'include' });
    if (!resp.ok) {
      throw new Error(`图片请求失败: ${resp.status}`);
    }
    const blob = await resp.blob();
    return await blobToDataUrl(blob);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function inlineCaptureImages(
  element: HTMLElement,
  options?: {
    timeoutMs?: number;
    concurrency?: number;
  }
): Promise<() => void> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_IMAGE_INLINE_TIMEOUT_MS;
  const concurrency = options?.concurrency ?? DEFAULT_IMAGE_INLINE_CONCURRENCY;

  const images = Array.from(element.querySelectorAll('img'));
  if (images.length === 0 || typeof window === 'undefined') return () => {};

  const restoreSnapshots: ImageRestoreSnapshot[] = [];
  const targets: Array<{ element: HTMLImageElement; fetchUrl: string }> = [];

  for (const img of images) {
    const resolvedSrc = img.currentSrc || img.src || '';
    if (!resolvedSrc || isSpecialImageUrl(resolvedSrc)) continue;

    const srcAttr = img.getAttribute('src');
    const srcsetAttr = img.getAttribute('srcset');
    const sizesAttr = img.getAttribute('sizes');

    const url = new URL(resolvedSrc, window.location.href);
    const isExternal = url.origin !== window.location.origin;
    const shouldInlineViaProxy = isExternal && isAllowedExternalMediaUrl(resolvedSrc, 'image');
    const shouldInlineProxyUrl = !isExternal && isMediaProxyUrl(url.pathname + url.search);

    if (!shouldInlineViaProxy && !shouldInlineProxyUrl) continue;

    restoreSnapshots.push({ element: img, src: srcAttr, srcset: srcsetAttr, sizes: sizesAttr });

    const fetchUrl = shouldInlineViaProxy ? buildMediaProxyUrl(resolvedSrc) : resolvedSrc;
    targets.push({ element: img, fetchUrl });
  }

  if (targets.length === 0) return () => {};

  const dataUrlCache = new Map<string, string>();
  const inflight = new Map<string, Promise<string>>();
  const getDataUrl = (fetchUrl: string) => {
    const cached = dataUrlCache.get(fetchUrl);
    if (cached) return Promise.resolve(cached);
    const existing = inflight.get(fetchUrl);
    if (existing) return existing;
    const promise = fetchAsDataUrl(fetchUrl, timeoutMs)
      .then((dataUrl) => {
        dataUrlCache.set(fetchUrl, dataUrl);
        return dataUrl;
      })
      .finally(() => {
        inflight.delete(fetchUrl);
      });
    inflight.set(fetchUrl, promise);
    return promise;
  };

  for (let i = 0; i < targets.length; i += concurrency) {
    const batch = targets.slice(i, i + concurrency);
    await Promise.allSettled(
      batch.map(async ({ element: img, fetchUrl }) => {
        const dataUrl = await getDataUrl(fetchUrl);
        if (!dataUrl) return;
        img.setAttribute('src', dataUrl);
        img.removeAttribute('srcset');
        img.removeAttribute('sizes');
      })
    );
  }

  return () => {
    for (const snapshot of restoreSnapshots) {
      if (snapshot.src === null) snapshot.element.removeAttribute('src');
      else snapshot.element.setAttribute('src', snapshot.src);
      if (snapshot.srcset === null) snapshot.element.removeAttribute('srcset');
      else snapshot.element.setAttribute('srcset', snapshot.srcset);
      if (snapshot.sizes === null) snapshot.element.removeAttribute('sizes');
      else snapshot.element.setAttribute('sizes', snapshot.sizes);
    }
  };
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

  const restoreImages = await inlineCaptureImages(element);

  try {
    return await snapdom.toBlob(element, {
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
  } finally {
    restoreImages();
  }
}
