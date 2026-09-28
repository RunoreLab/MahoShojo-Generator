import type { WebPackageRef } from '@mahoshojo/contracts/web-package';
import { BUILTIN_ARENA_NEWS_PACKAGE_REF as newsRef } from './registry';

const decoder = new TextDecoder('utf-8', { fatal: true });

/** A presentation capability for one verified first-party revision, not a local-package resolver. */
export const canRenderArenaNewsSrcdoc = (ref: WebPackageRef): boolean => (ref.id === newsRef.id && ref.version === newsRef.version && ref.digest === newsRef.digest);

const packagePath = (reference: string): { path: string; fragment: string } | null => {
  const value = reference.trim();
  if (!value || value.startsWith('#') || value.startsWith('/') || /^[a-z][a-z0-9+.-]*:/iu.test(value)) return null;
  // Only package-root-relative file references are part of this preset's authoring contract.
  if (value.includes('\\') || value.split(/[/?#]/u).includes('..')) throw new Error('竞技场新闻资源路径不受支持');
  const url = new URL(value, 'https://arena-news.invalid/index.html');
  return { path: decodeURIComponent(url.pathname.slice(1)), fragment: url.hash };
};

const imageMediaType = (path: string): string | undefined => ({
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
})[path.split('.').pop()?.toLowerCase() ?? ''];

const dataUrl = (bytes: Uint8Array, mediaType: string): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${mediaType};base64,${btoa(binary)}`;
};

/**
 * Browser-only Arena News transport adapter. The AI still authors the complete HTML.
 * Only verified preset CSS, classic scripts and image attributes are materialized.
 * No HTML regex rewriting, URL mounting, dynamic fetch/module imports or CSS URL resolver.
 * Execution/consent remains owned by the host's opaque sandbox iframe.
 */
export const materializeArenaNewsHtml = (
  ref: WebPackageRef,
  readFile: (_path: string) => Uint8Array | undefined,
  html: string,
): string => {
  if (!canRenderArenaNewsSrcdoc(ref)) throw new Error('竞技场新闻 revision 不受过渡适配器支持');
  if (typeof DOMParser === 'undefined') throw new Error('竞技场新闻预览需要浏览器 HTML 解析器');
  const document = new DOMParser().parseFromString(html, 'text/html');
  const read = (path: string): Uint8Array => {
    const bytes = readFile(path);
    if (!bytes) throw new Error(`竞技场新闻资源不存在：${path}`);
    return bytes;
  };

  // A generated base must not redirect remaining relative references to the host or another origin.
  for (const base of document.querySelectorAll('base')) base.remove();
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]')) {
    const resource = packagePath(link.getAttribute('href')!);
    if (!resource) continue;
    if (!resource.path.endsWith('.css')) throw new Error('竞技场新闻样式资源类型不受支持');
    const css = decoder.decode(read(resource.path));
    const style = document.createElement('style');
    if (link.media) style.media = link.media;
    style.textContent = css.replace(/<\/style/giu, '<\\/style');
    link.replaceWith(style);
  }
  for (const script of document.querySelectorAll<HTMLScriptElement>('script[src]')) {
    const resource = packagePath(script.getAttribute('src')!);
    if (!resource) continue;
    if (!resource.path.endsWith('.js') || !['', 'text/javascript', 'application/javascript'].includes(script.type)) {
      throw new Error('竞技场新闻仅支持包内经典脚本');
    }
    script.textContent = decoder.decode(read(resource.path)).replace(/<\/script/giu, '<\\/script');
    script.removeAttribute('src');
    script.removeAttribute('integrity');
    script.removeAttribute('crossorigin');
    script.removeAttribute('defer');
    script.removeAttribute('async');
  }
  for (const [selector, attribute] of [
    ['img[src], input[type="image"][src], source[src]', 'src'],
    ['video[poster]', 'poster'],
    ['link[rel~="icon"][href]', 'href'],
    ['image[href]', 'href'],
  ]) {
    for (const element of document.querySelectorAll(selector)) {
      const resource = packagePath(element.getAttribute(attribute)!);
      if (!resource) continue;
      const mediaType = imageMediaType(resource.path);
      if (!mediaType) throw new Error('竞技场新闻图片资源类型不受支持');
      element.setAttribute(attribute, dataUrl(read(resource.path), mediaType) + resource.fragment);
    }
  }
  return '<!doctype html>\n' + document.documentElement.outerHTML;
};
