// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { authStorage, favoritesApi } from '@/lib/auth';
import * as client from '@/lib/data-card-list-client';
import { useDataCardSummaryPage } from '@/lib/use-data-card-summary-page';
import type { DataCardSummary, DataCardSummaryPage } from '@mahoshojo/contracts/data-cards';
import DataCardsModal from '@/components/CharManager/DataCardsModal';
import BattleDataModal from '@/components/BattleDataModal';
vi.mock('@/lib/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true, user: { id: 1, username: 'test' }, userBadges: [] }) }));
vi.mock('@/components/DataCard', () => ({ default: (props: any) => <button onClick={props.onEditData || props.onViewDetails}>{props.name}</button> }));
vi.mock('@/components/DataCardDetailsModal', () => ({ default: () => null }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let state: ReturnType<typeof useDataCardSummaryPage>;
const card: DataCardSummary = { id: 'mine', user_id: 1, type: 'character', name: '我的角色', description: '',
  is_public: 0, review_status: 'approved', created_at: null, updated_at: null, usage_count: 0,
  like_count: 0, favorite_count: 0, is_recommended: 0, username: 'test', roleType: 'general',
  nativeAllowed: false, has_pending_update: false, tag_ids: [], favorited_at: null };
const page = (cards: DataCardSummary[] = [card], total = cards.length): DataCardSummaryPage => ({ success: true, cards, total, nextOffset: total > 12 ? 12 : null });
function Harness({ userId = 1, enabled = true, search = '' }: { userId?: number | null; enabled?: boolean; search?: string }) {
  state = useDataCardSummaryPage('my', userId, enabled, { search }); return null;
}
function deferred() {
  let resolve!: (result: DataCardSummaryPage) => void; let reject!: (reason: Error) => void;
  const promise = new Promise<DataCardSummaryPage>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.spyOn(authStorage, 'getAuthHeader').mockResolvedValue(null);
  vi.spyOn(favoritesApi, 'getFavorites').mockResolvedValue({ success: true, favorites: [] });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, cards: [], items: { mine: { metrics: null, strict: null } }, tags: [{ id: 'tag', name: '标签', scope: 'system', isActive: true }] })));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it('显式失败、重试恢复，刷新失败保留上次完整页', async () => {
  vi.spyOn(client, 'getDataCardSummaryPage').mockRejectedValueOnce(new Error('网络不可用')).mockResolvedValueOnce(page()).mockRejectedValueOnce(new Error('暂时不可用'));
  await act(async () => root.render(<Harness />));
  expect(state.error).toBe('网络不可用'); expect(state.status).toBe('error');
  await act(async () => state.reload()); expect(state.error).toBeNull(); expect(state.cards).toEqual([card]);
  await act(async () => state.reload()); expect(state.error).toBe('暂时不可用'); expect(state.cards).toEqual([card]);
});

it('新搜索取消旧请求，迟到的旧响应不覆盖新结果', async () => {
  const old = deferred(); const latest = deferred();
  const get = vi.spyOn(client, 'getDataCardSummaryPage').mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  await act(async () => root.render(<Harness />));
  await act(async () => root.render(<Harness search="目标" />));
  expect(get.mock.calls[0][2]?.aborted).toBe(true);
  await act(async () => { old.resolve(page([])); }); expect(state.loading).toBe(true);
  await act(async () => { latest.resolve(page()); }); expect(state.cards).toEqual([card]);
});

it('关闭来源和切换账号都取消请求，旧账号数据不写回', async () => {
  const old = deferred();
  const get = vi.spyOn(client, 'getDataCardSummaryPage').mockReturnValue(old.promise);
  await act(async () => root.render(<Harness />));
  await act(async () => root.render(<Harness enabled={false} userId={2} />));
  expect(get.mock.calls[0][2]?.aborted).toBe(true);
  await act(async () => { old.resolve(page()); }); expect(state.cards).toEqual([]);
});

const modalProps = { isOpen: true, onClose: vi.fn(), dataCards: [], editingCard: null, cardsPerPage: 12,
  onEditCard: vi.fn(), onUpdateCard: vi.fn(), onDeleteCard: vi.fn(), onCancelEdit: vi.fn(), summaryOwnerId: 1 };
it('200 张卡管理首屏只读一页摘要，翻页才发新查询，载入才读单卡正文', async () => {
  const get = vi.spyOn(client, 'getDataCardSummaryPage').mockResolvedValue(page([card], 200));
  const full = vi.spyOn(client, 'loadFullDataCard').mockResolvedValue({ ...card, data: '{"name":"正文"}' });
  const onLoad = vi.fn();
  function Modal() { const [currentPage, setPage] = useState(1); return <DataCardsModal {...modalProps} currentPage={currentPage} onPageChange={setPage} onLoadCard={onLoad} />; }
  await act(async () => root.render(<Modal />));
  expect(get).toHaveBeenCalledOnce(); expect(get.mock.calls[0][1]).toMatchObject({ limit: 12, offset: 0 }); expect(full).not.toHaveBeenCalled();
  await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent === '下一页')!.click());
  expect(get).toHaveBeenCalledTimes(2); expect(get.mock.calls[1][1]).toMatchObject({ offset: 12 });
  await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent === '我的角色')!.click());
  expect(full).toHaveBeenCalledOnce(); expect(onLoad.mock.calls[0][0].data).toBe('{"name":"正文"}');
});

it('管理列表初次失败可重试；刷新失败保留可见卡片与筛选入口', async () => {
  vi.spyOn(client, 'getDataCardSummaryPage').mockRejectedValueOnce(new Error('不可用')).mockResolvedValueOnce(page()).mockRejectedValueOnce(new Error('刷新失败'));
  await act(async () => root.render(<DataCardsModal {...modalProps} currentPage={1} onPageChange={vi.fn()} onLoadCard={vi.fn()} />));
  expect(document.body.textContent).not.toContain('暂无数据卡');
  expect(document.querySelector('input[placeholder^="搜索"]')).not.toBeNull();
  await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent === '重试')!.click());
  await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent === '刷新')!.click());
  expect(document.body.textContent).toContain('我的角色'); expect(document.body.textContent).toContain('当前显示上次成功结果');
});

it('Arena 私有库加载独立于公开库，刷新失败仍展示旧卡，收藏切换读取摘要并取消旧来源', async () => {
  const pending = deferred();
  const get = vi.spyOn(client, 'getDataCardSummaryPage').mockReturnValueOnce(pending.promise).mockRejectedValueOnce(new Error('不可用')).mockResolvedValue(page([]));
  await act(async () => root.render(<BattleDataModal isOpen onClose={vi.fn()} onSelectCard={vi.fn()} selectedType="character" />));
  expect(get).toHaveBeenCalledOnce(); expect(document.body.textContent).toContain('加载中...');
  await act(async () => { pending.resolve(page()); });
  await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent?.startsWith('我的角色 ('))!.click());
  expect(document.body.textContent).toContain('当前显示上次成功结果'); expect(document.body.textContent).toContain('我的角色');
  await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent?.startsWith('我的收藏'))!.click());
  expect(get.mock.calls.at(-1)?.[0]).toBe('favorites'); expect(get.mock.calls[0][2]?.aborted).toBe(true);
  expect(document.body.textContent).toContain('暂无数据卡');
});
