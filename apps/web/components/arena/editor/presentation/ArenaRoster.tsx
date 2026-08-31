'use client';

import type { ReactNode } from 'react';

export type ArenaRosterItemView = {
  key: string;
  displayName: string;
  typeLabel: string;
  guidance?: string;
  teamLabel?: string;
  tags?: ReactNode;
};

export type ArenaRosterCapabilities = {
  reorder?: boolean;
  guidance?: boolean;
  details?: boolean;
  download?: boolean;
  copy?: boolean;
  remove?: boolean;
  ranking?: boolean;
};

type ArenaRosterRowProps = {
  item: ArenaRosterItemView;
  index: number;
  total: number;
  disabled?: boolean;
  capabilities?: ArenaRosterCapabilities;
  guidanceExpanded?: boolean;
  copied?: boolean;
  rankingBadge?: ReactNode;
  ranking?: ReactNode;
  onMove?: (fromIndex: number, toIndex: number) => void;
  onToggleGuidance?: () => void;
  onGuidanceChange?: (value: string) => void;
  onShowDetails?: () => void;
  onDownload?: () => void;
  onCopy?: () => void;
  onRemove?: () => void;
};

/**
 * Safe roster row。组件只认识展示 view model；详情、下载、复制和排名均需显式 capability，
 * 因此 room stub 即使误传 callback/slot 也不会暴露敏感入口。
 */
export function ArenaRosterRow({
  item,
  index,
  total,
  disabled = false,
  capabilities = {},
  guidanceExpanded = false,
  copied = false,
  rankingBadge,
  ranking,
  onMove,
  onToggleGuidance,
  onGuidanceChange,
  onShowDetails,
  onDownload,
  onCopy,
  onRemove,
}: ArenaRosterRowProps) {
  const guidanceValue = item.guidance ?? '';
  const canMove = capabilities.reorder ? onMove : undefined;
  const toggleGuidance = capabilities.guidance ? onToggleGuidance : undefined;
  const updateGuidance = capabilities.guidance ? onGuidanceChange : undefined;

  return (
    <div className="group rounded-lg bg-white/70 border border-gray-300 px-2 py-2">
      <div className="flex items-start gap-2">
        {capabilities.reorder ? (
          <div className="flex flex-col gap-1 pt-0.5">
            <button
              type="button"
              onClick={() => canMove?.(index, index - 1)}
              disabled={disabled || !canMove || index === 0}
              className="w-6 h-6 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label={`上移 ${item.displayName}`}
              title="上移"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => canMove?.(index, index + 1)}
              disabled={disabled || !canMove || index === total - 1}
              className="w-6 h-6 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label={`下移 ${item.displayName}`}
              title="下移"
            >
              ↓
            </button>
          </div>
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex flex-col sm:flex-row sm:items-start sm:gap-2">
            <div className="min-w-0 flex-1">
              <div
                className="text-sm font-medium text-gray-800 leading-snug break-words line-clamp-3"
                title={item.displayName}
              >
                {item.displayName}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                <span className="whitespace-nowrap">({item.typeLabel})</span>
                {item.teamLabel ? <span className="whitespace-nowrap">队伍：{item.teamLabel}</span> : null}
                {item.tags}
                {capabilities.ranking && rankingBadge ? (
                  <span data-sensitive-roster-metadata>{rankingBadge}</span>
                ) : null}
              </div>
            </div>

            <div className="mt-2 sm:mt-0 flex flex-wrap items-center justify-end gap-2 w-full sm:w-auto">
              {capabilities.guidance && onToggleGuidance ? (
                <button
                  type="button"
                  onClick={onToggleGuidance}
                  className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200"
                  disabled={disabled}
                  title="为该角色输入行动/想法引导（最多100字）"
                >
                  行动
                </button>
              ) : null}
              {capabilities.details && onShowDetails ? (
                <button
                  type="button"
                  onClick={onShowDetails}
                  className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded hover:bg-gray-300"
                  disabled={disabled}
                >
                  详情
                </button>
              ) : null}
              {capabilities.download && onDownload ? (
                <button
                  type="button"
                  onClick={onDownload}
                  disabled={disabled}
                  className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200"
                >
                  下载
                </button>
              ) : null}
              {capabilities.copy && onCopy ? (
                <button
                  type="button"
                  onClick={onCopy}
                  disabled={disabled}
                  className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded hover:bg-green-200 w-16"
                >
                  {copied ? '已复制!' : '复制'}
                </button>
              ) : null}
              {capabilities.remove && onRemove ? (
                <button
                  type="button"
                  onClick={onRemove}
                  className={`w-5 h-5 bg-red-200 text-red-700 rounded-full flex items-center justify-center text-xs font-bold transition-colors flex-shrink-0 ${
                    disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-red-300'
                  }`}
                  aria-label={`移除 ${item.displayName}`}
                  disabled={disabled}
                >
                  X
                </button>
              ) : null}
            </div>
          </div>

          {!guidanceExpanded && guidanceValue.trim() ? (
            <div className="mt-1 text-xs text-gray-500 italic break-words">
              行动引导：{guidanceValue.trim()}
            </div>
          ) : null}

          {capabilities.ranking && ranking ? (
            <div data-sensitive-roster-metadata className="mt-1 text-xs text-gray-600">
              {ranking}
            </div>
          ) : null}
        </div>
      </div>

      {guidanceExpanded && toggleGuidance && updateGuidance ? (
        <div className="mt-2 ml-8 p-2 rounded bg-white/70 border border-gray-300">
          <label className="text-xs text-gray-700 mb-1 block" htmlFor={`arena-roster-guidance-${item.key}`}>
            角色行动引导（可选，最多100字）
          </label>
          <textarea
            id={`arena-roster-guidance-${item.key}`}
            className="w-full text-xs border border-gray-300 rounded px-2 py-1 bg-white disabled:opacity-50"
            rows={3}
            maxLength={100}
            disabled={disabled}
            placeholder="例如：谨慎试探、优先保护同伴、尽量不杀、被恐惧支配、隐藏身份等"
            value={guidanceValue}
            onChange={(event) => updateGuidance(event.target.value)}
          />
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
            <span>{Array.from(guidanceValue).length}/100</span>
            <div className="flex items-center gap-2">
              {guidanceValue.trim() ? (
                <button
                  type="button"
                  className="px-2 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50"
                  onClick={() => updateGuidance('')}
                  disabled={disabled}
                >
                  清空
                </button>
              ) : null}
              <button
                type="button"
                className="px-2 py-1 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50"
                onClick={toggleGuidance}
                disabled={disabled}
              >
                收起
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type ArenaRosterListProps<T extends ArenaRosterItemView> = {
  items: readonly T[];
  renderItem: (item: T, index: number) => ReactNode;
  className?: string;
  emptyLabel?: string;
};

export function ArenaRosterList<T extends ArenaRosterItemView>({
  items,
  renderItem,
  className = 'space-y-2',
  emptyLabel,
}: ArenaRosterListProps<T>) {
  if (items.length === 0 && emptyLabel) {
    return <div className="text-xs text-gray-500 px-1 py-2">{emptyLabel}</div>;
  }

  return <div className={className}>{items.map(renderItem)}</div>;
}
