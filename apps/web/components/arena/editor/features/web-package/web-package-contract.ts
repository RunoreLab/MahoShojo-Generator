/**
 * 共享 Web 包选择区块的 UI contract。
 *
 * 状态容器（单人 battle store / proposal editor session）由各自 adapter 持有；
 * 共享视图只消费归一化 model，不 import store、Room controller 或网络 client。
 *
 * 「本地库」与「内置预设」是两个并列来源，不再像旧实现那样压进同一个网格：
 * 前者可删可导出，后者随应用分发、不可删。
 */

import type { WebPackageRef } from '@mahoshojo/contracts/web-package';

export type ArenaWebPackageOptionView = Readonly<{
  digest: string;
  title: string;
  kind: 'builtin' | 'local' | 'unknown';
  ref: WebPackageRef | null;
  /** 来源身份行，通常是 `id@version`。 */
  summary?: string | null;
  /** 本地库条目：ZIP 字节数。 */
  byteLength?: number | null;
  /** 本地库条目：记录与字节不一致、已无法恢复。 */
  broken?: boolean;
  /**
   * 只存在于本次会话 staging、尚未写入本地库。
   * 导入默认不落盘，若这类包不可选，用户刚导入完就会看到"不可用的 Web 包"。
   */
  sessionOnly?: boolean;
}>;

export type ArenaWebPackageSectionCapabilities = Readonly<{
  /** 本地 ZIP 导入：仅单人 source；多人不得展示为可发布共享配置。 */
  importLocal: boolean;
  /** 预设 ZIP 下载；与选择卡片分离，避免误触。 */
  downloadPreset: boolean;
  /** 当前选择的移除（回到自由 Web）。 */
  remove: boolean;
  /** 更换当前包（打开选择列表）。 */
  replace: boolean;
  /** 本地库管理（删除/导出）。多人模式下不存在，因此为 false。 */
  manageLibrary: boolean;
}>;

export type ArenaWebPackageImportFeedback = Readonly<{
  /** What went wrong, in the user's terms. */
  message: string;
  /** What to change; empty when the failure has no actionable remedy. */
  hint: string;
  /** Normalization and defaults applied during a successful import. */
  diagnostics: readonly string[];
}>;

export type ArenaWebPackageSectionModel = Readonly<{
  disabled: boolean;
  /** reportFormat === 'web' 时才展示选择器细节；markdown 时保持简洁。 */
  active: boolean;
  selected: ArenaWebPackageOptionView | null;
  /** 内置预设；始终可下载，不可删除。 */
  presets: readonly ArenaWebPackageOptionView[];
  /** 本地库条目；可删除、可导出。 */
  library: readonly ArenaWebPackageOptionView[];
  importFeedback: ArenaWebPackageImportFeedback | null;
  /** 导出 ZIP 失败。与 `libraryError` 分开：一个是动作失败，一个是根本读不到列表。 */
  downloadError: string | null;
  /**
   * 本地库列表或完整性探测读取失败。
   *
   * 必须与"本地库是空的"区分开：读失败时若仍提示"还没有本地 Web 包"，用户会以为
   * 自己存的包被删了，从而重复导入或清站点数据。
   */
  libraryError: string | null;
  importing: boolean;
  /** 正在导出 ZIP 的条目 digest；null 表示空闲。 */
  downloadingDigest: string | null;
  /** 正在执行删除/导出的条目 digest。 */
  busyDigest: string | null;
  /** 「导入时保存到本地库」偏好。 */
  saveImportedToLibrary: boolean;
  capabilities: ArenaWebPackageSectionCapabilities;
  actions: Readonly<{
    select(digest: string | null): void;
    /** 只取消当前选择，不动本地库。 */
    remove(): void;
    downloadPreset(digest: string): Promise<void>;
    downloadFromLibrary(digest: string): Promise<void>;
    importFile(file: File | null | undefined): Promise<void>;
    /**
     * Promise 在失败时也必须 resolve：失败原因写入 `importFeedback`，由对话框保持打开。
     * 用 reject 表达失败会让 `void ...then(...)` 变成未处理的 rejection，用户什么都看不到。
     */
    removeFromLibrary(digest: string): Promise<void>;
    setSaveImportedToLibrary(next: boolean): void;
  }>;
}>;
