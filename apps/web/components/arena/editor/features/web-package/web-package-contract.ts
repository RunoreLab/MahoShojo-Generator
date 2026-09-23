/**
 * 共享 Web 包选择区块的 UI contract。
 * 状态容器（单人 battle store / proposal editor session）由各自 adapter 持有；
 * 共享视图只消费归一化 model，不 import store、Room controller 或网络 client。
 */

import type { WebPackageRef } from '@mahoshojo/contracts/web-package';

export type ArenaWebPackageOptionView = Readonly<{
  digest: string;
  title: string;
  kind: 'builtin' | 'local' | 'unknown';
  ref: WebPackageRef | null;
  /** 本地包摘要行用；builtin 可为空。 */
  summary?: string | null;
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
}>;

export type ArenaWebPackageSectionModel = Readonly<{
  disabled: boolean;
  /** reportFormat === 'web' 时才展示选择器细节；markdown 时保持简洁。 */
  active: boolean;
  selected: ArenaWebPackageOptionView | null;
  options: readonly ArenaWebPackageOptionView[];
  /** 已加载本地包摘要（含 staging 水合结果）。 */
  localSummary: string | null;
  importError: string | null;
  downloadError: string | null;
  importing: boolean;
  downloading: boolean;
  capabilities: ArenaWebPackageSectionCapabilities;
  actions: Readonly<{
    select(digest: string | null): void;
    remove(): void;
    downloadPreset(digest: string): Promise<void>;
    importFile(file: File | null | undefined): Promise<void>;
  }>;
}>;
