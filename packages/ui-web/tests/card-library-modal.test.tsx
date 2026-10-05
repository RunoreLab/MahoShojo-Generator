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

const createHost = (items: LocalCardRecordV1[]) => {
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
  };
  const store = new Set<string>();
  const host: CardLibraryHost = {
    auth: { isAuthenticated: false, userId: null, userBadges: [] },
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
