// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_WEB_PACKAGE_PRESETS, canRenderBuiltinWebPackageSrcdoc, clearLocalWebPackageSessionStaging,
  createWebPackageOverlay, packWebPackageZip, renderBuiltinWebPackageSrcdoc, resolveWebPackage,
  stageLocalWebPackage, unpackWebPackageZip,
} from '@mahoshojo/web-package';

const ref = BUILTIN_WEB_PACKAGE_PRESETS.find((preset) => preset.packageRef.id === 'mahoshojo.arena-news')!.packageRef;

describe('Arena News pinned HTML materialization', () => {
  it('rewrites static resources while preserving AI content, script strings and external/hash links', async () => {
    const base = await resolveWebPackage(ref);
    const source = `<!doctype html><html lang="zh"><head><base href="https://wrong.example/"><title>AI 自创报刊</title>
      <link media="screen" href='./styles/news.css?v=1' rel="stylesheet">
      </head><body><h1>AI 自创报刊</h1><p>scripts/news.js</p>
      <img alt="logo" src="assets/brand/arena.svg"><img src="https://example.com/image.png">
      <a href="#article-one">阅读</a><a href="https://example.com/story">来源</a>
      <script>window.exampleMarkup = '<img src="assets/brand/arena.svg">';</script>
      <script src="./scripts/news.js" defer></script></body></html>`;
    const { html } = await renderBuiltinWebPackageSrcdoc(await createWebPackageOverlay(ref, source));
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    expect(parsed.title).toBe('AI 自创报刊');
    expect(parsed.querySelector('base')).toBeNull();
    expect(parsed.querySelector('style')?.textContent).toBe(new TextDecoder().decode(base.readFile('styles/news.css')).replace(/\r\n?/gu, '\n'));
    expect(parsed.querySelector('style')?.media).toBe('screen');
    expect(parsed.querySelector('link[rel="stylesheet"],script[src]')).toBeNull();
    expect(parsed.querySelector('img')?.src).toMatch(/^data:image\/svg\+xml;base64,/u);
    expect(parsed.querySelectorAll('img')[1].src).toBe('https://example.com/image.png');
    expect(parsed.querySelector('a')?.getAttribute('href')).toBe('#article-one');
    expect(parsed.querySelectorAll('a')[1].href).toBe('https://example.com/story');
    expect(parsed.querySelectorAll('script')).toHaveLength(2);
    expect(parsed.querySelectorAll('script')[0].textContent).toContain('<img src="assets/brand/arena.svg">');
    expect(parsed.querySelectorAll('script')[1].textContent).toBe(new TextDecoder().decode(base.readFile('scripts/news.js')).replace(/\r\n?/gu, '\n'));
    expect(parsed.querySelectorAll('p')).toHaveLength(1);
    expect(parsed.querySelector('p')?.textContent).toBe('scripts/news.js');
  });

  it('refuses an unpinned revision or missing local resource without widening local execution', async () => {
    const changed = { ...ref, digest: `sha256:${'0'.repeat(64)}` };
    expect(canRenderBuiltinWebPackageSrcdoc(ref)).toBe(true);
    expect(canRenderBuiltinWebPackageSrcdoc(changed)).toBe(false);
    const missing = await createWebPackageOverlay(ref, '<!doctype html><html><body><script src="missing.js"></script></body></html>');
    await expect(renderBuiltinWebPackageSrcdoc(missing)).rejects.toThrow('资源不存在');
    const traversal = await createWebPackageOverlay(ref, '<!doctype html><html><body><script src="../outside.js"></script></body></html>');
    await expect(renderBuiltinWebPackageSrcdoc(traversal)).rejects.toThrow('路径');
  });

  it('uses the same static asset bytes after ZIP export and exact local reimport', async () => {
    try {
      const base = await resolveWebPackage(ref);
      const css = base.manifest.files.find((file) => file.path.endsWith('.css'))!.path;
      const script = base.manifest.files.find((file) => file.path.endsWith('.js'))!.path;
      const logo = base.manifest.files.find((file) => file.path.endsWith('.svg'))!.path;
      const generated = `<!doctype html><html><head><title>重新创作</title><link rel="stylesheet" href="${css}"></head><body><h1>重新创作</h1><img src="${logo}"><script src="${script}"></script></body></html>`;
      const overlay = await createWebPackageOverlay(ref, generated);
      const original = await renderBuiltinWebPackageSrcdoc(overlay);
      const imported = await unpackWebPackageZip(await packWebPackageZip(base));
      expect(imported.ref).toEqual(ref);
      stageLocalWebPackage(imported);
      expect(await renderBuiltinWebPackageSrcdoc(overlay)).toEqual(original);
      expect(original.html).toContain('<h1>重新创作</h1>');
      expect(original.html).toContain('data:image/svg+xml;base64,');
    } finally {
      clearLocalWebPackageSessionStaging();
    }
  });
});
