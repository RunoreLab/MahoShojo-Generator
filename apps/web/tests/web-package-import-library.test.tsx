// @vitest-environment jsdom
import '@/tests/helpers/fake-indexeddb';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  BUILTIN_ARENA_NEWS_PACKAGE_REF,
  clearLocalWebPackageSessionStaging,
  listStagedLocalWebPackages,
  packWebPackageZip,
  resolveWebPackage,
  verifyWebPackage,
} from '@mahoshojo/web-package';
import {
  LOCAL_LIBRARY_DB_NAME,
  resetLocalLibraryDbConnection,
} from '@/lib/local-library/db';
import { getLocalCardRepository, resetLocalCardRepository } from '@/lib/local-library/card-repository';
import { getLocalWebPackageRepository, resetLocalWebPackageRepository } from '@/lib/local-library/web-package-repository';
import { LOCAL_LIBRARY_PREFERENCE_STORAGE_KEY } from '@/lib/local-library/preferences';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';
import { SoloArenaWebPackageSection } from '@/components/arena/editor/features/web-package/SoloArenaWebPackageSection';

let container: HTMLDivElement;
let root: Root;

const makePackage = async (id: string) => {
  const builtin = await resolveWebPackage(BUILTIN_ARENA_NEWS_PACKAGE_REF);
  const manifest = { ...builtin.manifest, id, name: `导入包 ${id}` };
  return verifyWebPackage(manifest, manifest.files.map((file) => ({ path: file.path, bytes: builtin.readFile(file.path)! })));
};

const deleteDatabase = (name: string): Promise<void> =>
  new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });

/** 导入入口现在在选择模态框内；所有导入用例都先把它打开。 */
const openPicker = async (): Promise<void> => {
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[data-testid="arena-web-package-open-picker"]')!.click();
  });
};

/** 模态框内的文件输入。 */
const importInput = (): HTMLInputElement =>
  document.querySelector<HTMLInputElement>('[data-testid="web-package-import-input"]')!;

/**
 * 导入是异步的（解包 + 校验 + IndexedDB 写入），事件派发后必须把宏任务跑完，
 * 否则断言会看到"什么都没发生"的中间态。
 */
const flushAsyncWork = async (): Promise<void> => {
  for (let round = 0; round < 8; round += 1) {
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
  }
};

const importZip = async (file: File): Promise<void> => {
  const input = importInput();
  await act(async () => {
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flushAsyncWork();
};

const showLibraryTab = async (): Promise<void> => {
  await openPicker();
  await act(async () => {
    [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('本地库 ('))!.click();
  });
};

const zipFile = async (bytes: Uint8Array, name = 'package.zip'): Promise<File> => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], name, { type: 'application/zip' });
};

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  resetLocalLibraryDbConnection();
  resetLocalCardRepository();
  resetLocalWebPackageRepository();
  await deleteDatabase(LOCAL_LIBRARY_DB_NAME);
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  useBattleStore.setState({ webPackageRef: null, isGenerating: false });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  clearLocalWebPackageSessionStaging();
  useBattleStore.setState({ webPackageRef: null });
  window.localStorage.clear();
  vi.restoreAllMocks();
});

it('默认不保存到本地库时，导入的包仍然立即可选、可见，且标注为仅本次会话', async () => {
  const pkg = await makePackage('local.session-only');
  const file = await zipFile(await packWebPackageZip(pkg));

  await act(async () => root.render(<SoloArenaWebPackageSection reportFormat="web" />));
  // 默认偏好是关闭的：导入只写 session staging。
  expect(window.localStorage.getItem(LOCAL_LIBRARY_PREFERENCE_STORAGE_KEY)).toBeNull();

  await openPicker();
  await importZip(file);

  expect(useBattleStore.getState().webPackageRef).toEqual(pkg.ref);
  expect(listStagedLocalWebPackages().some((item) => item.ref.digest === pkg.ref.digest)).toBe(true);
  // 没有落盘。
  expect((await getLocalWebPackageRepository().list({ limit: 10 })).items).toHaveLength(0);

  // 关键回归点：刚导入完不能显示"不可用的 Web 包"，包必须出现在本地库页签里。
  expect(document.querySelector('[data-testid="arena-web-package-selected"]')?.textContent)
    .toBe(`本地：${pkg.manifest.name}`);
  await showLibraryTab();
  // 刚导入的包已经是当前选择，因此卡片的 aria-label 是「取消选择」而不是「选择」。
  const card = document.querySelector<HTMLButtonElement>(
    `[aria-label="取消选择 Web 包：${pkg.manifest.name}"]`,
  );
  expect(card).toBeTruthy();
  expect(card!.disabled).toBe(false);
  expect(card!.getAttribute('aria-pressed')).toBe('true');
  // 未落盘：不得提供删除入口，也不得谎称已保存。
  expect(document.querySelector(`[title="从本地库删除：${pkg.manifest.name}"]`)).toBeNull();
  expect(document.body.textContent).toContain('仅本次会话');
});

it('开启偏好后导入会写入本地库，并在列表中去掉「仅本次会话」标记', async () => {
  window.localStorage.setItem(
    LOCAL_LIBRARY_PREFERENCE_STORAGE_KEY,
    JSON.stringify({ saveImportedDataCards: false, saveImportedWebPackages: true }),
  );
  const pkg = await makePackage('local.saved');
  const file = await zipFile(await packWebPackageZip(pkg));

  await act(async () => root.render(<SoloArenaWebPackageSection reportFormat="web" />));
  await openPicker();
  await importZip(file);

  const page = await getLocalWebPackageRepository().list({ limit: 10 });
  expect(page.items.map((item) => item.ref.digest)).toContain(pkg.ref.digest);
  await showLibraryTab();
  expect(document.body.textContent).not.toContain('仅本次会话');
  // 已落库的条目可删除。
  expect(document.querySelector(`[title="从本地库删除：${pkg.manifest.name}"]`)).toBeTruthy();
});

it('重复导入同一份 ZIP 不会在本地库堆出第二行', async () => {
  window.localStorage.setItem(
    LOCAL_LIBRARY_PREFERENCE_STORAGE_KEY,
    JSON.stringify({ saveImportedDataCards: false, saveImportedWebPackages: true }),
  );
  const pkg = await makePackage('local.dupe');
  const archive = await packWebPackageZip(pkg);

  // 真实场景是"刷新后再导入同一份文件"，所以中间卸载重挂：它同时覆盖了会话水合。
  await act(async () => root.render(<SoloArenaWebPackageSection reportFormat="web" />));
  await openPicker();
  await importZip(await zipFile(archive));

  await act(async () => root.unmount());
  clearLocalWebPackageSessionStaging();
  root = createRoot(container);
  await act(async () => root.render(<SoloArenaWebPackageSection reportFormat="web" />));
  await openPicker();
  await importZip(await zipFile(archive));

  const page = await getLocalWebPackageRepository().list({ limit: 10 });
  expect(page.items.filter((item) => item.ref.digest === pkg.ref.digest)).toHaveLength(1);
  expect(document.querySelector('[data-testid="web-package-import-feedback"]')?.textContent)
    .toContain('已更新原记录');
});

it('未勾选偏好时本地库为空，但数据卡本地库路径不受影响', async () => {
  const repository = getLocalCardRepository();
  const now = new Date().toISOString();
  await repository.put({
    id: 'lc_smoke', schemaVersion: 1, storageLocation: 'local', cardType: 'character',
    title: '数据卡仍在', data: { name: '焰' },
    contentDigest: `sha256:${'a'.repeat(64)}`,
    provenance: { kind: 'unsigned', execution: 'imported' },
    createdAt: now, updatedAt: now,
  });

  await act(async () => root.render(<SoloArenaWebPackageSection reportFormat="web" />));
  expect((await getLocalWebPackageRepository().list({ limit: 10 })).items).toHaveLength(0);
  expect((await getLocalCardRepository().list({ limit: 10 })).items).toHaveLength(1);
});
