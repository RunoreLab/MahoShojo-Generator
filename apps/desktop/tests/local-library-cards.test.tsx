// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import { serializeLocalLibraryRecord } from '@mahoshojo/local-library/archive-export';

import backupFixture from '../../../fixtures/desktop-backup.json';
import {
  EXIT_AFTER_LOCAL_RESTORE_COMMAND,
  LIST_LOCAL_BACKUPS_COMMAND,
  PREPARE_LOCAL_RESTORE_COMMAND,
} from '../src/platform/local-backup-bridge';
import {
  DELETE_LOCAL_CARD_COMMAND,
  GET_LOCAL_CARD_COMMAND,
  LIST_LOCAL_CARDS_COMMAND,
  PURGE_LOCAL_CARD_COMMAND,
} from '../src/platform/local-card-bridge';
import { createDesktopRouter } from '../src/app/router';

const native = vi.hoisted(() => ({ listen: vi.fn() }));
const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
const host = vi.hoisted(() => ({
  probeStorage: vi.fn(async () => null),
  runExport: vi.fn(),
  pickArchiveBytes: vi.fn(),
  inspectArchive: vi.fn(),
  applyArchive: vi.fn(),
  describeError: () => '归档失败',
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: bridge.invoke }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: native.listen }) }));
vi.mock('../src/platform/desktop-archive-host', () => ({
  createDesktopArchiveHost: () => host,
  DESKTOP_LIBRARY_ARCHIVE_LIMITS: { fileBytes: 1024 },
}));

const card = (id: string, overrides: Partial<LocalCardRecordV1> = {}): LocalCardRecordV1 => ({
  id,
  schemaVersion: 1,
  storageLocation: 'local',
  cardType: 'character',
  title: `本机角色 ${id}`,
  data: { codename: id },
  contentDigest: `sha256:${id.padEnd(16, 'x')}`,
  provenance: { kind: 'unsigned', execution: 'direct-local' },
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

let rows: Map<string, LocalCardRecordV1>;
let root: Root;
let container: HTMLDivElement;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label) as HTMLButtonElement | undefined;
const click = (target: Element | undefined) => act(async () => {
  target!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  rows = new Map([['lc_a', card('lc_a')]]);
  bridge.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === LIST_LOCAL_BACKUPS_COMMAND) return { backups: [], invalidCount: 0 };
    if (command === LIST_LOCAL_CARDS_COMMAND) {
      const includeDeleted = (args?.request as { includeDeleted: boolean }).includeDeleted;
      return {
        documents: [...rows.values()]
          .filter((item) => includeDeleted || item.deletedAt === undefined)
          .map(serializeLocalLibraryRecord),
      };
    }
    if (command === GET_LOCAL_CARD_COMMAND) {
      const found = rows.get(args?.id as string);
      return found === undefined ? null : serializeLocalLibraryRecord(found);
    }
    if (command === DELETE_LOCAL_CARD_COMMAND) {
      const document = JSON.parse((args?.request as { document: string }).document) as LocalCardRecordV1;
      rows.set(document.id, document);
      return { id: document.id };
    }
    if (command === PURGE_LOCAL_CARD_COMMAND) {
      rows.delete(args?.id as string);
      return undefined;
    }
    return undefined;
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  window.location.hash = '#/local-library';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  native.listen.mockImplementation(async () => vi.fn());
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const mount = async () => {
  const router = createDesktopRouter();
  await router.load();
  await act(async () => { root.render(<RouterProvider router={router} />); });
  await settle();
  return router;
};

describe('Desktop 本地库数据卡列表与回收站（IPC mock，仍需真机重启验收）', () => {
  it('未登录读取本机记录，软删进入回收站后可彻底删除', async () => {
    await mount();
    expect(container.textContent).toContain('本机角色 lc_a');
    expect(container.textContent).toContain('无签名 · 本机模型生成');

    await click(button('移入回收站…'));
    await click(button('确认移入回收站'));
    await settle();
    expect(rows.get('lc_a')?.deletedAt).toBeDefined();
    expect(container.textContent).toContain('已移入回收站');

    await click(container.querySelector('[data-testid="local-cards-view-recycle"]')!);
    await settle();
    expect(container.textContent).toContain('本机角色 lc_a');
    await click(button('彻底删除…'));
    await click(button('确认彻底删除'));
    await settle();
    expect(bridge.invoke).toHaveBeenCalledWith(PURGE_LOCAL_CARD_COMMAND, { id: 'lc_a' });
    expect(rows.has('lc_a')).toBe(false);
    expect(container.textContent).toContain('回收站是空的');
  });

  it('归档导出进行中锁定数据卡写入，完成后解除', async () => {
    let finish!: (value: unknown) => void;
    host.runExport.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await mount();
    expect(button('移入回收站…')?.disabled).toBe(false);
    await click(button('导出整库'));
    expect(button('移入回收站…')?.disabled).toBe(true);
    await act(async () => { finish({ location: 'archive.zip', byteLength: 1, entryCount: 1 }); });
    await settle();
    expect(button('移入回收站…')?.disabled).toBe(false);
  });

  it('维护窗口内的写入显示可重试提示，不当作数据损坏', async () => {
    await mount();
    bridge.invoke.mockImplementationOnce(async () => serializeLocalLibraryRecord(rows.get('lc_a')!))
      .mockImplementationOnce(async () => { throw { code: 'maintenance-busy', message: 'busy' }; });
    await click(button('移入回收站…'));
    await click(button('确认移入回收站'));
    await settle();
    expect(container.querySelector('[data-testid="local-cards-action-error"]')?.textContent)
      .toBe('本地库正在维护，请稍后重试。');
    expect(container.textContent).toContain('本机角色 lc_a');
  });

  it('整体恢复挂起后回收站与软删入口保持锁定', async () => {
    const base = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === LIST_LOCAL_BACKUPS_COMMAND) return { backups: [backupFixture.summary], invalidCount: 0 };
      if (command === PREPARE_LOCAL_RESTORE_COMMAND) {
        return { restoreId: 'restore-1', backupId: backupFixture.summary.backupId, preRestoreBackupId: 'pre-1' };
      }
      if (command === EXIT_AFTER_LOCAL_RESTORE_COMMAND) throw { code: 'restore-failed', message: 'native detail' };
      return base(command, args);
    });
    await mount();
    expect(button('移入回收站…')?.disabled).toBe(false);
    await click([...container.querySelectorAll('button')].find((item) => item.textContent?.includes('使用此备份整体替换本地库')));
    await click(button('确认整体替换并退出'));
    await settle();
    expect(container.textContent).toContain('本地库已锁定');
    expect(button('移入回收站…')?.disabled).toBe(true);
  });

  it('归档导入完成后重读列表', async () => {
    host.pickArchiveBytes.mockResolvedValue(new Uint8Array([1]));
    host.inspectArchive.mockResolvedValue({
      summary: { format: 'mahoshojo-local-library', formatVersion: 2, exportedAt: '2026-10-02T00:00:00.000Z', cardCount: 1, webPackageCount: 0, cardSchemaVersion: 1, webPackageSchemaVersion: 1 },
      manifest: { cards: [], webPackages: [] },
      existingCardIds: [],
      existingWebPackageIds: [],
    });
    host.applyArchive.mockImplementation(async () => {
      rows.set('lc_b', card('lc_b'));
      return { succeededCardIds: ['lc_b'], succeededWebPackageIds: [], skipped: [], failed: [] };
    });
    await mount();
    await click(button('选择归档文件'));
    await settle();
    await click(button('确认导入'));
    await settle();
    expect(container.textContent).toContain('本机角色 lc_b');
  });
});
