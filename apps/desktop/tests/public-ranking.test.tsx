// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '@mahoshojo/contracts/fixtures/public-ranking.json';
import { PublicRankingRequestSchema, type PublicRankingRequest } from '@mahoshojo/contracts/public-ranking';
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, Channel: class {} }));
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ navigate: vi.fn() }), Link: ({ children }: { children: ReactNode }) => <span>{children}</span> }));
vi.mock('../src/features/account/use-desktop-cloud-session', () => ({ useDesktopCloudSession: () => { throw new Error('Public ranking must not read account state'); } }));
vi.mock('../src/features/external-links/external-links-provider', () => ({ useExternalLinks: () => ({ openContent: vi.fn() }) }));
import { DesktopRanking } from '../src/app/ranking-page';
import { readPublicRanking } from '../src/platform/public-ranking-bridge';
let root: Root; let container: HTMLDivElement;
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const response = (request: PublicRankingRequest) => ({ kind: request.kind, data: fixture.responses[request.kind] });
const render = () => act(async () => root.render(<DesktopRanking />));
const button = (text: string) => [...container.querySelectorAll('button')].find((node) => node.textContent?.trim() === text)!;
const click = (text: string) => act(async () => button(text).click());
const select = (index: number, value: string) => act(async () => { const node = container.querySelectorAll('select')[index]!; node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); });
const search = async (value = '角色') => {
  await act(async () => { const input = container.querySelector<HTMLInputElement>('[aria-label="排行榜搜索"]')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await click('搜索');
};
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.invoke.mockReset(); mocks.invoke.mockImplementation(async (_command, { request }) => response(request));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('Desktop actual anonymous ranking browser', () => {
  it('reads only public metadata, renders actual shared controls and offers real details without reading their bodies eagerly', async () => {
    await render(); expect(container.textContent).toContain('合成排行角色');
    expect(container.querySelector('[aria-label^="查看角色详情"]')).not.toBeNull();
    expect(container.textContent).toContain('赛季最高段位');
    expect(mocks.invoke.mock.calls.map((call) => call[0])).toEqual(Array(3).fill('cloud_public_ranking_read'));
    expect(mocks.invoke.mock.calls.map((call) => call[1].request.kind).sort()).toEqual(['leaderboard', 'seasons', 'tags']);
    await search(); expect(container.textContent).toContain('#—'); expect(container.textContent).not.toContain('#0');
    expect([...container.querySelectorAll('button')].some((node) => node.textContent?.includes('#—'))).toBe(true);
    expect(container.textContent).toContain('查看详情');
  });
  it('从实际榜单延迟打开公开正文，不拉 metadata，关闭后焦点回原详情按钮', async () => {
    await render();
    const opener = container.querySelector<HTMLButtonElement>('[aria-label^="查看角色详情"]')!; opener.focus();
    const pending = deferred<unknown>();
    mocks.invoke.mockImplementation(async (command, { request }) => command === 'cloud_card_library_request' ? pending.promise : response(request));
    await act(async () => opener.click()); expect(document.body.textContent).toContain('正在加载角色详情');
    const request = mocks.invoke.mock.lastCall?.[1].request;
    expect(request.routeId).toBe('public-data-cards.query'); expect(request.query.id).toBe(fixture.responses.leaderboard.items[0]!.entityId);
    await act(async () => pending.resolve({ status: 200, body: { success: true, card: { id: request.query.id, name: '榜单完整正文', type: 'character', description: '', data: '{"name":"公开主记录"}', is_public: 1 } } }));
    expect(document.body.textContent).toContain('公开主记录'); expect(document.body.textContent).toContain('不代表历史赛季正文快照');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(opener);
    expect(mocks.invoke.mock.calls.filter((call) => call[0] === 'cloud_card_library_request')).toHaveLength(1);
  });
  it('未收录的历史预设保持摘要，不渲染假详情入口', async () => {
    mocks.invoke.mockImplementation(async (_command, { request }) => request.kind === 'leaderboard' ? { kind: 'leaderboard', data: { success: true, items: [{ ...fixture.responses.leaderboard.items[0], entityType: 'preset', entityId: 'legacy-not-bundled.json', displayName: '旧预设' }] } } : response(request));
    await render(); expect(container.textContent).toContain('旧预设'); expect(container.querySelector('[aria-label="查看角色详情：旧预设"]')).toBeNull(); expect(container.querySelector('[title*="未收录"]')).not.toBeNull();
  });
  it('详情失败保留榜单提示，显式重试后可关闭且迟到正文不会重开弹窗', async () => {
    await render();
    const opener = container.querySelector<HTMLButtonElement>('[aria-label^="查看角色详情"]')!; opener.focus();
    const first = deferred<unknown>(), retry = deferred<unknown>();
    let requests = 0;
    mocks.invoke.mockImplementation(async (command, { request }) => command === 'cloud_card_library_request'
      ? (++requests === 1 ? first.promise : retry.promise) : response(request));
    await act(async () => opener.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('数据卡详情');
    expect(document.querySelector('[role="status"]')?.textContent).toContain('正在加载角色详情');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('当前榜单：#1');
    await act(async () => first.resolve({ status: 503, body: { success: false } }));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('HTTP 503');
    expect(document.body.textContent).toContain('当前榜单：#1');
    const retryButton = [...document.querySelectorAll('button')].find((node) => node.textContent === '重试')!;
    await act(async () => retryButton.click());
    expect(requests).toBe(2); expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector('[role="status"]')?.textContent).toContain('正在加载角色详情');
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="关闭对话框"]')!.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(opener);
    const id = fixture.responses.leaderboard.items[0]!.entityId;
    await act(async () => retry.resolve({ status: 200, body: { success: true, card: { id, name: '迟到榜单正文', type: 'character', data: '{"name":"迟到角色"}', is_public: 1 } } }));
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(requests).toBe(2);
  });
  it('keeps draft queue/sort changes unapplied until Apply and uses a single bounded page', async () => {
    await render(); await select(1, 'free'); await select(2, 'tech'); await select(3, 'asc');
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
    await click('应用筛选');
    expect(mocks.invoke.mock.lastCall?.[1].request).toMatchObject({ kind: 'leaderboard', offset: 0, limit: 50, filters: { queue: 'free', sort: 'tech', order: 'asc' } });
    expect(container.textContent).not.toContain('赛季最高段位');
  });
  it('paginates the real list only through Top300 without total or background traversal', async () => {
    mocks.invoke.mockImplementation(async (_command, { request }) => request.kind !== 'leaderboard' ? response(request) : ({ kind: request.kind, data: { success: true, items: Array.from({ length: 50 }, (_, index) => ({ ...fixture.responses.leaderboard.items[0], rank: request.offset + index + 1, entityId: `row-${request.offset + index}` })) } }));
    await render(); expect(mocks.invoke).toHaveBeenCalledTimes(3);
    expect(container.querySelector('[aria-label="跳转页码"]')).toBeNull();
    for (let i = 0; i < 5; i++) await click('下一页');
    expect(container.textContent).toContain('第 6 页'); expect(button('下一页').disabled).toBe(true);
    expect(mocks.invoke.mock.calls.filter((call) => call[1].request.kind === 'leaderboard').map((call) => call[1].request.offset)).toEqual([0, 50, 100, 150, 200, 250]);
    await click('上一页'); expect(container.textContent).toContain('第 5 页');
  });
  it.each(['filter', 'season', 'clear'] as const)('ignores a late search after %s changes', async (change) => {
    await render(); const old = deferred<unknown>();
    mocks.invoke.mockImplementation(async (_command, { request }) => request.kind === 'search' ? old.promise : response(request));
    await search();
    if (change === 'filter') { await select(1, 'free'); await click('应用筛选'); }
    if (change === 'season') await select(0, 'S3');
    if (change === 'clear') await click('清空');
    await act(async () => old.resolve({ kind: 'search', data: { success: true, items: [{ ...fixture.responses.search.items[0], displayName: '迟到搜索不可见' }] } }));
    expect(container.textContent).not.toContain('迟到搜索不可见'); expect(container.textContent).not.toContain('搜索中…');
  });
  it('shows archive scope/current rules, local search and missing-current archive errors', async () => {
    await render(); await select(0, 'S3');
    expect(container.textContent).toContain('归档排行角色'); expect(container.textContent).toContain('全量快照'); expect(container.textContent).toContain('段位/排序按当前版本规则重算');
    const count = mocks.invoke.mock.calls.length; await search('归档'); expect(mocks.invoke).toHaveBeenCalledTimes(count);
    await select(0, 'S4');
    mocks.invoke.mockImplementation(async (_command, { request }) => { if (request.kind === 'archive') throw { code: 'not-found', message: '排行榜数据不存在或尚未归档' }; return response(request); });
    await click('查看快照（测试）'); expect(container.textContent).toContain('此赛季尚无归档快照'); expect(container.textContent).not.toContain('暂无数据');
  });
  it('paginates archive facts by 50, limits local search to 10 and jumps to a known archived rank', async () => {
    const originalScroll = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = vi.fn();
    const originalFrame = window.requestAnimationFrame; const originalCancel = window.cancelAnimationFrame;
    window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(0), 0);
    window.cancelAnimationFrame = (id) => window.clearTimeout(id);
    try {
      mocks.invoke.mockImplementation(async (_command, { request }) => request.kind !== 'archive' ? response(request) : ({ kind: 'archive', data: { ...fixture.responses.archive,
        entities: Array.from({ length: 60 }, (_, index) => ({ ...fixture.responses.archive.entities[0], entityId: `archive-${index}`,
          displayName: index === 54 ? '目标归档' : `归档角色${index}`, queues: { strict: { ...fixture.responses.archive.entities[0]!.queues.strict, rating: 2000 - index } } })),
        totalEligible: { strict: 60, free: 0 },
      } }));
      await render(); await select(0, 'S3'); expect(container.querySelectorAll('tbody tr')).toHaveLength(50);
      const calls = mocks.invoke.mock.calls.length;
      await search('归档角色'); expect([...container.querySelectorAll('button')].filter((node) => node.textContent?.includes('点击跳转'))).toHaveLength(10);
      await search('目标归档');
      const hit = [...container.querySelectorAll('button')].find((node) => node.textContent?.includes('#55'))!;
      await act(async () => { hit.click(); await new Promise((resolve) => setTimeout(resolve, 5)); });
      expect(container.textContent).toContain('第 2 页'); expect(container.querySelectorAll('tbody tr')).toHaveLength(10);
      expect(container.querySelector('[data-row-key="data_card:archive-54"]')).not.toBeNull();
      expect(mocks.invoke).toHaveBeenCalledTimes(calls);
    } finally { HTMLElement.prototype.scrollIntoView = originalScroll; window.requestAnimationFrame = originalFrame; window.cancelAnimationFrame = originalCancel; }
  });
  it('jumps directly to page 3 of a large archive without another archive or intermediate leaderboard request', async () => {
    mocks.invoke.mockImplementation(async (_command, { request }) => request.kind !== 'archive' ? response(request) : ({ kind: 'archive', data: { ...fixture.responses.archive,
      entities: Array.from({ length: 130 }, (_, index) => ({ ...fixture.responses.archive.entities[0], entityId: `archive-jump-${index}`,
        displayName: `跳页归档角色${index}`, queues: { strict: { ...fixture.responses.archive.entities[0]!.queues.strict, rating: 3000 - index } } })),
      totalEligible: { strict: 130, free: 0 },
    } }));
    await render(); await select(0, 'S3');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(50);
    const jumpInput = container.querySelector<HTMLInputElement>('[aria-label="跳转页码"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(jumpInput, '3');
      jumpInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click('跳转');
    expect(container.textContent).toContain('第 3 页');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(30);
    expect(container.textContent).toContain('跳页归档角色100');
    expect(mocks.invoke.mock.calls.filter((call) => call[1].request.kind === 'archive')).toHaveLength(1);
    expect(mocks.invoke.mock.calls.filter((call) => call[1].request.kind === 'leaderboard').map((call) => call[1].request.offset)).toEqual([0]);
  });
  it('distinguishes empty, rate limit and failure, then retries without account refresh', async () => {
    mocks.invoke.mockImplementation(async (_command, { request }) => request.kind === 'leaderboard' ? { kind: 'leaderboard', data: { success: true, items: [] } } : response(request));
    await render(); expect(container.textContent).toContain('暂无数据');
    mocks.invoke.mockImplementation(async (_command, { request }) => { if (request.kind === 'search') throw { code: 'server-unavailable', message: '排行榜请求过于频繁，请稍后重试' }; return response(request); });
    await search(); expect(container.textContent).toContain('请求过于频繁');
    mocks.invoke.mockImplementation(async (_command, { request }) => { if (request.kind === 'leaderboard') throw { code: 'network-error', message: '离线' }; return response(request); });
    await select(1, 'free'); await click('应用筛选'); expect(container.textContent).toContain('排行榜加载失败'); expect(container.textContent).not.toContain('暂无数据');
    mocks.invoke.mockImplementation(async (_command, { request }) => response(request)); await click('重试'); expect(container.textContent).toContain('合成排行角色');
  });
  it('unmount ignores a pending search with no subsequent requests', async () => {
    await render(); const old = deferred<unknown>(); mocks.invoke.mockImplementation(async (_command, { request }) => request.kind === 'search' ? old.promise : response(request));
    await search(); const count = mocks.invoke.mock.calls.length; await act(async () => root.render(null));
    await act(async () => old.resolve({ kind: 'search', data: fixture.responses.search }));
    expect(container.textContent).toBe(''); expect(mocks.invoke).toHaveBeenCalledTimes(count);
  });
  it('isolates a late leaderboard across queue A→B→A and fetches the new A rather than reviving old data', async () => {
    const old = deferred<unknown>(); let first = true;
    mocks.invoke.mockImplementation(async (_command, { request }) => {
      if (request.kind !== 'leaderboard') return response(request);
      if (first) { first = false; return old.promise; }
      return { kind: 'leaderboard', data: { success: true, items: [{ ...fixture.responses.leaderboard.items[0], displayName: `新${request.filters.queue}列表` }] } };
    });
    await render(); await select(1, 'free'); await click('应用筛选'); expect(container.textContent).toContain('新free列表');
    await act(async () => old.resolve({ kind: 'leaderboard', data: { success: true, items: [{ ...fixture.responses.leaderboard.items[0], displayName: '迟到旧strict列表' }] } }));
    expect(container.textContent).not.toContain('迟到旧strict列表');
    await select(1, 'strict'); await click('应用筛选'); expect(container.textContent).toContain('新strict列表');
    expect(container.textContent).not.toContain('迟到旧strict列表');
    expect(mocks.invoke.mock.calls.filter((call) => call[1].request.kind === 'leaderboard')).toHaveLength(3);
  });
  it('isolates a late archive after switching back to the current live season and does not cache the cancelled archive', async () => {
    await render(); const old = deferred<unknown>(); let first = true;
    mocks.invoke.mockImplementation(async (_command, { request }) => {
      if (request.kind === 'archive' && first) { first = false; return old.promise; }
      return response(request);
    });
    await select(0, 'S3'); await select(0, 'S4');
    await act(async () => old.resolve({ kind: 'archive', data: { ...fixture.responses.archive, entities: [{ ...fixture.responses.archive.entities[0], displayName: '迟到旧归档' }] } }));
    expect(container.textContent).toContain('合成排行角色'); expect(container.textContent).not.toContain('迟到旧归档');
    await select(0, 'S3'); expect(container.textContent).toContain('归档排行角色'); expect(container.textContent).not.toContain('迟到旧归档');
    expect(mocks.invoke.mock.calls.filter((call) => call[1].request.kind === 'archive')).toHaveLength(2);
  });
  it('unmount ignores a pending leaderboard with no subsequent requests', async () => {
    const old = deferred<unknown>();
    mocks.invoke.mockImplementation(async (_command, { request }) => request.kind === 'leaderboard' ? old.promise : response(request));
    await render(); const count = mocks.invoke.mock.calls.length; await act(async () => root.render(null));
    await act(async () => old.resolve({ kind: 'leaderboard', data: fixture.responses.leaderboard }));
    expect(container.textContent).toBe(''); expect(mocks.invoke).toHaveBeenCalledTimes(count);
  });
  it.skipIf(!process.env.PUBLIC_RANKING_NATIVE_WIRE_INPUT)('consumes five actual Native loopback Serialize wires through TS bridge and actual Desktop', async () => {
    const native = (kind: string): unknown => JSON.parse(readFileSync(join(process.env.PUBLIC_RANKING_NATIVE_WIRE_INPUT!, `${kind}.json`), 'utf8'));
    mocks.invoke.mockImplementation(async (command, { request }) => { expect(command).toBe('cloud_public_ranking_read'); return native(request.kind); });
    await render(); expect(container.textContent).toContain('合成排行角色'); expect(container.textContent).toContain('测试标签');
    await search(fixture.requests.search.q); expect(container.textContent).toContain('#—'); expect(container.textContent).not.toContain('#0');
    await select(0, 'S3'); expect(container.textContent).toContain('归档排行角色'); expect(container.textContent).toContain('全量快照');
    for (const kind of ['leaderboard', 'search', 'tags', 'seasons', 'archive'] as const) {
      const result = await readPublicRanking(mocks.invoke, PublicRankingRequestSchema.parse(fixture.requests[kind]));
      expect(JSON.stringify(result)).not.toContain('DROP');
    }
    for (const [name, label] of [['archive-v2', 'Top 1 + Bottom 0'], ['archive-full', '全量快照'], ['archive-top-bottom', 'Top 3 + Bottom 3']]) {
      await act(async () => root.render(null));
      mocks.invoke.mockImplementation(async (_command, { request }) => native(request.kind === 'archive' ? name! : request.kind));
      await render(); await select(0, 'S3');
      expect(container.textContent).toContain('归档排行角色'); expect(container.textContent).toContain(label);
      expect(container.textContent).toContain('段位/排序按当前版本规则重算');
    }
  });
});

describe('Desktop actual recent strict history entry', () => {
  const body = { status: 200, body: { success: true, card: { id: 'public-card', name: '榜单正文', type: 'character', description: '', data: '{"name":"公开原件"}', is_public: 1 } } };
  const historyButton = () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent === '最近严格排位')!;
  const openDetails = async () => { const node = container.querySelector<HTMLButtonElement>('[aria-label^="查看角色详情"]')!; node.focus(); await act(async () => node.click()); return node; };
  const escape = () => act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  it('historical ranking details load current strict summaries only on click, with nested focus and no authority escalation', async () => {
    mocks.invoke.mockImplementation(async (command, { request }) => command === 'cloud_card_library_request' ? body : response(request));
    await render(); await select(0, 'S3'); const opener = await openDetails();
    expect(mocks.invoke.mock.calls.filter((call) => call[1].request.kind === 'ratingHistory')).toHaveLength(0);
    const history = historyButton(); history.focus(); await act(async () => history.click());
    expect(mocks.invoke.mock.lastCall).toEqual(['cloud_public_ranking_read', { request: { kind: 'ratingHistory', entityType: 'data_card', entityId: 'public-card' } }]);
    expect(document.body.textContent).toContain('历史对手甲'); expect(document.body.textContent).toContain('不按当前所选赛季筛选');
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-hidden')).toBe('true');
    await escape(); expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1); expect(document.activeElement).toBe(history);
    await escape(); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(opener);
  });
  it('closing/reopening the same details fences a late Native result rather than caching it', async () => {
    const old = deferred<unknown>(); let first = true;
    mocks.invoke.mockImplementation(async (command, { request }) => {
      if (command === 'cloud_card_library_request') return body;
      if (request.kind === 'ratingHistory' && first) { first = false; return old.promise; }
      return response(request);
    });
    await render(); await openDetails(); await act(async () => historyButton().click());
    await escape(); await escape(); await openDetails(); await act(async () => historyButton().click());
    await act(async () => old.resolve({ kind: 'ratingHistory', data: { ...fixture.responses.ratingHistory, items: [] } }));
    expect(document.body.textContent).toContain('历史对手甲'); expect(document.body.textContent).not.toContain('暂无严格排位记录');
    expect(mocks.invoke.mock.calls.filter((call) => call[1].request.kind === 'ratingHistory')).toHaveLength(2);
  });
  it('preset ranking details query only their explicit preset entity, not the local card identifier', async () => {
    const id = 'M01_centaurea.json';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"name":"内置正文"}')));
    try {
      mocks.invoke.mockImplementation(async (_command, { request }) => request.kind === 'leaderboard'
        ? { kind: 'leaderboard', data: { success: true, items: [{ ...fixture.responses.leaderboard.items[0], entityType: 'preset', entityId: id }] } }
        : request.kind === 'ratingHistory' ? { kind: 'ratingHistory', data: { ...fixture.responses.ratingHistory, entityType: 'preset', entityId: id } } : response(request));
      await render(); await openDetails(); await act(async () => historyButton().click());
      expect(mocks.invoke.mock.lastCall?.[1]).toEqual({ request: { kind: 'ratingHistory', entityType: 'preset', entityId: id } });
      expect(document.body.textContent).toContain('历史对手甲');
    } finally { vi.unstubAllGlobals(); }
  });
  it('shows transport failures distinctly and retries the same fixed target', async () => {
    mocks.invoke.mockImplementation(async (command, { request }) => {
      if (command === 'cloud_card_library_request') return body;
      if (request.kind === 'ratingHistory') throw { code: 'server-unavailable', message: '请求过于频繁，请稍后重试' };
      return response(request);
    });
    await render(); await openDetails(); await act(async () => historyButton().click()); expect(document.body.textContent).toContain('请求过于频繁'); expect(document.body.textContent).not.toContain('暂无严格排位记录');
    mocks.invoke.mockImplementation(async (_command, { request }) => response(request));
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent === '重试')!.click());
    expect(document.body.textContent).toContain('历史对手甲');
  });
  it.skipIf(!process.env.PUBLIC_RANKING_NATIVE_WIRE_INPUT)('consumes actual Native ratingHistory loopback Serialize through TS bridge and real ranking details', async () => {
    const native = (kind: string): unknown => JSON.parse(readFileSync(join(process.env.PUBLIC_RANKING_NATIVE_WIRE_INPUT!, `${kind}.json`), 'utf8'));
    mocks.invoke.mockImplementation(async (command, { request }) => command === 'cloud_card_library_request' ? body : native(request.kind));
    await render(); await openDetails(); expect(mocks.invoke.mock.calls.some((call) => call[1].request.kind === 'ratingHistory')).toBe(false);
    await act(async () => historyButton().click()); expect(document.body.textContent).toContain('历史对手甲'); expect(document.body.textContent).toContain('赛后 -10');
    const projected = await readPublicRanking(mocks.invoke, { kind: 'ratingHistory', entityType: 'data_card', entityId: ' public-card ' });
    expect(JSON.stringify(projected)).not.toContain('DROP'); expect(projected.items[0]?.appliedAt).toBeNull();
    mocks.invoke.mockImplementation(async () => native('ratingHistory-preset'));
    const preset = await readPublicRanking(mocks.invoke, { kind: 'ratingHistory', entityType: 'preset', entityId: ' 旧 / ?&+%😀.json ' });
    expect(preset.entityId).toBe('旧 / ?&+%😀.json'); expect(preset.items[2]?.delta).toBe(0);
  });
});

describe('typed public ranking bridge', () => {
  it('rejects extras/path escape/arrays before invoke and fences wrong kind/ranks/season', async () => {
    for (const request of [{ kind: 'tags', token: 'x' }, { kind: 'archive', seasonId: '../S3' }, [], { ...fixture.requests.leaderboard, filters: [] }]) {
      await expect(readPublicRanking(mocks.invoke, request as PublicRankingRequest)).rejects.toMatchObject({ code: 'invalid-request' });
    }
    expect(mocks.invoke).not.toHaveBeenCalled();
    const request = PublicRankingRequestSchema.parse(fixture.requests.leaderboard);
    for (const raw of [{ kind: 'tags', data: fixture.responses.tags }, { kind: 'leaderboard', data: { success: true, items: [{ ...fixture.responses.leaderboard.items[0], rank: 0 }] } }]) {
      mocks.invoke.mockResolvedValue(raw); await expect(readPublicRanking(mocks.invoke, request)).rejects.toMatchObject({ code: 'invalid-response' });
    }
    mocks.invoke.mockResolvedValue({ kind: 'archive', data: fixture.responses.archive });
    await expect(readPublicRanking(mocks.invoke, { kind: 'archive', seasonId: 'S4' })).rejects.toMatchObject({ code: 'invalid-response' });
  });
  it('rejects expanded history requests before invoke and mismatched summaries after invoke', async () => {
    const request = { kind: 'ratingHistory', entityType: 'data_card', entityId: 'public-card' } as const;
    for (const key of ['queue', 'limit', 'seasonId', 'url', 'headers', 'credentials']) {
      await expect(readPublicRanking(mocks.invoke, { ...request, [key]: 'forbidden' })).rejects.toMatchObject({ code: 'invalid-request' });
    }
    expect(mocks.invoke).not.toHaveBeenCalled();
    for (const data of [{ ...fixture.responses.ratingHistory, entityId: 'wrong' }, { ...fixture.responses.ratingHistory, entityType: 'preset' }, { ...fixture.responses.ratingHistory, queue: 'free' }, { ...fixture.responses.ratingHistory, items: Array(11).fill(fixture.responses.ratingHistory.items[0]) }]) {
      mocks.invoke.mockResolvedValue({ kind: 'ratingHistory', data }); await expect(readPublicRanking(mocks.invoke, request)).rejects.toMatchObject({ code: 'invalid-response' });
    }
  });

});
