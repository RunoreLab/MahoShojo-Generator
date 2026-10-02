import {
  applyLocalLibraryArchiveImport,
  inspectLocalLibraryArchive,
  LocalLibraryArchiveImportError,
  type LocalLibraryArchiveImportPlan,
  type LocalLibraryArchiveImportReport,
  type LocalLibraryArchiveImportTarget,
} from '@mahoshojo/local-library/archive-import';
import { MAX_LOCAL_LIBRARY_ARCHIVE_OUTPUT_BYTES } from '@mahoshojo/local-library/archive-pack';

export type {
  LocalLibraryArchiveImportPlan,
  LocalLibraryArchiveImportReport,
  LocalLibraryArchiveImportSummary,
  LocalLibraryArchiveImportSkip,
  LocalLibraryArchiveImportFailure,
} from '@mahoshojo/local-library/archive-import';
export {
  LOCAL_LIBRARY_ARCHIVE_IMPORT_ERROR_CODES,
  LocalLibraryArchiveImportError,
  MAX_LOCAL_LIBRARY_ARCHIVE_MANIFEST_BYTES,
} from '@mahoshojo/local-library/archive-import';

/**
 * Desktop 侧导入 portable archive。
 *
 * ## 能力面：零新增
 *
 * 解析 manifest、判定冲突、按条目写入——全部是纯 TypeScript 语义（`ADR-desktop-tauri-v1` 第 7 条），
 * 因此本模块**不引入任何 native command**。写入走既有的 `save_local_card` / `save_web_package`
 * （`DESK-071b`）。
 *
 * ## 文件从哪来
 *
 * `<input type="file">`——WebView 标准能力，不需要任何权限，也不给 renderer 任意路径。
 * `readFileBytes` 因此**不接受路径**，它只接受一个 `File`。
 */

/**
 * UI 在读取之前能拿到的上限，供它提前判定而不是让用户等一次几分钟的读取。
 *
 * 取 **OUTPUT** 上限而不是 INPUT 上限：被度量的是归档**文件长度**，而 `DESK-070` 把"打包输入总量"
 * 与"最终归档文件长度"定义为两个不同的维度，并明确 `MUST NOT` 互相充当。两者今天同值，因此这是
 * 一处尚未发作的偏差而不是当前的 bug——但导入侧用错维度会让将来任何一次调整都变成"导入比导出
 * 更早拒绝"的静默不一致。
 */
export const DESKTOP_LIBRARY_IMPORT_LIMITS = {
  fileBytes: MAX_LOCAL_LIBRARY_ARCHIVE_OUTPUT_BYTES,
} as const;

/**
 * 把 `<input type="file">` 选中的文件读成字节。
 *
 * 读之前先按 `file.size` 拒绝超限文件：这一层不解压任何东西，因此它能在**分配之前**拒掉一个
 * 明显过大的文件，而共享导入模块里的预算守卫要等到第一条 entry 开始解压才生效。
 *
 * `file.size` 与实际读取长度**都要**核对：WebView 的 `File` 来自不可信输入（拖放、共享、扩展），
 * 而一个谎报长度的文件会让"按长度分配的缓冲区"变成一段截断数据——症状是解包器报 ZIP 损坏。
 */
export const readFileBytes = async (file: File): Promise<Uint8Array> => {
  if (file.size > DESKTOP_LIBRARY_IMPORT_LIMITS.fileBytes) {
    throw new LocalLibraryArchiveImportError(
      'archive-budget-exceeded',
      `文件超过导入上限：${file.size} > ${DESKTOP_LIBRARY_IMPORT_LIMITS.fileBytes} 字节`,
    );
  }
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength !== file.size) {
    throw new LocalLibraryArchiveImportError(
      'archive-malformed',
      `文件实际长度与声明不符：声明 ${file.size}，实际 ${buffer.byteLength}`,
    );
  }
  return new Uint8Array(buffer);
};

/**
 * 第一步：完整预检并给出摘要与冲突条数。**一次写入都没有。**
 *
 * UI MUST 先把这份摘要（格式、版本、导出时间、条目数、已有多少条会被跳过）给用户看，再让用户决定
 * 是否写入（`DESK-052`）。
 *
 * **刻意不接受预算覆盖。** 共享模块留着 `maxTotalBytes` / `maxManifestBytes` / `maxEntries` 是为了
 * 让测试能构造出超限输入；把它们透传到这里就等于把"关掉本模块全部内存安全控制"变成一个普通选项，
 * 而 `AGENTS.md` 明确禁止用 feature flag 或配置绕过 accepted 的 `MUST`。要测超限请直接测共享模块。
 */
export const inspectDesktopLibraryArchive = async (
  target: LocalLibraryArchiveImportTarget,
  archive: Uint8Array,
): Promise<LocalLibraryArchiveImportPlan> => inspectLocalLibraryArchive(target, archive);

/**
 * 第二步：按 plan 写入。
 *
 * 它必须拿到 `inspect` 返回的**那一份** plan：冲突摘要与"写入前展示什么"是在那里定下的。
 * （existing-wins 本身由 apply 按存储的当前状态复核，因此这份 plan 被换到另一个库上也不会覆盖——
 * 见 `applyLocalLibraryArchiveImport` 的注释。）
 */
export const applyDesktopLibraryArchiveImport = async (
  target: LocalLibraryArchiveImportTarget,
  archive: Uint8Array,
  plan: LocalLibraryArchiveImportPlan,
): Promise<LocalLibraryArchiveImportReport> =>
  applyLocalLibraryArchiveImport(target, archive, plan);