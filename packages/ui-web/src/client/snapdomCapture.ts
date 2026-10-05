// 结果卡截图（snapdom）与站外媒体内联。
//
// 自 `apps/web/lib/client/snapdomCapture.ts` 迁移。截图管线本体（图片内联、
// DPR 钳制、snapdom.toBlob）是平台无关的浏览器实现；站外媒体策略注入为
// `SnapdomMediaAdapter`：Web 传入 `WEB_SNAPDOM_MEDIA`（/api/media-proxy +
// 白名单），Desktop 等无媒体代理的运行时使用 `DENY_SNAPDOM_MEDIA`，此时不发起
// 任何站外请求（与共享 markdown 的 DENY_EXTERNAL_MEDIA 同口径）。

import { snapdom } from '@zumer/snapdom';

import { isAllowedExternalMediaUrl } from '@mahoshojo/domain/external-media';

/**
 * 截图时的站外媒体内联策略。
 *
 * - `snapdomProxyUrl`：透传给 snapdom 的 `useProxy` 前缀，同时用于站内代理路径再内联；
 *   空字符串/缺省表示不使用媒体代理。
 * - `isMediaProxyPath`：判定站内路径是否已是媒体代理地址（相对路径或 URL 均可）。
 * - `isAllowedExternalImageUrl`：判定站外图片 URL 是否允许经代理内联为 dataURL。
 */
export interface SnapdomMediaAdapter {
  readonly snapdomProxyUrl?: string;
  readonly isMediaProxyPath?: (path: string) => boolean;
  readonly isAllowedExternalImageUrl?: (url: string) => boolean;
}

/** 拒绝一切站外媒体内联：无代理、不内联任何图片（默认策略）。 */
export const DENY_SNAPDOM_MEDIA: SnapdomMediaAdapter = {
  snapdomProxyUrl: '',
  isMediaProxyPath: () => false,
  isAllowedExternalImageUrl: () => false,
};

/** Web 的媒体代理策略：与原 `apps/web` 实现完全同口径。 */
export const WEB_SNAPDOM_MEDIA: SnapdomMediaAdapter = {
  snapdomProxyUrl: '/api/media-proxy?url=',
  isMediaProxyPath: (path) => path.includes('/api/media-proxy'),
  isAllowedExternalImageUrl: (url) => isAllowedExternalMediaUrl(url, 'image'),
};

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

const buildMediaProxyUrl = (targetUrl: string, proxyBase: string) => {
  const base = proxyBase || '/api/media-proxy?url=';
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
      throw new Error(`图片代理失败: ${resp.status}`);
    }
    const blob = await resp.blob();
    return await blobToDataUrl(blob);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function inlineCaptureImages(
  element: HTMLElement,
  adapter: SnapdomMediaAdapter,
  options?: {
    timeoutMs?: number;
    concurrency?: number;
  }
): Promise<() => void> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_IMAGE_INLINE_TIMEOUT_MS;
  const concurrency = options?.concurrency ?? DEFAULT_IMAGE_INLINE_CONCURRENCY;

  const images = Array.from(element.querySelectorAll('img'));
  if (images.length === 0 || typeof window === 'undefined') return () => {};

  const isAllowedExternalImageUrl = adapter.isAllowedExternalImageUrl ?? (() => false);
  const isMediaProxyPath = adapter.isMediaProxyPath ?? (() => false);
  const proxyBase = adapter.snapdomProxyUrl ?? '';

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
    const shouldInlineViaProxy = isExternal && isAllowedExternalImageUrl(resolvedSrc);
    const shouldInlineProxyUrl = !isExternal && isMediaProxyPath(url.pathname + url.search);

    if (!shouldInlineViaProxy && !shouldInlineProxyUrl) continue;

    restoreSnapshots.push({ element: img, src: srcAttr, srcset: srcsetAttr, sizes: sizesAttr });

    const fetchUrl = shouldInlineViaProxy ? buildMediaProxyUrl(resolvedSrc, proxyBase) : resolvedSrc;
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
    /** 站外媒体内联策略；缺省 `DENY_SNAPDOM_MEDIA`。 */
    mediaAdapter?: SnapdomMediaAdapter;
  }
): Promise<Blob> {
  const scale = options?.scale ?? 1;
  const dpr = getSafeDpr(options?.dprMax ?? 2);
  const adapter = options?.mediaAdapter ?? DENY_SNAPDOM_MEDIA;
  const useProxy = adapter.snapdomProxyUrl ?? '';

  const restoreImages = await inlineCaptureImages(element, adapter);

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
