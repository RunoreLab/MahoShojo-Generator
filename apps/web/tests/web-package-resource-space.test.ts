import '@/tests/helpers/fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BUILTIN_VISUAL_NOVEL_PACKAGE_REF,
  WEB_PACKAGE_INSTANCE_PREFIX,
  createWebPackageInstance,
  createWebPackageOverlay,
  createWebPackageResourceSnapshot,
  digestWebPackageBytes,
  resolveWebPackage,
  verifyWebPackage,
} from '@mahoshojo/web-package';
import {
  clearWebPackageInstances,
  deleteWebPackageInstance,
  deserializeWebPackageInstanceRecord,
  gcWebPackageInstances,
  putWebPackageInstance,
  readWebPackageInstance,
  serializeWebPackageResourceSnapshot,
} from '@/lib/web-package/instance-store';
import { handleWebPackageResourceRequest } from '@/lib/web-package/resource-handler';

const story = JSON.stringify({ title: '实例存储', scenes: [{ text: '第一幕' }] });

const buildSnapshot = async (instanceId: string) => {
  const base = await resolveWebPackage(BUILTIN_VISUAL_NOVEL_PACKAGE_REF);
  const overlay = await createWebPackageOverlay(BUILTIN_VISUAL_NOVEL_PACKAGE_REF, story);
  const instance = await createWebPackageInstance(base, overlay);
  return createWebPackageResourceSnapshot(instanceId, instance);
};

describe('Web package instance store and resource handler', () => {
  beforeEach(async () => {
    await clearWebPackageInstances();
  });

  it('round-trips instance files through IndexedDB without losing overlay bytes', async () => {
    const snapshot = await buildSnapshot('inst_roundtrip');
    await putWebPackageInstance(snapshot);
    const loaded = await readWebPackageInstance('inst_roundtrip');
    expect(loaded).not.toBeNull();
    expect(loaded!.entry).toBe(snapshot.entry);
    expect(loaded!.packageRef).toEqual(snapshot.packageRef);
    expect([...loaded!.files.keys()].sort()).toEqual([...snapshot.files.keys()].sort());

    const storyFile = loaded!.files.get('data/story.json')!;
    expect(new TextDecoder().decode(storyFile.bytes)).toBe(story);
    expect(storyFile.mediaType).toBe('application/json');

    const record = serializeWebPackageResourceSnapshot(snapshot);
    const restored = deserializeWebPackageInstanceRecord(record);
    expect(restored.files.get('runtime/app.js')!.bytes).toEqual(snapshot.files.get('runtime/app.js')!.bytes);
  });

  it('serves nested relative paths and rejects unknown or foreign instance paths', async () => {
    const snapshot = await buildSnapshot('inst_handler');
    await putWebPackageInstance(snapshot);

    const nested = `${WEB_PACKAGE_INSTANCE_PREFIX}inst_handler/styles/app.css`;
    const css = await handleWebPackageResourceRequest(nested);
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toContain('text/css');
    expect(css.headers.get('x-content-type-options')).toBe('nosniff');
    expect(css.headers.get('access-control-allow-origin')).toBe('*');

    const html = await handleWebPackageResourceRequest(`${WEB_PACKAGE_INSTANCE_PREFIX}inst_handler/index.html`);
    expect(html.status).toBe(200);
    expect(html.headers.get('content-security-policy')).toBe('sandbox allow-scripts');
    expect(html.headers.get('referrer-policy')).toBe('no-referrer');
    expect(html.headers.get('access-control-allow-origin')).toBe('*');

    for (const pathname of [
      `${WEB_PACKAGE_INSTANCE_PREFIX}inst_handler/missing.js`,
      `${WEB_PACKAGE_INSTANCE_PREFIX}other/index.html`,
      `${WEB_PACKAGE_INSTANCE_PREFIX}inst_handler/../index.html`,
      '/arena',
      '/__web-package__/sw.js',
      '',
    ]) {
      const response = await handleWebPackageResourceRequest(pathname);
      expect(response.status, pathname).toBe(404);
      expect(response.headers.get('access-control-allow-origin'), pathname).toBe('*');
    }

    await clearWebPackageInstances();
    const afterClear = await handleWebPackageResourceRequest(`${WEB_PACKAGE_INSTANCE_PREFIX}inst_handler/index.html`);
    expect(afterClear.status).toBe(404);
    expect(await readWebPackageInstance('missing-instance')).toBeNull();
  });

  it('serves overlay-only targets and garbage-collects stale instances', async () => {
    const base = await resolveWebPackage(BUILTIN_VISUAL_NOVEL_PACKAGE_REF);
    const manifest = {
      ...base.manifest,
      generation: { ...base.manifest.generation, schema: undefined, target: 'new/story.json' },
    };
    const withNewTarget = await verifyWebPackage(manifest, manifest.files.map((file) => ({
      path: file.path,
      bytes: base.readFile(file.path)!,
    })));
    const overlay = {
      packageRef: withNewTarget.ref,
      targetPath: withNewTarget.manifest.generation.target,
      targetMediaType: withNewTarget.manifest.generation.mediaType,
      generatedContent: story,
      generatedDigest: await digestWebPackageBytes(new TextEncoder().encode(story)),
    };
    const instance = await createWebPackageInstance(withNewTarget, overlay);
    const snapshot = createWebPackageResourceSnapshot('inst_new_target', instance);
    await putWebPackageInstance(snapshot);
    const created = await handleWebPackageResourceRequest(`${WEB_PACKAGE_INSTANCE_PREFIX}inst_new_target/new/story.json`);
    expect(created.status).toBe(200);
    expect(await created.text()).toBe(story);

    await putWebPackageInstance(await buildSnapshot('inst_stale'));
    expect(await readWebPackageInstance('inst_stale')).not.toBeNull();
    await gcWebPackageInstances(['inst_new_target']);
    expect(await readWebPackageInstance('inst_stale')).toBeNull();
    expect(await readWebPackageInstance('inst_new_target')).not.toBeNull();

    await deleteWebPackageInstance('inst_new_target');
    expect(await readWebPackageInstance('inst_new_target')).toBeNull();
    await clearWebPackageInstances();
  });

  it('keeps both session-mounted instances when a second mount GCs', async () => {
    const first = await buildSnapshot('inst_session_a');
    const second = await buildSnapshot('inst_session_b');
    await putWebPackageInstance(first);
    await putWebPackageInstance(second);
    await putWebPackageInstance(await buildSnapshot('inst_session_stale'));

    // Simulate mountWebPackageInstance lease semantics: keep both active ids.
    await gcWebPackageInstances(['inst_session_a', 'inst_session_b']);
    expect(await readWebPackageInstance('inst_session_a')).not.toBeNull();
    expect(await readWebPackageInstance('inst_session_b')).not.toBeNull();
    expect(await readWebPackageInstance('inst_session_stale')).toBeNull();

    const a = await handleWebPackageResourceRequest(`${WEB_PACKAGE_INSTANCE_PREFIX}inst_session_a/index.html`);
    const b = await handleWebPackageResourceRequest(`${WEB_PACKAGE_INSTANCE_PREFIX}inst_session_b/index.html`);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    await clearWebPackageInstances();
  });
});
