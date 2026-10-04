// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';

import { LocalCardsPanel, useLocalCardsController, type LocalCardsHost } from '../src/local-cards/index';

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

const record = (id: string, overrides: Partial<LocalCardRecordV1> = {}): LocalCardRecordV1 => ({
  id,
  schemaVersion: 1,
  storageLocation: 'local',
  cardType: 'character',
  title: `角色 ${id}`,
  data: { codename: id },
  contentDigest: `sha256:${id.padEnd(16, 'x')}`,
  provenance: { kind: 'unsigned', execution: 'imported' },
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

const Harness = ({ host, disabled }: { host: LocalCardsHost; disabled?: boolean }) => {
  const { controller, model } = useLocalCardsController(host);
  return <LocalCardsPanel model={model} actions={controller.actions} disabled={disabled ?? false} />;
};

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
const click = (target: Element | undefined) => act(async () => {
  target!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});

const createHost = (rows: LocalCardRecordV1[]) => {
  const store = {
    list: vi.fn(async (query: { includeDeleted?: boolean }) => ({
      items: rows.filter((item) => query.includeDeleted === true || item.deletedAt === undefined),
    })),
    delete: vi.fn(async (id: string) => {
      const index = rows.findIndex((item) => item.id === id);
      rows[index] = { ...rows[index]!, deletedAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' };
    }),
    restore: vi.fn(async () => {}),
    purge: vi.fn(async (id: string) => {
      rows.splice(rows.findIndex((item) => item.id === id), 1);
    }),
  };
  return { host: { store, describeError: () => '失败' } satisfies LocalCardsHost, store };
};

test('移入回收站需要确认，取消不写入，确认后进入回收站视图', async () => {
  const { host, store } = createHost([record('a')]);
  await act(async () => root.render(<Harness host={host} />));
  await settle();
  expect(container.textContent).toContain('角色 a');
  expect(container.textContent).toContain('无签名 · 导入');

  await click(button('移入回收站…'));
  expect(container.querySelector('[data-testid="local-card-confirm"]')).not.toBeNull();
  expect(document.activeElement?.textContent).toBe('取消');
  await click(button('取消'));
  expect(store.delete).not.toHaveBeenCalled();

  await click(button('移入回收站…'));
  await click(button('确认移入回收站'));
  await settle();
  expect(store.delete).toHaveBeenCalledWith('a');
  expect(container.textContent).toContain('已移入回收站，可在回收站恢复。');
  expect(container.querySelector('[data-testid="local-cards-empty"]')?.textContent).toContain('本地库中还没有数据卡');

  await click(container.querySelector('[data-testid="local-cards-view-recycle"]')!);
  await settle();
  expect(container.textContent).toContain('角色 a');
  expect(button('恢复')).toBeDefined();
  await click(button('彻底删除…'));
  expect(container.textContent).toContain('无法在应用内撤销');
  await click(button('确认彻底删除'));
  await settle();
  expect(store.purge).toHaveBeenCalledWith('a');
  expect(container.textContent).toContain('回收站是空的');
});

test('宿主禁用时只读浏览仍可用，写入口不可点', async () => {
  const { host } = createHost([record('a')]);
  await act(async () => root.render(<Harness host={host} disabled />));
  await settle();
  expect((button('移入回收站…') as HTMLButtonElement).disabled).toBe(true);
  await click(button('详情'));
  expect(container.querySelector('[data-testid="local-card-details"]')?.textContent).toContain('"codename": "a"');
});

test('搜索与类型筛选只影响显示，无结果时说明是筛选所致', async () => {
  const { host } = createHost([record('a', { title: '星光' }), record('b', { title: '雾港', cardType: 'scenario' })]);
  await act(async () => root.render(<Harness host={host} />));
  await settle();
  const select = container.querySelector('select')!;
  await act(async () => {
    select.value = 'questionnaire';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(container.querySelector('[data-testid="local-cards-empty"]')?.textContent).toBe('没有符合条件的数据卡。');
  await act(async () => {
    select.value = 'scenario';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(container.querySelectorAll('[data-testid="local-card-item"]')).toHaveLength(1);
  expect(container.textContent).toContain('雾港');
});
