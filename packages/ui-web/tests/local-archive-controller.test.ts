import { describe, expect, it, vi } from 'vitest';

import type {
  LocalLibraryArchiveImportPlan,
  LocalLibraryArchiveImportReport,
} from '@mahoshojo/local-library/archive-import';

import { createLocalArchiveController, type LocalArchiveHost } from '../src/local-archive/controller';
import { toArchivePreflightView } from '../src/local-archive/contract';

/**
 * 用最小 fake adapter 驱动共享归档流程。
 *
 * `DESK-PROD-003` 的验收要求就是「用最小 fake adapter 驱动共享页面的可用/不可用/失败状态」。这里不
 * 碰真实存储、不解真实 ZIP，因此可以在毫秒级覆盖那些在真机上很难触发的分支：用户取消选文件、预检
 * 失败、写入失败、以及最容易出错的一种——预检失败后残留上一份 plan。
 */

const plan = (overrides: Partial<LocalLibraryArchiveImportPlan> = {}): LocalLibraryArchiveImportPlan =>
  ({
    summary: {
      format: 'mahoshojo-local-library',
      formatVersion: 2,
      exportedAt: '2026-10-02T00:00:00.000Z',
      cardCount: 3,
      webPackageCount: 2,
      cardSchemaVersion: 1,
      webPackageSchemaVersion: 1,
    },
    manifest: {
      format: 'mahoshojo-local-library',
      formatVersion: 2,
      cardSchemaVersion: 1,
      webPackageSchemaVersion: 1,
      exportedAt: '2026-10-02T00:00:00.000Z',
      cardCount: 3,
      webPackageCount: 2,
      cards: [
        { cardId: 'card-a', path: 'cards/a.json', contentDigest: 'sha256:a', checksum: 'sha256:a', byteLength: 1 },
        { cardId: 'card-b', path: 'cards/b.json', contentDigest: 'sha256:b', checksum: 'sha256:b', byteLength: 1 },
        { cardId: 'card-c', path: 'cards/c.json', contentDigest: 'sha256:c', checksum: 'sha256:c', byteLength: 1 },
      ],
      webPackages: [
        {
          packageId: 'pkg-a',
          path: 'web-packages/a.json',
          contentDigest: 'sha256:a',
          checksum: 'sha256:a',
          byteLength: 1,
          archivePath: 'web-packages/a.zip',
          archiveDigest: 'sha256:a',
        },
        {
          packageId: 'pkg-b',
          path: 'web-packages/b.json',
          contentDigest: 'sha256:b',
          checksum: 'sha256:b',
          byteLength: 1,
          archivePath: 'web-packages/b.zip',
          archiveDigest: 'sha256:b',
        },
      ],
    },
    manifestDigest: 'sha256:manifest',
    existingCardIds: [],
    existingWebPackageIds: [],
    ...overrides,
  }) as LocalLibraryArchiveImportPlan;

const report = (
  overrides: Partial<LocalLibraryArchiveImportReport> = {},
): LocalLibraryArchiveImportReport => ({
  succeededCardIds: ['card-a', 'card-b', 'card-c'],
  succeededWebPackageIds: ['pkg-a', 'pkg-b'],
  skipped: [],
  failed: [],
  ...overrides,
});

const host = (overrides: Partial<LocalArchiveHost> = {}): LocalArchiveHost => ({
  probeStorage: async () => null,
  runExport: async () => ({ location: 'archive.zip', byteLength: 1024, entryCount: 5 }),
  pickArchiveBytes: async () => new Uint8Array([1, 2, 3]),
  inspectArchive: async () => plan(),
  applyArchive: async () => report(),
  describeError: (cause) => (cause instanceof Error ? cause.message : String(cause)),
  ...overrides,
});

const controllerFor = (overrides: Partial<LocalArchiveHost> = {}) =>
  createLocalArchiveController(host(overrides));

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

describe('preflight projection', () => {
  it('counts skipped entries as the intersection with this archive, not the whole local library', () => {
    // existingCardIds 是本机**全部**已有 id，其中多数与这份归档无关。直接拿它的长度当跳过数，
    // 会让「将跳过 N 条」与随后的实际报告对不上，而用户正是靠这个数字决定要不要导入。
    const view = toArchivePreflightView(
      plan({
        existingCardIds: ['card-a', 'card-z', 'unrelated-1', 'unrelated-2'],
        existingWebPackageIds: ['pkg-b'],
      }),
    );

    expect(view.skippedCardCount).toBe(1);
    expect(view.skippedWebPackageCount).toBe(1);
    expect(view.willWriteCardCount).toBe(2);
    expect(view.willWriteWebPackageCount).toBe(1);
  });

  it('never reports a negative write count', () => {
    const view = toArchivePreflightView(
      plan({ existingCardIds: ['card-a', 'card-b', 'card-c', 'extra-1', 'extra-2'] }),
    );

    expect(view.skippedCardCount).toBe(3);
    expect(view.willWriteCardCount).toBe(0);
  });

  it('carries format, version and export time through to the view', () => {
    const view = toArchivePreflightView(plan());

    expect(view.format).toBe('mahoshojo-local-library');
    expect(view.formatVersion).toBe(2);
    expect(view.exportedAt).toBe('2026-10-02T00:00:00.000Z');
  });
});

describe('export flow', () => {
  it('reports indeterminate progress when the host offers no progress callback', async () => {
    // Web 侧的打包是同步 zipSync，没有任何中间进度可报。此时必须显示"不确定"而不是编一个百分比。
    const controller = controllerFor();
    controller.actions.startExport();
    expect(controller.model.exportProgress).toEqual({ kind: 'indeterminate' });

    await settle();
    expect(controller.model.exportProgress).toBeNull();
    expect(controller.model.lastExport).toEqual({ location: 'archive.zip', byteLength: 1024, entryCount: 5 });
  });

  it('surfaces real byte progress when the host provides it', async () => {
    const controller = controllerFor({
      runExport: async (onProgress) => {
        onProgress?.({ kind: 'determinate', written: 512, total: 1024 });
        return { location: 'archive.zip', byteLength: 1024, entryCount: 5 };
      },
    });

    const seen: unknown[] = [];
    controller.subscribe(() => seen.push(controller.model.exportProgress));
    controller.actions.startExport();
    await settle();

    expect(seen).toContainEqual({ kind: 'determinate', written: 512, total: 1024 });
    expect(controller.model.lastExport).not.toBeNull();
  });

  it('does not claim success when the host reports failure', async () => {
    const controller = controllerFor({
      runExport: async () => {
        throw new Error('导出被取消');
      },
    });

    controller.actions.startExport();
    await settle();

    expect(controller.model.lastExport).toBeNull();
    expect(controller.model.exportError).toBe('导出被取消');
    expect(controller.model.exporting).toBe(false);
  });

  it('surfaces an indeterminate phase even when the host reports determinate progress', async () => {
    // 导出开始时先进入不确定态，宿主报告第一段真实字节后才变成确定态。这样"已启动但还没有任何
    // 进度可报"与"完全没启动"在界面上可区分。
    const controller = controllerFor({
      runExport: async (onProgress) => {
        expect(controller.model.exportProgress).toEqual({ kind: 'indeterminate' });
        onProgress?.({ kind: 'determinate', written: 1024, total: 1024 });
        return { location: 'archive.zip', byteLength: 1024, entryCount: 5 };
      },
    });

    controller.actions.startExport();
    await settle();
    expect(controller.model.exportError).toBeNull();
  });
});

describe('import flow', () => {
  it('treats a cancelled file picker as not-an-error', async () => {
    const controller = controllerFor({ pickArchiveBytes: async () => null });

    controller.actions.pickImportFile();
    await settle();

    expect(controller.model.inspecting).toBe(false);
    expect(controller.model.importError).toBeNull();
    expect(controller.model.plan).toBeNull();
  });

  it('requires a preflight result before any write can happen', async () => {
    // DESK-052：先展示摘要、版本、条目数与冲突策略，再让用户决定是否写入。
    const applyArchive = vi.fn(async () => report());
    const controller = controllerFor({ applyArchive });

    controller.actions.confirmImport();
    await settle();

    expect(applyArchive).not.toHaveBeenCalled();
    expect(controller.model.report).toBeNull();
  });

  it('writes only after a preflight, using the bytes that preflight inspected', async () => {
    const bytes = new Uint8Array([9, 9, 9]);
    const inspectedPlan = plan();
    const applyArchive = vi.fn(
      async (_archive: Uint8Array, _plan: LocalLibraryArchiveImportPlan) => report(),
    );
    const controller = controllerFor({
      pickArchiveBytes: async () => bytes,
      inspectArchive: async () => inspectedPlan,
      applyArchive,
    });

    controller.actions.pickImportFile();
    await settle();
    expect(controller.model.plan).toBe(inspectedPlan);

    controller.actions.confirmImport();
    await settle();

    // 断言传下去的正是被预检的那份字节与那份 plan。"预检 A、按 B 写入"会让摘要与结果脱钩，
    // 而用户正是靠摘要决定是否导入。
    expect(applyArchive).toHaveBeenCalledTimes(1);
    expect(applyArchive.mock.calls[0]?.[0]).toBe(bytes);
    expect(applyArchive.mock.calls[0]?.[1]).toBe(inspectedPlan);
    expect(controller.model.report).not.toBeNull();
  });

  it('clears a stale preflight when a later preflight fails', async () => {
    // 这是本模块最容易出的错：预检失败后若留着上一份 plan，用户点"确认导入"会按一份与当前文件
    // 无关的预检结果写入。
    let attempt = 0;
    const controller = controllerFor({
      inspectArchive: async () => {
        attempt += 1;
        if (attempt === 1) return plan();
        throw new Error('归档已损坏');
      },
    });

    controller.actions.pickImportFile();
    await settle();
    expect(controller.model.plan).not.toBeNull();

    controller.actions.pickImportFile();
    await settle();

    expect(controller.model.plan).toBeNull();
    expect(controller.model.importError).toBe('归档已损坏');
  });

  it('will not write after a failed preflight even if confirm is called', async () => {
    const applyArchive = vi.fn(async () => report());
    const controller = controllerFor({
      inspectArchive: async () => {
        throw new Error('归档已损坏');
      },
      applyArchive,
    });

    controller.actions.pickImportFile();
    await settle();
    controller.actions.confirmImport();
    await settle();

    expect(applyArchive).not.toHaveBeenCalled();
    expect(controller.model.report).toBeNull();
  });

  it('reports a write failure without discarding the preflight the user already approved', async () => {
    // 写入失败后 plan 必须留着：用户看到失败后最合理的行为是重试，而不是重新选一遍文件。
    const controller = controllerFor({
      applyArchive: async () => {
        throw new Error('存储写入失败');
      },
    });

    controller.actions.pickImportFile();
    await settle();
    controller.actions.confirmImport();
    await settle();

    expect(controller.model.importError).toBe('存储写入失败');
    expect(controller.model.plan).not.toBeNull();
    expect(controller.model.applying).toBe(false);
  });

  it('cancels cleanly and allows a second file to be picked', async () => {
    const controller = controllerFor();

    controller.actions.pickImportFile();
    await settle();
    expect(controller.model.plan).not.toBeNull();

    controller.actions.cancelImport();
    expect(controller.model.plan).toBeNull();
    expect(controller.model.report).toBeNull();

    controller.actions.pickImportFile();
    await settle();
    expect(controller.model.plan).not.toBeNull();
  });

  it('surfaces skipped and failed counts from the report', async () => {
    const controller = controllerFor({
      applyArchive: async () =>
        report({
          succeededCardIds: ['card-a'],
          succeededWebPackageIds: [],
          skipped: [
            { kind: 'card', id: 'card-b', reason: 'already-present' },
            { kind: 'card', id: 'card-c', reason: 'already-present' },
          ],
          failed: [{ kind: 'web-package', id: 'pkg-b', reason: 'ZIP 字节与清单不符' }],
        }),
    });

    controller.actions.pickImportFile();
    await settle();
    controller.actions.confirmImport();
    await settle();

    const result = controller.model.report;
    expect(result?.skipped).toHaveLength(2);
    expect(result?.failed).toHaveLength(1);
    expect(result?.failed[0]?.reason).toBe('ZIP 字节与清单不符');
  });
});

describe('archive operation serialization', () => {
  it.each(['export', 'inspect', 'apply'] as const)(
    'blocks competing actions and reset during %s, then releases the operation',
    async (operation) => {
      let release!: () => void;
      const pending = new Promise<void>((resolve) => { release = resolve; });
      const runExport = vi.fn(async () => {
        if (operation === 'export') await pending;
        return { location: 'archive.zip', byteLength: 1024, entryCount: 5 };
      });
      const inspectArchive = vi.fn(async () => plan());
      const applyArchive = vi.fn(async () => {
        if (operation === 'apply') await pending;
        return report();
      });
      const pickArchiveBytes = vi.fn(async () => new Uint8Array([1, 2, 3]));
      const controller = controllerFor({ runExport, inspectArchive, applyArchive, pickArchiveBytes });

      // 留一份旧预检，确认新预检尚未结束时不能用旧 plan 写入。
      controller.actions.pickImportFile();
      await settle();
      if (operation === 'inspect') {
        inspectArchive.mockImplementationOnce(async () => { await pending; return plan(); });
        controller.actions.pickImportFile();
      } else if (operation === 'apply') {
        controller.actions.confirmImport();
      } else {
        controller.actions.startExport();
      }
      await settle();

      const before = controller.model;
      const calls = [runExport.mock.calls.length, pickArchiveBytes.mock.calls.length, applyArchive.mock.calls.length];
      controller.actions.startExport();
      controller.actions.pickImportFile();
      controller.actions.confirmImport();
      controller.actions.cancelImport();
      controller.actions.reset();
      await settle();
      expect(controller.model).toBe(before);
      expect([runExport.mock.calls.length, pickArchiveBytes.mock.calls.length, applyArchive.mock.calls.length]).toEqual(calls);

      release();
      await settle();
      expect(controller.model.exporting || controller.model.inspecting || controller.model.applying).toBe(false);
      controller.actions.reset();
      expect(controller.model.plan).toBeNull();
      controller.actions.pickImportFile();
      await settle();
      expect(controller.model.plan).not.toBeNull();
    },
  );
});

describe('storage availability', () => {
  it('keeps storage failure distinct from an empty library', async () => {
    // DESK-PROD-003：MUST NOT 把「本地存储不可用」显示成「没有数据」。
    const controller = controllerFor({ probeStorage: async () => 'IndexedDB 被浏览器拒绝' });

    controller.actions.probeStorage();
    await settle();

    expect(controller.model.storageError).toBe('IndexedDB 被浏览器拒绝');
    // 关键：这不是"空库"，因此 lastExport/plan 都还是 null，界面必须走 storageError 分支。
    expect(controller.model.lastExport).toBeNull();
  });

  it('treats a thrown probe as a storage failure rather than success', async () => {
    const controller = controllerFor({
      probeStorage: async () => {
        throw new Error('数据库初始化失败');
      },
    });

    controller.actions.probeStorage();
    await settle();

    expect(controller.model.storageError).toBe('数据库初始化失败');
  });
});
