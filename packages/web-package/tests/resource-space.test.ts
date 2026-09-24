import { describe, expect, it } from 'vitest';
import {
  WEB_PACKAGE_INSTANCE_PREFIX,
  WEB_PACKAGE_SERVICE_WORKER_PATH,
  WEB_PACKAGE_SERVICE_WORKER_SCOPE,
  buildWebPackageInstanceUrl,
  createWebPackageResourceHeaders,
  createWebPackageResourceResponse,
  createWebPackageResourceSnapshot,
  parseWebPackageInstancePath,
  resolveWebPackageInstancePath,
} from '../src/resource-space';
import {
  BUILTIN_VISUAL_NOVEL_PACKAGE_REF,
  createWebPackageInstance,
  createWebPackageOverlay,
  digestWebPackageBytes,
  resolveWebPackage,
  verifyWebPackage,
} from '../src';

const INSTANCE_ID = 'inst_0123456789abcdef';
const encoder = new TextEncoder();
const storyJson = JSON.stringify({ title: '新建目标', scenes: [{ text: '第一幕' }] });

const buildSnapshot = async (content: string) => {
  const base = await resolveWebPackage(BUILTIN_VISUAL_NOVEL_PACKAGE_REF);
  const overlay = await createWebPackageOverlay(BUILTIN_VISUAL_NOVEL_PACKAGE_REF, content);
  const instance = await createWebPackageInstance(base, overlay);
  return createWebPackageResourceSnapshot(INSTANCE_ID, instance);
};

describe('generic Web package resource space', () => {
  it('parses only the narrow instance namespace and portable package paths', () => {
    expect(parseWebPackageInstancePath(`${WEB_PACKAGE_INSTANCE_PREFIX}${INSTANCE_ID}/index.html`)).toEqual({
      instanceId: INSTANCE_ID,
      path: 'index.html',
    });
    expect(parseWebPackageInstancePath(`${WEB_PACKAGE_INSTANCE_PREFIX}${INSTANCE_ID}/runtime/app.js`)).toEqual({
      instanceId: INSTANCE_ID,
      path: 'runtime/app.js',
    });
    expect(parseWebPackageInstancePath(`${WEB_PACKAGE_INSTANCE_PREFIX}${INSTANCE_ID}/%E6%8A%A5%E5%91%8A.html`)).toEqual({
      instanceId: INSTANCE_ID,
      path: '报告.html',
    });
    for (const pathname of [
      '/',
      '/index.html',
      WEB_PACKAGE_SERVICE_WORKER_PATH,
      `${WEB_PACKAGE_INSTANCE_PREFIX}`,
      `${WEB_PACKAGE_INSTANCE_PREFIX}${INSTANCE_ID}`,
      `${WEB_PACKAGE_INSTANCE_PREFIX}${INSTANCE_ID}/`,
      `${WEB_PACKAGE_INSTANCE_PREFIX}${INSTANCE_ID}/../secrets.txt`,
      `${WEB_PACKAGE_INSTANCE_PREFIX}${INSTANCE_ID}/a/../b`,
      `${WEB_PACKAGE_INSTANCE_PREFIX}${INSTANCE_ID}/%2e%2e/secrets.txt`,
      `${WEB_PACKAGE_INSTANCE_PREFIX}${INSTANCE_ID}/%zz`,
      `${WEB_PACKAGE_INSTANCE_PREFIX}bad id/index.html`,
      `${WEB_PACKAGE_INSTANCE_PREFIX}${INSTANCE_ID}/a//b`,
      `${WEB_PACKAGE_INSTANCE_PREFIX}${INSTANCE_ID}/a\\b`,
    ]) {
      expect(parseWebPackageInstancePath(pathname), pathname).toBeNull();
    }
    expect(WEB_PACKAGE_SERVICE_WORKER_SCOPE).toBe('/__web-package__/');
    expect(WEB_PACKAGE_SERVICE_WORKER_PATH.startsWith(WEB_PACKAGE_SERVICE_WORKER_SCOPE)).toBe(true);
  });

  it('serves relative JS, nested paths and the entry document from one instance URL space', async () => {
    const snapshot = await buildSnapshot(JSON.stringify({ title: '资源空间', scenes: [{ text: '第一幕' }] }));
    const entryUrl = buildWebPackageInstanceUrl(INSTANCE_ID, snapshot.entry);
    expect(entryUrl).toBe(`${WEB_PACKAGE_INSTANCE_PREFIX}${INSTANCE_ID}/index.html`);

    for (const [path, mediaType] of [
      ['index.html', 'text/html'],
      ['runtime/app.js', 'text/javascript'],
      ['styles/app.css', 'text/css'],
      ['assets/backdrop.svg', 'image/svg+xml'],
      ['data/story.json', 'application/json'],
      ['schemas/story.schema.json', 'application/json'],
    ] as const) {
      const pathname = `${WEB_PACKAGE_INSTANCE_PREFIX}${INSTANCE_ID}/${path}`;
      const resolved = resolveWebPackageInstancePath(snapshot, pathname);
      expect(resolved, path).not.toBeNull();
      expect(resolved!.mediaType).toBe(mediaType);
      expect(resolved!.bytes.byteLength).toBeGreaterThan(0);

      const response = createWebPackageResourceResponse(snapshot, pathname);
      expect(response.status, pathname).toBe(200);
      expect(response.headers.get('content-type'), path).toContain(mediaType);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('access-control-allow-origin'), path).toBe('*');
    }

    const html = createWebPackageResourceResponse(snapshot, `${WEB_PACKAGE_INSTANCE_PREFIX}${INSTANCE_ID}/index.html`);
    expect(html.headers.get('content-security-policy')).toBe('sandbox allow-scripts');

    const js = createWebPackageResourceResponse(snapshot, `${WEB_PACKAGE_INSTANCE_PREFIX}${INSTANCE_ID}/runtime/app.js`);
    expect(js.headers.get('content-security-policy')).toBeNull();
    const jsText = await js.text();
    expect(jsText).toContain('Visual Novel Lite');
  });

  it('prefers the overlay target over the immutable base file without mutating base bytes', async () => {
    const base = await resolveWebPackage(BUILTIN_VISUAL_NOVEL_PACKAGE_REF);
    const baseStory = base.readFile('data/story.json')!;
    const content = JSON.stringify({ title: 'overlay wins', scenes: [{ text: '新故事' }] });
    const overlay = await createWebPackageOverlay(BUILTIN_VISUAL_NOVEL_PACKAGE_REF, content);
    const instance = await createWebPackageInstance(base, overlay);
    const snapshot = createWebPackageResourceSnapshot(INSTANCE_ID, instance);

    const targetPath = `${WEB_PACKAGE_INSTANCE_PREFIX}${INSTANCE_ID}/data/story.json`;
    const resolved = resolveWebPackageInstancePath(snapshot, targetPath)!;
    expect(new TextDecoder().decode(resolved.bytes)).toBe(content);
    expect(resolved.mediaType).toBe('application/json');
    expect(base.readFile('data/story.json')).toEqual(baseStory);
    expect(new TextDecoder().decode(base.readFile('data/story.json')!)).not.toContain('overlay wins');

    const untouched = resolveWebPackageInstancePath(snapshot, `${WEB_PACKAGE_INSTANCE_PREFIX}${INSTANCE_ID}/runtime/app.js`)!;
    expect(untouched.bytes).toEqual(base.readFile('runtime/app.js'));
  });

  it('returns 404 for unknown paths, foreign instance ids and non-instance URLs', async () => {
    const snapshot = await buildSnapshot(JSON.stringify({ title: '仅本实例', scenes: [{ text: 'x' }] }));
    for (const pathname of [
      `${WEB_PACKAGE_INSTANCE_PREFIX}${INSTANCE_ID}/missing/file.js`,
      `${WEB_PACKAGE_INSTANCE_PREFIX}${INSTANCE_ID}/`,
      `${WEB_PACKAGE_INSTANCE_PREFIX}other-instance/index.html`,
      `${WEB_PACKAGE_INSTANCE_PREFIX}${INSTANCE_ID}/../index.html`,
      '/arena',
      WEB_PACKAGE_SERVICE_WORKER_PATH,
    ]) {
      const response = createWebPackageResourceResponse(snapshot, pathname);
      expect(response.status, pathname).toBe(404);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    }
  });

  it('builds instance URLs only for portable entry paths and valid ids', () => {
    expect(buildWebPackageInstanceUrl(INSTANCE_ID, 'index.html')).toContain(INSTANCE_ID);
    expect(() => buildWebPackageInstanceUrl('bad id', 'index.html')).toThrow();
    expect(() => buildWebPackageInstanceUrl(INSTANCE_ID, '../index.html')).toThrow();
    expect(() => buildWebPackageInstanceUrl(INSTANCE_ID, '/index.html')).toThrow();
  });

  it('segment-encodes logical paths so #, spaces and Unicode stay requestable', () => {
    const withHash = buildWebPackageInstanceUrl(INSTANCE_ID, 'notes/report#1.html');
    expect(withHash).toBe(`${WEB_PACKAGE_INSTANCE_PREFIX}${INSTANCE_ID}/notes/report%231.html`);
    expect(withHash.split('#')).toHaveLength(1);
    expect(parseWebPackageInstancePath(new URL(withHash, 'https://example.test').pathname)).toEqual({
      instanceId: INSTANCE_ID,
      path: 'notes/report#1.html',
    });

    const withSpace = buildWebPackageInstanceUrl(INSTANCE_ID, 'my file.js');
    expect(withSpace).toContain('my%20file.js');
    expect(parseWebPackageInstancePath(new URL(withSpace, 'https://example.test').pathname)?.path).toBe('my file.js');

    const unicode = buildWebPackageInstanceUrl(INSTANCE_ID, 'assets/背景.svg');
    expect(parseWebPackageInstancePath(new URL(unicode, 'https://example.test').pathname)?.path).toBe('assets/背景.svg');
  });

  it('materializes an overlay-only target that is absent from the base manifest', async () => {
    const base = await resolveWebPackage(BUILTIN_VISUAL_NOVEL_PACKAGE_REF);
    const manifest = {
      ...base.manifest,
      generation: { ...base.manifest.generation, schema: undefined, target: 'new/story.json' },
    };
    const withNewTarget = await verifyWebPackage(manifest, manifest.files.map((file) => ({
      path: file.path,
      bytes: base.readFile(file.path)!,
    })));
    expect(withNewTarget.readFile('new/story.json')).toBeUndefined();
    const overlay = {
      packageRef: withNewTarget.ref,
      targetPath: withNewTarget.manifest.generation.target,
      targetMediaType: withNewTarget.manifest.generation.mediaType,
      generatedContent: storyJson,
      generatedDigest: await digestWebPackageBytes(encoder.encode(storyJson)),
    };
    const instance = await createWebPackageInstance(withNewTarget, overlay);
    const snapshot = createWebPackageResourceSnapshot(INSTANCE_ID, instance);
    const pathname = `${WEB_PACKAGE_INSTANCE_PREFIX}${INSTANCE_ID}/new/story.json`;
    expect(resolveWebPackageInstancePath(snapshot, pathname)).not.toBeNull();
    const response = createWebPackageResourceResponse(snapshot, pathname);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.text()).toBe(storyJson);
  });

  it('rejects snapshots when overlay identity drifts from the frozen base ref', async () => {
    const base = await resolveWebPackage(BUILTIN_VISUAL_NOVEL_PACKAGE_REF);
    const overlay = await createWebPackageOverlay(BUILTIN_VISUAL_NOVEL_PACKAGE_REF, JSON.stringify({ title: 't', scenes: [{ text: 's' }] }));
    const instance = await createWebPackageInstance(base, overlay);
    expect(() => createWebPackageResourceSnapshot(INSTANCE_ID, {
      ...instance,
      overlay: { ...overlay, packageRef: { ...overlay.packageRef, digest: `sha256:${'0'.repeat(64)}` } },
    })).toThrow('契约');
    expect(() => createWebPackageResourceSnapshot('bad id', instance)).toThrow('instance id');
  });

  it('labels HTML documents with the sandbox CSP while keeping asset responses minimal', () => {
    const html = createWebPackageResourceHeaders('text/html');
    expect(html.get('content-security-policy')).toBe('sandbox allow-scripts');
    expect(html.get('content-type')).toBe('text/html; charset=utf-8');
    expect(html.get('access-control-allow-origin')).toBe('*');

    const png = createWebPackageResourceHeaders('image/png');
    expect(png.get('content-security-policy')).toBeNull();
    expect(png.get('content-type')).toBe('image/png');
    expect(png.get('access-control-allow-origin')).toBe('*');

    const mjs = createWebPackageResourceHeaders('text/javascript');
    expect(mjs.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(mjs.get('x-content-type-options')).toBe('nosniff');
    expect(mjs.get('access-control-allow-origin')).toBe('*');
  });

  it('emits CORS headers on success and 404 so opaque sandbox fetches can read JSON/JS', async () => {
    const snapshot = await buildSnapshot(JSON.stringify({ title: 'CORS', scenes: [{ text: 'x' }] }));
    const ok = createWebPackageResourceResponse(snapshot, `${WEB_PACKAGE_INSTANCE_PREFIX}${INSTANCE_ID}/data/story.json`);
    expect(ok.headers.get('access-control-allow-origin')).toBe('*');
    const missing = createWebPackageResourceResponse(snapshot, `${WEB_PACKAGE_INSTANCE_PREFIX}${INSTANCE_ID}/missing.json`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('keeps foreign instance bytes out of this snapshot even when paths match', async () => {
    const snapshot = await buildSnapshot(JSON.stringify({ title: '隔离', scenes: [{ text: '仅 A' }] }));
    const otherPath = `${WEB_PACKAGE_INSTANCE_PREFIX}ffff/index.html`;
    expect(resolveWebPackageInstancePath(snapshot, otherPath)).toBeNull();
    expect(createWebPackageResourceResponse(snapshot, otherPath).status).toBe(404);
    expect(encoder.encode('隔离').byteLength).toBeGreaterThan(0);
  });
});
