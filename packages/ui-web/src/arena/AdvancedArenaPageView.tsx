'use client';
import type { ReactNode } from 'react';

export type AdvancedArenaPageViewProps = Readonly<{
  header: ReactNode;
  links?: ReactNode;
  beforeWorkspace?: ReactNode;
  children: ReactNode;
  result?: ReactNode;
  homeLink?: ReactNode;
  footer?: ReactNode;
}>;

/** Actual Web Arena page frame. Hosts supply navigation, capabilities and execution. */
export function AdvancedArenaPageView({ header, links, beforeWorkspace, children, result, homeLink, footer }: AdvancedArenaPageViewProps) {
  return (
    <div className="magic-background-white">
      <div className="arena-page-shell mx-auto w-full max-w-[1380px] px-4 pb-8 pt-6 sm:px-6 lg:px-8">
        <div className="rounded-[28px] border p-5 sm:p-6 xl:p-8" style={{ borderColor: 'var(--app-border-strong)', background: 'var(--app-surface-90)', boxShadow: 'var(--app-card-shadow)', backdropFilter: 'blur(10px)' }}>
          {header}
          {links != null && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">{links}</div>}
          {beforeWorkspace}
          {children}
        </div>
        {result}
        {homeLink != null && <div className="text-center" style={{ marginTop: '2rem' }}>{homeLink}</div>}
        {footer}
      </div>
    </div>
  );
}
