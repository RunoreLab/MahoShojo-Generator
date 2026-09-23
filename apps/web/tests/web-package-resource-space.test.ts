import '@/tests/helpers/fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BUILTIN_VISUAL_NOVEL_PACKAGE_REF,
  WEB_PACKAGE_INSTANCE_PREFIX,
  createWebPackageInstance,
  createWebPackageOverlay,
  createWebPackageResourceSnapshot,
  resolveWebPackage,
} from '@mahoshojo/web-package';
import {
  clearWebPackageInstances,
  deserializeWebPackageInstanceRecord,
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

    const html = await handleWebPackageResourceRequest(`${WEB_PACKAGE_INSTANCE_PREFIX}inst_handler/index.html`);
    expect(html.status).toBe(200);
    expect(html.headers.get('content-security-policy')).toBe('sandbox allow-scripts');
    expect(html.headers.get('referrer-policy')).toBe('no-referrer');

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
    }

    await clearWebPackageInstances();
    const afterClear = await handleWebPackageResourceRequest(`${WEB_PACKAGE_INSTANCE_PREFIX}inst_handler/index.html`);
    expect(afterClear.status).toBe(404);
    expect(await readWebPackageInstance('missing-instance')).toBeNull();
  });
});
