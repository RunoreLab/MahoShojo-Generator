// @vitest-environment jsdom
import '@/tests/helpers/fake-indexeddb';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { favoritesApi, authStorage } from '@/lib/auth';
import BattleDataModal from '@/components/BattleDataModal';
import { IndexedDbCardRepository, resetLocalCardRepository } from '@/lib/local-library/card-repository';
import { LOCAL_LIBRARY_DB_NAME, resetLocalLibraryDbConnection } from '@/lib/local-library/db';
import { saveLocalDataCard } from '@/lib/local-library/data-card-digest';
import { mapDataCardRuntimeSourceInfo } from '@/lib/data-card-read-mappers';

vi.mock('@/lib/useAuth', () => ({ useAuth: () => ({ isAuthenticated: false, user: null, userBadges: [] }) }));
vi.mock('@/components/DataCard', () => ({ default: (props: any) => (
  <div
    data-testid={`card-${props.id}`}
    data-storage={props.storageLocation}
    data-remove={String(typeof props.onRemoveFromLibrary === 'function')}
  >
    <span>{props.name}</span>
    <button type="button" data-testid={`remove-${props.id}`} disabled={props.removePending} onClick={(event) => { event.stopPropagation(); props.onRemoveFromLibrary?.(); }}>移除卡片</button>
    <button type="button" data-testid={`details-${props.id}`} onClick={(event) => { event.stopPropagation(); props.onViewDetails?.(); }}>详情</button>
  </div>
 ) }));
vi.mock('@/components/DataCardDetailsModal', () => ({ default: (props: any) => (
  props.isOpen ? <div data-testid="card-details">{props.card?.name}</div> : null
) }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let repository: IndexedDbCardRepository;

const character = (name: string): Record<string, unknown> => ({ name, codename: name, age: 15 });

beforeEach(async () => {
  resetLocalLibraryDbConnection();
  resetLocalCardRepository();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(LOCAL_LIBRARY_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
  repository = new IndexedDbCardRepository();
  vi.spyOn(authStorage, 'getAuthHeader').mockResolvedValue(null);
  vi.spyOn(favoritesApi, 'getFavorites').mockResolvedValue({ success: true, favorites: [] });
  // 标签库为空是真实场景；旧实现把它当成「还没取过」，每次渲染都重新请求。
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, cards: [], items: {}, tags: [] })));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const render = async (props: Record<string, unknown> = {}): Promise<void> => {
  await act(async () => root.render(
    <BattleDataModal
      isOpen
      onClose={() => {}}
      selectedType="character"
      initialTab="local"
      onSelectCard={() => {}}
      {...props}
    />,
  ));
};

it('未登录也能打开本地库并看到本机数据卡', async () => {
  await saveLocalDataCard(repository, { cardType: 'character', title: '本机焰', payload: character('焰') }, () => '2026-09-29T12:00:00.000Z');
  await render();

  const tab = [...document.body.querySelectorAll('button')].find((button) => button.textContent?.startsWith('本地库'));
  expect(tab).toBeDefined();
  expect(document.body.textContent).toContain('本机焰');
  // 本地库记录不参与服务器侧批量元数据请求。
  const metaCalls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .filter((call) => String(call[0]).includes('/api/data-card-meta-batch'));
  expect(metaCalls).toHaveLength(0);
});

it('本地库卡片带上本地标记，从而让 DataCard 走本地动作集', async () => {
  const { record } = await saveLocalDataCard(
    repository,
    { cardType: 'character', title: '本机焰', payload: character('焰') },
    () => '2026-09-29T12:00:00.000Z',
  );
  await render();
  const card = document.body.querySelector(`[data-testid="card-${record.id}"]`);
  expect(card?.getAttribute('data-storage')).toBe('local');
  expect(card?.getAttribute('data-remove')).toBe('true');
});

it('删除本地库卡片需要二次确认，确认后记录才消失', async () => {
  const { record } = await saveLocalDataCard(
    repository,
    { cardType: 'character', title: '本机焰', payload: character('焰') },
    () => '2026-09-29T12:00:00.000Z',
  );
  await render();

  await act(async () => (document.body.querySelector(`[data-testid="remove-${record.id}"]`) as HTMLButtonElement).click());
  // 第一次点击只是提出删除请求，库里还没有变化。
  expect(await repository.get(record.id)).not.toBeNull();
  const confirm = [...document.body.querySelectorAll('button')].find((button) => button.textContent === '删除' && button.closest('[role="dialog"]'));
  expect(confirm).toBeDefined();
  await act(async () => (confirm as HTMLButtonElement).click());

  expect(await repository.get(record.id)?.then((value) => value?.deletedAt ?? null)).toEqual(expect.any(String));
  expect((await repository.list({ limit: 10 })).items).toHaveLength(0);
});

it('详情按钮直接读本地正文，不发单卡网络请求', async () => {
  const { record } = await saveLocalDataCard(
    repository,
    { cardType: 'character', title: '本机焰', payload: character('焰') },
    () => '2026-09-29T12:00:00.000Z',
  );
  await render();
  await act(async () => (document.body.querySelector(`[data-testid="details-${record.id}"]`) as HTMLButtonElement).click());

  expect(document.body.querySelector('[data-testid="card-details"]')?.textContent).toBe('本机焰');
  const singleCardCalls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .filter((call) => String(call[0]).includes(`/api/public-data-cards?id=${record.id}`));
  expect(singleCardCalls).toHaveLength(0);
});

it('空本地库给出填充入口与边界说明，而不是一句共用的「暂无数据卡」', async () => {
  await render();
  // 首次进入本地库页签会先读一次 IndexedDB，空态要等这次读取落定。
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

  expect(document.body.textContent).toContain('本地库还是空的');
  // 填充入口全在用户当前视野之外，空状态必须自己把它们列出来。
  expect(document.body.textContent).toContain('存到本地库');
  expect(document.body.textContent).toContain('同时保存到本地库');
  expect(document.body.textContent).toContain('清除本站数据会一并删除');
  // 没有整库备份这件事必须在这里说，否则用户会以为清站点数据是安全的。
  expect(document.body.textContent).toContain('还没有整库导出/备份');
  expect(document.body.querySelector('a[href="/encyclopedia/local-library"]')).not.toBeNull();
});

it('标签库为空时不会反复重取（否则每次渲染都触发一次请求）', async () => {
  const fetchMock = vi.fn(async () => Response.json({ success: true, cards: [], items: {}, tags: [] }));
  vi.stubGlobal('fetch', fetchMock);
  await render();

  const tagCalls = () => fetchMock.mock.calls.filter((call) => String(call[0]).includes('/api/tags')).length;
  const firstPass = tagCalls();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  expect(tagCalls()).toBe(firstPass);
});

it('选择本地库卡片直接产出 payload，不经过线上单卡接口', async () => {
  const onSelectCard = vi.fn();
  const { record } = await saveLocalDataCard(
    repository,
    { cardType: 'character', title: '本机焰', payload: character('焰') },
    () => '2026-09-29T12:00:00.000Z',
  );
  await render({ onSelectCard });
  await act(async () => (document.body.querySelector(`[data-testid="card-${record.id}"]`) as HTMLElement).click());

  expect(onSelectCard).toHaveBeenCalledTimes(1);
  const payload = onSelectCard.mock.calls[0][0];
  expect(payload).toMatchObject({ _cardName: '本机焰', name: '焰', _storageLocation: 'local' });
  // 本地库记录没有服务器身份：给出本地 id 会让它在下游被当成 online content reference
  // 发布进 Arena 房间共享配置与 PVP 提交（ADR-local-library-data-ownership §2）。
  expect(payload._cardId).toBe('');
  expect(mapDataCardRuntimeSourceInfo(payload).sourceDataCardId).toBeUndefined();
  expect(mapDataCardRuntimeSourceInfo(payload).sourceIsLocalLibrary).toBe(true);
});
