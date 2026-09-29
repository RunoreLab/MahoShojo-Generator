import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { MAX_ARCHIVE_EXPANDED_BYTES } from '../src/archive';
import { importWebPackageArchive, WebPackageImportError, type WebPackageImportErrorCode } from '../src/import';
import { packWebPackageZip, resolveWebPackage, unpackWebPackageZip } from '../src';
import { BUILTIN_ARENA_NEWS_PACKAGE_REF } from '../src/registry';

const encoder = new TextEncoder();
const MTIME = new Date('1980-01-01T00:00:00.000Z');
const pack = (entries: Record<string, Uint8Array>): Uint8Array => zipSync(entries, { level: 6, mtime: MTIME });

const HTML = encoder.encode('<!doctype html><html lang="zh"><head><title>站点</title></head><body><h1>你好</h1></body></html>');
const CSS = encoder.encode('body{color:red}');

/** A minimal but valid hand-written manifest, minus whatever a test wants to omit. */
const manifestOf = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  format: 'mahoshojo-web-package',
  formatVersion: 1,
  id: 'local.sample',
  version: '1.0.0',
  name: '示例站点',
  entry: 'index.html',
  generation: { target: 'index.html', mode: 'replace', mediaType: 'text/html' },
  ...overrides,
});

const expectCode = async (archive: Uint8Array, code: WebPackageImportErrorCode): Promise<WebPackageImportError> => {
  const error = await importWebPackageArchive(archive).then(() => null, (e: unknown) => e);
  expect(error, `expected ${code} but import resolved`).toBeInstanceOf(WebPackageImportError);
  const typed = error as WebPackageImportError;
  expect(typed.code).toBe(code);
  // Every import failure must tell the user what to do next.
  expect(typed.hint.length).toBeGreaterThan(0);
  return typed;
};

describe('ZIP envelope normalization', () => {
  it('imports a package wrapped in a single root directory, the shape common ZIP tools emit', async () => {
    const { pkg, diagnostics } = await importWebPackageArchive(pack({
      'web-package-danmaku-arena/': new Uint8Array(),
      'web-package-danmaku-arena/assets/': new Uint8Array(),
      'web-package-danmaku-arena/index.html': HTML,
      'web-package-danmaku-arena/assets/site.css': CSS,
      'web-package-danmaku-arena/web-package.json': encoder.encode(JSON.stringify(manifestOf())),
    }));
    expect(pkg.manifest.files.map((file) => file.path)).toEqual(['assets/site.css', 'index.html']);
    expect(pkg.manifest.entry).toBe('index.html');
    expect(diagnostics.join('\n')).toContain('web-package-danmaku-arena/');
  });

  it('never guesses between several candidate package roots', async () => {
    await expectCode(pack({
      'a/index.html': HTML, 'a/web-package.json': encoder.encode(JSON.stringify(manifestOf())),
      'b/index.html': HTML, 'b/web-package.json': encoder.encode(JSON.stringify(manifestOf({ id: 'local.other' }))),
    }), 'manifest-ambiguous');
  });

  it('rejects a manifest buried deeper than one wrapper directory', async () => {
    const error = await expectCode(pack({
      'nested/deep/index.html': HTML,
      'nested/deep/web-package.json': encoder.encode(JSON.stringify(manifestOf())),
    }), 'manifest-nested');
    expect(error.hint).toContain('Web 包目录本身');
  });

  it('rejects payload files outside the resolved package root', async () => {
    await expectCode(pack({
      'pkg/index.html': HTML,
      'pkg/web-package.json': encoder.encode(JSON.stringify(manifestOf())),
      'sibling.txt': encoder.encode('stray'),
    }), 'file-outside-root');
  });

  it('drops archive-tool metadata by fixed name and reports it', async () => {
    const { pkg, diagnostics } = await importWebPackageArchive(pack({
      'index.html': HTML,
      'web-package.json': encoder.encode(JSON.stringify(manifestOf())),
      '__MACOSX/': new Uint8Array(),
      '__MACOSX/._index.html': encoder.encode('resource fork'),
      '.DS_Store': encoder.encode('finder metadata'),
      'assets/Thumbs.db': encoder.encode('thumbnail cache'),
    }));
    expect(pkg.manifest.files.map((file) => file.path)).toEqual(['index.html']);
    expect(diagnostics.join('\n')).toContain('归档工具元数据');
  });

  it('matches directory placeholders on path segments, not string prefixes', async () => {
    const entries: Record<string, Uint8Array> = {
      'index.html': HTML,
      'assets/site.css': CSS,
      'web-package.json': encoder.encode(JSON.stringify(manifestOf())),
    };
    entries['assets/'] = new Uint8Array();
    await expect(importWebPackageArchive(pack(entries)).then((r) => r.pkg.manifest.files.length)).resolves.toBe(2);

    const stray = { ...entries };
    delete stray['assets/'];
    stray['assetsX/'] = new Uint8Array();
    await expectCode(pack(stray), 'undeclared-file');
  });

  it('bounds decompression so a forged central directory cannot exhaust memory', async () => {
    // A highly compressible payload whose declared expansion dwarfs the budget.
    const bomb = new Uint8Array(MAX_ARCHIVE_EXPANDED_BYTES + 1024);
    const error = await expectCode(pack({ 'index.html': bomb, 'web-package.json': encoder.encode(JSON.stringify(manifestOf())) }), 'archive-too-large');
    expect(error.hint).toContain('不是 Web 包的产品大小限制');
  });
});

describe('file table derivation', () => {
  it('derives media types and digests when files is absent', async () => {
    const { pkg, diagnostics } = await importWebPackageArchive(pack({
      'index.html': HTML,
      'assets/site.css': CSS,
      'web-package.json': encoder.encode(JSON.stringify(manifestOf({ files: undefined }))),
    }));
    expect(pkg.manifest.files).toEqual([
      { path: 'assets/site.css', mediaType: 'text/css', digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u), size: CSS.byteLength },
      { path: 'index.html', mediaType: 'text/html', digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u), size: HTML.byteLength },
    ]);
    expect(diagnostics.join('\n')).toContain('自动派生文件表');
  });

  it('describes undescribable assets as opaque binaries instead of refusing the package', async () => {
    const { pkg, diagnostics } = await importWebPackageArchive(pack({
      'index.html': HTML,
      'assets/theme.wasm': encoder.encode('binary'),
      'assets/blob.unknown': encoder.encode('opaque'),
      'web-package.json': encoder.encode(JSON.stringify(manifestOf({ files: undefined }))),
    }));
    expect(pkg.manifest.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'assets/theme.wasm', mediaType: 'application/wasm' }),
      expect.objectContaining({ path: 'assets/blob.unknown', mediaType: 'application/octet-stream' }),
    ]));
    expect(diagnostics.join('\n')).toContain('assets/blob.unknown');
    expect(diagnostics.join('\n')).toContain('不透明二进制');
  });

  it('imports the common formats the shared media type table used to reject', async () => {
    const { pkg, diagnostics } = await importWebPackageArchive(pack({
      'index.html': HTML,
      'static/favicon.ico': encoder.encode('icon'),
      'static/manifest.webmanifest': encoder.encode('{}'),
      'assets/app.mjs': encoder.encode('export default 1;'),
      'assets/font.woff': encoder.encode('woff'),
      'web-package.json': encoder.encode(JSON.stringify(manifestOf({ files: undefined }))),
    }));
    expect(diagnostics.join('\n')).not.toContain('不透明二进制');
    expect(pkg.manifest.files.map((file) => [file.path, file.mediaType])).toEqual(expect.arrayContaining([
      ['static/favicon.ico', 'image/vnd.microsoft.icon'],
      ['static/manifest.webmanifest', 'application/manifest+json'],
      ['assets/app.mjs', 'text/javascript'],
      ['assets/font.woff', 'font/woff'],
    ]));
  });

  it('keeps a declared file table authoritative', async () => {
    const base = await resolveWebPackage(BUILTIN_ARENA_NEWS_PACKAGE_REF);
    const { unzipSync } = await import('fflate');
    const entries = unzipSync(await packWebPackageZip(base));
    entries['extra.txt'] = encoder.encode('not declared');
    await expectCode(pack(entries), 'undeclared-file');
  });

  it('rejects declared paths that differ only by case', async () => {
    const base = await resolveWebPackage(BUILTIN_ARENA_NEWS_PACKAGE_REF);
    const files = base.manifest.files.map((file) => ({ ...file }));
    files.push({ ...files[0]!, path: files[0]!.path.toUpperCase() });
    await expectCode(pack({
      'web-package.json': encoder.encode(JSON.stringify({ ...base.manifest, files })),
      ...Object.fromEntries(base.manifest.files.map((file) => [file.path, base.readFile(file.path)!])),
    }), 'duplicate-path');
  });
});

describe('manifest defaulting', () => {
  it('derives a missing generation.mediaType from the target file instead of assuming HTML', async () => {
    // 作者写了 target 却漏写 mediaType 时，默认 text/html 会撞上"target 必须与
    // 既有路径和媒体类型一致"，而那条消息完全不提 mediaType。
    const { pkg, diagnostics } = await importWebPackageArchive(pack({
      'index.html': HTML,
      'static/events.json': encoder.encode('[]'),
      'web-package.json': encoder.encode(JSON.stringify(manifestOf({
        generation: { target: 'static/events.json', mode: 'replace' },
      }))),
    }));
    expect(pkg.manifest.generation.mediaType).toBe('application/json');
    expect(diagnostics.join('\n')).toContain('已按目标文件 static/events.json 推导为 application/json');
  });

  it('still assumes text/html when the target is not an existing package file', async () => {
    const { pkg, diagnostics } = await importWebPackageArchive(pack({
      'index.html': HTML,
      'web-package.json': encoder.encode(JSON.stringify(manifestOf({
        generation: { target: 'data/result.json', mode: 'replace' },
      }))),
    }));
    expect(pkg.manifest.generation.mediaType).toBe('text/html');
    expect(diagnostics.join('\n')).toContain('已按目标文件 data/result.json 推导为 text/html');
  });

  it('discovers a package with no manifest at all', async () => {
    // Without a manifest there is no authority for where the package starts, so
    // the whole archive is imported and author paths are left untouched.
    const { pkg, diagnostics } = await importWebPackageArchive(pack({
      'index.html': HTML,
      'assets/site.css': CSS,
    }));
    expect(pkg.manifest.format).toBe('mahoshojo-web-package');
    expect(pkg.manifest.formatVersion).toBe(1);
    expect(pkg.manifest.entry).toBe('index.html');
    expect(pkg.manifest.id).toMatch(/^local\.[0-9a-f]{32}$/u);
    expect(pkg.manifest.version).toBe('1.0.0');
    expect(pkg.manifest.generation).toEqual({ target: 'index.html', mode: 'replace', mediaType: 'text/html' });
    expect(pkg.manifest.capabilities).toEqual([]);
    const notes = diagnostics.join('\n');
    expect(notes).toContain('自动识别 Web 包');
    expect(notes).toContain('自动识别入口');
  });

  it('keeps author paths verbatim when a manifest-less archive is wrapped', async () => {
    const { pkg } = await importWebPackageArchive(pack({ 'site/index.html': HTML, 'site/assets/site.css': CSS }));
    expect(pkg.manifest.files.map((file) => file.path)).toEqual(['site/assets/site.css', 'site/index.html']);
    expect(pkg.manifest.entry).toBe('site/index.html');
  });

  it('prefers index.html over other HTML files regardless of depth', async () => {
    const { pkg } = await importWebPackageArchive(pack({
      'about/team.html': encoder.encode('<!doctype html><title>团队</title>'),
      'index.html': HTML,
    }));
    expect(pkg.manifest.entry).toBe('index.html');
  });

  it('keeps a derived identity stable when the archive is renamed', async () => {
    const first = await importWebPackageArchive(pack({ 'index.html': HTML }));
    const renamed = await importWebPackageArchive(pack({ 'index.html': HTML }));
    expect(renamed.pkg.manifest.id).toBe(first.pkg.manifest.id);
    expect(renamed.pkg.ref.digest).toBe(first.pkg.ref.digest);
  });

  it('changes a derived identity when content changes', async () => {
    const first = await importWebPackageArchive(pack({ 'index.html': HTML }));
    const changed = await importWebPackageArchive(pack({ 'index.html': encoder.encode('<!doctype html><title>改</title>') }));
    expect(changed.pkg.manifest.id).not.toBe(first.pkg.manifest.id);
  });

  it('fills only absent fields and never overrides an explicit value', async () => {
    const { pkg } = await importWebPackageArchive(pack({
      'index.html': HTML,
      'web-package.json': encoder.encode(JSON.stringify({
        id: 'author.declared', generation: { target: 'index.html', mode: 'replace', mediaType: 'text/html' },
      })),
    }));
    expect(pkg.manifest.id).toBe('author.declared');
    expect(pkg.manifest.version).toBe('1.0.0');
  });

  it('fails loudly on a present-but-invalid field instead of defaulting it', async () => {
    await expectCode(pack({
      'index.html': HTML,
      'web-package.json': encoder.encode(JSON.stringify(manifestOf({ id: '' }))),
    }), 'invalid-manifest-field');
    await expectCode(pack({
      'index.html': HTML,
      'web-package.json': encoder.encode(JSON.stringify(manifestOf({ format: 'other-format' }))),
    }), 'unsupported-format');
    await expectCode(pack({
      'index.html': HTML,
      'web-package.json': encoder.encode(JSON.stringify(manifestOf({ formatVersion: 2 }))),
    }), 'unsupported-format-version');
    await expectCode(pack({
      'index.html': HTML,
      'web-package.json': encoder.encode(JSON.stringify(manifestOf({ generation: { target: 'index.html', mode: 'patch' } }))),
    }), 'invalid-manifest-field');
  });

  it('rejects an entry that is not present in the archive', async () => {
    await expectCode(pack({
      'index.html': HTML,
      'web-package.json': encoder.encode(JSON.stringify(manifestOf({ entry: 'missing.html' }))),
    }), 'entry-not-found');
  });

  it('reports invalid JSON as a distinct, actionable failure', async () => {
    await expectCode(pack({ 'index.html': HTML, 'web-package.json': encoder.encode('{') }), 'manifest-invalid-json');
  });

  // 这些是最容易在中文包生态里写错的字段；zod 原文是校验器语言，作者读不懂。
  it.each([
    [{ capabilities: ['storage'] }, 'capabilities', '宿主预检自动检测'],
    [{ id: '雀权引擎' }, 'id', '中文名称请写进 name'],
    [{ version: '1.0 版' }, 'version', '中文名称请写进 name'],
  ])('explains the authoring mistake in %o', async (overrides, field, hintFragment) => {
    const error = await expectCode(pack({
      'index.html': HTML,
      'web-package.json': encoder.encode(JSON.stringify(manifestOf(overrides))),
    }), 'invalid-manifest-field');
    expect(error.message).toContain(field);
    expect(error.message).not.toMatch(/Invalid (string|option)|Unrecognized key/u);
    expect(error.hint).toContain(hintFragment);
  });

  it('names unknown manifest fields instead of silently dropping them', async () => {
    const { diagnostics } = await importWebPackageArchive(pack({
      'index.html': HTML,
      'web-package.json': encoder.encode(JSON.stringify(manifestOf({ entrys: 'index.html' }))),
    }));
    expect(diagnostics.join('\n')).toContain('entrys 不属于当前清单字段');
  });

  it('explains a mediaType written with parameters', async () => {
    const error = await expectCode(pack({
      'index.html': HTML,
      'web-package.json': encoder.encode(JSON.stringify(manifestOf({
        files: [{ path: 'index.html', mediaType: 'text/html; charset=utf-8', digest: `sha256:${'a'.repeat(64)}`, size: HTML.byteLength }],
      }))),
    }), 'invalid-manifest-field');
    expect(error.hint).toContain('不要写成 "text/html; charset=utf-8"');
  });
});

describe('round-trip parity with first-party packages', () => {
  it('re-imports a canonical builtin ZIP with no normalization applied', async () => {
    const base = await resolveWebPackage(BUILTIN_ARENA_NEWS_PACKAGE_REF);
    const { pkg, diagnostics } = await importWebPackageArchive(await packWebPackageZip(base));
    expect(pkg.ref).toEqual(base.ref);
    expect(pkg.manifest).toEqual(base.manifest);
    expect(diagnostics).toEqual([]);
  });

  it('re-packs an imported wrapped archive into canonical root layout', async () => {
    const first = await importWebPackageArchive(pack({
      'site/index.html': HTML, 'site/web-package.json': encoder.encode(JSON.stringify(manifestOf({ files: undefined }))),
    }));
    const second = await unpackWebPackageZip(await packWebPackageZip(first.pkg));
    expect(second.ref).toEqual(first.pkg.ref);
    expect(second.manifest.files.map((file) => file.path)).toEqual(['index.html']);
  });
});
