import type { ReactNode } from 'react';
import type { WebPackageRef } from '@mahoshojo/contracts/web-package';
import type { ArenaWebPackageOptionView } from './web-package-contract';

export type WebPackageSavePreferenceProps = Readonly<{
  checked: boolean;
  disabled?: boolean;
  onChange(next: boolean): void;
}>;

const DEFAULT_COPY = {
  inactiveMessage: '当前为 Markdown 战报；切换到 Web 后可选择预设或导入本地 Web 包。',
  sessionOrigin: '仅本次页面暂存（未写入本地库，离开后需重新导入）',
  sessionNote: '仅本次页面暂存；离开后需要重新导入。',
  libraryNote: '来自本机本地库；可导出备份或重新导入。',
  libraryReadErrorHint: '这不代表已保存的 Web 包被删除；请重试，仍失败时检查本机存储状态。',
  emptyImportHint: '导入本地 ZIP 即可使用。默认仅在当前页面暂存，勾选「导入时保存到本地库」后才会写入本机本地库。',
  importNote: 'ZIP 在本机解析；导入与选择不会执行包脚本，也不会向服务器上传完整包。',
};

/** Host owns IO, risk scanning, storage preferences and navigation. Missing slots never grant a capability. */
export type ArenaWebPackageViewHost = Readonly<{
  copy?: Partial<typeof DEFAULT_COPY>;
  renderRisk?(ref: WebPackageRef): ReactNode;
  renderHelpLink?(label: string): ReactNode;
  libraryStatus?: ReactNode;
  renderSavePreference?(props: WebPackageSavePreferenceProps): ReactNode;
  describeRemoval?(target: ArenaWebPackageOptionView): readonly string[];
}>;

export function resolveWebPackageViewHost(host: ArenaWebPackageViewHost = {}) {
  return {
    ...host,
    copy: { ...DEFAULT_COPY, ...host.copy },
    describeRemoval: host.describeRemoval ?? ((target: ArenaWebPackageOptionView) => [
      `「${target.title}」将从本地库的可用包中移除；此操作与移除当前选择不同。`,
      '历史战报正文保留，但引用这份包的结果可能无法原样重放。可先导出 ZIP 备份。',
    ]),
  };
}

/** A controlled current-page choice by default. Persistence, if any, belongs to the host. */
export function WebPackageSavePreference({ checked, onChange, disabled }: WebPackageSavePreferenceProps) {
  return <div className="mt-2">
    <label className="flex min-h-11 items-start gap-2 text-sm text-gray-700 dark:text-gray-200">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="mt-1 h-4 w-4 shrink-0" />
      <span>导入时保存到本地库<span className="block text-xs text-gray-500">仅控制当前页面接下来导入的包；未勾选时只暂存，不写入本地库。</span></span>
    </label>
  </div>;
}
