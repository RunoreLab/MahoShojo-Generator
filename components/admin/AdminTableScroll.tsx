import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export interface AdminTableScrollProps {
  children: React.ReactNode;
  footer?: React.ReactNode;
  withCard?: boolean;
  className?: string;
  scrollerClassName?: string;
  hint?: string;
  scrollStep?: number;
}

export function AdminTableScroll({
  children,
  footer,
  withCard = true,
  className,
  scrollerClassName,
  hint = '提示：表格支持横向滚动（可用按钮或触控板/Shift+滚轮）。',
  scrollStep = 480,
}: AdminTableScrollProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const update = () => {
      const nextCanLeft = el.scrollLeft > 0;
      const nextCanRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setCanScrollLeft(nextCanLeft);
      setCanScrollRight(nextCanRight);
    };

    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    ro?.observe(el);

    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  }, []);

  const scrollBy = (delta: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: delta, behavior: 'smooth' });
  };

  return (
    <div
      className={clsx(
        withCard ? 'relative overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-100' : 'relative overflow-hidden',
        className,
      )}
    >
      <div className="flex flex-col gap-2 border-b border-gray-100 px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-gray-500">{hint}</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => scrollBy(-scrollStep)}
            disabled={!canScrollLeft}
            className="admin-button-sm"
            aria-label="向左滚动表格"
            title="向左滚动"
          >
            <ChevronLeft className="h-4 w-4" />
            左
          </button>
          <button
            type="button"
            onClick={() => scrollBy(scrollStep)}
            disabled={!canScrollRight}
            className="admin-button-sm"
            aria-label="向右滚动表格"
            title="向右滚动"
          >
            右
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        ref={scrollerRef}
        className={clsx('min-w-0 overflow-x-auto overscroll-x-contain', scrollerClassName)}
        style={{ scrollbarGutter: 'stable both-edges' }}
      >
        {children}
      </div>

      {footer ? <div className="border-t border-gray-100 px-4 py-3">{footer}</div> : null}
    </div>
  );
}
