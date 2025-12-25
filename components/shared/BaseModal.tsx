'use client';

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

type Props = {
  isOpen: boolean;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  maxWidthClassName?: string;
  onClose: () => void;
};

export function BaseModal({
  isOpen,
  title,
  description,
  children,
  footer,
  maxWidthClassName,
  onClose,
}: Props) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose]);

  const wrapper = useMemo(() => {
    if (!mounted) return null;
    return document.body;
  }, [mounted]);

  if (!isOpen || !wrapper) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="关闭"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={[
          'relative w-full overflow-hidden rounded-xl border border-white/10 bg-white shadow-2xl',
          maxWidthClassName || 'max-w-4xl',
        ].join(' ')}
      >
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            {title ? <div className="text-lg font-semibold text-gray-900 truncate">{title}</div> : null}
            {description ? <div className="mt-1 text-sm text-gray-600">{description}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[78vh] overflow-auto px-5 py-4">{children}</div>

        {footer ? <div className="border-t bg-gray-50 px-5 py-3">{footer}</div> : null}
      </div>
    </div>,
    wrapper
  );
}

