// @vitest-environment jsdom
import '@/tests/helpers/fake-indexeddb';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { LocalLibraryPage } from '@/components/library/LocalLibraryPage';
import { IndexedDbCardRepository, resetLocalCardRepository } from '@/lib/local-library/card-repository';
import { LOCAL_LIBRARY_DB_NAME, resetLocalLibraryDbConnection } from '@/lib/local-library/db';
import { saveLocalDataCard } from '@/lib/local-library/save-local-data-card';

vi.mock('@/components/shared/LocalLibraryStatusNote', () => ({ LocalLibraryStatusNote: () => null }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let repository: IndexedDbCardRepository;

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
const click = (target: Element | undefined) => act(async () => {
  target!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});

beforeEach(async () => {
  resetLocalLibraryDbConnection();
  resetLocalCardRepository();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(LOCAL_LIBRARY_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
  repository = new IndexedDbCardRepository();
  const fetchSpy = vi.fn(async () => { throw new Error('本地库页面不应发起网络请求'); });
  vi.stubGlobal('fetch', fetchSpy);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('Web 本地库页回用共源列表：软删进入回收站并可恢复，全程不触网', async () => {
  await saveLocalDataCard(repository, { cardType: 'character', title: '星光', payload: { codename: '星光' } });
  await act(async () => root.render(<LocalLibraryPage />));
  await settle();
  expect(container.querySelector('[data-testid="local-cards-panel"]')).not.toBeNull();
  expect(container.textContent).toContain('星光');

  await click(button('移入回收站…'));
  await click(button('确认移入回收站'));
  await settle();
  const [stored] = (await repository.list({ limit: 10, includeDeleted: true })).items;
  expect(stored?.deletedAt).toBeDefined();

  await click(container.querySelector('[data-testid="local-cards-view-recycle"]')!);
  await settle();
  await click(button('恢复'));
  await settle();
  const restored = await repository.list({ limit: 10 });
  expect(restored.items.map((item) => item.title)).toEqual(['星光']);
  expect(fetch).not.toHaveBeenCalled();
});
