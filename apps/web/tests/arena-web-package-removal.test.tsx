// @vitest-environment jsdom
import '@/tests/helpers/fake-indexeddb';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import {
  BUILTIN_VISUAL_NOVEL_PACKAGE_REF, clearLocalWebPackageSessionStaging,
  listStagedLocalWebPackages, resolveWebPackage, stageLocalWebPackage, verifyWebPackage,
} from '@mahoshojo/web-package';
import { putWebPackageArchiveCache, readWebPackageArchiveCache, deleteWebPackageArchiveCache } from '@/lib/web-package/cache';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';
import { SoloArenaWebPackageSection } from '@/components/arena/editor/features/web-package/SoloArenaWebPackageSection';

it('移除本地包只取消选择，保留 session staging 与持久缓存供历史重放', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const builtin = await resolveWebPackage(BUILTIN_VISUAL_NOVEL_PACKAGE_REF);
  const manifest = { ...builtin.manifest, id: 'local.removal-test', name: '可保留本地包' };
  const local = await verifyWebPackage(manifest, manifest.files.map((file) => ({
    path: file.path, bytes: builtin.readFile(file.path)!,
  })));
  stageLocalWebPackage(local);
  await putWebPackageArchiveCache(local);
  useBattleStore.setState({ webPackageRef: local.ref, isGenerating: false });
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<SoloArenaWebPackageSection reportFormat="web" />));
    const remove = [...container.querySelectorAll('button')].find((button) => button.textContent === '移除')!;
    await act(async () => remove.click());
    expect(useBattleStore.getState().webPackageRef).toBeNull();
    expect(listStagedLocalWebPackages().some((pkg) => pkg.ref.digest === local.ref.digest)).toBe(true);
    expect(await readWebPackageArchiveCache(local.ref.digest)).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    useBattleStore.setState({ webPackageRef: null });
    clearLocalWebPackageSessionStaging();
    await deleteWebPackageArchiveCache(local.ref.digest);
  }
});
