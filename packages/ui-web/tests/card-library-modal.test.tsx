// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import type { CardRepository } from '@mahoshojo/local-library/repository';

import {
  CardLibraryModal,
  mapDataCardRuntimeSourceInfo,
  type CardLibraryHost,
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
  expect(onSelectCard.mock.calls[0]![1]).toEqual({
    selectionId: 'local:a', storageLocation: 'local',
  });
});
