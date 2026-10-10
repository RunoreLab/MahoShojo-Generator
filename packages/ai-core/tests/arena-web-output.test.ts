import { describe, expect, it, vi } from 'vitest';
import {
  ArenaWebPackageQualificationError,
  createArenaStreamProjector,
  normalizeArenaWebOutput,
  qualifyArenaWebPackageOutput,
  resolveWebDisplayTitle,
  splitStreamMeta,
} from '../src/arena-generation';
import type { WebPackageOverlay, WebPackagePromptProjection } from '@mahoshojo/contracts/web-package';

const meta = { version: 1, report: { headline: '机器标题', winner: '甲' } };
const trailer = `<!-- MAHOSHOJO_ARENA_META ${JSON.stringify(meta)} -->`;
const ref = { id: 'local.shared-output', version: '1', digest: `sha256:${'a'.repeat(64)}` };
const projection: WebPackagePromptProjection = {
  package: { ...ref, name: '共享夹具' }, entry: 'index.html',
  target: { path: 'data/result.json', mediaType: 'application/json', mode: 'replace' },
};
const overlay: WebPackageOverlay = {
  packageRef: ref, targetPath: projection.target.path, targetMediaType: projection.target.mediaType,
  generatedContent: '{"text":"正文"}', generatedDigest: `sha256:${'b'.repeat(64)}`,
};

const project = (chunks: string[], strictTrailer = true) => {
  const projector = createArenaStreamProjector({ expectsMeta: true, strictTrailer });
  const content = [...chunks.flatMap(chunk => projector.push(chunk)), ...projector.finish().markdown].join('');
  return { content, metaEvent: projector.result().metaEvent };
};

describe('shared free Web framing and display titles', () => {
  it('keeps HTML/CSS/JS and allowed external resources untouched, with independent notes', () => {
    const document = '<!doctype html>\n<html><head><title>标题</title><link href="https://example.test/a.css"></head><body><script src="https://example.test/a.js"></script><style>.a::after{content:"</html>"}</style><textarea></html></textarea><!-- </html> --><p>正文</p></body></html>';
    expect(normalizeArenaWebOutput(`附言\r\n\x60\x60\x60html\r\n${document}\r\n\x60\x60\x60\r\n结束\n${trailer}`))
      .toEqual({ document, prelude: '附言', epilogue: '结束' });
  });

  it.each([
    '<!doctype html><html><body>未结束',
    '<html><script>const close="</html>";',
    '<html><!-- 未闭合 </html>',
    '<html><style>.a{content:"</html>"}',
    '<html><textarea></html>',
    '只有普通文本',
  ])('incomplete or non-document source stays text: %s', (source) => {
    expect(normalizeArenaWebOutput(source)).toEqual({ document: null, prelude: source, epilogue: '' });
  });

  it('free Web keeps its existing missing-meta semantics rather than adopting the package gate', () => {
    const document = '<html><title>仅显示标题</title><body>正文</body></html>';
    expect(normalizeArenaWebOutput(document).document).toBe(document);
    expect(resolveWebDisplayTitle({ html: document })).toBe('仅显示标题');
    expect(project([document]).metaEvent?.type).toBe('meta_error');
  });

  it('malformed numeric entities cannot throw while finding a display title', () => {
    expect(resolveWebDisplayTitle({ html: '<html><title>&#x110000; &#999999999; &#x1f319; &amp;</title></html>' }))
      .toBe('&#x110000; &#999999999; 🌙 &');
  });
});

describe('shared strict package control trailer', () => {
  it.each([
    '<!doctype html><html><script>let x="你好";</script></html>\r\n',
    'export const value = "🪄";\n',
    '.a::after{content:"雪";}\n',
    '```json\n{"message":"早安"}\n```\n',
  ])('preserves exact source for every two-chunk boundary: %s', (source) => {
    const raw = source + trailer + '\n\t';
    const expected = project([raw]);
    expect(expected.content).toBe(source);
    expect(expected.metaEvent).toMatchObject({ type: 'meta', data: { meta } });
    for (let i = 0; i <= raw.length; i++) expect(project([raw.slice(0, i), raw.slice(i)])).toEqual(expected);
    expect(project(Array.from(raw))).toEqual(expected);
  });

  it.each([
    '',
    '<!-- MAHOSHOJO_ARENA_META {"version":1}',
    '<!-- MAHOSHOJO_ARENA_META {bad} -->',
    '<!-- MAHOSHOJO_ARENA_META [] -->',
    `MAHOSHOJO_ARENA_META ${JSON.stringify(meta)}`,
    `${trailer}\n附言不属于 target`,
    `${trailer}\n${trailer}`,
  ])('rejects absent, malformed, loose, duplicate or nonterminal control trailers: %s', (suffix) => {
    const result = project(['{}\n', suffix]);
    expect(result.metaEvent?.type).toBe('meta_error');
  });

  it('retains the separate latest-block rule for ordinary stream metadata', () => {
    const latest = '<!-- MAHOSHOJO_ARENA_META {"version":1,"report":{"headline":"后块","winner":"乙"}} -->';
    expect(project(['{}\n', trailer, latest]).metaEvent?.type).toBe('meta_error');
    expect(splitStreamMeta('{}\n' + trailer + latest).updateMetaBlocks.at(-1)?.rawComment).toBe(latest);
    expect(project(['{}\n', trailer, '\n尾注'], false).content).toBe('{}\n\n尾注');
  });

  it('has a single stable finish and refuses late pushes', () => {
    const projector = createArenaStreamProjector({ expectsMeta: true, strictTrailer: true });
    projector.push('{}' + trailer);
    projector.finish();
    const result = projector.result();
    expect(projector.finish()).toEqual({ markdown: [] });
    expect(projector.result()).toEqual(result);
    expect(() => projector.push('late')).toThrow('ARENA_STREAM_PROJECTOR_FINISHED');
  });
});

describe('shared package final qualification', () => {
  it('retains normalized content/artifact and supplies the existing 4 MiB budget', async () => {
    const createOverlay = vi.fn(async () => overlay);
    const raw = '```json\n{"text":"正文"}\n```';
    const result = await qualifyArenaWebPackageOutput({ ref, projection, content: raw, meta, createOverlay });
    expect(createOverlay).toHaveBeenCalledExactlyOnceWith(raw, { maxBytes: 4 * 1024 * 1024 });
    expect(result.overlay.generatedContent).toBe(overlay.generatedContent);
    expect(result.artifact).toEqual({
      packageRef: ref, targetPath: projection.target.path, targetMediaType: projection.target.mediaType,
      generatedDigest: overlay.generatedDigest,
    });
    expect(result.artifact).not.toHaveProperty('generatedContent');
  });

  it.each([null, {}, { ...meta, version: 2 }, { version: 1, report: {} },
    { version: 1, report: { headline: ' ', winner: '甲' } },
    { version: 1, report: { headline: '标题', winner: '' } },
  ])('rejects invalid minimal machine metadata before creating an overlay', async (bad) => {
    const createOverlay = vi.fn(async () => overlay);
    await expect(qualifyArenaWebPackageOutput({ ref, projection, content: '{}', meta: bad, createOverlay }))
      .rejects.toMatchObject({ name: 'ArenaWebPackageQualificationError', failure: 'meta' });
    expect(createOverlay).not.toHaveBeenCalled();
  });

  it('pins ref and target to the frozen host projection', async () => {
    const createOverlay = vi.fn(async () => overlay);
    await expect(qualifyArenaWebPackageOutput({ ref: { ...ref, version: '2' }, projection, content: '{}', meta, createOverlay }))
      .rejects.toMatchObject({ failure: 'identity' });
    expect(createOverlay).not.toHaveBeenCalled();
    await expect(qualifyArenaWebPackageOutput({ ref, projection, content: '{}', meta,
      createOverlay: async () => ({ ...overlay, packageRef: { ...ref, digest: `sha256:${'c'.repeat(64)}` } }),
    })).rejects.toMatchObject({ failure: 'identity' });
    await expect(qualifyArenaWebPackageOutput({ ref, projection, content: '{}', meta,
      createOverlay: async () => ({ ...overlay, targetPath: 'other.json' }),
    })).rejects.toMatchObject({ failure: 'target' });
  });

  it('snapshots ref/target before awaiting, so later host edits do not change qualification', async () => {
    const mutableRef = { ...ref };
    const mutableProjection = structuredClone(projection);
    const result = await qualifyArenaWebPackageOutput({ ref: mutableRef, projection: mutableProjection, content: '{}', meta,
      createOverlay: async () => {
        mutableRef.version = 'later';
        mutableProjection.target.path = 'later.json';
        return overlay;
      },
    });
    expect(result.artifact.packageRef).toEqual(ref);
    expect(result.artifact.targetPath).toBe(projection.target.path);
  });

  it('does not wrap creator target failures or cancellation', async () => {
    for (const error of [new Error('target-error'), new DOMException('aborted', 'AbortError')]) {
      await expect(qualifyArenaWebPackageOutput({ ref, content: '{}', meta, createOverlay: async () => { throw error; } }))
        .rejects.toBe(error);
    }
    expect(new ArenaWebPackageQualificationError('meta').message).not.toContain('正文');
  });
});
