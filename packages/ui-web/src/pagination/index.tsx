'use client';

import { useId, useState } from 'react';
import { ArrowRight } from 'lucide-react';

export interface PageJumpProps {
  currentPage: number;
  totalPages: number;
  onPageChange(page: number): void;
  disabled?: boolean;
  label?: string;
}

/** 仅在确认时定位目标页；输入草稿不触发查询，也不顺序读取中间页。 */
export function PageJump({ currentPage, totalPages, onPageChange, disabled = false, label = '分页跳转' }: PageJumpProps) {
  const id = useId();
  const [draft, setDraft] = useState({ page: currentPage, total: totalPages, value: String(currentPage) });
  // 外部翻页或筛选使页数变化时，同步丢弃旧草稿；不在 effect 中回写页码。
  const value = draft.page === currentPage && draft.total === totalPages ? draft.value : String(currentPage);
  if (draft.page !== currentPage || draft.total !== totalPages) {
    setDraft({ page: currentPage, total: totalPages, value: String(currentPage) });
  }
  const target = /^\d+$/.test(value) ? Number(value) : NaN;
  const valid = Number.isSafeInteger(target) && target >= 1 && target <= totalPages;
  const canJump = !disabled && valid && target !== currentPage;
  const jump = () => { if (canJump) onPageChange(target); };

  if (totalPages <= 1) return null;
  return <div role="group" aria-label={label} className="inline-flex flex-wrap items-center justify-center gap-2 text-sm text-(--app-text)">
    <label htmlFor={id}>前往</label>
    <input id={id} aria-label="跳转页码" aria-describedby={`${id}-range`} aria-invalid={value !== '' && !valid}
      type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" value={value} disabled={disabled} title={`请输入 1 至 ${totalPages} 的整数页码`}
      className="min-h-10 w-20 rounded-md border border-(--app-text-muted) bg-(--app-input-bg) px-2 py-1 text-center text-(--app-text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--app-text) disabled:opacity-50"
      onChange={event => setDraft({ page: currentPage, total: totalPages, value: event.target.value })}
      onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); jump(); } }} />
    <span>页</span>
    <span id={`${id}-range`} className={value !== '' && !valid ? 'text-xs text-(--app-text-muted)' : 'sr-only'}>请输入 1 至 {totalPages} 的整数页码</span>
    <button type="button" disabled={!canJump} onClick={jump}
      className="inline-flex min-h-10 items-center gap-1 rounded-md border border-(--app-text-muted) bg-(--app-surface) px-3 py-1 text-(--app-text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--app-text) disabled:cursor-not-allowed disabled:opacity-50">
      <ArrowRight aria-hidden="true" className="h-4 w-4" />跳转
    </button>
  </div>;
}
