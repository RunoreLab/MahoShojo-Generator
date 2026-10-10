import { afterEach, describe, expect, it } from 'vitest';
import {
  BUILTIN_ARENA_NEWS_PACKAGE_REF,
  buildWebPackagePromptProjection,
  clearLocalWebPackageSessionStaging,
  createWebPackageInstance,
  createWebPackageOverlay,
  createWebPackageOverlayFromBase,
  createWebPackageOverlayFromProjection,
  digestWebPackageBytes,
  prepareWebPackageReplay,
  resolveWebPackage,
  stageLocalWebPackage,
  verifyWebPackage,
  type WebPackageReplaySources,
} from '../src';
import { createJsonPackage } from './helpers/json-package';

const content = '{"title":"共享结果","records":[{"value":"第一幕"}]}\n';
const missing: WebPackageReplaySources = { resolveExact: async () => null, findCandidatesById: async () => [] };
afterEach(clearLocalWebPackageSessionStaging);

describe('frozen verified-base target output', () => {
  it('matches existing resolved/projection creators byte-for-byte without relying on staging', async () => {
    const base = await createJsonPackage('1', 'local.frozen');
    const projection = buildWebPackagePromptProjection(base);
    const frozen = await createWebPackageOverlayFromBase(base, content);
    expect(frozen).toEqual(await createWebPackageOverlayFromProjection(projection, content));
    expect(frozen.generatedContent).toBe(content);
    expect(frozen.generatedDigest).toBe(await digestWebPackageBytes(new TextEncoder().encode(content)));
    stageLocalWebPackage(base);
    expect(frozen).toEqual(await createWebPackageOverlay(base.ref, content));
    clearLocalWebPackageSessionStaging();
    expect(await createWebPackageOverlayFromBase(base, content)).toEqual(frozen);
    await expect(createWebPackageInstance(base, frozen)).resolves.toMatchObject({ overlay: frozen });
    await expect(createWebPackageOverlay(base.ref, content)).rejects.toThrow();
  });

  it('uses the same conservative JSON normalization and exact generated digest', async () => {
    const base = await createJsonPackage('1', 'local.normalized');
    const wrapped = `\x60\x60\x60json\n${content}\x60\x60\x60`;
    const frozen = await createWebPackageOverlayFromBase(base, wrapped);
    expect(frozen).toEqual(await createWebPackageOverlayFromProjection(buildWebPackagePromptProjection(base), wrapped));
    expect(frozen.generatedContent).toBe(content.trimEnd());
    expect(frozen.generatedDigest).toBe(await digestWebPackageBytes(new TextEncoder().encode(frozen.generatedContent)));
    await expect(createWebPackageInstance(base, frozen)).resolves.toHaveProperty('overlay', frozen);
  });

  it.each([
    ['text/html', 'index.html', '<!doctype html><html><body><script src="https://example.test/a.js"></script></body></html>\n'],
    ['text/javascript', 'target.js', 'export const text="🪄";\r\n'],
    ['text/css', 'target.css', '.a{background:url(https://example.test/a.png)}\n'],
  ])('keeps %s target bytes and unknown resources unchanged', async (mediaType, target, generated) => {
    const files = [
      { path: 'index.html', mediaType: 'text/html', bytes: new TextEncoder().encode('<!doctype html><html><body>base</body></html>') },
      { path: 'assets/raw.bin', mediaType: 'application/octet-stream', bytes: new Uint8Array([0, 128, 255]) },
    ];
    const base = await verifyWebPackage({
      format: 'mahoshojo-web-package', formatVersion: 1, id: 'local.media', version: '1', name: '媒体夹具', entry: 'index.html',
      generation: { target, mediaType, mode: 'replace' },
      files: await Promise.all(files.map(async file => ({ path: file.path, mediaType: file.mediaType, size: file.bytes.length, digest: await digestWebPackageBytes(file.bytes) }))),
    }, files);
    const overlay = await createWebPackageOverlayFromBase(base, generated);
    const instance = await createWebPackageInstance(base, overlay);
    expect(overlay.generatedContent).toBe(generated);
    expect(instance.readFile(target)).toEqual(new TextEncoder().encode(generated));
    expect(instance.readFile('assets/raw.bin')).toEqual(new Uint8Array([0, 128, 255]));
  });

  it('keeps existing target failure classes and 4 MiB default', async () => {
    const base = await resolveWebPackage(BUILTIN_ARENA_NEWS_PACKAGE_REF);
    await expect(createWebPackageOverlayFromBase(base, 'x'.repeat(4 * 1024 * 1024 + 1)))
      .rejects.toMatchObject({ failure: 'empty-or-oversized' });
    await expect(createWebPackageOverlayFromBase(base, '\ud800')).rejects.toMatchObject({ failure: 'encoding' });
    await expect(createWebPackageOverlayFromBase(base, 'MAHOSHOJO_ARENA_META')).rejects.toMatchObject({ failure: 'trailer' });
  });
});

describe('host-owned exact replay sources', () => {
  it('never resurrects a deleted/missing host package from Web global staging', async () => {
    const base = await createJsonPackage('1', 'local.deleted');
    stageLocalWebPackage(base);
    const { generatedContent, ...artifact } = await createWebPackageOverlayFromBase(base, content);
    expect((await prepareWebPackageReplay({ artifact, generatedContent })).status).toBe('exact');
    const outcome = await prepareWebPackageReplay({ artifact, generatedContent }, missing);
    expect(outcome.status).toBe('missing-package');
    expect(outcome.instance).toBeUndefined();
    expect(outcome.fallbackText).toContain('共享结果');
  });

  it('rejects a resolver that silently substitutes another revision', async () => {
    const base = await createJsonPackage('1', 'local.pinned');
    const next = await createJsonPackage('2', 'local.pinned');
    const { generatedContent, ...artifact } = await createWebPackageOverlayFromBase(base, content);
    const outcome = await prepareWebPackageReplay({ artifact, generatedContent }, {
      resolveExact: async () => next, findCandidatesById: async () => [next],
    });
    expect(outcome.status).toBe('rejected');
    expect(outcome.instance).toBeUndefined();
  });

  it('reuses explicit compatibility, target and digest validation with host candidates', async () => {
    const base = await createJsonPackage('1', 'local.compat');
    const next = await createJsonPackage('2', 'local.compat');
    const other = await createJsonPackage('2', 'local.other');
    const { generatedContent, ...artifact } = await createWebPackageOverlayFromBase(base, content);
    const sources = { ...missing, findCandidatesById: async () => [other, next] };
    const pending = await prepareWebPackageReplay({ artifact, generatedContent }, sources);
    expect(pending.status).toBe('mismatch-available');
    expect(pending.candidates).toEqual([next.ref]);
    const replay = await prepareWebPackageReplay({ artifact, generatedContent, allowCompatibility: true, compatibilityRef: next.ref }, sources);
    expect(replay.status).toBe('compatibility');
    expect(replay.instance?.base.ref).toEqual(next.ref);
    expect(artifact.packageRef).toEqual(base.ref);
    expect((await prepareWebPackageReplay({ artifact, generatedContent: content + ' ' }, sources)).status).toBe('rejected');
    const badDigest = { ...artifact, generatedDigest: `sha256:${'0'.repeat(64)}` };
    expect((await prepareWebPackageReplay({ artifact: badDigest, generatedContent }, { ...missing, resolveExact: async () => base })).status).toBe('rejected');
    const badTarget = { ...artifact, targetPath: 'other.json' };
    expect((await prepareWebPackageReplay({ artifact: badTarget, generatedContent }, { ...missing, resolveExact: async () => base })).status).toBe('rejected');
  });
});
