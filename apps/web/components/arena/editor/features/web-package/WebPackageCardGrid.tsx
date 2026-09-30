'use client';

import { Download, HardDrive, Info, Loader2, Package, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

/**
 * Web 包卡片网格。
 *
 * 与 `DataCard` 保持同一套动作语法：本地来源的卡片不出现"点赞/收藏/分享"这类线上语义，
 * 只给删除/下载/详情；内置预设不出现删除（删除会破坏 digest 固定的注册表）。
 *
 * 动作按钮独占底部一行，不与标题/描述抢横向空间：预设描述有四五十个汉字，
 * 挤在图标按钮左边会被截成个位数（规格 §16.1 要求当前选择与摘要可读）。
 * 按钮也不使用 `after:absolute` 撑热区——按钮一旦不是定位元素，热区就会退化到
 * 整个动作行容器上，同一行里最后一个按钮会吞掉其余按钮的点击（规格 §16.1 不变量 8）。
 */

export type WebPackageCardItem = Readonly<{
  /** 稳定键：包的 canonical digest。 */
  digest: string;
  title: string;
  /** 描述行：内置预设是 catalog 里的 description，本地库是 `id@version`。 */
  summary: string;
  /**
   * 规范身份 `id@version`。
   *
   * 与 `summary` 分开是因为内置预设的 summary 是描述而不是身份；搜索框承诺能按
   * id@version 找包，就必须单独拿这一份来匹配，否则预设永远搜不到自己的身份。
   */
  identity: string;
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
    onClick={onClick}
    title={title}
    aria-label={title}
    className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border bg-white/90 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-pink-500 disabled:cursor-not-allowed ${
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
  downloadingDigest,
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
  /** 正在导出 ZIP 的条目；只让这张卡转圈，其余卡片的导出入口保持可用。 */
  downloadingDigest?: string | null;
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {paged.map((item) => {
          const selected = item.digest === selectedDigest;
          const busy = busyDigest === item.digest;
          const downloading = downloadingDigest === item.digest;
          return (
            <div
              key={item.digest}
              className={`flex flex-col rounded-xl border p-3 transition-colors ${
                selected
                  ? 'border-pink-400 bg-pink-50 dark:border-pink-600 dark:bg-pink-950/40'
                  : item.broken
                    ? 'border-red-200 bg-red-50/40 dark:border-red-900/60 dark:bg-red-950/30'
                    : 'border-gray-200 bg-white hover:border-pink-300 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-pink-600'
              }`}
            >
              {/* 选择入口就是标题/描述/来源这一整块，按钮内只放 phrasing 内容，语义合法。 */}
              <button
                type="button"
                disabled={disabled || item.broken === true}
                aria-pressed={selected}
                aria-label={`${selected ? '取消选择' : '选择'} Web 包：${item.title}`}
                onClick={() => onSelect(selected ? null : item.digest)}
                className="block w-full min-w-0 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed"
              >
                <span className="block truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{item.title}</span>
                <span className="mt-0.5 block break-words text-xs leading-[18px] text-gray-500 line-clamp-2 dark:text-gray-400">
                  {item.summary}
                </span>
                <span className="mt-1.5 flex flex-wrap items-center gap-1">
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
                </span>
              </button>

              <div className="mt-auto flex items-center justify-end gap-1.5 pt-2">
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
                    // 否则用户无法在等待时取得预设 ZIP。只有同一张卡正在导出才禁用，
                    // 否则会把整页卡片的导出入口一起锁掉。
                    disabled={busy || downloading || item.broken === true}
                    onClick={() => onDownload(item)}
                  >
                    {downloading
                      ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      : <Download className="h-4 w-4" />}
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
