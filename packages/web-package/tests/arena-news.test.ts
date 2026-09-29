import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_WEB_PACKAGE_PRESETS, buildWebPackagePromptProjection, createWebPackageInstance,
  createWebPackageOverlay, packWebPackageZip, resolveWebPackage, unpackWebPackageZip,
} from '../src';
import { scanWebPackageBase } from '../src/security';

const ref = BUILTIN_WEB_PACKAGE_PRESETS.find((preset) => preset.packageRef.id === 'mahoshojo.arena-news')!.packageRef;

describe('Arena News resource package', () => {
  it('exports and reimports every static source byte with the same identity and projection', async () => {
    const base = await resolveWebPackage(ref);
    const imported = await unpackWebPackageZip(await packWebPackageZip(base));
    expect(imported.ref).toEqual(ref);
    expect(buildWebPackagePromptProjection(imported)).toEqual(buildWebPackagePromptProjection(base));
    for (const file of base.manifest.files) {
      const source = await readFile(new URL(`../presets/arena-news/${file.path}`, import.meta.url));
      expect(base.readFile(file.path), file.path).toEqual(new Uint8Array(source));
      expect(imported.readFile(file.path), file.path).toEqual(new Uint8Array(source));
    }
  });

  it('asks for complete HTML and leaves assets immutable when replacing the entry', async () => {    const base = await resolveWebPackage(ref);
    const projection = buildWebPackagePromptProjection(base);
    expect(projection.target).toEqual({ path: 'index.html', mode: 'replace', mediaType: 'text/html' });
    expect(projection.schema).toBeUndefined();
    const catalog = projection.assetCatalog as { resources: { path: string }[] };
    for (const resource of catalog.resources) expect(base.readFile(resource.path), resource.path).toBeDefined();
    const original = base.readFile('index.html');
    const content = '<!doctype html><html><head><title>AI 自创新闻</title></head><body><article>独立正文</article></body></html>';
    const instance = await createWebPackageInstance(base, await createWebPackageOverlay(ref, content));
    expect(new TextDecoder().decode(instance.readFile('index.html'))).toBe(content);
    expect(base.readFile('index.html')).toEqual(original);
    for (const file of base.manifest.files.filter((file) => file.path !== 'index.html')) {
      expect(instance.readFile(file.path)).toEqual(base.readFile(file.path));
    }
  });

  // 这个包完全离线：没有网络代码、没有存储、没有动态执行。SVG 命名空间、
  // 内嵌 data: 图片和提示词文件曾经让它长期挂着三条不成立的警告，
  // 其中两个假 origin 还会写进同源授权凭据。
  it('does not claim network, storage or dynamic execution it does not have', async () => {
    const profile = scanWebPackageBase(await resolveWebPackage(ref));
    expect(profile.status).toBe('complete');
    expect(profile.externalOrigins).toEqual([]);
    for (const category of ['network', 'site-storage', 'dynamic-execution', 'host-page-access'] as const) {
      expect(profile.categories, category).not.toContain(category);
    }
    expect(profile.findings.map((finding) => `${finding.path}:${finding.category}`).sort())
      .toEqual(['scripts/news.js:navigation', 'scripts/news.js:scripts']);
  });
});
