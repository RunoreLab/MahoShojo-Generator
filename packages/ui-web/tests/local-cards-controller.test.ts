import { describe, expect, it, vi } from 'vitest';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import type { LocalCardPage, LocalCardQuery } from '@mahoshojo/local-library/repository';

import { createLocalCardsController, type LocalCardsStore } from '../src/local-cards/controller';
import { describeLocalCardProvenance, filterLocalCards, previewLocalCardData } from '../src/local-cards/presentation';

const record = (id: string, overrides: Partial<LocalCardRecordV1> = {}): LocalCardRecordV1 => ({
  id,
  schemaVersion: 1,
  storageLocation: 'local',
  cardType: 'character',
  title: `卡 ${id}`,
  data: { codename: id },
  contentDigest: `sha256:${id.padEnd(16, 'x')}`,
  provenance: { kind: 'unsigned', execution: 'imported' },
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** 内存 fake：只实现控制器真正使用的四个方法，墓碑语义与两端 adapter 一致。 */
const memoryStore = (initial: LocalCardRecordV1[]) => {
  const rows = new Map(initial.map((item) => [item.id, item]));
  const store = {
    list: vi.fn(async (query: LocalCardQuery): Promise<LocalCardPage> => ({
      items: [...rows.values()].filter((item) => query.includeDeleted === true || item.deletedAt === undefined),
    })),
    delete: vi.fn(async (id: string) => {
      const existing = rows.get(id);
      if (existing && existing.deletedAt === undefined) rows.set(id, { ...existing, deletedAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' });
    }),
    restore: vi.fn(async (id: string) => {
      const existing = rows.get(id);
      if (!existing || existing.deletedAt === undefined) return;
      const restored = { ...existing };
      delete restored.deletedAt;
      rows.set(id, restored);
    }),
    purge: vi.fn(async (id: string) => { rows.delete(id); }),
  } satisfies LocalCardsStore;
  return { store, rows };
};

const describeError = (cause: unknown) => (cause instanceof Error ? cause.message : '失败');

describe('本地数据卡控制器', () => {
  it('活动视图排除墓碑，回收站只含墓碑并按删除时间倒序', async () => {
    const { store } = memoryStore([
      record('a'),
      record('b', { deletedAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' }),
      record('c', { deletedAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z' }),
    ]);
    const controller = createLocalCardsController({ store, describeError });
    controller.actions.reload();
    await flush();
    expect(controller.model.records.map((item) => item.id)).toEqual(['a']);
    controller.actions.setView('recycle');
    await flush();
    expect(controller.model.records.map((item) => item.id)).toEqual(['c', 'b']);
    expect(store.list).toHaveBeenLastCalledWith({ limit: 100, includeDeleted: true });
  });

  it('逐页读完，并汇总 adapter 报出的不可读行', async () => {
    const list = vi.fn(async (query: LocalCardQuery) => (query.cursor === undefined
      ? { items: [record('a')], nextCursor: 'p2', unreadable: ['bad-1'] }
      : { items: [record('b')], unreadable: ['bad-1', 'bad-2'] }));
    const controller = createLocalCardsController({
      store: { list, delete: vi.fn(), restore: vi.fn(), purge: vi.fn() },
      describeError,
    });
    controller.actions.reload();
    await flush();
    expect(controller.model.records.map((item) => item.id)).toEqual(['a', 'b']);
    expect(controller.model.unreadableCount).toBe(2);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('重复游标以读取失败结束，而不是无限循环', async () => {
    const list = vi.fn(async () => ({ items: [record('a')], nextCursor: 'same' }));
    const controller = createLocalCardsController({
      store: { list, delete: vi.fn(), restore: vi.fn(), purge: vi.fn() },
      describeError,
    });
    controller.actions.reload();
    await flush();
    expect(controller.model.status).toBe('error');
    expect(controller.model.loadError).toContain('重复的分页游标');
    expect(controller.model.records).toEqual([]);
  });

  it('切换视图后晚到的旧响应不会写进新视图', async () => {
    const active = deferred<LocalCardPage>();
    const recycle = deferred<LocalCardPage>();
    const list = vi.fn((query: LocalCardQuery) => (query.includeDeleted ? recycle.promise : active.promise));
    const controller = createLocalCardsController({
      store: { list, delete: vi.fn(), restore: vi.fn(), purge: vi.fn() },
      describeError,
    });
    controller.actions.reload();
    controller.actions.setView('recycle');
    recycle.resolve({ items: [record('gone', { deletedAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' })] });
    await flush();
    active.resolve({ items: [record('alive')] });
    await flush();
    expect(controller.model.view).toBe('recycle');
    expect(controller.model.records.map((item) => item.id)).toEqual(['gone']);
  });

  it('读失败显示为错误而不是空库', async () => {
    const controller = createLocalCardsController({
      store: { list: vi.fn(async () => { throw new Error('store-unavailable'); }), delete: vi.fn(), restore: vi.fn(), purge: vi.fn() },
      describeError,
    });
    controller.actions.reload();
    await flush();
    expect(controller.model.status).toBe('error');
    expect(controller.model.loadError).toBe('store-unavailable');
  });

  it('软删 → 恢复 → 彻底删除逐步改变两个视图，并给出真实结果文案', async () => {
    const { store, rows } = memoryStore([record('a')]);
    const controller = createLocalCardsController({ store, describeError });
    controller.actions.reload();
    await flush();
    controller.actions.remove('a');
    await flush();
    expect(controller.model.notice).toContain('回收站');
    expect(controller.model.records).toEqual([]);
    expect(rows.get('a')?.deletedAt).toBeDefined();

    controller.actions.setView('recycle');
    await flush();
    controller.actions.restore('a');
    await flush();
    expect(rows.get('a')?.deletedAt).toBeUndefined();
    expect(controller.model.records).toEqual([]);

    controller.actions.setView('active');
    await flush();
    controller.actions.remove('a');
    await flush();
    controller.actions.setView('recycle');
    await flush();
    controller.actions.purge('a');
    await flush();
    expect(rows.has('a')).toBe(false);
    expect(controller.model.notice).toBe('已从本机彻底删除。');
  });

  it('写操作单飞：在途时第二次写入直接忽略，isBusy 同步反映', async () => {
    const pending = deferred<void>();
    const store = {
      list: vi.fn(async () => ({ items: [record('a'), record('b')] })),
      delete: vi.fn(() => pending.promise),
      restore: vi.fn(),
      purge: vi.fn(),
    };
    const controller = createLocalCardsController({ store, describeError });
    controller.actions.remove('a');
    expect(controller.isBusy()).toBe(true);
    controller.actions.remove('b');
    controller.actions.purge('a');
    expect(store.delete).toHaveBeenCalledOnce();
    expect(store.purge).not.toHaveBeenCalled();
    pending.resolve();
    await flush();
    expect(controller.isBusy()).toBe(false);
  });

  it('写失败保留错误并以存储为准重读', async () => {
    const store = {
      list: vi.fn(async () => ({ items: [record('a')] })),
      delete: vi.fn(async () => { throw new Error('本地库正在维护，请稍后重试。'); }),
      restore: vi.fn(),
      purge: vi.fn(),
    };
    const controller = createLocalCardsController({ store, describeError });
    controller.actions.remove('a');
    await flush();
    expect(controller.model.actionError).toBe('本地库正在维护，请稍后重试。');
    expect(controller.model.notice).toBeNull();
    expect(store.list).toHaveBeenCalledOnce();
    expect(controller.model.records.map((item) => item.id)).toEqual(['a']);
  });
});

describe('本地数据卡展示规则', () => {
  it('签名字段只陈述为本机未验证', () => {
    expect(describeLocalCardProvenance(record('a', { provenance: { kind: 'official-signed', signature: 'sig' } })))
      .toBe('含签名字段（本机未验证）');
    // 草稿恢复等不可信载体中的签名证据同样只陈述事实，不升格为官方签名。
    expect(describeLocalCardProvenance(record('a', { provenance: { kind: 'signature-unverified', signature: 'sig' } })))
      .toBe('含签名字段（本机未验证）');
    expect(describeLocalCardProvenance(record('a', { provenance: { kind: 'unsigned', execution: 'direct-local' } })))
      .toBe('无签名 · 本机模型生成');
  });

  it('按标题、类型标签与 ID 过滤，类型筛选独立生效', () => {
    const items = [record('a', { title: '星光' }), record('b', { title: '雾港', cardType: 'scenario' })];
    expect(filterLocalCards(items, { query: '星', cardType: '' }).map((item) => item.id)).toEqual(['a']);
    expect(filterLocalCards(items, { query: '情景', cardType: '' }).map((item) => item.id)).toEqual(['b']);
    expect(filterLocalCards(items, { query: '', cardType: 'character' }).map((item) => item.id)).toEqual(['a']);
  });

  it('超长正文截断预览', () => {
    const preview = previewLocalCardData(record('a', { data: { text: 'x'.repeat(30_000) } }));
    expect(preview.truncated).toBe(true);
    expect(preview.text.length).toBe(20_000);
  });
});
