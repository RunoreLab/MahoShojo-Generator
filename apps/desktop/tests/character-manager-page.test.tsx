// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serializeLocalLibraryRecord } from '@mahoshojo/local-library/archive-export';
import { deriveLocalDataCardIdV1, digestLocalCardPayloadV1 } from '@mahoshojo/local-library/digest';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';

import { LIST_LOCAL_BACKUPS_COMMAND } from '../src/platform/local-backup-bridge';
import {
  DELETE_LOCAL_CARD_COMMAND,
  GET_LOCAL_CARD_COMMAND,
  LIST_LOCAL_CARDS_COMMAND,
  RESTORE_LOCAL_CARD_COMMAND,
  SAVE_LOCAL_CARD_COMMAND,
} from '../src/platform/local-card-bridge';
import { createDesktopRouter } from '../src/app/router';

const native = vi.hoisted(() => ({ listen: vi.fn() }));
const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: bridge.invoke }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: native.listen }) }));
vi.mock('../src/platform/desktop-archive-host', () => ({
  createDesktopArchiveHost: () => ({
    probeStorage: async () => null,
    runExport: vi.fn(),
    pickArchiveBytes: vi.fn(),
    inspectArchive: vi.fn(),
    applyArchive: vi.fn(),
    describeError: () => '归档失败',
  }),
  DESKTOP_LIBRARY_ARCHIVE_LIMITS: { fileBytes: 1024 },
}));

const makeRecord = async (data: Record<string, unknown>, overrides: Partial<LocalCardRecordV1> = {}): Promise<LocalCardRecordV1> => {
  const contentDigest = await digestLocalCardPayloadV1(data);
  return {
    id: deriveLocalDataCardIdV1(contentDigest),
    schemaVersion: 1,
    storageLocation: 'local',
    cardType: 'character',
    title: String(data.codename ?? '卡'),
    data: data as LocalCardRecordV1['data'],
    contentDigest,
    provenance: { kind: 'unsigned', execution: 'direct-local' },
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
};

let rows: Map<string, LocalCardRecordV1>;
let original: LocalCardRecordV1;
let root: Root;
let container: HTMLDivElement;
let close: (event: { preventDefault: () => void }) => void;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
/** 懒加载路由与 IPC mock 在负载下可能晚于固定等待；按条件轮询而不是赌一个时长。 */
const waitFor = async (predicate: () => boolean, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('等待条件超时');
    await settle();
  }
};
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label) as HTMLButtonElement | undefined;
const click = async (target: Element | undefined) => {
  await act(async () => { target!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await settle();
};
const type = (element: HTMLInputElement | HTMLTextAreaElement, value: string) => act(() => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!;
  setter.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
});
const fieldByLabel = (label: string) => {
  const target = [...container.querySelectorAll('label')].find((item) => item.textContent?.trim().startsWith(label))!;
  return container.querySelector<HTMLInputElement>(`#${CSS.escape(target.htmlFor)}`)!;
};

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  original = await makeRecord({ codename: '星光', appearance: { outfit: '白裙' } });
  rows = new Map([[original.id, original]]);
  bridge.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === LIST_LOCAL_BACKUPS_COMMAND) return { backups: [], invalidCount: 0 };
    if (command === LIST_LOCAL_CARDS_COMMAND) {
      const includeDeleted = (args?.request as { includeDeleted: boolean }).includeDeleted;
      return { documents: [...rows.values()].filter((item) => includeDeleted || item.deletedAt === undefined).map(serializeLocalLibraryRecord) };
    }
    if (command === GET_LOCAL_CARD_COMMAND) {
      const found = rows.get(args?.id as string);
      return found === undefined ? null : serializeLocalLibraryRecord(found);
    }
    if (command === SAVE_LOCAL_CARD_COMMAND || command === DELETE_LOCAL_CARD_COMMAND || command === RESTORE_LOCAL_CARD_COMMAND) {
      const request = args?.request as { document: string; writeMode: string };
      const document = JSON.parse(request.document) as LocalCardRecordV1;
      if (request.writeMode === 'insert-if-absent' && rows.has(document.id)) return { id: document.id, alreadyPresent: true };
      rows.set(document.id, document);
      return { id: document.id };
    }
    return undefined;
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  window.location.hash = '#/local-library';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  native.listen.mockImplementation(async (handler) => { close = handler; return vi.fn(); });
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

const mount = async () => {
  const router = createDesktopRouter();
  await router.load();
  await act(async () => { root.render(<RouterProvider router={router} />); });
  await settle();
  return router;
};

describe('Desktop 本地角色管理（IPC mock，仍需真机重启验收）', () => {
  it('从本地库进入编辑，只改标题时原记录整卡替换，未保存修改受离开保护', async () => {
    const router = await mount();
    await waitFor(() => button('编辑') !== undefined);
    await click(button('编辑'));
    await waitFor(() => container.textContent?.includes('编辑：星光') === true);
    expect(router.state.location.pathname).toBe('/character-manager');
    expect(router.state.location.search).toEqual({ card: original.id });
    expect(container.textContent).toContain('编辑：星光');
    // 已有记录的类型创建后不可修改：编辑器里是只读文本而不是下拉选择。
    expect(container.textContent).toContain('类型（创建后不可修改）');
    expect(container.querySelector('select')).toBeNull();

    await type(fieldByLabel('记录标题'), '星光·改');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => { void router.navigate({ to: '/settings' }); });
    await settle();
    expect(confirm).toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/character-manager');
    const prevented = vi.fn();
    // 关窗回调会同步写入提示状态（guard message），与真实事件一样需要 act 包裹。
    await act(async () => { close({ preventDefault: prevented }); });
    expect(prevented).toHaveBeenCalledOnce();

    await click(button('保存到本地库'));
    await waitFor(() => container.textContent?.includes('已更新本地库中的记录。') === true);
    expect(rows.get(original.id)?.title).toBe('星光·改');
    expect(rows.size).toBe(1);

    confirm.mockClear();
    await act(async () => { await router.navigate({ to: '/settings' }); });
    await settle();
    expect(confirm).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/settings');
  });

  it('改正文另存为新记录，原记录保留并可显式移入回收站', async () => {
    window.location.hash = `#/character-manager?card=${original.id}`;
    const router = await mount();
    await waitFor(() => container.querySelector('#editor-field-appearance__outfit') !== null);
    await type(container.querySelector<HTMLInputElement>('#editor-field-appearance__outfit')!, '黑裙');
    await click(button('保存到本地库'));
    await waitFor(() => container.textContent?.includes('已另存为一条新记录') === true);
    expect(rows.size).toBe(2);
    const created = [...rows.values()].find((item) => item.id !== original.id)!;
    expect(created.provenance).toEqual({ kind: 'unsigned', execution: 'edited' });
    await waitFor(() => router.state.location.search.card === created.id);

    await click(button('将原记录移入回收站'));
    await waitFor(() => container.textContent?.includes('原记录已移入回收站') === true);
    expect(rows.get(original.id)?.deletedAt).toBeDefined();
  });

  it('粘贴导入命中回收站中的同内容卡时需显式恢复', async () => {
    rows.set(original.id, { ...original, deletedAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' });
    window.location.hash = '#/character-manager';
    const router = await mount();
    await waitFor(() => container.querySelector('textarea') !== null);
    await type(container.querySelector<HTMLTextAreaElement>('textarea')!, JSON.stringify(original.data));
    await click(button('从文本载入'));
    expect(container.textContent).toContain('编辑导入的数据卡');
    // 尚未首次保存的导入草稿可以选择类型。
    expect(container.querySelector('select')).not.toBeNull();
    await click(button('保存到本地库'));
    await waitFor(() => container.textContent?.includes('内容相同的记录在回收站中') === true);
    expect(rows.get(original.id)?.deletedAt).toBeDefined();

    await click(button('从回收站恢复并打开'));
    await waitFor(() => container.textContent?.includes('编辑：星光') === true);
    expect(rows.get(original.id)?.deletedAt).toBeUndefined();
    expect(router.state.location.search).toEqual({ card: original.id });
    expect(container.textContent).toContain('编辑：星光');
  });

  it('非法导入给出原因且不进入编辑', async () => {
    window.location.hash = '#/character-manager';
    await mount();
    await waitFor(() => container.querySelector('textarea') !== null);
    await type(container.querySelector<HTMLTextAreaElement>('textarea')!, '[1, 2]');
    await click(button('从文本载入'));
    expect(container.textContent).toContain('数据卡必须是一个 JSON 对象。');
    expect(container.textContent).not.toContain('编辑导入的数据卡');
  });

  it('粘贴超过 4 MiB 的文本在解析前拒绝且不进入编辑', async () => {
    window.location.hash = '#/character-manager';
    await mount();
    await waitFor(() => container.querySelector('textarea') !== null);
    const oversized = `{"a":"${'x'.repeat(4 * 1024 * 1024)}"}`;
    await type(container.querySelector<HTMLTextAreaElement>('textarea')!, oversized);
    await click(button('从文本载入'));
    expect(container.textContent).toContain('内容超过单张数据卡的大小上限（4 MiB）。');
    expect(container.textContent).not.toContain('编辑导入的数据卡');
  });
});
