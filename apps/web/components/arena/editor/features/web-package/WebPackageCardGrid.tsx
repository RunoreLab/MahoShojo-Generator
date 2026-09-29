'use client';

import { Download, HardDrive, Info, Package, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

/**
 * Web 包卡片网格。
 *
 * 与 `DataCard` 保持同一套动作语法：本地来源的卡片不出现"点赞/收藏/分享"这类线上语义，
 * 只给删除/下载/详情；内置预设不出现删除（删除会破坏 digest 固定的注册表）。
 */

export type WebPackageCardItem = Readonly<{
  /** 稳定键：包的 canonical digest。 */
  digest: string;
  title: string;
  /** 来源身份行，通常是 `id@version`。 */
  summary: string;
  source: 'builtin' | 'local';
  /** 记录与 archive 字节不一致、已无法恢复时为 true。 */
  broken?: boolean;
  /** 只在本次会话可用：刷新后需要重新导入。 */
  sessionOnly?: boolean;
}>;

const CARDS_PER_PAGE = 6;

interface CardActionProps {
  label: string;
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

const CardAction = ({ label, title, disabled, onClick, children }: CardActionProps) => (
  <button
    type="button"
    disabled={disabled}
    onClick={(event) => { event.stopPropagation(); onClick(); }}
    title={title}
    aria-label={title}
    className={`inline-flex h-8 w-8 items-center justify-center rounded-full border bg-white/90 shadow-sm transition-colors after:absolute after:-inset-1 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-pink-500 disabled:cursor-not-allowed ${
      disabled ? 'border-gray-200 text-gray-300' : 'border-gray-200 text-gray-600 hover:border-pink-400 hover:text-pink-600'
    }`}
  >
    {children}
    <span className="sr-only">{label}</span>
  </button>
);

export function WebPackageCardGrid({
  items,
  selectedDigest,
  disabled,
  emptyHint,
  onSelect,
  onDownload,
  onDelete,
  onViewDetails,
  busyDigest,
  deletable,
}: {
  items: readonly WebPackageCardItem[];
  selectedDigest: string | null;
  disabled?: boolean;
  emptyHint: string;
  /** 已选中的卡片再次点击时传 `null`，表示取消选择回到自由 Web。 */
  onSelect: (digest: string | null) => void;
  onDownload?: (item: WebPackageCardItem) => void;
  onDelete?: (item: WebPackageCardItem) => void;
  onViewDetails?: (item: WebPackageCardItem) => void;
  busyDigest?: string | null;
  /** 逐项决定是否给出删除入口；未提供时对所有条目开放。 */
  deletable?: (item: WebPackageCardItem) => boolean;
}) {
  const [page, setPage] = useState(1);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(items.length / CARDS_PER_PAGE)), [items.length]);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const paged = useMemo(
    () => items.slice((safePage - 1) * CARDS_PER_PAGE, safePage * CARDS_PER_PAGE),
    [items, safePage],
  );

  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
        {emptyHint}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {paged.map((item) => {
          const selected = item.digest === selectedDigest;
          const busy = busyDigest === item.digest;
          return (
            <div
              key={item.digest}
              className={`relative rounded-xl border p-3 transition-colors ${
                selected
                  ? 'border-pink-400 bg-pink-50 dark:border-pink-600 dark:bg-pink-950/40'
                  : item.broken
                    ? 'border-red-200 bg-red-50/40 dark:border-red-900/60 dark:bg-red-950/30'
                    : 'border-gray-200 bg-white hover:border-pink-300 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-pink-600'
              }`}
            >
              <button
                type="button"
                disabled={disabled || item.broken === true}
                aria-pressed={selected}
                aria-label={`${selected ? '取消选择' : '选择'} Web 包：${item.title}`}
                onClick={() => onSelect(selected ? null : item.digest)}
                className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed"
              />

              <div className="pointer-events-none relative z-10 flex flex-col gap-1 pr-[7.5rem]">
                <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100" title={item.title}>{item.title}</p>
                <p className="truncate text-xs text-gray-500 dark:text-gray-400" title={item.summary}>{item.summary}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
                    item.source === 'builtin' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-700'
                  }`}>
                    {item.source === 'builtin' ? <Package className="h-3 w-3" /> : <HardDrive className="h-3 w-3" />}
                    {item.source === 'builtin' ? '内置预设' : '本地库'}
                  </span>
                  {item.sessionOnly ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">仅本次会话</span>
                  ) : null}
                  {item.broken ? (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] text-red-700">文件已缺失</span>
                  ) : null}
                </div>
              </div>

              <div className="absolute right-2 top-2 z-20 flex items-center gap-1.5">
                {onViewDetails ? (
                  <CardAction label="详情" title={`查看 Web 包详情：${item.title}`} onClick={() => onViewDetails(item)}>
                    <Info className="h-4 w-4" />
                  </CardAction>
                ) : null}
                {onDownload ? (
                  <CardAction
                    label="下载"
                    title={`下载 Web 包 ZIP：${item.title}`}
                    // 下载是只读的本地动作，与"正在生成"无关：生成期间也必须可用，
                    // 否则用户无法在等待时取得预设 ZIP。
                    disabled={busy || item.broken === true}
                    onClick={() => onDownload(item)}
                  >
                    <Download className="h-4 w-4" />
                  </CardAction>
                ) : null}
                {onDelete && (deletable?.(item) ?? true) ? (
                  <CardAction
                    label="删除"
                    title={`从本地库删除：${item.title}`}
                    disabled={disabled || busy}
                    onClick={() => onDelete(item)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </CardAction>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-center gap-2 text-sm">
          <button type="button" className="page-button" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>上一页</button>
          <span className="text-gray-600">第 {safePage} / {totalPages} 页</span>
          <button type="button" className="page-button" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>下一页</button>
        </div>
      ) : null}
    </div>
  );
}
