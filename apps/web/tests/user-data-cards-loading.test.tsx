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
vi.mock('@/components/DataCard', () => ({ default: (props: any) => (
  <button data-author={props.author} onClick={(event) => { event.stopPropagation(); (props.onEditData || props.onViewDetails)?.(); }}>{props.name}</button>
) }));
vi.mock('@/components/DataCardDetailsModal', () => ({ default: (props: any) => (props.isOpen ? <div data-testid="card-details">{props.card?.name}</div> : null) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let state: ReturnType<typeof useDataCardSummaryPage>;
const card: DataCardSummary = { id: 'mine', user_id: 1, type: 'character', name: '我的角色', description: '',
  is_public: 0, review_status: 'approved', created_at: null, updated_at: null, usage_count: 0,
  like_count: 0, favorite_count: 0, is_recommended: 0, username: 'test', roleType: 'general',
  nativeAllowed: false, has_pending_update: false, tag_ids: [], favorited_at: null };
const page = (cards: DataCardSummary[] = [card], total = cards.length): DataCardSummaryPage => ({ success: true, cards, total, nextOffset: total > 12 ? 12 : null });
function Harness({ userId = 1, enabled = true, search = '', offset = 0 }: { userId?: number | null; enabled?: boolean; search?: string; offset?: number }) {
  state = useDataCardSummaryPage('my', userId, enabled, { search, offset }); return null;
}
function deferred<T = DataCardSummaryPage>() {
  let resolve!: (result: T) => void; let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
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
  expect(document.querySelector('[data-author="test"]')).not.toBeNull();
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

it('公开库高级筛选不随 Tab 泄漏进我的卡/收藏摘要查询', async () => {
  const fetchMock = vi.fn(async () => Response.json({ success: true, cards: [], items: {}, tags: [{ id: 'tag', name: '标签', scope: 'system', isActive: true }] }));
  vi.stubGlobal('fetch', fetchMock);
  const get = vi.spyOn(client, 'getDataCardSummaryPage').mockResolvedValue(page([]));
  await act(async () => root.render(<BattleDataModal isOpen onClose={vi.fn()} onSelectCard={vi.fn()} selectedType="character" />));
  const clickButton = async (predicate: (text: string) => boolean) => {
    const button = [...document.querySelectorAll('button')].find((b) => typeof b.textContent === 'string' && predicate(b.textContent));
    expect(button).toBeDefined();
    await act(async () => button!.click());
  };
  await clickButton((text) => text === '公开角色');
  await clickButton((text) => text.includes('高级筛选'));
  const authorInput = document.querySelector<HTMLInputElement>('input[name="author"]');
  expect(authorInput).not.toBeNull();
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setValue?.call(authorInput, 'Bob');
    authorInput!.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await clickButton((text) => text === '应用筛选');
  expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('author=Bob'))).toBe(true);
  await clickButton((text) => text.startsWith('我的角色 ('));
  expect([...document.querySelectorAll('button')].some((b) => typeof b.textContent === 'string' && b.textContent.includes('高级筛选'))).toBe(false);
  const myQueries = get.mock.calls.filter((call) => call[0] === 'my').map((call) => call[1] as Record<string, unknown>);
  expect(myQueries.length).toBeGreaterThanOrEqual(2);
  for (const query of myQueries) {
    for (const hidden of ['author', 'minLikes', 'maxLikes', 'minUsage', 'maxUsage', 'minFavorites', 'maxFavorites',
      'roleType', 'nativeOnly', 'nativeAllowedOnly', 'recommendedOnly']) {
      expect(query).not.toHaveProperty(hidden);
    }
  }
  expect(myQueries.at(-1)).toMatchObject({ sortBy: 'created_at', tagMatch: 'any' });
});

it('同一查询刷新失败保留旧数据；翻页请求失败不得展示上一页结果', async () => {
  const get = vi.spyOn(client, 'getDataCardSummaryPage')
    .mockResolvedValueOnce(page())
    .mockRejectedValueOnce(new Error('第二页失败'))
    .mockRejectedValueOnce(new Error('第二页仍失败'));
  await act(async () => root.render(<Harness />));
  expect(state.cards).toEqual([card]); expect(state.status).toBe('success');
  await act(async () => root.render(<Harness offset={12} />));
  expect(get.mock.calls[1][1]).toMatchObject({ offset: 12 });
  expect(state.cards).toEqual([]); expect(state.status).toBe('error'); expect(state.error).toBe('第二页失败');
  await act(async () => state.reload());
  expect(state.cards).toEqual([]); expect(state.error).toBe('第二页仍失败');
});

it('搜索 A 成功后搜索 B 失败，不把 A 的结果留在 B 的结果区', async () => {
  vi.spyOn(client, 'getDataCardSummaryPage')
    .mockResolvedValueOnce(page())
    .mockRejectedValueOnce(new Error('搜索失败'));
  await act(async () => root.render(<Harness search="A" />));
  expect(state.cards).toEqual([card]); expect(state.status).toBe('success');
  await act(async () => root.render(<Harness search="B" />));
  expect(state.cards).toEqual([]); expect(state.status).toBe('error'); expect(state.error).toBe('搜索失败');
});

it('Arena 详情连续点击 last-click-wins：新请求中止旧请求，后点击的卡片胜出', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    success: true, cards: [],
    items: { 'card-a': { metrics: null, strict: null }, 'card-b': { metrics: null, strict: null } },
    tags: [{ id: 'tag', name: '标签', scope: 'system', isActive: true }],
  })));
  const cardA = { ...card, id: 'card-a', name: '甲卡' };
  const cardB = { ...card, id: 'card-b', name: '乙卡' };
  const first = deferred<any>(); const second = deferred<any>();
  vi.spyOn(client, 'getDataCardSummaryPage').mockResolvedValue(page([cardA, cardB]));
  const full = vi.spyOn(client, 'loadFullDataCard').mockImplementation((target: any) => (target.id === 'card-a' ? first.promise : second.promise));
  await act(async () => root.render(<BattleDataModal isOpen onClose={vi.fn()} onSelectCard={vi.fn()} selectedType="character" />));
  const clickCard = async (name: string) => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent === name);
    expect(button).toBeDefined();
    await act(async () => button!.click());
  };
  await clickCard('甲卡');
  await clickCard('乙卡');
  expect(full).toHaveBeenCalledTimes(2);
  expect(full.mock.calls[0][2]?.aborted).toBe(true);
  await act(async () => { second.resolve({ ...cardB, data: '{"name":"乙"}' }); });
  expect(document.querySelector('[data-testid="card-details"]')?.textContent).toBe('乙卡');
  await act(async () => { first.resolve({ ...cardA, data: '{"name":"甲"}' }); });
  expect(document.querySelector('[data-testid="card-details"]')?.textContent).toBe('乙卡');
});

const flushAsync = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const waitDebounceOrBackoff = async () => {
  // 覆盖 500ms 搜索防抖或 500ms 有界重试退避，再冲刷挂起的 React 更新。
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 550)); });
  await flushAsync();
  await flushAsync();
};
const waitSearchDebounce = waitDebounceOrBackoff;
const makePublicBatchFetch = (listResponse: (url: string) => Response | Promise<Response>) => vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes('/api/public-data-cards')) return listResponse(url);
  if (url.includes('/api/data-card-meta-batch')) {
    const body = init?.body ? JSON.parse(String(init.body)) as { dataCardIds?: string[] } : {};
    const items: Record<string, unknown> = {};
    for (const id of body.dataCardIds ?? []) items[id] = { metrics: null, strict: null };
    return Response.json({ success: true, items });
  }
  if (url.includes('/api/badges/batch')) {
    const body = init?.body ? JSON.parse(String(init.body)) as { userIds?: number[] } : {};
    const items: Record<number, unknown[]> = {};
    for (const id of body.userIds ?? []) items[id] = [];
    return Response.json({ success: true, items });
  }
  if (url.includes('/api/tags')) return Response.json({ success: true, tags: [{ id: 'tag', name: '标签', scope: 'system', isActive: true }] });
  if (url.includes('/api/favorites')) return Response.json({ success: true, favorites: [] });
  return Response.json({ success: true, cards: [], items: {}, tags: [] });
});
const typeSearch = async (value: string) => {
  const input = document.querySelector<HTMLInputElement>('input[placeholder^="搜索角色"]');
  expect(input).not.toBeNull();
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setValue?.call(input, value);
    input!.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await waitSearchDebounce();
};

it('公开库搜索 A 成功后搜索 B 失败，不把 A 的结果留在 B 的结果区', async () => {
  const publicCardA = { ...card, id: 'public-a', name: '公开甲卡', is_public: 1 };
  vi.stubGlobal('fetch', makePublicBatchFetch((url) => {
    if (url.includes('search=B')) return new Response(null, { status: 500 });
    return Response.json({ success: true, cards: [publicCardA] });
  }));
  await act(async () => root.render(
    <BattleDataModal isOpen onClose={vi.fn()} onSelectCard={vi.fn()} selectedType="character" initialTab="public" />,
  ));
  await flushAsync();
  await flushAsync();
  await typeSearch('A');
  expect(document.body.textContent).toContain('公开甲卡');
  expect(document.body.textContent).not.toContain('数据卡加载失败');
  await typeSearch('B');
  // 5xx 还需等一次 500ms 有界重试退避才进入最终错误态。
  await waitDebounceOrBackoff();
  expect(document.body.textContent).not.toContain('公开甲卡');
  expect(document.body.textContent).toContain('数据卡加载失败');
  expect(document.body.textContent).not.toContain('当前显示上次成功结果');
});

it('公开库切换到管理员推荐失败，不把公开库结果留在推荐结果区', async () => {
  const publicCardA = { ...card, id: 'public-a', name: '公开甲卡', is_public: 1 };
  vi.stubGlobal('fetch', makePublicBatchFetch((url) => {
    if (url.includes('recommendedOnly=1')) return new Response(null, { status: 500 });
    return Response.json({ success: true, cards: [publicCardA] });
  }));
  await act(async () => root.render(
    <BattleDataModal isOpen onClose={vi.fn()} onSelectCard={vi.fn()} selectedType="character" initialTab="public" />,
  ));
  await flushAsync();
  await flushAsync();
  expect(document.body.textContent).toContain('公开甲卡');
  const recommendedTab = [...document.querySelectorAll('button')].find((b) => b.textContent === '管理员推荐');
  expect(recommendedTab).toBeDefined();
  await act(async () => recommendedTab!.click());
  // 5xx 还需等一次 500ms 有界重试退避才进入最终错误态。
  await waitDebounceOrBackoff();
  expect(document.body.textContent).not.toContain('公开甲卡');
  expect(document.body.textContent).toContain('数据卡加载失败');
  expect(document.body.textContent).not.toContain('当前显示上次成功结果');
});

it('公开列表首次 503 自动重试一次后成功，不把瞬时故障展示为失败', async () => {
  const publicCardA = { ...card, id: 'public-a', name: '公开甲卡', is_public: 1 };
  let armed = false;
  let listCalls = 0;
  vi.stubGlobal('fetch', makePublicBatchFetch(() => {
    if (!armed) return Response.json({ success: true, cards: [] });
    listCalls += 1;
    if (listCalls === 1) return new Response(null, { status: 503 });
    return Response.json({ success: true, cards: [publicCardA] });
  }));
  await act(async () => root.render(
    <BattleDataModal isOpen onClose={vi.fn()} onSelectCard={vi.fn()} selectedType="character" initialTab="public" />,
  ));
  await flushAsync();
  await flushAsync();
  armed = true;
  const publicTab = [...document.querySelectorAll('button')].find((b) => b.textContent === '公开角色');
  expect(publicTab).toBeDefined();
  await act(async () => publicTab!.click());
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 550)); });
  await flushAsync();
  await flushAsync();
  expect(listCalls).toBe(2);
  expect(document.body.textContent).toContain('公开甲卡');
  expect(document.body.textContent).not.toContain('数据卡加载失败');
  expect(document.body.textContent).not.toContain('加载中...');
});

it('公开列表持续超时有界结束后进入错误态，不永久停留在加载中', async () => {
  let armed = false;
  let listCalls = 0;
  vi.stubGlobal('fetch', makePublicBatchFetch(() => {
    if (!armed) return Response.json({ success: true, cards: [] });
    listCalls += 1;
    throw new DOMException('The operation timed out.', 'TimeoutError');
  }));
  await act(async () => root.render(
    <BattleDataModal isOpen onClose={vi.fn()} onSelectCard={vi.fn()} selectedType="character" initialTab="public" />,
  ));
  await flushAsync();
  await flushAsync();
  armed = true;
  const publicTab = [...document.querySelectorAll('button')].find((b) => b.textContent === '公开角色');
  expect(publicTab).toBeDefined();
  await act(async () => publicTab!.click());
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 550)); });
  await flushAsync();
  await flushAsync();
  expect(listCalls).toBe(2);
  expect(document.body.textContent).toContain('数据卡加载失败');
  expect(document.body.textContent).not.toContain('加载中...');
  expect(document.body.textContent).not.toContain('暂无数据卡');
});

it('公开切推荐 Tab 只发一次列表请求，不产生被立即 abort 的多余请求', async () => {
  const listUrls: string[] = [];
  vi.stubGlobal('fetch', makePublicBatchFetch((url) => {
    listUrls.push(url);
    return Response.json({ success: true, cards: [] });
  }));
  await act(async () => root.render(
    <BattleDataModal isOpen onClose={vi.fn()} onSelectCard={vi.fn()} selectedType="character" initialTab="public" />,
  ));
  await flushAsync();
  await flushAsync();
  const before = listUrls.length;
  const recommendedTab = [...document.querySelectorAll('button')].find((b) => b.textContent === '管理员推荐');
  expect(recommendedTab).toBeDefined();
  await act(async () => recommendedTab!.click());
  await flushAsync();
  await flushAsync();
  expect(listUrls.length).toBe(before + 1);
  expect(listUrls.at(-1)).toContain('recommendedOnly=1');
});

it('重复点击当前公开 Tab 仍保留搜索词，不发无搜索条件请求', async () => {
  const listUrls: string[] = [];
  vi.stubGlobal('fetch', makePublicBatchFetch((url) => {
    listUrls.push(url);
    return Response.json({ success: true, cards: [] });
  }));
  await act(async () => root.render(
    <BattleDataModal isOpen onClose={vi.fn()} onSelectCard={vi.fn()} selectedType="character" initialTab="public" />,
  ));
  await flushAsync();
  await flushAsync();
  await typeSearch('A');
  expect(listUrls.at(-1)).toContain('search=A');
  const publicTab = [...document.querySelectorAll('button')].find((b) => b.textContent === '公开角色');
  expect(publicTab).toBeDefined();
  await act(async () => publicTab!.click());
  await flushAsync();
  await flushAsync();
  expect(listUrls.at(-1)).toContain('search=A');
});

const findButton = (predicate: (text: string) => boolean): HTMLButtonElement | undefined =>
  [...document.querySelectorAll('button')].find((b) => typeof b.textContent === 'string' && predicate(b.textContent));

it('公开库下一页发 offset=12 并停留在第 2 页，不被公开查询 effect 弹回第 1 页', async () => {
  const pageCards = Array.from({ length: 12 }, (_, index) => ({
    ...card,
    id: `public-${index + 1}`,
    name: `公开卡${index + 1}`,
    is_public: 1,
  }));
  const listUrls: string[] = [];
  vi.stubGlobal('fetch', makePublicBatchFetch((url) => {
    listUrls.push(url);
    return Response.json({ success: true, cards: pageCards });
  }));
  await act(async () => root.render(
    <BattleDataModal isOpen onClose={vi.fn()} onSelectCard={vi.fn()} selectedType="character" initialTab="public" />,
  ));
  await flushAsync();
  await flushAsync();
  expect(document.body.textContent).toContain('第 1 页');
  const nextButton = findButton((text) => text === '下一页');
  expect(nextButton).toBeDefined();
  expect(nextButton!.disabled).toBe(false);

  const requestsBeforePageChange = listUrls.length;
  await act(async () => nextButton!.click());
  await flushAsync();
  await flushAsync();

  const pageChangeRequests = listUrls.slice(requestsBeforePageChange);
  expect(pageChangeRequests.some((url) => url.includes('offset=12'))).toBe(true);
  expect(pageChangeRequests.some((url) => url.includes('offset=0'))).toBe(false);
  expect(document.body.textContent).toContain('第 2 页');
  expect(document.body.textContent).not.toContain('第 1 页');
});

it('roleType 高级筛选后本地分页第 2 页不被公开查询 effect 重置', async () => {
  const roleCards = Array.from({ length: 13 }, (_, index) => ({
    ...card,
    id: `role-${index + 1}`,
    name: `魔法少女${index + 1}`,
    is_public: 1,
    roleType: 'magical-girl',
  }));
  const listUrls: string[] = [];
  vi.stubGlobal('fetch', makePublicBatchFetch((url) => {
    listUrls.push(url);
    return Response.json({ success: true, cards: roleCards });
  }));
  await act(async () => root.render(
    <BattleDataModal isOpen onClose={vi.fn()} onSelectCard={vi.fn()} selectedType="character" initialTab="public" />,
  ));
  await flushAsync();
  await flushAsync();

  const filterToggle = findButton((text) => text.includes('高级筛选'));
  expect(filterToggle).toBeDefined();
  await act(async () => filterToggle!.click());
  const roleSelect = document.querySelector<HTMLSelectElement>('select[name="roleType"]');
  expect(roleSelect).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set?.call(roleSelect, 'magical-girl');
    roleSelect!.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const applyButton = findButton((text) => text === '应用筛选');
  expect(applyButton).toBeDefined();
  await act(async () => applyButton!.click());
  await flushAsync();
  await flushAsync();
  expect(document.body.textContent).toContain('第 1 页 / 2');

  const nextButton = findButton((text) => text === '下一页');
  expect(nextButton).toBeDefined();
  expect(nextButton!.disabled).toBe(false);
  const requestsBeforePageChange = listUrls.length;
  await act(async () => nextButton!.click());
  await flushAsync();
  await flushAsync();

  expect(listUrls.length).toBe(requestsBeforePageChange);
  expect(document.body.textContent).toContain('第 2 页 / 2');
  expect(document.body.textContent).not.toContain('第 1 页 / 2');
});

it('公开单卡刷新遇 404 清除 stale 卡片，不显示“上次成功结果”', async () => {
  const uuid = '12345678-1234-1234-1234-123456789abc';
  const singleCard = { ...card, id: 'public-single', name: '公开单卡', is_public: 1 };
  let idRequests = 0;
  vi.stubGlobal('fetch', makePublicBatchFetch((url) => {
    if (url.includes(`id=${uuid}`)) {
      idRequests += 1;
      if (idRequests === 1) return Response.json({ success: true, card: singleCard });
      return new Response(null, { status: 404 });
    }
    return Response.json({ success: true, cards: [] });
  }));
  await act(async () => root.render(
    <BattleDataModal isOpen onClose={vi.fn()} onSelectCard={vi.fn()} selectedType="character" initialTab="public" />,
  ));
  await flushAsync();
  await flushAsync();
  await typeSearch(uuid);
  expect(idRequests).toBe(1);
  expect(document.body.textContent).toContain('公开单卡');

  const publicTab = findButton((text) => text === '公开角色');
  expect(publicTab).toBeDefined();
  await act(async () => publicTab!.click());
  await flushAsync();
  await flushAsync();

  expect(idRequests).toBe(2);
  expect(document.body.textContent).not.toContain('公开单卡');
  expect(document.body.textContent).toContain('数据卡加载失败');
  expect(document.body.textContent).not.toContain('当前显示上次成功结果');
});
