import { useRef, useState } from 'react';
import { Monitor, Moon, Palette, Sun } from 'lucide-react';

import { COLOR_MODE_OPTIONS, useColorModePreference, type ColorModePreference } from '../color-mode/index';
import { useEscapeLayer } from '../modal/escape-stack';

const getIcon = (value: ColorModePreference) => {
  const className = 'h-4 w-4';

  if (value === 'light') return <Sun className={className} aria-hidden="true" />;
  if (value === 'dark') return <Moon className={className} aria-hidden="true" />;
  return <Monitor className={className} aria-hidden="true" />;
};

/**
 * 顶栏外观菜单（自 `apps/web` 上移，DOM/文案/hover 展开逻辑逐字保留）。
 *
 * 偏好的读取、持久化与 `data-color-mode` 应用全走 `../color-mode`——存储键与属性名
 * 是产品级契约；Web `layout.tsx` 内联脚本与 Desktop `index.html` 内联脚本消费同一个
 * `getColorModeInitScript()` 生成器，两端切换器因此天然一致。
 */
export function TopBarThemeMenu() {
  const { preference, setPreference, isHydrated } = useColorModePreference();
  const current = COLOR_MODE_OPTIONS.find((option) => option.value === preference) ?? COLOR_MODE_OPTIONS[0];
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // 展开态受控化（DESK-PARITY-007）：hover/focus 语义不变，但 Escape 需要
  // 一个能主动收起的开关——CSS group-hover 形态无法响应键盘层级。
  const [open, setOpen] = useState(false);

  useEscapeLayer({
    active: open,
    onEscape: () => {
      setOpen(false);
      if (rootRef.current?.contains(document.activeElement)) {
        triggerRef.current?.focus();
      }
      return true;
    },
  });

  return (
    <div
      ref={rootRef}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        // 与旧 group-focus-within 等价：指针移出但焦点仍在菜单内时保持展开。
        if (!rootRef.current?.contains(document.activeElement)) setOpen(false);
      }}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/50 bg-white/70 px-3 text-sm font-medium text-gray-700 shadow-sm backdrop-blur transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-200 dark:border-slate-600/60 dark:bg-slate-900/70 dark:text-slate-100"
      >
        <Palette className="h-4 w-4" aria-hidden="true" />
        <span>外观</span>
        <span className="hidden text-xs text-gray-500 lg:inline dark:text-slate-300">
          {isHydrated ? current.label : '跟随系统'}
        </span>
      </button>
      <div
        aria-label="外观设置"
        className={`${open ? 'visible opacity-100' : 'invisible opacity-0'} absolute right-0 top-full z-[45] min-w-40 pt-2 transition`}
      >
        <div className="space-y-2 rounded-2xl border border-white/60 bg-white/95 p-2 shadow-xl backdrop-blur dark:border-slate-600/60 dark:bg-slate-950/95">
          {COLOR_MODE_OPTIONS.map((option) => {
            const isActive = option.value === preference;

            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={isActive}
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
    </div>
  );
}
