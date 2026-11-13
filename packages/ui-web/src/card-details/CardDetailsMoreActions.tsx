import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useEscapeLayer } from '../modal';

export interface CardDetailsMoreAction {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  title?: string;
  detail?: string;
}

/** 用于 BasicCardDetailsModal 的 headerActions；面板锚定整个头部操作区，避免窄屏向左溢出。 */
export function CardDetailsMoreActions({ actions, feedback, buttonRef }: {
  actions: readonly CardDetailsMoreAction[];
  feedback?: ReactNode;
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const ownButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = buttonRef ?? ownButtonRef;
  const close = () => { setOpen(false); triggerRef.current?.focus(); };
  useEscapeLayer({ active: open, onEscape: () => { close(); return true; } });
  useEffect(() => {
    if (!open) return;
    wrapperRef.current?.querySelector<HTMLButtonElement>('[data-card-actions] button:not(:disabled)')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrapperRef.current?.contains(event.target)) setOpen(false);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !wrapperRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [open]);
  return <div ref={wrapperRef} className="contents" role="group" aria-label="数据卡扩展操作">
    <button ref={triggerRef} type="button" aria-label="更多操作" aria-expanded={open} aria-controls={panelId}
      onClick={() => setOpen(value => !value)}
      className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border border-(--app-border) p-2 text-sm text-(--app-text) hover:bg-(--app-surface-80) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--app-accent)">
      <MoreHorizontal className="h-5 w-5 shrink-0" aria-hidden="true" /><span className="hidden sm:inline">更多</span>
    </button>
    {open && <div id={panelId} data-card-actions role="group" aria-label="数据卡更多操作"
      className="absolute right-0 top-full z-10 mt-2 max-h-[50dvh] w-56 max-w-[calc(100vw-4rem)] overflow-auto rounded-xl border border-(--app-border) bg-(--app-surface-strong) p-2 text-sm text-(--app-text) shadow-xl">
      {actions.map(action => <button key={action.id} type="button" disabled={action.disabled} title={action.title}
        onClick={() => { close(); action.onSelect(); }}
        className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-(--app-surface-80) focus-visible:outline-2 focus-visible:outline-(--app-accent) disabled:cursor-not-allowed disabled:opacity-50">
        {action.icon}<span className="min-w-0 flex-1 break-words">{action.label}</span>
        {action.detail && <span className="text-xs text-(--app-text-muted)">{action.detail}</span>}
      </button>)}
      {feedback}
    </div>}
  </div>;
}
