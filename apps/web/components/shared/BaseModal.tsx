'use client';

import type { ReactNode, RefObject } from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

type Props = {
  isOpen: boolean;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  maxWidthClassName?: string;
  zIndexClassName?: string;
  onClose: () => void;
};

export type BaseModalLayoutClassNameOptions = {
  maxWidthClassName?: string;
  zIndexClassName?: string;
};

const joinClassNames = (...classNames: Array<string | null | undefined | false>): string =>
  classNames.filter(Boolean).join(' ');

const DEFAULT_Z_INDEX_CLASS_NAME = 'z-50';
const DEFAULT_MAX_WIDTH_CLASS_NAME = 'max-w-4xl';
const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export const useBaseModalAccessibility = ({
  isOpen,
  onClose,
  fallbackFocusRef,
}: {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly fallbackFocusRef?: RefObject<HTMLElement | null>;
}) => {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const fallbackFocus = fallbackFocusRef?.current ?? null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    initialFocusRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])]
        .filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !dialogRef.current?.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !dialogRef.current?.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      } else {
        fallbackFocus?.focus();
      }
    };
  }, [fallbackFocusRef, isOpen]);

  return { dialogRef, initialFocusRef, titleId };
};

export const BASE_MODAL_ROOT_LAYOUT_CLASS_NAME = 'fixed inset-0 flex items-center justify-center p-4';
export const BASE_MODAL_PANEL_LAYOUT_CLASS_NAME =
  'relative flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden';
export const BASE_MODAL_HEADER_LAYOUT_CLASS_NAME = 'shrink-0';
export const BASE_MODAL_BODY_LAYOUT_CLASS_NAME = 'min-h-0 flex-1 overflow-auto';
export const BASE_MODAL_FOOTER_LAYOUT_CLASS_NAME = 'shrink-0';

export const getBaseModalLayoutClassNames = ({
  maxWidthClassName = DEFAULT_MAX_WIDTH_CLASS_NAME,
  zIndexClassName = DEFAULT_Z_INDEX_CLASS_NAME,
}: BaseModalLayoutClassNameOptions = {}) => ({
  rootClassName: joinClassNames(BASE_MODAL_ROOT_LAYOUT_CLASS_NAME, zIndexClassName),
  panelClassName: joinClassNames(
    BASE_MODAL_PANEL_LAYOUT_CLASS_NAME,
    'rounded-xl border border-white/10 bg-white shadow-2xl',
    maxWidthClassName,
  ),
  headerClassName: joinClassNames(
    BASE_MODAL_HEADER_LAYOUT_CLASS_NAME,
    'flex items-start justify-between gap-3 border-b px-5 py-4',
  ),
  bodyClassName: joinClassNames(BASE_MODAL_BODY_LAYOUT_CLASS_NAME, 'px-5 py-4'),
  footerClassName: joinClassNames(BASE_MODAL_FOOTER_LAYOUT_CLASS_NAME, 'border-t bg-gray-50 px-5 py-3'),
});

export function BaseModal({
  isOpen,
  title,
  description,
  children,
  footer,
  maxWidthClassName,
  zIndexClassName,
  onClose,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const {
    dialogRef,
    initialFocusRef: closeButtonRef,
    titleId,
  } = useBaseModalAccessibility({ isOpen: isOpen && mounted, onClose });

  useEffect(() => {
    setMounted(true);
  }, []);

  const wrapper = useMemo(() => {
    if (!mounted) return null;
    return document.body;
  }, [mounted]);

  if (!isOpen || !wrapper) return null;
  const { rootClassName, panelClassName, headerClassName, bodyClassName, footerClassName } =
    getBaseModalLayoutClassNames({ maxWidthClassName, zIndexClassName });
  const accessibleTitle = title || '对话框';

  return createPortal(
    <div className={rootClassName}>
      <button
        type="button"
        aria-label="关闭对话框"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={panelClassName}
      >
        <div className={headerClassName}>
          <div className="min-w-0">
            <div id={titleId} className="text-lg font-semibold text-gray-900 truncate">{accessibleTitle}</div>
            {description ? <div className="mt-1 text-sm text-gray-600">{description}</div> : null}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="关闭对话框"
            className="min-h-10 min-w-10 rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className={bodyClassName}>{children}</div>

        {footer ? <div className={footerClassName}>{footer}</div> : null}
      </div>
    </div>,
    wrapper
  );
}
