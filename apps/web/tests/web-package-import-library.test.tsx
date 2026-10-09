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

/**
 * 故障注入：这两个开关让用例能精准触发"读列表失败"和"读 ZIP 字节失败"。
 * 未开启时 mock 完整透传，因此不影响同文件其它用例。
 */
const injected = { readArchive: null as Error | null, listLibrary: null as Error | null, saveGate: null as Promise<void> | null, saveStarted: false };

vi.mock('@/lib/local-library/web-package-library', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/local-library/web-package-library')>();
  return {
    ...actual,
    saveWebPackageToLibrary: async (input: Parameters<typeof actual.saveWebPackageToLibrary>[0]) => {
      injected.saveStarted = true;
      if (injected.saveGate) await injected.saveGate;
      return actual.saveWebPackageToLibrary(input);
    },
    readWebPackageFromLibrary: (record: Parameters<typeof actual.readWebPackageFromLibrary>[0]) =>
      injected.readArchive
        ? Promise.reject(injected.readArchive)
        : actual.readWebPackageFromLibrary(record),
  };
});

vi.mock('@/lib/local-library/web-package-repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/local-library/web-package-repository')>();
  return {
    ...actual,
    getLocalWebPackageRepository: () => {
      const real = actual.getLocalWebPackageRepository();
      if (!injected.listLibrary) return real;
      const fail = () => Promise.reject(injected.listLibrary);
      return new Proxy(real, {
        get(target, property, receiver) {
          if (property === 'list' || property === 'listArchiveDigests') return fail;
          const value = Reflect.get(target, property, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
});

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
  // Wait for the controller's completion signal, not a guessed number of event-loop ticks.
  // The remaining assertions still verify the actual stored record and visible selection.
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(importInput()?.disabled).toBe(false);
    expect(document.querySelector('[data-testid="web-package-import-feedback"]')).not.toBeNull();
  }, { timeout: 5_000 });
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
  injected.readArchive = null;
  injected.listLibrary = null;
  injected.saveGate = null;
  injected.saveStarted = false;
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


it('导入断言等待真实异步写入完成，不把固定宏任务次数当作已落库', async () => {
  window.localStorage.setItem(LOCAL_LIBRARY_PREFERENCE_STORAGE_KEY, JSON.stringify({ saveImportedWebPackages: true }));
  let release!: () => void;
  injected.saveGate = new Promise<void>((resolve) => { release = resolve; });
  const pkg = await makePackage('local.delayed-save');
  await act(async () => root.render(<SoloArenaWebPackageSection reportFormat="web" />));
  await openPicker();
  let settled = false;
  const pending = importZip(await zipFile(await packWebPackageZip(pkg))).then(() => { settled = true; });
  await vi.waitFor(() => expect(injected.saveStarted).toBe(true));
  await flushAsyncWork();
  expect(settled).toBe(false);
  expect(importInput().disabled).toBe(true);
  expect((await getLocalWebPackageRepository().list({ limit: 10 })).items).toHaveLength(0);
  release();
  await pending;
  expect((await getLocalWebPackageRepository().list({ limit: 10 })).items.map((item) => item.ref.digest)).toContain(pkg.ref.digest);
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

it('本地库导出失败时给出可读原因，并在失败后解锁重试', async () => {
  window.localStorage.setItem(
    LOCAL_LIBRARY_PREFERENCE_STORAGE_KEY,
    JSON.stringify({ saveImportedWebPackages: true }),
  );
  const pkg = await makePackage('local.download-fails');
  await act(async () => root.render(<SoloArenaWebPackageSection reportFormat="web" />));
  await openPicker();
  await importZip(await zipFile(await packWebPackageZip(pkg)));
  await showLibraryTab();

  const downloadOf = () => document.querySelector<HTMLButtonElement>(
    `[title="下载 Web 包 ZIP：${pkg.manifest.name}"]`,
  );
  expect(downloadOf()).toBeTruthy();

  // 让"读 ZIP 字节"直接抛错。修复前这段没有 catch，界面什么都不发生，
  // 用户只会以为按钮坏了。
  injected.readArchive = new Error('本地库字节读取被拒绝');
  await act(async () => { downloadOf()!.click(); });
  await flushAsyncWork();

  expect(document.querySelector('[data-testid="web-package-import-feedback"]')?.textContent)
    .toContain('本地库字节读取被拒绝');
  expect(document.body.textContent).toContain('本地库可能不可读');
  // 失败后必须解锁，否则用户再也无法重试。
  expect(downloadOf()?.disabled).toBe(false);
});

it('本地库列表读取失败时不谎称"还没有本地 Web 包"', async () => {
  injected.listLibrary = new Error('IndexedDB 不可用');

  await act(async () => root.render(<SoloArenaWebPackageSection reportFormat="web" />));
  await showLibraryTab();
  await flushAsyncWork();

  expect(document.querySelector('[data-testid="web-package-library-error"]')?.textContent)
    .toContain('IndexedDB 不可用');
  // 关键回归点：读失败不等于没有包，空态与错误提示必须各说各的。
  expect(document.body.textContent).toContain('本地库暂时读不出来');
  expect(document.body.textContent).not.toContain('还没有本地 Web 包');
  expect(document.body.textContent).toContain('这不代表已保存的 Web 包被删除');
});

it('迁移与水合阶段失败时不产生未处理 rejection，并如实上报', async () => {
  injected.listLibrary = new Error('存储访问被拒绝');

  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
  process.on('unhandledRejection', onUnhandled);
  try {
    await act(async () => root.render(<SoloArenaWebPackageSection reportFormat="web" />));
    await openPicker();
    await flushAsyncWork();
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }

  expect(unhandled).toEqual([]);
  expect(document.querySelector('[data-testid="web-package-library-error"]')?.textContent)
    .toContain('存储访问被拒绝');
});
