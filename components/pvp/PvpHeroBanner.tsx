import type { ReactNode } from 'react';

type PvpHeroBannerProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
};

export function PvpHeroBanner({ title, subtitle, right }: PvpHeroBannerProps) {
  return (
    <div className="relative overflow-hidden border-b border-white/60">
      <div className="absolute inset-0 overflow-hidden">
        <img
          src="/arena-card-white.webp"
          alt=""
          aria-hidden="true"
          className="h-full w-3/4 translate-x-1/2 object-cover object-[10%_30%] opacity-100 blur-xs"
        />
      </div>
      <div className="absolute inset-0 bg-gradient-to-r from-white/95 via-white/80 to-white/55" />

      <div className="relative px-6 py-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="text-xs font-semibold tracking-wide text-pink-700/90">ARENA PVP</div>
          <div className="mt-1 text-2xl font-bold text-gray-900 truncate">{title}</div>
          {subtitle ? <div className="mt-1 text-sm text-gray-700">{subtitle}</div> : null}
        </div>
        {right ? <div className="flex items-center gap-2 sm:shrink-0">{right}</div> : null}
      </div>
    </div>
  );
}

