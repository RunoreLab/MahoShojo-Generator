import type { ReactNode } from 'react';

type TavernHeroBannerProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  actions?: ReactNode;
};

export function TavernHeroBanner({ title, subtitle, right, actions }: TavernHeroBannerProps) {
  return (
    <div className="relative overflow-hidden border-b border-white/60">
      <div className="absolute inset-0 overflow-hidden">
        <img
          src="/arena-card-white.webp"
          alt=""
          aria-hidden="true"
          className="h-full w-full object-cover object-[20%_30%] opacity-90 blur-xs"
        />
      </div>
      <div className="absolute inset-0 bg-gradient-to-r from-white/95 via-white/85 to-white/60" />

      <div className="relative px-6 py-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-pink-700/90">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-pink-500/90">
                <img src="/tavern-white.svg" alt="" aria-hidden="true" className="h-3 w-3" />
              </span>
              <span>SILLYTAVERN TOOLKIT</span>
            </div>
            <div className="mt-1 text-2xl font-bold text-gray-900 truncate">{title}</div>
            {subtitle ? <div className="mt-1 text-sm text-gray-700">{subtitle}</div> : null}
          </div>
          {right ? <div className="flex items-center gap-2 sm:shrink-0">{right}</div> : null}
        </div>
        {actions ? <div className="mt-4">{actions}</div> : null}
      </div>
    </div>
  );
}
