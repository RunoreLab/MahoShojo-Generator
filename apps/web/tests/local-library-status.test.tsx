// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocalLibraryStatusNote } from '@/components/shared/LocalLibraryStatusNote';
import { LocalLibrarySavePreference } from '@/components/shared/LocalLibrarySavePreference';
import { LOCAL_LIBRARY_PREFERENCE_STORAGE_KEY } from '@/lib/local-library/preferences';

let container: HTMLDivElement;
let root: Root;

const stubStorageManager = (overrides: Partial<StorageManager> = {}): void => {
  vi.stubGlobal('navigator', {
    ...navigator,
    storage: {
      estimate: vi.fn(async () => ({ usage: 1024, quota: 1024 * 1024 * 10 })),
      persisted: vi.fn(async () => true),
      persist: vi.fn(async () => true),
      ...overrides,
    },
  });
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

it('已获得持久化存储时说明理由，并仍然提醒清站点数据会删除本地库', async () => {
  stubStorageManager();
  await act(async () => root.render(<LocalLibraryStatusNote />));
  expect(container.textContent).toContain('已获得持久化存储');
  expect(container.textContent).toContain('1.0 KB / 10.0 MB');
  expect(container.textContent).toContain('清除本站数据会一并删除');
  expect(container.textContent).not.toContain('申请持久化存储');
});

it('未获得持久化存储时提供申请入口，并如实反映结果', async () => {
  const persist = vi.fn(async () => false);
  stubStorageManager({ persisted: vi.fn(async () => false), persist } as unknown as Partial<StorageManager>);
  await act(async () => root.render(<LocalLibraryStatusNote />));
  expect(container.textContent).toContain('尚未获得持久化存储');

  const button = [...container.querySelectorAll('button')].find((item) => item.textContent === '申请持久化存储')!;
  await act(async () => button.click());
  // 申请被拒绝时不得谎称已获得，只是不再重复提供该入口。
  expect(persist).toHaveBeenCalled();
  expect(container.textContent).not.toContain('申请持久化存储');
});

it('环境不支持 StorageManager 时退回到保守措辞，不显示编造的空间数字', async () => {
  vi.stubGlobal('navigator', { ...navigator, storage: undefined });
  await act(async () => root.render(<LocalLibraryStatusNote />));
  expect(container.textContent).toContain('无法提供本地库空间估计');
  expect(container.textContent).toContain('清除本站数据会一并删除');
  expect(container.textContent).not.toMatch(/\d+(\.\d+)? MB/);
});

it('「保存到本地库」偏好可勾选，并写进设备偏好而不是本地库数据', async () => {
  const onChange = vi.fn();
  await act(async () => root.render(
    <LocalLibrarySavePreference checked={false} onChange={onChange} label="导入时保存到本地库" />,
  ));
  const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  expect(checkbox.checked).toBe(false);
  expect(container.textContent).toContain('导入时保存到本地库');
  await act(async () => checkbox.click());
  expect(onChange).toHaveBeenCalledWith(true);
  // 偏好键与本地库记录键彼此独立：它是设备设置，不是库内容。
  expect(window.localStorage.getItem(LOCAL_LIBRARY_PREFERENCE_STORAGE_KEY)).toBeNull();
});
