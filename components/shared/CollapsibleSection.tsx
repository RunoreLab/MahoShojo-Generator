'use client';

import { ReactNode, useEffect, useId, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';

type CollapsibleSectionVariant = 'panel' | 'plain';

type CollapsibleSectionProps = {
  title: ReactNode;
  children: ReactNode;
  description?: ReactNode;
  headerRight?: ReactNode;
  defaultOpen?: boolean;
  autoOpen?: boolean;
  collapsible?: boolean;
  disabled?: boolean;
  keepMounted?: boolean;
  storageKey?: string;
  variant?: CollapsibleSectionVariant;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
};

const readStoredOpenState = (storageKey: string): boolean | null => {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === '1') return true;
    if (raw === '0') return false;
    return null;
  } catch {
    return null;
  }
};

const writeStoredOpenState = (storageKey: string, open: boolean) => {
  try {
    window.localStorage.setItem(storageKey, open ? '1' : '0');
  } catch {
    // localStorage 在部分隐私模式/受限环境下可能不可用，忽略即可
  }
};

export function CollapsibleSection({
  title,
  children,
  description,
  headerRight,
  defaultOpen = true,
  autoOpen = false,
  collapsible = true,
  disabled = false,
  keepMounted = false,
  storageKey,
  variant = 'panel',
  className,
  headerClassName,
  contentClassName,
  titleClassName,
  descriptionClassName,
}: CollapsibleSectionProps) {
  const reactId = useId();
  const contentId = useMemo(() => `collapsible-${reactId}`, [reactId]);
  const [restored, setRestored] = useState(false);
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (!storageKey) return;
    const stored = readStoredOpenState(storageKey);
    if (typeof stored === 'boolean') {
      setOpen(stored);
    }
    setRestored(true);
  }, [storageKey]);

  useEffect(() => {
    if (!autoOpen) return;
    setOpen(true);
  }, [autoOpen]);

  useEffect(() => {
    if (!storageKey) return;
    if (!restored) return;
    writeStoredOpenState(storageKey, open);
  }, [storageKey, open, restored]);

  const isCollapsible = collapsible && !disabled;
  const isOpen = collapsible ? open : true;
  const rootClassName =
    variant === 'panel'
      ? [
          'rounded-xl border border-[var(--app-border-strong)] bg-[var(--app-surface-80)]',
          className,
        ]
          .filter(Boolean)
          .join(' ')
      : [className].filter(Boolean).join(' ');

  const resolvedHeaderClassName = [
    'flex items-start gap-3',
    variant === 'panel' ? 'px-3 py-2 sm:px-4 sm:py-3' : '',
    headerClassName,
  ]
    .filter(Boolean)
    .join(' ');

  const resolvedTitleClassName = [
    'text-sm font-semibold text-[color:var(--app-text)]',
    titleClassName,
  ]
    .filter(Boolean)
    .join(' ');

  const resolvedDescriptionClassName = [
    'text-xs text-[color:var(--app-text-subtle)]',
    descriptionClassName,
  ]
    .filter(Boolean)
    .join(' ');

  const resolvedContentClassName = [
    variant === 'panel' ? 'px-3 pb-3 sm:px-4 sm:pb-4' : '',
    contentClassName,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClassName}>
      <div className={resolvedHeaderClassName}>
        <button
          type="button"
          className={[
            'flex min-w-0 flex-1 items-start gap-2 rounded-lg text-left',
            variant === 'panel' ? 'py-1' : 'px-1 py-1',
            isCollapsible ? 'cursor-pointer hover:bg-[var(--app-surface-90)]' : 'cursor-default',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-focus-ring)]',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-expanded={isOpen}
          aria-controls={contentId}
          disabled={!isCollapsible}
          onClick={() => {
            if (!isCollapsible) return;
            setOpen((v) => !v);
          }}
        >
          {collapsible ? (
            <ChevronDown
              className={[
                'mt-0.5 h-4 w-4 shrink-0 transition-transform',
                isOpen ? 'rotate-0' : '-rotate-90',
                disabled ? 'opacity-50' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-hidden
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <div className={resolvedTitleClassName}>{title}</div>
            {description ? <div className={resolvedDescriptionClassName}>{description}</div> : null}
          </div>
        </button>

        {headerRight ? <div className="shrink-0">{headerRight}</div> : null}
      </div>

      {isOpen ? (
        <div id={contentId} className={resolvedContentClassName}>
          {children}
        </div>
      ) : keepMounted ? (
        <div id={contentId} className={resolvedContentClassName} hidden>
          {children}
        </div>
      ) : (
        <div id={contentId} className="sr-only" />
      )}
    </div>
  );
}

type DisclosureButtonProps = {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  iconClassName?: string;
};

export function DisclosureButton({
  open,
  onToggle,
  children,
  disabled = false,
  className,
  iconClassName,
}: DisclosureButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-expanded={open}
      className={[
        'inline-flex items-center gap-1 rounded-md text-sm font-semibold',
        'text-[color:var(--app-text-muted)] hover:text-[color:var(--app-text)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-focus-ring)]',
        disabled ? 'opacity-50 cursor-not-allowed' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <ChevronDown
        className={[
          'h-4 w-4 transition-transform',
          open ? 'rotate-0' : '-rotate-90',
          iconClassName,
        ]
          .filter(Boolean)
          .join(' ')}
        aria-hidden
      />
      <span>{children}</span>
    </button>
  );
}
