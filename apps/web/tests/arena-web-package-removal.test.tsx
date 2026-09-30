// @vitest-environment jsdom
import '@/tests/helpers/fake-indexeddb';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, beforeEach } from 'vitest';
import {
  BUILTIN_ARENA_NEWS_PACKAGE_REF,
  clearLocalWebPackageSessionStaging,
  listStagedLocalWebPackages,
  resolveWebPackage,
  stageLocalWebPackage,
  verifyWebPackage,
} from '@mahoshojo/web-package';
import { getLocalWebPackageRepository, resetLocalWebPackageRepository } from '@/lib/local-library/web-package-repository';
import { LOCAL_LIBRARY_DB_NAME, resetLocalLibraryDbConnection } from '@/lib/local-library/db';
import { saveWebPackageToLibrary } from '@/lib/local-library/web-package-library';
import { removeLocalWebPackage } from '@/lib/local-library/remove-local-web-package';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';
import { SoloArenaWebPackageSection } from '@/components/arena/editor/features/web-package/SoloArenaWebPackageSection';
import { WEB_PACKAGE_TRUST_KEY_PREFIX } from '@/lib/web-package/trust';

const makeLocalPackage = async (id: string) => {
  const builtin = await resolveWebPackage(BUILTIN_ARENA_NEWS_PACKAGE_REF);
  const manifest = { ...builtin.manifest, id, name: '可删除的本地包' };
  return verifyWebPackage(manifest, manifest.files.map((file) => ({
    path: file.path,
    bytes: builtin.readFile(file.path)!,
  })));
};

const resetLibrary = async (): Promise<void> => {
  resetLocalLibraryDbConnection();
  resetLocalWebPackageRepository();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(LOCAL_LIBRARY_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
};

beforeEach(resetLibrary);

it('「移除选择」只取消选择，本地库记录与同源授权都保留', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const local = await makeLocalPackage('local.removal-test');
  const { record } = await saveWebPackageToLibrary({ pkg: local, archive: new Uint8Array([1, 2, 3]) });
  stageLocalWebPackage(local);
  window.localStorage.setItem(WEB_PACKAGE_TRUST_KEY_PREFIX + local.ref.digest, '{}');

  useBattleStore.setState({ webPackageRef: local.ref, isGenerating: false });
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<SoloArenaWebPackageSection reportFormat="web" />));
    const remove = [...container.querySelectorAll('button')].find((button) => button.textContent === '移除选择')!;
    await act(async () => remove.click());

    expect(useBattleStore.getState().webPackageRef).toBeNull();
    // 取消选择不等于删除：本地库记录、staging 与授权都必须还在。
    expect((await getLocalWebPackageRepository().get(record.id))?.deletedAt).toBeUndefined();
    expect(listStagedLocalWebPackages().some((pkg) => pkg.ref.digest === local.ref.digest)).toBe(true);
    expect(window.localStorage.getItem(WEB_PACKAGE_TRUST_KEY_PREFIX + local.ref.digest)).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    useBattleStore.setState({ webPackageRef: null });
    clearLocalWebPackageSessionStaging();
    window.localStorage.removeItem(WEB_PACKAGE_TRUST_KEY_PREFIX + local.ref.digest);
    await resetLibrary();
  }
});

it('从本机删除会同时清掉本地库记录、staging、同源授权与陈旧选择', async () => {
  const local = await makeLocalPackage('local.full-removal');
  const { record } = await saveWebPackageToLibrary({ pkg: local, archive: new Uint8Array([1, 2, 3]) });
  stageLocalWebPackage(local);
  window.localStorage.setItem(WEB_PACKAGE_TRUST_KEY_PREFIX + local.ref.digest, '{}');
  useBattleStore.setState({ webPackageRef: local.ref, isGenerating: false });

  const outcome = await removeLocalWebPackage(record, {
    activeRefDigest: local.ref.digest,
    clearSelection: () => useBattleStore.setState({ webPackageRef: null }),
  });

  expect(outcome.clearedSelection).toBe(true);
  expect(outcome.clearedStaging).toBe(true);
  expect(outcome.clearedTrustGrant).toBe(true);
  // 「从本机删除」承诺的是彻底移除，因此记录本身必须消失，而不只是留下 tombstone。
  // 断言 get 返回 null 而不是 deletedAt 有值，正是为了挡住回退到仓储软删语义。
  expect(await getLocalWebPackageRepository().get(record.id)).toBeNull();
  expect((await getLocalWebPackageRepository().list({ limit: 10 })).items).toHaveLength(0);
  expect(listStagedLocalWebPackages().some((pkg) => pkg.ref.digest === local.ref.digest)).toBe(false);
  expect(window.localStorage.getItem(WEB_PACKAGE_TRUST_KEY_PREFIX + local.ref.digest)).toBeNull();
  // 删包后不能再从陈旧 ref 恢复出一个指向已删除包的选择。
  expect(useBattleStore.getState().webPackageRef).toBeNull();
  expect(await getLocalWebPackageRepository().readArchive(local.ref.digest)).toBeNull();

  clearLocalWebPackageSessionStaging();
  useBattleStore.setState({ webPackageRef: null });
  await resetLibrary();
});

it('删除不在本地库中的 digest 不影响其它条目', async () => {
  const kept = await makeLocalPackage('local.kept');
  const removed = await makeLocalPackage('local.removed');
  await saveWebPackageToLibrary({ pkg: kept, archive: new Uint8Array([9]) });
  const { record: removedRecord } = await saveWebPackageToLibrary({ pkg: removed, archive: new Uint8Array([1]) });

  await removeLocalWebPackage(removedRecord, {
    activeRefDigest: null,
    clearSelection: () => { throw new Error('不应清空选择'); },
  });

  const page = await getLocalWebPackageRepository().list({ limit: 10 });
  expect(page.items.map((item) => item.ref.digest)).toContain(kept.ref.digest);
  expect(page.items.map((item) => item.ref.digest)).not.toContain(removed.ref.digest);
  await resetLibrary();
});
