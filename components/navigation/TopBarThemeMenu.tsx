import { Monitor, Moon, Palette, Sun } from 'lucide-react';

import type { ColorModePreference } from '@/lib/color-mode';
import { COLOR_MODE_OPTIONS, useColorModePreference } from '@/lib/color-mode';

const getIcon = (value: ColorModePreference) => {
  const className = 'h-4 w-4';

  if (value === 'light') return <Sun className={className} aria-hidden="true" />;
  if (value === 'dark') return <Moon className={className} aria-hidden="true" />;
  return <Monitor className={className} aria-hidden="true" />;
};

export function TopBarThemeMenu() {
  const { preference, setPreference, isHydrated } = useColorModePreference();
  const current = COLOR_MODE_OPTIONS.find((option) => option.value === preference) ?? COLOR_MODE_OPTIONS[0];

  return (
    <div className="group relative">
      <button
        type="button"
        aria-haspopup="menu"
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/50 bg-white/70 px-3 text-sm font-medium text-gray-700 shadow-sm backdrop-blur transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-200 dark:border-slate-600/60 dark:bg-slate-900/70 dark:text-slate-100"
      >
        <Palette className="h-4 w-4" aria-hidden="true" />
        <span>外观</span>
        <span className="hidden text-xs text-gray-500 lg:inline dark:text-slate-300">
          {isHydrated ? current.label : '跟随系统'}
        </span>
      </button>
      <div
        role="menu"
        aria-label="外观设置"
        className="invisible absolute right-0 top-full z-[45] mt-2 min-w-40 rounded-2xl border border-white/60 bg-white/95 p-2 opacity-0 shadow-xl backdrop-blur transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 dark:border-slate-600/60 dark:bg-slate-950/95"
      >
        {COLOR_MODE_OPTIONS.map((option) => {
          const isActive = option.value === preference;

          return (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={isActive}
              onClick={() => setPreference(option.value)}
              className={
                isActive
                  ? 'flex w-full items-center gap-2 rounded-xl bg-pink-600 px-3 py-2 text-left text-sm font-medium text-white'
                  : 'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-gray-700 transition hover:bg-pink-50 dark:text-slate-100 dark:hover:bg-slate-800'
              }
            >
              {getIcon(option.value)}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
