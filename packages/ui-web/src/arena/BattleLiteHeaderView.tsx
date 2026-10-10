'use client';
import type { ReactNode } from 'react';
export type BattleLiteHeaderViewProps = Readonly<{
  badge?: string;
  logo: ReactNode;
  description: ReactNode;
  helper?: ReactNode;
  children?: ReactNode;
}>;
/** Shared hero chrome; product copy, navigation, media and notices are explicit host slots. */
export function BattleLiteHeaderView({ badge = '简洁版竞技场', logo, description, helper, children }: BattleLiteHeaderViewProps) {
  return <>
      <div className="battle-lite-hero-card relative overflow-hidden rounded-[28px] border px-5 py-6 text-center sm:px-8">
        <div className="battle-lite-hero-pill inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold tracking-[0.22em]">
          {badge}
        </div>
        <div className="mt-4 flex justify-center">
          {logo}
        </div>
        <p className="battle-lite-muted-text mt-4 text-sm leading-6 sm:text-[15px]">
          {description}
        </p>
        <div className="battle-lite-subtle-text mt-4 flex flex-wrap items-center justify-center gap-2 text-xs sm:text-sm">
          {helper}
        </div>
      </div>
    {children}
  </>;
}
