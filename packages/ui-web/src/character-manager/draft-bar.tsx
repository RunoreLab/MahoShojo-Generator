import type { ReactNode } from 'react';

/** 恢复时间来自已读取的草稿，不使用随后自动保存的新时间。 */
export const formatCharacterManagerRestoredDraftMessage = (timestamp: number): string =>
  `已恢复本地草稿（${new Date(timestamp).toLocaleTimeString()}）`;

export interface CharacterManagerDraftBarProps {
  /** 最近一次自动保存的时间戳（epoch ms）；`null` 表示尚无已保存草稿。 */
  readonly savedAt: number | null;
  readonly onClear: () => void;
  /** 尚无已保存草稿时的提示文案（提及存储介质，宿主各自表述）。 */
  readonly pendingText?: ReactNode;
  readonly clearLabel?: ReactNode;
  readonly formatSavedAt?: (timestamp: number) => ReactNode;
}

/**
 * 页面草稿自动保存提示条（amber）。
 * 持久化介质由宿主决定（浏览器 localStorage / WebView 本地存储），共享组件只呈现状态。
 */
export function CharacterManagerDraftBar({
  savedAt,
  onClear,
  pendingText = '当前输入会自动保存到浏览器，刷新后仍可恢复。',
  clearLabel = '清空本地草稿',
  formatSavedAt = (timestamp) => `已自动保存于 ${new Date(timestamp).toLocaleTimeString()}`,
}: CharacterManagerDraftBarProps) {
  return (
    <div className="mb-6 flex flex-col gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-900 sm:flex-row sm:items-center sm:justify-between">
      <span>{savedAt ? formatSavedAt(savedAt) : pendingText}</span>
      <button
        type="button"
        onClick={onClear}
        className="text-left font-semibold text-amber-800 hover:text-amber-950 sm:text-right"
      >
        {clearLabel}
      </button>
    </div>
  );
}
