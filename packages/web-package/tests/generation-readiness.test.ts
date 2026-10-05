import { describe, expect, it } from 'vitest';
import { importWebPackageArchive } from '../src';
import { WebPackageImportError } from '../src/import';

const encoder = new TextEncoder();

type FileSpec = { path: string; mediaType: string; content: string };

const packFixture = async (manifest: Record<string, unknown>, specs: readonly FileSpec[]) => {
  const entries: Record<string, Uint8Array> = {
    'web-package.json': encoder.encode(JSON.stringify(manifest, null, 2)),
  };
  for (const { path, content } of specs) entries[path] = encoder.encode(content);
  return zipOf(entries);
};

/** Minimal stored-only ZIP writer so these tests do not depend on a fixture generator. */
const zipOf = (entries: Record<string, Uint8Array>): Uint8Array => {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const table: Uint8Array[] = [];
  for (const [name, data] of Object.entries(entries)) {
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    chunks.push(local, data);
    table.push(local, data);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    central.push(cd);
    offset += local.length + data.length;
  }
  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, Object.keys(entries).length, true);
  ev.setUint16(10, Object.keys(entries).length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const total = [...chunks, ...central, end];
  const out = new Uint8Array(total.reduce((sum, item) => sum + item.length, 0));
  let cursor = 0;
  for (const item of total) { out.set(item, cursor); cursor += item.length; }
  return out;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
const crc32 = (data: Uint8Array): number => {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/**
 * 真实第三方包 `quequan-game` 的 instructions 原文（183 字符）——只有字段名清单。
 */
const quequanInstructions = [
  '# 雀权事件生成说明',
  '',
  'AI 输出目标：static/events.json',
  '',
  '请生成事件数组。',
  '',
  '每个事件必须包含：',
  '- id',
  '- initial',
  '- text',
  '- weight',
  '- chain',
  '- oneTime',
  '- ending',
  '- accept',
  '- reject',
  '- acceptUnlock',
  '- rejectUnlock',
  '',
  '保持事件数据为合法 JSON。',
  '',
].join('\n');

const baseSpecs: FileSpec[] = [
  { path: 'index.html', mediaType: 'text/html', content: '<!doctype html><title>引擎</title>' },
  { path: 'static/events.json', mediaType: 'application/json', content: '[{"id":"e1","text":"原有事件","weight":1,"accept":{},"reject":{}}]' },
];

const manifestFor = (generation: Record<string, unknown>, id = 'fixture.gen') => ({
  format: 'mahoshojo-web-package', formatVersion: 1, id, version: '1.0.0', name: '生成体检夹具',
  entry: 'index.html', generation,
});

describe('import-time generation readiness hints', () => {
  it('flags the real quequan shape: thin instructions, no required coverage, no example', async () => {
    const archive = await packFixture(
      manifestFor({ target: 'static/events.json', mode: 'replace', mediaType: 'application/json', instructions: 'ai/instructions.md', schema: 'ai/schema.json' }),
      [...baseSpecs,
        { path: 'ai/instructions.md', mediaType: 'text/markdown', content: quequanInstructions },
        { path: 'ai/schema.json', mediaType: 'application/json', content: JSON.stringify({ type: 'array', items: { type: 'object', required: ['id', 'text', 'weight', 'accept', 'reject'] } }) },
      ],
    );
    const { diagnostics } = await importWebPackageArchive(archive);
    const hints = diagnostics.filter((line) => line.startsWith('生成可行性：'));
    // 真实包的三个盲点：instructions 只有字段清单、schema 只有 required 没有
    // properties（因此约束不到 accept/reject 的结构）、没有 example。
    expect(hints).toHaveLength(3);
    expect(hints.join('\n')).toMatch(/generation\.instructions 只有 \d+ 字符/);
    expect(hints.join('\n')).toContain('没有 properties');
    expect(hints.join('\n')).toContain('没有 generation.example');
  });

  it('flags a package that tells the model nothing at all', async () => {
    const archive = await packFixture(
      manifestFor({ target: 'static/events.json', mode: 'replace', mediaType: 'application/json' }),
      baseSpecs,
    );
    const { diagnostics } = await importWebPackageArchive(archive);
    const hints = diagnostics.filter((line) => line.startsWith('生成可行性：'));
    expect(hints).toHaveLength(3);
    expect(hints.join('\n')).toContain('没有 generation.instructions');
    expect(hints.join('\n')).toContain('没有 generation.schema');
    expect(hints.join('\n')).toContain('没有 generation.example');
  });

  it('flags a schema whose required covers too little of the declared properties', async () => {
    const archive = await packFixture(
      manifestFor({ target: 'static/events.json', mode: 'replace', mediaType: 'application/json', instructions: 'ai/instructions.md', schema: 'ai/schema.json', example: 'ai/example.json' }),
      [...baseSpecs,
        { path: 'ai/instructions.md', mediaType: 'text/markdown', content: 'x'.repeat(400) },
        { path: 'ai/schema.json', mediaType: 'application/json', content: JSON.stringify({ type: 'array', items: { type: 'object', properties: { a: {}, b: {}, c: {}, d: {}, e: {} }, required: ['a', 'b'] } }) },
        { path: 'ai/example.json', mediaType: 'application/json', content: '[{"a":1}]' },
      ],
    );
    const { diagnostics } = await importWebPackageArchive(archive);
    const hints = diagnostics.filter((line) => line.startsWith('生成可行性：'));
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('只把 2 个列入 required');
  });

  it('warns when the reference implementation is large enough to inflate the output', async () => {
    // 实测 79 KiB 参考实现 -> 65 KiB 产出、2.8 万 token、5 分钟。范例长度直接
    // 决定目标文件长度，所以偏大的范例既慢又有截断风险。
    const archive = await packFixture(
      manifestFor({ target: 'static/events.json', mode: 'replace', mediaType: 'application/json', instructions: 'ai/instructions.md', schema: 'ai/schema.json', example: 'ai/example.json' }),
      [...baseSpecs,
        { path: 'ai/instructions.md', mediaType: 'text/markdown', content: 'x'.repeat(400) },
        { path: 'ai/schema.json', mediaType: 'application/json', content: JSON.stringify({ type: 'array', items: { type: 'object', properties: { id: {}, text: {} }, required: ['id', 'text'] } }) },
        { path: 'ai/example.json', mediaType: 'application/json', content: `<!doctype html><script>${'const bullet=1;'.repeat(6_000)}</script>` },
      ],
    );
    const { diagnostics } = await importWebPackageArchive(archive);
    const hints = diagnostics.filter((line) => line.startsWith('生成可行性：'));
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('偏大');
    expect(hints[0]).toContain('5 分钟');
  });

  it('says nothing about a reference that fits comfortably', async () => {
    const archive = await packFixture(
      manifestFor({ target: 'static/events.json', mode: 'replace', mediaType: 'application/json', instructions: 'ai/instructions.md', schema: 'ai/schema.json', example: 'ai/example.json' }),
      [...baseSpecs,
        { path: 'ai/instructions.md', mediaType: 'text/markdown', content: 'x'.repeat(400) },
        { path: 'ai/schema.json', mediaType: 'application/json', content: JSON.stringify({ type: 'array', items: { type: 'object', properties: { id: {}, text: {} }, required: ['id', 'text'] } }) },
        { path: 'ai/example.json', mediaType: 'application/json', content: '<!doctype html><script>const a=1;</script>' },
      ],
    );
    const { diagnostics } = await importWebPackageArchive(archive);
    expect(diagnostics.filter((line) => line.startsWith('生成可行性：'))).toEqual([]);
  });

  it('stays silent for a well-authored data package', async () => {    const archive = await packFixture(
      manifestFor({ target: 'static/events.json', mode: 'replace', mediaType: 'application/json', instructions: 'ai/instructions.md', schema: 'ai/schema.json', example: 'ai/example.json' }),
      [...baseSpecs,
        { path: 'ai/instructions.md', mediaType: 'text/markdown', content: '请生成事件数组。每个事件包含 id、text、weight 与 accept/reject 的四维增减表。'.repeat(12) },
        { path: 'ai/schema.json', mediaType: 'application/json', content: JSON.stringify({ type: 'array', items: { type: 'object', properties: { id: {}, text: {}, weight: {}, accept: {}, reject: {} }, required: ['id', 'text', 'weight', 'accept', 'reject'] } }) },
        { path: 'ai/example.json', mediaType: 'application/json', content: '[{"id":"e1"}]' },
      ],
    );
    const { diagnostics } = await importWebPackageArchive(archive);
    expect(diagnostics.filter((line) => line.startsWith('生成可行性：'))).toEqual([]);
  });

  it('never checks prose targets', async () => {
    const archive = await packFixture(
      { ...manifestFor({ target: 'index.html', mode: 'replace', mediaType: 'text/html' }), entry: 'index.html' },
      [{ path: 'index.html', mediaType: 'text/html', content: '<!doctype html><title>新闻</title>' }],
    );
    const { diagnostics } = await importWebPackageArchive(archive);
    expect(diagnostics.filter((line) => line.startsWith('生成可行性：'))).toEqual([]);
  });

  it('keeps import succeeding even when every hint fires', async () => {
    const archive = await packFixture(
      manifestFor({ target: 'static/events.json', mode: 'replace', mediaType: 'application/json' }),
      baseSpecs,
    );
    const { pkg, diagnostics } = await importWebPackageArchive(archive);
    expect(pkg.ref.id).toBe('fixture.gen');
    expect(diagnostics.filter((line) => line.startsWith('生成可行性：'))).toHaveLength(3);
  });

  it('does not report a hint for an undeclared schema the package cannot read', async () => {
    // A schema that exists but is unreadable must degrade to "no schema", not crash.
    const archive = await packFixture(
      manifestFor({ target: 'static/events.json', mode: 'replace', mediaType: 'application/json', instructions: 'ai/instructions.md', schema: 'ai/schema.json', example: 'ai/example.json' }),
      [...baseSpecs,
        { path: 'ai/instructions.md', mediaType: 'text/markdown', content: 'x'.repeat(400) },
        { path: 'ai/schema.json', mediaType: 'application/json', content: '{ not json' },
        { path: 'ai/example.json', mediaType: 'application/json', content: '[{"id":"e1"}]' },
      ],
    );
    await expect(importWebPackageArchive(archive)).rejects.toBeInstanceOf(WebPackageImportError);
  });
});
