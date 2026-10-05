// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_WEB_PACKAGE_PRESETS, clearLocalWebPackageSessionStaging,
  createWebPackageOverlay, createWebPackageInstance, packWebPackageZip, resolveWebPackage,
  stageLocalWebPackage, unpackWebPackageZip,
} from '@mahoshojo/web-package';
import { renderWebPackageInstance } from '@mahoshojo/web-package/browser';
import type { WebPackageOverlay } from '@mahoshojo/contracts/web-package';

const render = async (overlay: WebPackageOverlay) => renderWebPackageInstance(
  await createWebPackageInstance(await resolveWebPackage(overlay.packageRef), overlay),
);
const decodeData = (value: string) => new TextDecoder().decode(Uint8Array.from(atob(value.slice(value.indexOf(',') + 1)), char => char.charCodeAt(0)));

const ref = BUILTIN_WEB_PACKAGE_PRESETS.find((preset) => preset.packageRef.id === 'mahoshojo.arena-news')!.packageRef;

describe('竞技场新闻复用通用资源渲染', () => {
  it('rewrites static resources while preserving AI content, script strings and external/hash links', async () => {
    const base = await resolveWebPackage(ref);
    const source = `<!doctype html><html lang="zh"><head><base href="https://wrong.example/"><title>AI 自创报刊</title>
      <link media="screen" href='./styles/news.css?v=1' rel="stylesheet">
      </head><body><h1>AI 自创报刊</h1><p>scripts/news.js</p>
      <img alt="logo" src="assets/brand/arena.svg"><img src="https://example.com/image.png">
      <a href="#article-one">阅读</a><a href="https://example.com/story">来源</a>
      <script>window.exampleMarkup = '<img src="assets/brand/arena.svg">';</script>
      <script src="./scripts/news.js" defer></script></body></html>`;
    const { html } = await render(await createWebPackageOverlay(ref, source));
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    expect(parsed.title).toBe('AI 自创报刊');
    expect(parsed.querySelector('base')?.href).toMatch(/^https:\/\/web-package\.invalid\//u);
    const css = parsed.querySelector<HTMLLinkElement>('link[rel="stylesheet"]')!;
    expect(css.href).toMatch(/^data:text\/css;base64,/u);
    expect(css.media).toBe('screen');
    expect(decodeData(css.href).length).toBeGreaterThan(0);
    expect(parsed.querySelector('img')?.src).toMatch(/^data:image\/svg\+xml;base64,/u);
    expect(parsed.querySelectorAll('img')[1].src).toBe('https://example.com/image.png');
    expect(parsed.querySelector('a')?.getAttribute('href')).toBe('#article-one');
    expect(parsed.querySelectorAll('a')[1].href).toBe('https://example.com/story');
    const scripts = [...parsed.querySelectorAll('script')];
    expect(scripts).toHaveLength(3);
    expect(scripts.some(script => (script.src ? decodeData(script.src) : script.textContent)?.includes('<img src="assets/brand/arena.svg">'))).toBe(true);
    const external = parsed.querySelector<HTMLScriptElement>('script[defer][src]')!;
    expect(external.defer).toBe(true);
    expect(decodeData(external.src)).toBe(new TextDecoder().decode(base.readFile('scripts/news.js')));
    expect(parsed.querySelectorAll('p')).toHaveLength(1);
    expect(parsed.querySelector('p')?.textContent).toBe('scripts/news.js');
  });

  it('rejects unknown identities and missing or escaping local resources', async () => {
    const changed = { ...ref, digest: `sha256:${'0'.repeat(64)}` };
    await expect(resolveWebPackage(changed)).rejects.toThrow();
    const missing = await createWebPackageOverlay(ref, '<!doctype html><html><body><script src="missing.js"></script></body></html>');
    await expect(render(missing)).rejects.toThrow();
    const traversal = await createWebPackageOverlay(ref, '<!doctype html><html><body><script src="../outside.js"></script></body></html>');
    await expect(render(traversal)).rejects.toThrow();
  });

  it('uses the same static asset bytes after ZIP export and exact local reimport', async () => {
    try {
      const base = await resolveWebPackage(ref);
      const css = base.manifest.files.find((file) => file.path.endsWith('.css'))!.path;
      const script = base.manifest.files.find((file) => file.path.endsWith('.js'))!.path;
      const logo = base.manifest.files.find((file) => file.path.endsWith('.svg'))!.path;
      const generated = `<!doctype html><html><head><title>重新创作</title><link rel="stylesheet" href="${css}"></head><body><h1>重新创作</h1><img src="${logo}"><script src="${script}"></script></body></html>`;
      const overlay = await createWebPackageOverlay(ref, generated);
      const original = await render(overlay);
      const imported = await unpackWebPackageZip(await packWebPackageZip(base));
      expect(imported.ref).toEqual(ref);
      stageLocalWebPackage(imported);
      expect(await render(overlay)).toEqual(original);
      expect(original.html).toContain('<h1>重新创作</h1>');
      expect(original.html).toContain('data:image/svg+xml;base64,');
    } finally {
      clearLocalWebPackageSessionStaging();
    }
  });
});
