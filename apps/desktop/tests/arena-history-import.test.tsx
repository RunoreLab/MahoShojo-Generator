// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildNarrativeHistoryCardPayload } from '@mahoshojo/domain/narrative-history-operations';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import { importDesktopHistoryFile } from '../src/features/arena/history-import';
import { DesktopArenaHistoryPicker } from '../src/features/arena/history-picker';
import { readSublimationHistorySource } from '../src/features/sublimation/history-source';

const now = '2026-10-28T00:00:00.000Z';
const entries = [{ id: 'web-id', title: '网页历史', content: '完整正文', createdAt: now, updatedAt: now, extension: { nested: true } }];
const payload = { ...buildNarrativeHistoryCardPayload(entries, now, { now: () => now }), extension: { preserve: true } };
const file = (value: unknown = payload) => ({ name: 'web-history.json', size: JSON.stringify(value).length, text: async () => JSON.stringify(value) }) as File;
let records: Map<string, LocalCardRecordV1>;
let repository: CardRepository;
let root: Root | undefined;
let container: HTMLDivElement | undefined;
beforeEach(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  vi.stubGlobal('TextEncoder', TextEncoder);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  records = new Map();
  repository = {
    get: vi.fn(async id => records.get(id) ?? null),
    list: vi.fn(async () => ({ items: [...records.values()].filter(record => !record.deletedAt) })),
    putIfAbsent: vi.fn(async record => {
      if (records.has(record.id)) return { alreadyPresent: true };
      records.set(record.id, structuredClone(record)); return { written: true };
    }),
    put: vi.fn(), delete: vi.fn(), restore: vi.fn(),
  };
});
afterEach(() => { if (root) act(() => root!.unmount()); container?.remove(); root = undefined; vi.unstubAllGlobals(); });
const importFile = (source = file(), signal = new AbortController().signal) => importDesktopHistoryFile(repository, source, signal);
it('网页正式导出能保存为独立历史卡，重读可引用且原文、ID 和扩展不丢失', async () => {
  expect(await importFile()).toEqual({ count: 1, alreadyPresent: false });
  const saved = [...records.values()][0]!;
  expect(saved.data).toEqual(payload);
  expect(saved.provenance).toEqual({ kind: 'unsigned', execution: 'imported' });
  const reopened = await readSublimationHistorySource(repository);
  expect(reopened.status).toBe('ready');
  expect(reopened.entries[0]).toEqual({ ...entries[0], id: JSON.stringify([saved.id, 0, 'web-id']) });
  expect(repository.put).not.toHaveBeenCalled();
});
it('重复导入幂等，回收站记录不复活', async () => {
  await importFile(); expect(await importFile()).toEqual({ count: 1, alreadyPresent: true });
  expect(records.size).toBe(1);
  const saved = [...records.values()][0]!; records.set(saved.id, { ...saved, deletedAt: now });
  await expect(importFile()).rejects.toThrow('回收站');
  expect(records.get(saved.id)?.deletedAt).toBe(now);
  expect(repository.restore).not.toHaveBeenCalled();
});
it.each([{ version: 1, product: 'arena', draft: {} }, { ...payload, entries: [] }, { ...payload, entries: [{ content: '不完整条目' }] }])('错误类型、空历史和损坏条目不写库', async value => {
  await expect(importFile(file(value))).rejects.toThrow(); expect(repository.putIfAbsent).not.toHaveBeenCalled();
});
it('超出既有本地库容量保留文件且不截断写入', async () => {
  await expect(importFile(file({ ...payload, entries: [{ ...entries[0], content: 'x'.repeat(4 * 1024 * 1024) }] }))).rejects.toThrow('4 MiB');
  expect(repository.putIfAbsent).not.toHaveBeenCalled();
});
it('读取期间身份失效不写入', async () => {
  const controller = new AbortController();
  const source = { ...file(), text: async () => { controller.abort(); return JSON.stringify(payload); } } as File;
  await expect(importFile(source, controller.signal)).rejects.toThrow(); expect(repository.putIfAbsent).not.toHaveBeenCalled();
});

const button = (text: string) => [...document.querySelectorAll('button')].find(item => item.textContent?.includes(text)) as HTMLButtonElement;
const chooseFile = async (source: File) => {
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { value: [source], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
};
const mount = () => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  const props = { isOpen: true, onClose: vi.fn(), onConfirm: vi.fn(), entries: [], lastUpdatedAt: null,
    sort: 'updated_desc' as const, onSort: vi.fn(), formatDateTime: (value: string) => value, readStatus: 'ready' as const,
    sourceHint: '只读引用', repository, scopeKey: 'arena:guest', onImported: vi.fn(), onBusyChange: vi.fn() };
  const render = async () => { await act(async () => root!.render(<DesktopArenaHistoryPicker {...props} />)); };
  return { props, render };
};
it('空列表直接导入，写入中禁止关闭和重复提交，成功才刷新来源', async () => {
  let finish!: () => void;
  const write = repository.putIfAbsent;
  repository.putIfAbsent = vi.fn(async record => { await new Promise<void>(resolve => { finish = resolve; }); return write(record); });
  const { props, render } = mount(); await render();
  expect(button('导入 JSON 并保存到本机')).toBeTruthy();
  await chooseFile(file());
  await vi.waitFor(() => expect(repository.putIfAbsent).toHaveBeenCalledTimes(1));
  expect(button('取消').disabled).toBe(true);
  expect(button('不使用叙事历史').disabled).toBe(true);
  await chooseFile(file()); expect(repository.putIfAbsent).toHaveBeenCalledTimes(1);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(props.onClose).not.toHaveBeenCalled(); expect(props.onImported).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(props.onImported).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).toContain('已保存到本机（1 条）');
  expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
});
it('写入失败不显示成功或刷新，选择同一文件可重试', async () => {
  vi.mocked(repository.putIfAbsent).mockRejectedValueOnce(new Error('本地库暂不可用'));
  const { props, render } = mount(); await render(); await chooseFile(file());
  await vi.waitFor(() => expect(document.body.textContent).toContain('本地库暂不可用'));
  expect(props.onImported).not.toHaveBeenCalled(); expect(button('取消').disabled).toBe(false);
  await chooseFile(file()); await vi.waitFor(() => expect(props.onImported).toHaveBeenCalledTimes(1));
});
it.each(['scope', 'reopen'])('%s 变化后，旧文件读取不能保存到新作用域', async change => {
  let finish!: (text: string) => void;
  const source = { ...file(), text: () => new Promise<string>(resolve => { finish = resolve; }) } as File;
  const { props, render } = mount(); await render(); await chooseFile(source);
  if (change === 'scope') { props.scopeKey = 'arena:other'; await render(); }
  else { props.isOpen = false; await render(); props.isOpen = true; await render(); }
  await act(async () => finish(JSON.stringify(payload)));
  expect(repository.putIfAbsent).not.toHaveBeenCalled(); expect(props.onImported).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain('已保存到本机');
});
