// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import { AnnouncementCenter } from '../src/announcement/AnnouncementCenter';
import { BaseModal } from '../src/modal/BaseModal';

import {
  CardLibraryModal,
  DataCardEmptyState,
  mapDataCardRuntimeSourceInfo,
  type CardLibraryHost,
  type CardLibraryPublicCachePort,
} from '../src/card-library/index';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const click = (target: Element) => act(async () => {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});

const record = (id: string): LocalCardRecordV1 => ({
  id,
  schemaVersion: 1,
  storageLocation: 'local',
  cardType: 'character',
  title: `本地角色 ${id}`,
  data: { codename: id, description: `来自本机 ${id}` },
  contentDigest: `sha256:${id.padEnd(16, 'x')}`,
  provenance: { kind: 'unsigned', execution: 'imported' },
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});

const repository = (items: LocalCardRecordV1[]): CardRepository => ({
  get: vi.fn(async (id: string) => items.find((item) => item.id === id) ?? null),
  list: vi.fn(async (query: { cardTypes?: string[]; includeDeleted?: boolean }) => ({
    items: items.filter(
      (item) =>
        (query.includeDeleted === true || item.deletedAt === undefined) &&
        (query.cardTypes === undefined || query.cardTypes.includes(item.cardType)),
    ),
    nextCursor: undefined,
  })),
  put: vi.fn(async () => {}),
  putIfAbsent: vi.fn(async () => ({ written: true }) as const),
  delete: vi.fn(async () => {}),
  restore: vi.fn(async () => {}),
});

const createHost = (
  items: LocalCardRecordV1[],
  overrides: {
    auth?: CardLibraryHost['auth'];
    online?: Partial<CardLibraryHost['online']>;
  } = {},
) => {
  const online = {
    fetchSummaryPage: vi.fn(async () => ({ success: true as const, cards: [], total: 0, nextOffset: null })),
    fetchPublicCards: vi.fn(async () => { throw new Error('offline'); }),
    fetchPublicCardById: vi.fn(async () => { throw new Error('offline'); }),
    loadFullCard: vi.fn(async () => { throw new Error('loadFullCard must not be hit for local rows'); }),
    listTags: vi.fn(async () => ({ ok: false as const, error: 'offline' })),
    listFavoriteIds: vi.fn(async () => ({ success: true, favorites: [] as string[] })),
    addFavorite: vi.fn(async () => ({ success: true })),
    removeFavorite: vi.fn(async () => ({ success: true })),
    getDeckCards: vi.fn(async () => null),
    reportCardStat: vi.fn(async () => false),
    ...overrides.online,
  };
  const store = new Set<string>();
  const host: CardLibraryHost = {
    auth: overrides.auth ?? { status: 'unauthenticated', userId: null, userBadges: [] },
    online,
    local: { repository: repository(items) },
    platform: {
      Link: ({ children, href, title }) => <a href={href} title={title}>{children}</a>,
      marks: {
        isLiked: (id) => store.has(`like:${id}`),
        markLiked: (id) => (store.has(`like:${id}`) ? false : (store.add(`like:${id}`), true)),
        isUsed: (id) => store.has(`used:${id}`),
        markUsed: (id) => (store.has(`used:${id}`) ? false : (store.add(`used:${id}`), true)),
      },
      copyText: vi.fn(async () => {}),
    },
    slots: {},
  };
  return { host, online };
};

const render = (props: Parameters<typeof CardLibraryModal>[0]) =>
  act(async () => { root.render(<CardLibraryModal {...props} />); });

test('本地页签渲染本地记录；云端故障不影响本地列表', async () => {
  const { host, online } = createHost([record('a')]);
  const onSelectCard = vi.fn();
  await render({
    host, isOpen: true, onClose: vi.fn(), onSelectCard,
    selectedType: 'character', initialTab: 'local', visibleTabs: ['local'],
  });
  await settle();

  expect(document.body.textContent).toContain('本地角色 a');
  // 本地行自带完整正文，任何情况下都不应触发单卡在线读取。
  expect(online.loadFullCard).not.toHaveBeenCalled();
});

test('选择本地记录：载荷无服务器身份，不触发在线读取', async () => {
  const { host, online } = createHost([record('a')]);
  const onSelectCard = vi.fn();
  const onClose = vi.fn();
  await render({
    host, isOpen: true, onClose, onSelectCard,
    selectedType: 'character', initialTab: 'local', visibleTabs: ['local'],
  });
  await settle();

  await click(document.body.querySelector('[role="button"][aria-label="选择本地角色 a"]')!);
  await settle();

  expect(onSelectCard).toHaveBeenCalledTimes(1);
  const payload = onSelectCard.mock.calls[0]![0] as Record<string, unknown>;
  expect(payload._storageLocation).toBe('local');
  expect(payload._cardId).toBe('');
  // 本地内容在下游不得生成 online content reference（ADR §8 / LIB-012）。
  const source = mapDataCardRuntimeSourceInfo(payload);
  expect(source.sourceDataCardId).toBeUndefined();
  expect(source.sourceIsPublic).toBeUndefined();
  expect(online.loadFullCard).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});

test('未提供详情/导出插槽时对应入口不出现', async () => {
  const { host } = createHost([record('a')]);
  await render({
    host, isOpen: true, onClose: vi.fn(), onSelectCard: vi.fn(),
    selectedType: 'character', initialTab: 'local', visibleTabs: ['local'],
  });
  await settle();

  const detailsButtons = [...document.body.querySelectorAll('button')].filter((b) => b.textContent?.trim() === '详情');
  expect(detailsButtons).toHaveLength(0);
  // 缺 downloadJson 时导出入口保留但禁用（fail-closed，不出现可用假象）。
  const exportButton = document.body.querySelector<HTMLButtonElement>('[aria-label="导出本地数据卡"]');
  expect(exportButton).not.toBeNull();
  expect(exportButton!.disabled).toBe(true);
});

test('提供详情插槽后出现详情入口', async () => {
  const { host } = createHost([record('a')]);
  host.slots.CardDetailsModal = () => null;
  await render({
    host, isOpen: true, onClose: vi.fn(), onSelectCard: vi.fn(),
    selectedType: 'character', initialTab: 'local', visibleTabs: ['local'],
  });
  await settle();

  const detailsButtons = [...document.body.querySelectorAll('button')].filter((b) => b.textContent?.trim() === '详情');
  expect(detailsButtons.length).toBeGreaterThan(0);
});

test('本地行出现「上传到云端」入口；失败保留本地记录并显示错误', async () => {
  const { host } = createHost([record('a')]);
  const uploadLocalRecord = vi.fn(async (_record: LocalCardRecordV1) => ({ ok: false as const, error: '需要登录云端账号' }));
  host.online.uploadLocalRecord = uploadLocalRecord;
  await render({
    host, isOpen: true, onClose: vi.fn(), onSelectCard: vi.fn(),
    selectedType: 'character', initialTab: 'local', visibleTabs: ['local'],
  });
  await settle();

  const uploadButton = document.body.querySelector<HTMLButtonElement>('[aria-label="上传本地数据卡到云端"]');
  expect(uploadButton).not.toBeNull();
  await click(uploadButton!);
  await settle();

  expect(uploadLocalRecord).toHaveBeenCalledTimes(1);
  expect((uploadLocalRecord.mock.calls[0]![0] as LocalCardRecordV1).id).toBe('a');
  expect(document.body.textContent).toContain('需要登录云端账号');
  // 上传失败不回滚：本地行仍在，可再次选择。
  expect(document.body.textContent).toContain('本地角色 a');
});

test('宿主不提供 uploadLocalRecord 时本地行没有上传入口', async () => {
  const { host } = createHost([record('a')]);
  await render({
    host, isOpen: true, onClose: vi.fn(), onSelectCard: vi.fn(),
    selectedType: 'character', initialTab: 'local', visibleTabs: ['local'],
  });
  await settle();
  expect(document.body.querySelector('[aria-label="上传本地数据卡到云端"]')).toBeNull();
});

test('上传成功后显示提示且本地记录不变', async () => {
  const { host } = createHost([record('a')]);
  host.online.uploadLocalRecord = vi.fn(async () => ({ ok: true as const }));
  await render({
    host, isOpen: true, onClose: vi.fn(), onSelectCard: vi.fn(),
    selectedType: 'character', initialTab: 'local', visibleTabs: ['local'],
  });
  await settle();

  await click(document.body.querySelector('[aria-label="上传本地数据卡到云端"]')!);
  await settle();
  expect(document.body.textContent).toContain('已上传为云端新数据卡');
  expect(document.body.textContent).toContain('本地角色 a');
});

test('云端列表失败只影响公开页签，切到本地仍可选', async () => {
  const { host } = createHost([record('a')]);
  const onSelectCard = vi.fn();
  await render({
    host, isOpen: true, onClose: vi.fn(), onSelectCard,
    selectedType: 'character', initialTab: 'public',
  });
  await settle();

  // 公开页签因传输失败显示错误/空态；点击本地页签仍应工作。
  const localTab = [...document.body.querySelectorAll('[role="tab"],button')].find((b) => b.textContent?.includes('本地'));
  expect(localTab).toBeDefined();
  await click(localTab!);
  await settle();
  expect(document.body.textContent).toContain('本地角色 a');

  await click(document.body.querySelector('[role="button"][aria-label="选择本地角色 a"]')!);
  await settle();
  expect(onSelectCard).toHaveBeenCalledTimes(1);
});

/** 受控 promise：用于编排「请求在飞 → 账号已切换 → 迟到响应到达」的竞态。 */
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const publicCard = (id: string) => ({
  id, type: 'character', name: `公开角色 ${id}`, description: '公开描述',
  data: { codename: id, description: `公开描述 ${id}` },
  is_public: 1, review_status: 'approved', created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z', usage_count: 0, like_count: 0, favorite_count: 0,
  is_recommended: 0, username: 'author', roleType: 'magical-girl', nativeAllowed: false,
  has_pending_update: false, tag_ids: [] as string[], favorited_at: null,
});

/** 星标收藏按钮的「已收藏」投影：`取消收藏` title 只在 isFavorited 时出现。 */
const isFavoritedRendered = () =>
  [...document.body.querySelectorAll('button')].some((b) => b.title === '取消收藏');

test('迟到的收藏 id 列表不得投影进切换后的账号会话', async () => {
  const listA = deferred<{ success: boolean; favorites?: string[] }>();
  const listB = deferred<{ success: boolean; favorites?: string[] }>();
  const fetchPublicCards = vi.fn(async () => ({
    ok: true as const, status: 200,
    data: { success: true, cards: [publicCard('card-1')], total: 1, nextOffset: null },
  }));
  const { host: hostA } = createHost([], {
    auth: { status: 'authenticated', userId: 1, userBadges: [] },
    online: { fetchPublicCards, listFavoriteIds: vi.fn(() => listA.promise) },
  });
  await render({
    host: hostA, isOpen: true, onClose: vi.fn(), onSelectCard: vi.fn(),
    selectedType: 'character', initialTab: 'public',
  });
  await settle();
  expect(document.body.textContent).toContain('公开角色 card-1');

  // 账号 A → B：B 的列表请求挂起期间，A 的迟到响应不应落进 UI。
  const { host: hostB } = createHost([], {
    auth: { status: 'authenticated', userId: 2, userBadges: [] },
    online: { fetchPublicCards, listFavoriteIds: vi.fn(() => listB.promise) },
  });
  await act(async () => {
    root.render(<CardLibraryModal
      host={hostB} isOpen onClose={vi.fn()} onSelectCard={vi.fn()}
      selectedType="character" initialTab="public"
    />);
  });
  await settle();

  listA.resolve({ success: true, favorites: ['card-1'] });
  await settle();
  expect(isFavoritedRendered()).toBe(false);

  // B 自己的集合正常投影。
  listB.resolve({ success: true, favorites: ['card-1'] });
  await settle();
  expect(isFavoritedRendered()).toBe(true);
});

test('迟到的收藏 mutation 不得投影进切换后的账号会话', async () => {
  const addA = deferred<{ success: boolean }>();
  const fetchPublicCards = vi.fn(async () => ({
    ok: true as const, status: 200,
    data: { success: true, cards: [publicCard('card-1')], total: 1, nextOffset: null },
  }));
  const { host: hostA } = createHost([], {
    auth: { status: 'authenticated', userId: 1, userBadges: [] },
    online: { fetchPublicCards, addFavorite: vi.fn(() => addA.promise) },
  });
  await render({
    host: hostA, isOpen: true, onClose: vi.fn(), onSelectCard: vi.fn(),
    selectedType: 'character', initialTab: 'public',
  });
  await settle();

  const favoriteButton = [...document.body.querySelectorAll('button')].find((b) => b.title === '收藏')!;
  await click(favoriteButton);
  await settle();
  expect(isFavoritedRendered()).toBe(false);

  const { host: hostB } = createHost([], {
    auth: { status: 'authenticated', userId: 2, userBadges: [] },
    online: { fetchPublicCards },
  });
  await act(async () => {
    root.render(<CardLibraryModal
      host={hostB} isOpen onClose={vi.fn()} onSelectCard={vi.fn()}
      selectedType="character" initialTab="public"
    />);
  });
  await settle();

  // A 的 addFavorite 迟到完成——绝不能把 card-1 标成 B 的已收藏。
  addA.resolve({ success: true });
  await settle();
  expect(isFavoritedRendered()).toBe(false);
});

test('选中回调携带来源实例上下文（local:<recordId> / cloud:<cardId>）', async () => {
  const { host } = createHost([record('a')]);
  const onSelectCard = vi.fn();
  await render({
    host, isOpen: true, onClose: vi.fn(), onSelectCard,
    selectedType: 'character', initialTab: 'local', visibleTabs: ['local'],
  });
  await settle();
  await click(document.body.querySelector('[role="button"][aria-label="选择本地角色 a"]')!);
  await settle();
  expect(onSelectCard).toHaveBeenCalledTimes(1);
  expect(onSelectCard.mock.calls[0]![1]).toMatchObject({
    selectionId: 'local:a', storageLocation: 'local',
  });
});

test('卡组导入的迟到结果不得写进切换后的账号，且换账号即关闭并重挂载卡组弹窗', async () => {
  const deckA = deferred<{ cards?: Array<{ isAccessible?: boolean; card?: any }> } | null>();
  const getDeckCards = vi.fn(() => deckA.promise);
  const fetchPublicCards = vi.fn(async () => ({
    ok: true as const, status: 200,
    data: { success: true, cards: [], total: 0, nextOffset: null },
  }));
  let decksMounts = 0;
  const DecksModalStub = ({ isOpen, onImportDeck }: { isOpen: boolean; onImportDeck: (id: string) => void }) => {
    // 记录真实挂载次数：key={accountKey} 换身份时必须整树重挂载。
    useEffect(() => { decksMounts += 1; }, []);
    return (
      <div data-testid="decks-modal">
        {isOpen ? 'open' : 'closed'}
        <button type="button" onClick={() => onImportDeck('deck-1')}>import-deck</button>
      </div>
    );
  };
  const onToggleCard = vi.fn();
  const onSelectCard = vi.fn();

  const { host: hostA } = createHost([], {
    auth: { status: 'authenticated', userId: 1, userBadges: [] },
    online: { fetchPublicCards, getDeckCards },
  });
  hostA.slots.DecksModal = DecksModalStub;
  await render({
    host: hostA, isOpen: true, onClose: vi.fn(), onToggleCard, onSelectCard,
    selectedType: 'character', initialTab: 'public', selectionMode: 'multi', selectedCardIds: [],
  });
  await settle();
  expect(decksMounts).toBe(1);

  // 打开卡组弹窗并发起导入：getDeckCards 在飞。
  await click([...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === '卡组导入')!);
  await settle();
  expect(document.body.querySelector('[data-testid="decks-modal"]')!.textContent).toContain('open');
  await click([...document.body.querySelectorAll('button')].find((b) => b.textContent === 'import-deck')!);
  await settle();
  expect(getDeckCards).toHaveBeenCalledWith('deck-1');

  // 请求在飞时切到账号 B：弹窗立即关闭且 DecksModal 整体重挂载。
  const { host: hostB } = createHost([], {
    auth: { status: 'authenticated', userId: 2, userBadges: [] },
    online: { fetchPublicCards, getDeckCards },
  });
  hostB.slots.DecksModal = DecksModalStub;
  await act(async () => {
    root.render(<CardLibraryModal
      host={hostB} isOpen onClose={vi.fn()} onToggleCard={onToggleCard} onSelectCard={onSelectCard}
      selectedType="character" initialTab="public" selectionMode="multi" selectedCardIds={[]}
    />);
  });
  await settle();
  expect(document.body.querySelector('[data-testid="decks-modal"]')!.textContent).toContain('closed');
  expect(decksMounts).toBe(2);

  // A 的卡组明细迟到到达：不得经 onToggleCard/onSelectCard 落进 B 的选择状态。
  deckA.resolve({ cards: [{ isAccessible: true, card: publicCard('card-9') }] });
  await settle();
  expect(onToggleCard).not.toHaveBeenCalled();
  expect(onSelectCard).not.toHaveBeenCalled();
});

test('同账号下的卡组导入正常写入多选状态并跳不可访问项', async () => {
  const { host } = createHost([], {
    auth: { status: 'authenticated', userId: 1, userBadges: [] },
    online: {
      fetchPublicCards: vi.fn(async () => ({
        ok: true as const, status: 200,
        data: { success: true, cards: [], total: 0, nextOffset: null },
      })),
      getDeckCards: vi.fn(async () => ({
        cards: [
          { isAccessible: true, card: publicCard('card-9') },
          { isAccessible: false, card: publicCard('card-x') },
        ],
      })),
    },
  });
  host.slots.DecksModal = ({ onImportDeck }) => (
    <button type="button" onClick={() => onImportDeck('deck-1')}>import-deck</button>
  );
  const onToggleCard = vi.fn();
  await render({
    host, isOpen: true, onClose: vi.fn(), onToggleCard,
    selectedType: 'character', initialTab: 'public', selectionMode: 'multi', selectedCardIds: [],
  });
  await settle();

  await click([...document.body.querySelectorAll('button')].find((b) => b.textContent === 'import-deck')!);
  await settle();

  expect(onToggleCard).toHaveBeenCalledTimes(1);
  const [payload, nextSelected, context] = onToggleCard.mock.calls[0]! as [Record<string, unknown>, boolean, unknown];
  expect(payload._cardId).toBe('card-9');
  expect(nextSelected).toBe(true);
  expect(context).toMatchObject({ selectionId: 'cloud:card-9', storageLocation: 'cloud', cloudCardId: 'card-9' });
});

test('会话探测（unknown）不清账号绑定状态：A→unknown→A 收藏投影不失配', async () => {
  const listA = deferred<{ success: boolean; favorites?: string[] }>();
  const fetchPublicCards = vi.fn(async () => ({
    ok: true as const, status: 200,
    data: { success: true, cards: [publicCard('card-1')], total: 1, nextOffset: null },
  }));
  const { host: hostA } = createHost([], {
    auth: { status: 'authenticated', userId: 1, userBadges: [] },
    online: { fetchPublicCards, listFavoriteIds: vi.fn(() => listA.promise) },
  });
  await render({
    host: hostA, isOpen: true, onClose: vi.fn(), onSelectCard: vi.fn(),
    selectedType: 'character', initialTab: 'public',
  });
  await settle();
  expect(document.body.textContent).toContain('公开角色 card-1');

  listA.resolve({ success: true, favorites: ['card-1'] });
  await settle();
  expect(isFavoritedRendered()).toBe(true);

  // 会话探测期（unknown）：登录态未确认不产出新身份，已确认账号的投影保留。
  const { host: hostUnknown } = createHost([], {
    auth: { status: 'unknown', userId: null, userBadges: [] },
    online: { fetchPublicCards, listFavoriteIds: vi.fn(() => new Promise<never>(() => {})) },
  });
  await act(async () => {
    root.render(<CardLibraryModal
      host={hostUnknown} isOpen onClose={vi.fn()} onSelectCard={vi.fn()}
      selectedType="character" initialTab="public"
    />);
  });
  await settle();
  expect(isFavoritedRendered()).toBe(true);

  // 探测结束回到同一账号：旧投影仍然有效，不必等重新拉取才显示星标。
  const { host: hostA2 } = createHost([], {
    auth: { status: 'authenticated', userId: 1, userBadges: [] },
    online: { fetchPublicCards, listFavoriteIds: vi.fn(() => new Promise<never>(() => {})) },
  });
  await act(async () => {
    root.render(<CardLibraryModal
      host={hostA2} isOpen onClose={vi.fn()} onSelectCard={vi.fn()}
      selectedType="character" initialTab="public"
    />);
  });
  await settle();
  expect(isFavoritedRendered()).toBe(true);
});

/* ── D5.1-K2 公开缓存视图 ─────────────────────────────────────────────── */

const cachedEntry = (id: string, hasBody = true) => ({
  card: { ...publicCard(id), data: JSON.stringify({ codename: id }) },
  hasBody,
  lastSuccessAt: '2026-10-05T00:00:00Z',
  summaryUpdatedAt: '2026-10-05T00:00:00Z',
  bodyUpdatedAt: hasBody ? '2026-10-05T00:00:00Z' : null,
});

const createCachePort = (entries: Array<ReturnType<typeof cachedEntry>>): CardLibraryPublicCachePort => ({
  queryCachedCards: vi.fn(async () => ({
    status: 'ready' as const,
    entries,
    total: entries.length,
    bodyCount: entries.filter((entry) => entry.hasBody).length,
  })),
  loadCachedCard: vi.fn(async (cardId: string) => ({
    status: 'ready' as const,
    availability: 'full' as const,
    entry: {
      card: { ...publicCard(cardId), data: JSON.stringify({ codename: cardId }) },
      bodyUpdatedAt: '2026-10-05T00:00:00Z',
      lastSuccessAt: '2026-10-05T00:00:00Z',
    },
  })),
});

test('在线失败自动降级到本机缓存：快照行标记 stale、不出现收藏入口', async () => {
  const { host } = createHost([]);
  host.publicCache = createCachePort([cachedEntry('card-c')]);
  await render({
    host, isOpen: true, onClose: vi.fn(), onSelectCard: vi.fn(),
    selectedType: 'character', initialTab: 'public',
  });
  await settle();

  expect(host.publicCache!.queryCachedCards).toHaveBeenCalled();
  expect(document.body.textContent).toContain('线上公开库暂时不可用');
  expect(document.body.textContent).toContain('公开角色 card-c');
  expect(document.body.textContent).toContain('本机缓存');
  // 缓存行的收藏/点赞是服务器权威写路径——入口不出现，不是点了再失败。
  expect([...document.body.querySelectorAll('button')].some((b) => b.title === '收藏')).toBe(false);
  expect([...document.body.querySelectorAll('button')].some((b) => b.title === '点赞')).toBe(false);
});

test('缓存快照行选择：cache 作用域、无服务器身份、不触发在线读取与使用统计', async () => {
  const { host, online } = createHost([]);
  const cache = createCachePort([cachedEntry('card-c')]);
  host.publicCache = cache;
  const onSelectCard = vi.fn();
  await render({
    host, isOpen: true, onClose: vi.fn(), onSelectCard,
    selectedType: 'character', initialTab: 'public',
  });
  await settle();

  await click(document.body.querySelector('[role="button"][aria-label="选择公开角色 card-c"]')!);
  await settle();

  expect(onSelectCard).toHaveBeenCalledTimes(1);
  const [payload, context] = onSelectCard.mock.calls[0]! as [Record<string, unknown>, unknown];
  // 快照正文不是已验证的线上引用——折叠到 local 一侧（DESK-CACHE-007）。
  expect(payload._cardId).toBe('');
  expect(payload._storageLocation).toBe('local');
  expect(payload.codename).toBe('card-c');
  expect(context).toMatchObject({ selectionId: 'cache:card-c', storageLocation: 'cache' });
  expect(cache.loadCachedCard).toHaveBeenCalledWith('card-c', expect.anything());
  // 降级中不重撞刚失败的在线路径；正文读取走缓存通道。
  expect(online.fetchPublicCardById).not.toHaveBeenCalled();
  expect(online.loadFullCard).not.toHaveBeenCalled();
  expect(online.reportCardStat).not.toHaveBeenCalled();
});

test('仅摘要缓存行不可选：入口禁用且不发起任何读取', async () => {
  const { host } = createHost([]);
  const cache = createCachePort([cachedEntry('card-s', false)]);
  host.publicCache = cache;
  const onSelectCard = vi.fn();
  await render({
    host, isOpen: true, onClose: vi.fn(), onSelectCard,
    selectedType: 'character', initialTab: 'public',
  });
  await settle();

  expect(document.body.textContent).toContain('仅摘要');
  const row = document.body.querySelector('[role="button"][aria-label="选择公开角色 card-s"]');
  expect(row?.getAttribute('aria-disabled')).toBe('true');
  await click(row!);
  await settle();

  expect(onSelectCard).not.toHaveBeenCalled();
  expect(cache.loadCachedCard).not.toHaveBeenCalled();
});

test('「已缓存」主动浏览缓存视图：查询缓存、显示快照横幅、可回到线上', async () => {
  const fetchPublicCards = vi.fn(async () => ({
    ok: true as const, status: 200,
    data: { success: true, cards: [publicCard('online-1')], total: 1, nextOffset: null },
  }));
  const { host } = createHost([], { online: { fetchPublicCards } });
  const cache = createCachePort([cachedEntry('card-c')]);
  host.publicCache = cache;
  await render({
    host, isOpen: true, onClose: vi.fn(), onSelectCard: vi.fn(),
    selectedType: 'character', initialTab: 'public',
  });
  await settle();
  expect(document.body.textContent).toContain('公开角色 online-1');

  await click([...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes('已缓存'))!);
  await settle();

  expect(cache.queryCachedCards).toHaveBeenCalled();
  expect(document.body.textContent).toContain('正在浏览本机缓存的公开资料快照');
  expect(document.body.textContent).toContain('公开角色 card-c');
  // 主动缓存视图不混入当前线上结果（DESK-CACHE-004）。
  expect(document.body.textContent).not.toContain('公开角色 online-1');
  const onlineCalls = fetchPublicCards.mock.calls.length;

  await click([...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes('回到线上'))!);
  await settle();
  expect(fetchPublicCards.mock.calls.length).toBeGreaterThan(onlineCalls);
  expect(document.body.textContent).toContain('公开角色 online-1');
});

/* ── D5.1-K2-r1 审查修复回归 ─────────────────────────────────────────── */

test('宿主无 publicCache 端口时 online/focus 不新增请求（Web 行为不回变）', async () => {
  const fetchPublicCards = vi.fn(async () => ({
    ok: true as const, status: 200,
    data: { success: true, cards: [publicCard('online-1')], total: 1, nextOffset: null },
  }));
  const { host } = createHost([], { online: { fetchPublicCards } });
  await render({
    host, isOpen: true, onClose: vi.fn(), onSelectCard: vi.fn(),
    selectedType: 'character', initialTab: 'public',
  });
  await settle();
  expect(document.body.textContent).toContain('公开角色 online-1');
  const calls = fetchPublicCards.mock.calls.length;
  expect(calls).toBeGreaterThan(0);

  await act(async () => { window.dispatchEvent(new Event('online')); });
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  await settle();
  // K2 的断线重连/回前台重验证是缓存宿主专属逻辑——Web 不得挂载监听。
  expect(fetchPublicCards.mock.calls.length).toBe(calls);
});

test('缓存宿主的 online 事件触发线上重试并从降级恢复', async () => {
  let fail = true;
  const fetchPublicCards = vi.fn(async () => {
    if (fail) return { ok: false as const, status: 503 };
    return {
      ok: true as const, status: 200,
      data: { success: true, cards: [publicCard('online-1')], total: 1, nextOffset: null },
    };
  });
  const { host } = createHost([], { online: { fetchPublicCards } });
  host.publicCache = createCachePort([cachedEntry('card-c')]);
  await render({
    host, isOpen: true, onClose: vi.fn(), onSelectCard: vi.fn(),
    selectedType: 'character', initialTab: 'public',
  });
  await settle();
  // 线上失败 → 已降级到缓存快照。
  expect(document.body.textContent).toContain('公开角色 card-c');
  expect(document.body.textContent).toContain('线上公开库暂时不可用');
  const calls = fetchPublicCards.mock.calls.length;

  fail = false;
  await act(async () => { window.dispatchEvent(new Event('online')); });
  await settle();
  expect(fetchPublicCards.mock.calls.length).toBeGreaterThan(calls);
  // 重连重试成功：自动回到线上结果，不再展示缓存行。
  expect(document.body.textContent).toContain('公开角色 online-1');
  expect(document.body.textContent).not.toContain('公开角色 card-c');
});

test('在线成功返回空结果后，同条件刷新失败仍降级到本机缓存', async () => {
  let fail = false;
  const fetchPublicCards = vi.fn(async () => {
    if (fail) return { ok: false as const, status: 503 };
    // 语义级成功但零行——这是「没有可保留的在线行」，不是「没有成功过」。
    return {
      ok: true as const, status: 200,
      data: { success: true, cards: [], total: 0, nextOffset: null },
    };
  });
  const { host } = createHost([], { online: { fetchPublicCards } });
  const cache = createCachePort([cachedEntry('card-c')]);
  host.publicCache = cache;
  await render({
    host, isOpen: true, onClose: vi.fn(), onSelectCard: vi.fn(),
    selectedType: 'character', initialTab: 'public',
  });
  await settle();
  expect(document.body.textContent).toContain('公开库里还没有公开的角色数据卡');
  // 成功路径不发缓存查询。
  expect(cache.queryCachedCards).not.toHaveBeenCalled();

  // 同条件强制刷新（重连信号）失败：没有可保留的在线行 → 查本机缓存。
  fail = true;
  await act(async () => { window.dispatchEvent(new Event('online')); });
  await settle();
  expect(cache.queryCachedCards).toHaveBeenCalled();
  expect(document.body.textContent).toContain('线上公开库暂时不可用');
  expect(document.body.textContent).toContain('公开角色 card-c');
});

test('缓存空态优先级：unavailable/unsupported-schema 不被线上错误文案覆盖', async () => {
  await act(async () => {
    root.render(<DataCardEmptyState
      tab="public" typeLabel="角色" error onRetry={() => {}}
      cacheView="degraded" cachedStatus="unavailable"
    />);
  });
  // 缓存故障不能伪装成「缓存为空」（DESK-CACHE-002）。
  expect(document.body.textContent).toContain('本机缓存当前也不可读取');
  expect(document.body.textContent).not.toContain('本机缓存中也没有可显示的内容');

  await act(async () => {
    root.render(<DataCardEmptyState
      tab="public" typeLabel="角色" error onRetry={() => {}}
      cacheView="degraded" cachedStatus="unsupported-schema"
    />);
  });
  expect(document.body.textContent).toContain('本机缓存由更新版本的应用创建');

  // 主动浏览缓存：线上错误与缓存内容无关，照常展示缓存空态。
  await act(async () => {
    root.render(<DataCardEmptyState
      tab="public" typeLabel="角色" error onRetry={() => {}}
      cacheView="browse" cachedStatus="ready"
    />);
  });
  expect(document.body.textContent).toContain('本机缓存中还没有公开的角色数据卡');
  expect(document.body.textContent).not.toContain('加载失败');

  // 无缓存视图（Web 现状）：错误文案完全不变。
  await act(async () => {
    root.render(<DataCardEmptyState tab="public" typeLabel="角色" error onRetry={() => {}} />);
  });
  expect(document.body.textContent).toContain('数据卡加载失败，请重试。');
});

const renderCacheBrowse = async (cache: ReturnType<typeof createCachePort>, online: Partial<CardLibraryHost['online']>) => {
  const { host } = createHost([], {
    online: {
      fetchPublicCards: vi.fn(async () => ({
        ok: true as const, status: 200,
        data: { success: true, cards: [publicCard('online-1')], total: 1, nextOffset: null },
      })),
      ...online,
    },
  });
  host.publicCache = cache;
  const onSelectCard = vi.fn();
  await render({
    host, isOpen: true, onClose: vi.fn(), onSelectCard,
    selectedType: 'character', initialTab: 'public',
  });
  await settle();
  await click([...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes('已缓存'))!);
  await settle();
  expect(document.body.textContent).toContain('公开角色 card-c');
  return { onSelectCard };
};

const selectCachedRow = () => click(document.body.querySelector('[role="button"][aria-label="选择公开角色 card-c"]')!);

test('缓存正文重验证：仅「404 + success:false + 撤回码」三证齐全才判撤回并即时移除行', async () => {
  // 在线侧确认撤回发生在 native 观察路径——mock 里翻转 withdrawn，
  // 模拟「404 证据落盘/登记后再重查」的权威计数。
  let withdrawn = false;
  const fetchPublicCardById = vi.fn(async () => {
    withdrawn = true;
    return {
      ok: false as const, status: 404,
      data: { success: false, code: 'PUBLIC_DATA_CARD_NOT_FOUND', error: 'not found' },
    };
  });
  const queryCachedCards = vi.fn(async () => ({
    status: 'ready' as const,
    entries: withdrawn ? [cachedEntry('card-d')] : [cachedEntry('card-c'), cachedEntry('card-d')],
    total: withdrawn ? 1 : 2,
    bodyCount: withdrawn ? 1 : 2,
  }));
  const cache: CardLibraryPublicCachePort = {
    queryCachedCards,
    loadCachedCard: vi.fn(async () => ({
      status: 'ready' as const,
      availability: 'full' as const,
      entry: { card: publicCard('card-c'), bodyUpdatedAt: null, lastSuccessAt: null },
    })),
  };
  const { onSelectCard } = await renderCacheBrowse(cache, { fetchPublicCardById });
  expect(document.body.textContent).toContain('命中 2 条（2 条已缓存正文可离线打开）');

  await selectCachedRow();
  await settle();
  // 明确撤回是终态：不再回落缓存正文，选择终止，错误如实说明。
  expect(onSelectCard).not.toHaveBeenCalled();
  expect(cache.loadCachedCard).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('已从公开库撤回或不再公开');
  // K-r2：已撤回行从可见/可选集合立即移除，不是降格为「仅摘要」；
  // 重查询以撤回后的权威全集计数 total/bodyCount。
  expect(document.body.querySelector('[role="button"][aria-label="选择公开角色 card-c"]')).toBeNull();
  expect(document.body.textContent).toContain('公开角色 card-d');
  expect(document.body.textContent).toContain('命中 1 条（1 条已缓存正文可离线打开）');
  expect(queryCachedCards.mock.calls.length).toBeGreaterThanOrEqual(2);
});

test('缓存正文重验证：同名 code 的非 404 响应不算撤回，照常回落缓存正文', async () => {
  for (const status of [200, 503]) {
    const fetchPublicCardById = vi.fn(async () => ({
      ok: status === 200, status,
      data: { success: status === 200, code: 'PUBLIC_DATA_CARD_NOT_FOUND' },
    }));
    const cache = createCachePort([cachedEntry('card-c')]);
    const { onSelectCard } = await renderCacheBrowse(cache, { fetchPublicCardById });

    await selectCachedRow();
    await settle();
    expect(cache.loadCachedCard).toHaveBeenCalledWith('card-c', expect.anything());
    expect(onSelectCard).toHaveBeenCalledTimes(1);
    const [, context] = onSelectCard.mock.calls[0]! as [unknown, { selectionId: string }];
    expect(context.selectionId).toBe('cache:card-c');
    expect(document.body.textContent).not.toContain('撤回');

    await act(async () => { root.unmount(); });
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  }
});

test('缓存正文重验证：返回卡 id 与请求不符不得升级为 cloud 身份', async () => {
  const fetchPublicCardById = vi.fn(async () => ({
    ok: true as const, status: 200,
    data: { success: true, card: publicCard('card-WRONG') },
  }));
  const cache = createCachePort([cachedEntry('card-c')]);
  const { onSelectCard } = await renderCacheBrowse(cache, { fetchPublicCardById });

  await selectCachedRow();
  await settle();
  // id 不符不构成已验证事实 → 回落缓存，语义保持 cache:card-c。
  expect(cache.loadCachedCard).toHaveBeenCalledWith('card-c', expect.anything());
  expect(onSelectCard).toHaveBeenCalledTimes(1);
  const [, context] = onSelectCard.mock.calls[0]! as [unknown, { selectionId: string }];
  expect(context.selectionId).toBe('cache:card-c');
});

test('缓存正文重验证：返回卡 id 匹配才升级为 cloud 选择语义', async () => {
  const fetchPublicCardById = vi.fn(async () => ({
    ok: true as const, status: 200,
    data: { success: true, card: publicCard('card-c') },
  }));
  const cache = createCachePort([cachedEntry('card-c')]);
  const { onSelectCard } = await renderCacheBrowse(cache, { fetchPublicCardById });

  await selectCachedRow();
  await settle();
  expect(onSelectCard).toHaveBeenCalledTimes(1);
  const [, context] = onSelectCard.mock.calls[0]! as [unknown, { selectionId: string; cloudCardId: string }];
  expect(context).toMatchObject({ selectionId: 'cloud:card-c', storageLocation: 'cloud', cloudCardId: 'card-c' });
});

test('缓存通道自身判撤回时同样终止并即时移除行', async () => {
  // native 口径对拍：loadCachedCard 判撤回后，queryCachedCards 也不再
  // 交付该卡（占位行/进程内屏障都会排除它）。
  let withdrawn = false;
  const cache: CardLibraryPublicCachePort = {
    queryCachedCards: vi.fn(async () => ({
      status: 'ready' as const,
      entries: withdrawn ? [] : [cachedEntry('card-c')],
      total: withdrawn ? 0 : 1,
      bodyCount: withdrawn ? 0 : 1,
    })),
    loadCachedCard: vi.fn(async () => {
      withdrawn = true;
      return {
        status: 'ready' as const,
        availability: 'withdrawn' as const,
        entry: null,
      };
    }),
  };
  const { onSelectCard } = await renderCacheBrowse(cache, {
    // 传输层失败（非撤回）→ 回落缓存通道，由缓存的撤回标记终结。
    fetchPublicCardById: vi.fn(async () => ({ ok: false as const, status: 503 })),
  });

  await selectCachedRow();
  await settle();
  expect(onSelectCard).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('已从公开库撤回或不再公开');
  // K-r2：撤回行直接移出可见集合且不再出现（native 重查口径一致）。
  expect(document.body.querySelector('[role="button"][aria-label="选择公开角色 card-c"]')).toBeNull();
});

test('撤回确认前签发的在途缓存列表响应不得重新展示已撤回卡', async () => {
  // 第二次查询由用户「刷新快照视图」签发、在撤回确认前已在途：撤回
  // 登记水位线高于它的签发序号——即使负载迟到且仍带该卡也不得重显。
  const late = deferred<{
    status: 'ready'; entries: ReturnType<typeof cachedEntry>[]; total: number; bodyCount: number;
  }>();
  let calls = 0;
  const cache: CardLibraryPublicCachePort = {
    queryCachedCards: vi.fn(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve({
          status: 'ready' as const,
          entries: [cachedEntry('card-c'), cachedEntry('card-d')],
          total: 2, bodyCount: 2,
        });
      }
      if (calls === 2) return late.promise;
      // 撤回触发的重查及此后查询：native 权威口径已排除撤回卡。
      return Promise.resolve({
        status: 'ready' as const,
        entries: [cachedEntry('card-d')],
        total: 1, bodyCount: 1,
      });
    }),
    loadCachedCard: vi.fn(async () => ({
      status: 'ready' as const,
      availability: 'withdrawn' as const,
      entry: null,
    })),
  };
  const { onSelectCard } = await renderCacheBrowse(cache, {
    fetchPublicCardById: vi.fn(async () => ({ ok: false as const, status: 503 })),
  });

  // 撤回确认前签发的在途查询：刷新快照视图后保持挂起。
  await click([...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes('刷新快照视图'))!);
  await settle();
  expect(calls).toBe(2);

  await selectCachedRow();
  await settle();
  // 即时移除已生效，撤回后重查返回权威全集。
  expect(document.body.querySelector('[role="button"][aria-label="选择公开角色 card-c"]')).toBeNull();
  expect(document.body.textContent).toContain('公开角色 card-d');

  // 迟到响应仍携带已撤回卡——abort 使其不被认领，签发世代屏障同样
  // 把它挡在视图写入前（issueSeq <= 水位线）。
  await act(async () => {
    late.resolve({
      status: 'ready',
      entries: [cachedEntry('card-c'), cachedEntry('card-d')],
      total: 2, bodyCount: 2,
    });
  });
  await settle();
  expect(document.body.querySelector('[role="button"][aria-label="选择公开角色 card-c"]')).toBeNull();
  expect(document.body.textContent).toContain('公开角色 card-d');
  expect(onSelectCard).not.toHaveBeenCalled();
});

test('撤回后重新公开：native 重新捕获的卡不关闭弹窗刷新即恢复显示', async () => {
  // cardGone=true：线上 404 三证齐全判撤回；cardGone=false：作者重新
  // 公开且 native 已被撤回后签发的新票据带回的真实响应重新捕获——
  // queryCachedCards 只交付 availability='known' 行，返回即权威确认。
  let cardGone = false;
  const fetchPublicCardById = vi.fn(async () => {
    if (cardGone) {
      return {
        ok: false as const, status: 404,
        data: { success: false, code: 'PUBLIC_DATA_CARD_NOT_FOUND', error: 'not found' },
      };
    }
    return {
      ok: true as const, status: 200,
      data: { success: true, card: publicCard('card-c') },
    };
  });
  const cache: CardLibraryPublicCachePort = {
    queryCachedCards: vi.fn(async () => ({
      status: 'ready' as const,
      entries: cardGone ? [] : [cachedEntry('card-c')],
      total: cardGone ? 0 : 1,
      bodyCount: cardGone ? 0 : 1,
    })),
    loadCachedCard: vi.fn(async () => ({
      status: 'ready' as const,
      availability: 'full' as const,
      entry: {
        card: { ...publicCard('card-c'), data: JSON.stringify({ codename: 'card-c' }) },
        bodyUpdatedAt: '2026-10-05T00:00:00Z',
        lastSuccessAt: '2026-10-05T00:00:00Z',
      },
    })),
  };
  const { onSelectCard } = await renderCacheBrowse(cache, { fetchPublicCardById });
  expect(document.body.textContent).toContain('公开角色 card-c');

  // 确认撤回：行即时移出可见/可选集合。
  cardGone = true;
  await selectCachedRow();
  await settle();
  expect(onSelectCard).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('已从公开库撤回或不再公开');
  expect(document.body.querySelector('[role="button"][aria-label="选择公开角色 card-c"]')).toBeNull();

  // 作者重新公开、native 重新捕获；不关闭弹窗，刷新快照视图。
  cardGone = false;
  await click([...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes('刷新快照视图'))!);
  await settle();
  // 撤回后签发的查询仍由 native 权威交付该卡 → 会话标记解除，行恢复。
  expect(document.body.textContent).toContain('公开角色 card-c');

  // 恢复后的行是完整可用快照：重验证成功即按线上已验证事实选择。
  await selectCachedRow();
  await settle();
  expect(onSelectCard).toHaveBeenCalledTimes(1);
  const [, context] = onSelectCard.mock.calls[0]! as [unknown, { selectionId: string }];
  expect(context.selectionId).toBe('cloud:card-c');
});

test('缓存正文读取：unavailable/unsupported-schema 如实报错而非「没有这张卡」', async () => {
  for (const status of ['unavailable', 'unsupported-schema'] as const) {
    const cache = createCachePort([cachedEntry('card-c')]);
    cache.loadCachedCard = vi.fn(async () => ({
      status,
      availability: 'absent' as const,
      entry: null,
    }));
    const { onSelectCard } = await renderCacheBrowse(cache, {
      // 传输层失败 → 走缓存通道；缓存整体不可用不是「没有这张卡」。
      fetchPublicCardById: vi.fn(async () => ({ ok: false as const, status: 503 })),
    });

    await selectCachedRow();
    await settle();
    expect(onSelectCard).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      status === 'unavailable' ? '本机缓存暂不可用' : '本机缓存数据版本不受支持',
    );
    expect(document.body.textContent).not.toContain('本机缓存中没有这张卡');

    await act(async () => { root.unmount(); });
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  }
});


test('公告与卡库同时卸载后恢复宿主滚动，不留下隐藏快照', async () => {
  const { host } = createHost([]);
  const announcements = [{ id: 'over-library', title: '测试公告', content: '正文', date: '2026-10-09' }];
  const dismissal = { isDismissed: () => false, markDismissed: vi.fn() };
  const originalOverflow = document.body.style.overflow;
  document.body.style.overflow = 'auto';
  try {
    await act(async () => root.render(
      <>
        <CardLibraryModal host={host} isOpen onClose={vi.fn()} selectedType="character" initialTab="local" visibleTabs={['local']} />
        <AnnouncementCenter announcements={announcements} dismissal={dismissal} />
      </>,
    ));
    await click(document.querySelector<HTMLButtonElement>('.announcement-trigger')!);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
    expect(document.body.style.overflow).toBe('hidden');
    await act(async () => root.render(null));
    expect(document.body.style.overflow).toBe('auto');
  } finally {
    document.body.style.overflow = originalOverflow;
  }
});

test('先关闭卡库不解除其上公告的滚动锁或抢走焦点，公告关闭后恢复宿主', async () => {
  const { host } = createHost([]);
  const announcements = [{ id: 'over-library', title: '测试公告', content: '正文', date: '2026-10-09' }];
  const dismissal = { isDismissed: () => false, markDismissed: vi.fn() };
  const originalOverflow = document.body.style.overflow;
  const mount = (libraryOpen: boolean) => (
    <>
      <button data-library-opener>打开卡库</button>
      <CardLibraryModal host={host} isOpen={libraryOpen} onClose={vi.fn()} selectedType="character" initialTab="local" visibleTabs={['local']} />
      <AnnouncementCenter announcements={announcements} dismissal={dismissal} />
    </>
  );
  document.body.style.overflow = 'auto';
  try {
    await act(async () => root.render(mount(false)));
    document.querySelector<HTMLButtonElement>('[data-library-opener]')!.focus();
    await act(async () => root.render(mount(true)));
    await click(document.querySelector<HTMLButtonElement>('.announcement-trigger')!);
    const announcementFocus = document.activeElement;
    await act(async () => root.render(mount(false)));
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement).toBe(announcementFocus);
    await click(document.querySelector<HTMLButtonElement>('[aria-label="关闭详情"]')!);
    expect(document.body.style.overflow).toBe('auto');
  } finally {
    await act(async () => root.render(null));
    document.body.style.overflow = originalOverflow;
  }
});


test.each(['library-lower', 'library-upper'] as const)('卡库与BaseModal混用 %s：下层先关、上层最后归还页面入口', async (order) => {
  const { host } = createHost([]);
  const originalOverflow = document.body.style.overflow;
  const mount = (lower: boolean, upper: boolean) => (
    <>
      <button data-mixed-opener>页面入口</button>
      <BaseModal isOpen={order === 'library-lower' ? upper : lower} title="共享弹窗" onClose={() => {}}>内容</BaseModal>
      <CardLibraryModal host={host} isOpen={order === 'library-lower' ? lower : upper} onClose={vi.fn()} selectedType="character" initialTab="local" visibleTabs={['local']} />
    </>
  );
  document.body.style.overflow = 'auto';
  try {
    await act(async () => root.render(mount(false, false)));
    const opener = document.querySelector<HTMLButtonElement>('[data-mixed-opener]')!;
    opener.focus();
    await act(async () => root.render(mount(true, false)));
    await act(async () => root.render(mount(true, true)));
    const upperFocus = document.activeElement;
    await act(async () => root.render(mount(false, true)));
    expect(document.activeElement).toBe(upperFocus);
    expect(document.body.style.overflow).toBe('hidden');
    await act(async () => root.render(mount(false, false)));
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe('auto');
  } finally {
    await act(async () => root.render(null));
    document.body.style.overflow = originalOverflow;
  }
});
