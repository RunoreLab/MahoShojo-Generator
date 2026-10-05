import { invoke } from '@tauri-apps/api/core';
import type {
  LocalLibraryArchiveImportPlan,
  LocalLibraryArchiveImportReport,
} from '@mahoshojo/local-library/archive-import';
import type {
  ArchiveExportOutcome,
  ArchiveExportProgress,
  LocalArchiveHost,
} from '@mahoshojo/ui-web/local-archive';

import {
  DESKTOP_LIBRARY_IMPORT_LIMITS,
  IpcLocalCardRepository,
  IpcWebPackageRepository,
  LocalArchiveExportError,
  LocalLibraryArchiveImportError,
  applyDesktopLibraryArchiveImport,
  createArchiveExportSource,
  exportLocalLibraryArchive,
  inspectDesktopLibraryArchive,
  readFileBytes,
} from './index';
import type { RawInvokeFn } from './local-archive-bridge';

/**
 * Desktop 侧的本地库归档 adapter。
 *
 * 它与 Web 侧跑**同一个**共享界面与同一个 `@mahoshojo/local-library` 契约，差异只在这六个方法：
 * 导出走 raw IPC 分块写入 native，导入走 `<input type="file">`。
 *
 * ## 能力面：零新增
 *
 * 导入全程零网络、零新增 native command（`DESK-052`、`ADR-desktop-tauri-v1` 第 7 条）：解析 manifest、
 * 判定冲突、按条目写入都是纯 TypeScript 语义，写入复用既有的 `save_local_card` / `save_web_package`。
 * 文件来自 `<input type="file">` + `File.arrayBuffer()`，是 WebView 标准能力——`readFileBytes` 因此
 * **不接受路径**，它只接受一个 `File`，不给 renderer 任意路径（`DESK-053`）。
 */

/**
 * raw IPC 调用。
 *
 * 直接透传 Tauri 的 `invoke`：它的第二个参数接受 `Uint8Array` 时会走原生 raw 通道，而 JSON 序列化
 * 4 MiB 的块是一次无意义的拷贝，整包则是一场灾难（`DESK-053`）。这里的类型来自桥模块，二者不能互换。
 */
const rawInvoke: RawInvokeFn = (command, body, options) => invoke(command, body as never, options as never);

const PICKER_CANCEL_FALLBACK_DELAY_MS = 250;

/**
 * 打开一个文件选择器并读出选中的字节；用户取消返回 `null`。
 *
 * 与 Web 侧同构，但有一条额外理由：Desktop 窗口里嵌一个 `<input type="file">` 会走 WebView 的原生
 * 文件对话框，因此**不需要**新增 Tauri dialog 权限——那会是一次真实的授权面扩张，而本切片明确不
 * 扩张（`DESK-071b`「不因接 UI 新增通用文件权限」）。
 *
 * 取消 → resolve `null`；读取失败（超限、长度对不上）→ **reject**。混同两者会让用户挑了一个超大文件
 * 却得到一个毫无反应的界面。
 */
const pickArchiveBytes = async (): Promise<Uint8Array | null> => {
  if (typeof document === 'undefined') return null;

  return new Promise<Uint8Array | null>((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip';
    input.style.display = 'none';

    let settled = false;
    const finish = (value: Uint8Array | null): void => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };
    const fail = (cause: unknown): void => {
      if (settled) return;
      settled = true;
      input.remove();
      reject(cause);
    };

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }
      readFileBytes(file).then(finish, fail);
    });

    input.addEventListener('cancel', () => finish(null));
    // WebView2 may restore focus before `change` exposes the chosen file, and some versions do not dispatch
    // `cancel` for Escape. Defer the fallback so the file event can run first; focus alone is not cancellation.
    window.addEventListener(
      'focus',
      () => {
        window.setTimeout(() => {
          if (!settled && input.files?.length === 0) finish(null);
        }, PICKER_CANCEL_FALLBACK_DELAY_MS);
      },
      { once: true },
    );

    document.body.appendChild(input);
    input.click();
  });
};

/**
 * 归档长度上限。
 *
 * 直接复用导入模块的 `DESKTOP_LIBRARY_IMPORT_LIMITS`，而不是在这里写一个 256 MiB 字面量：那个常量
 * 取的是 **OUTPUT** 上限（最终归档文件长度），正是界面与宿主需要的维度；自己再写一份会在将来调整
 * 时变成一个与真实上限不一致的"看起来没问题的"数字。
 */
const DESKTOP_LIBRARY_ARCHIVE_LIMITS = DESKTOP_LIBRARY_IMPORT_LIMITS;

/**
 * 构造 Desktop 侧的共享归档 host。
 *
 * `onProgress` 会被真实调用：导出走 `append_local_archive_export_chunk` 分块写入，每送达一块就上报
 * 已写入字节，因此界面可以呈现确定的进度条。这是 Desktop 与 Web 的实质差别，也正是共享契约把它表达成
 * 可辨识 union 而不是单一形状的原因。
 *
 * ## 成功只认 native 的最终确认
 *
 * `exportLocalLibraryArchive` 逐块核对 native 回报的 `writtenByteLength`，并且只在 `complete` 与
 * 「本地已送完全部字节」一致、最终路径与 `begin` 回显一致时才 resolve。因此这里**不**做任何自己的
 * 成功推断，也不把「已发起导出」当成成功（`DESK-071b`、`D2.3d` 退出门禁）。
 */
export const createDesktopArchiveHost = (): LocalArchiveHost => {
  const cards = new IpcLocalCardRepository((command, args) => invoke(command, args as never));
  const packages = new IpcWebPackageRepository((command, args) => invoke(command, args as never));

  return {
    /**
     * Desktop 的存储可用性。
     *
     * 探一次卡片列表就足够：SQLite 读失败会在第一次查询时抛出，而不是在「没有数据」时静默返回空列表。
     * 刻意不新增一个 `ping` command —— 那是一次真实的 command ACL 扩张，而这里只需要确认既有读路径
     * 可用。
     */
    probeStorage: async () => {
      try {
        await cards.list({ includeDeleted: true, limit: 1 });
        return null;
      } catch (cause) {
        return cause instanceof Error ? cause.message : '本地库读取失败';
      }
    },

    runExport: async (onProgress?: (progress: ArchiveExportProgress) => void): Promise<ArchiveExportOutcome> => {
      const result = await exportLocalLibraryArchive(
        (command, args) => invoke(command, args as never),
        rawInvoke,
        createArchiveExportSource(cards, packages),
        {
          onProgress: (written, total) => onProgress?.({ kind: 'determinate', written, total }),
        },
      );

      return {
        location: result.absolutePath,
        byteLength: result.byteLength,
        entryCount: result.entryCount,
      };
    },

    pickArchiveBytes: pickArchiveBytes,

    inspectArchive: (archive: Uint8Array): Promise<LocalLibraryArchiveImportPlan> =>
      inspectDesktopLibraryArchive({ cards, packages }, archive),

    applyArchive: (
      archive: Uint8Array,
      plan: LocalLibraryArchiveImportPlan,
    ): Promise<LocalLibraryArchiveImportReport> =>
      applyDesktopLibraryArchiveImport({ cards, packages }, archive, plan),

    describeError: (cause: unknown): string => {
      if (cause instanceof LocalArchiveExportError || cause instanceof LocalLibraryArchiveImportError) {
        return cause.message;
      }
      if (cause instanceof Error) return cause.message;
      return '归档操作失败';
    },
  };
};

export { DESKTOP_LIBRARY_ARCHIVE_LIMITS };
