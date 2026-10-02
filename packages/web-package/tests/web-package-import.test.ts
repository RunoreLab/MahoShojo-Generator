import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { ZIP_DOS_EPOCH } from '@mahoshojo/contracts/zip';
import { MAX_ARCHIVE_ENTRIES, MAX_ARCHIVE_EXPANDED_BYTES } from '../src/archive';
import { importWebPackageArchive, WebPackageImportError, type WebPackageImportErrorCode } from '../src/import';
import { packWebPackageZip, resolveWebPackage, unpackWebPackageZip } from '../src';
import { BUILTIN_ARENA_NEWS_PACKAGE_REF } from '../src/registry';

const encoder = new TextEncoder();
// 用共享纪元而不是本地字面量：这些夹具要模拟的是"别的工具打出来的 ZIP"，而在 UTC 以西的
// 时区里，UTC 字面量会让 `zipSync` 在**构造夹具时**就抛错——于是一条本该验证导入逻辑的用例
// 变成了"打包器坏了"，症状与根因完全无关。
const pack = (entries: Record<string, Uint8Array>): Uint8Array =>
  zipSync(entries, { level: 6, mtime: ZIP_DOS_EPOCH });
/** 不压缩：fflate 的尺寸处理在 store 与 deflate 下方向相反，两条用例需要分别指明。 */
const packStored = (entries: Record<string, Uint8Array>): Uint8Array =>
  zipSync(entries, { level: 0, mtime: ZIP_DOS_EPOCH });

/**
 * 把某个条目的**声明**解压尺寸改成别的值，模拟伪造的 central directory。
 *
 * 必须同时改 local header 与 central directory：fflate 按 central directory 的尺寸分配并切分输出，
 * 只改一处会得到"两个尺寸互相矛盾"的另一种畸形归档，于是测试证明的是别的东西。
 * compressed size 保持不变——这里伪造的正是展开尺寸这一个字段。
 */
const forgeUncompressedSize = (
  archive: Uint8Array,
  entryName: string,
  declared: number,
  scope: 'central' | 'both' = 'both',
): Uint8Array => {
  const patched = new Uint8Array(archive);
  const put16 = (offset: number, value: number): void => {
    patched[offset] = value & 0xff;
    patched[offset + 1] = (value >> 8) & 0xff;
  };
  // local header 与 central directory 的字段偏移**不同**：文件名长度分别在 26 / 28，文件名分别在
  // 30 / 46，展开尺寸分别在 22 / 24。用同一组偏移读两者会静默读错 central directory 的名字，于是
  // 断言变成"只伪造了一半"——而 fflate 从 local header 决定输出长度，于是这条用例会安静地通过。
  // ZIP 是小端签名：local header 的四个字节是 50 4B **03 04**，central directory 是 50 4B **01 02**。
  // 把 0x0403 / 0x0102 当成 kind 会把两者对调，于是只改到 central directory，而 fflate 从 local
  // header 决定输出长度——用例安静地通过，证明的是一个不存在的问题。
  const LOCAL = 0x0304;
  const CENTRAL = 0x0102;
  let patchedLocal = 0;
  let patchedCentral = 0;
  for (let offset = 0; offset + 4 <= patched.length; offset += 1) {
    if (patched[offset] !== 0x50 || patched[offset + 1] !== 0x4b) continue;
    const kind = (patched[offset + 2]! << 8) | patched[offset + 3]!;
    if (kind !== LOCAL && kind !== CENTRAL) continue;
    if (kind === LOCAL && scope === 'central') continue;
    const nameLengthOffset = kind === LOCAL ? 26 : 28;
    const nameOffset = kind === LOCAL ? 30 : 46;
    const sizeOffset = kind === LOCAL ? 22 : 24;
    const nameLength = patched[offset + nameLengthOffset]! + (patched[offset + nameLengthOffset + 1]! << 8);
    const name = new TextDecoder().decode(patched.subarray(offset + nameOffset, offset + nameOffset + nameLength));
    if (name !== entryName) continue;
    put16(offset + sizeOffset, declared);
    if (kind === LOCAL) patchedLocal += 1; else patchedCentral += 1;
  }
  if (patchedCentral !== 1 || (scope === 'both' && patchedLocal !== 1)) {
    throw new Error(`夹具里 ${entryName} 的头部数量异常：local ${patchedLocal}、central ${patchedCentral}`);
  }
  return patched;
};

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

  it('bounds entry count, which the byte budget cannot see', async () => {
    // 这个用例证明的是**字节预算失效**而不是它生效：一个 32 MiB 的归档，每个条目声明展开 0 字节，
    // 因此展开总额读作 0——MAX_ARCHIVE_EXPANDED_BYTES 完全不会触发。但它携带 20 万个条目，
    // 会让 unzipSync 分配 20 万个结果对象、再让归一化构造 20 万个路径字符串。
    const many: Record<string, Uint8Array> = {};
    for (let index = 0; index < MAX_ARCHIVE_ENTRIES + 100; index += 1) many[`f${index}`] = new Uint8Array();
    const entries = { ...many, 'web-package.json': encoder.encode(JSON.stringify(manifestOf())) };
    expect(entries).toHaveProperty('web-package.json');
    const error = await expectCode(pack(entries), 'archive-too-many-entries');
    expect(error.hint).toContain('不是 Web 包的产品大小限制');
    // 上限必须真的紧：只比常见包大一个量级，否则它挡不住任何东西。
    expect(MAX_ARCHIVE_ENTRIES).toBeLessThanOrEqual(4096);
  });

  it('rejects an archive whose declared entry size disagrees with what it delivers', async () => {
    // 断言的是**交付长度 != 声明长度**，而"截断"只是它的一个可能形态。实测两种压缩方式的偏差方向
    // 相反（见 archive.ts 的注释），所以这里必须用 store：只有 store 会交付**多于**声明的字节，而这
    // 正是内存安全的方向——guard 1 的预算按 central directory 记账，fflate 却按 local header 分配。
    // 少了这道断言，一个超出预算的实际分配会被静默接受。
    //
    // deflate 的形态（交付 == 声明、文件被静默截断）在这里**测不到**，因为声明与交付在构造上相等；
    // 它最终由 manifest 的文件摘要校验挡住，代价是错误指向包内容而不是畸形归档。这一点写在这里，
    // 是为了避免后来者以为这道断言覆盖了截断。
    const archive = packStored({
      'index.html': HTML,
      'web-package.json': encoder.encode(JSON.stringify(manifestOf())),
    });
    const patched = forgeUncompressedSize(archive, 'index.html', HTML.byteLength - 8, 'central');
    const error = await expectCode(patched, 'archive-entry-truncated');
    expect(error.message).toContain('index.html');
  });

  it('accepts a stored archive whose size declarations agree', async () => {
    // 上一条的前提是"store + 只伪造 central directory"。如果一个完全诚实的 store 归档也被这道
    // 断言拒绝，那么被拒的不是畸形归档而是正常的包——所以这里必须钉住正向用例。
    const archive = packStored({
      'index.html': HTML,
      'web-package.json': encoder.encode(JSON.stringify(manifestOf())),
    });
    const { pkg } = await importWebPackageArchive(archive);
    expect(pkg.manifest.id).toBe(manifestOf().id);
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

  it('rejects a prompt field that points at the entry, with guidance', async () => {
    // 入口一定会执行。把提示字段指向它，等于让一段会执行的代码以"提示文本"的名义
    // 逃过风险扫描，而授权判定正是基于那份风险档案。
    for (const key of ['instructions', 'example'] as const) {
      let failure: WebPackageImportError | null = null;
      try {
        await importWebPackageArchive(pack({
          'index.html': HTML,
          'web-package.json': encoder.encode(JSON.stringify(manifestOf({
            generation: { target: 'index.html', mode: 'replace', mediaType: 'text/html', [key]: 'index.html' },
          }))),
        }));
      } catch (caught) {
        failure = caught as WebPackageImportError;
      }
      expect(failure).toBeInstanceOf(WebPackageImportError);
      const error = failure as WebPackageImportError;
      expect(error.code).toBe('invalid-manifest-field');
      expect(error.message).toContain('不能指向入口文件');
      expect(error.hint).toContain('风险分析');
    }
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

  // 重复声明曾经同时得到 "Too big: expected array to have <=4 items" 与英文的
  // "capabilities must be unique"：4 正是允许的取值数，作者无从判断该删哪一项。
  it('explains duplicated capability declarations without the validator text', async () => {
    const error = await expectCode(pack({
      'index.html': HTML,
      'web-package.json': encoder.encode(JSON.stringify(manifestOf({
        capabilities: ['scripts', 'scripts', 'audio', 'video', 'network'],
      }))),
    }), 'invalid-manifest-field');
    expect(error.message).toContain('capabilities');
    expect(error.message).not.toMatch(/Too big|must be unique/u);
    expect(error.hint).toContain('重复');
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
