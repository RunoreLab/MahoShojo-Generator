import { useEffect, useMemo, useRef, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

import type { ColorModePreference } from '@/lib/color-mode';
import { COLOR_MODE_OPTIONS, useColorModePreference } from '@/lib/color-mode';

export function ColorModeSwitcher() {
  const { preference, resolvedMode, setPreference, isHydrated } = useColorModePreference();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const resolvedLabel = resolvedMode === 'dark' ? '深色' : '浅色';
  const title = preference === 'system' ? `当前：${resolvedLabel}（系统）` : `当前：${resolvedLabel}`;

  const currentIcon = useMemo(() => {
    const className = 'h-4 w-4';
    if (preference === 'system') return <Monitor className={className} aria-hidden="true" />;
    if (preference === 'dark') return <Moon className={className} aria-hidden="true" />;
    return <Sun className={className} aria-hidden="true" />;
  }, [preference]);

  useEffect(() => {
    if (!isMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (root.contains(event.target as Node)) return;
      setIsMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMenuOpen]);

  const handleSelect = (value: ColorModePreference) => {
    setPreference(value);
    setIsMenuOpen(false);
  };

  if (!isHydrated) {
    return null;
  }

  return (
    <div ref={rootRef} className="fixed right-4 top-4 z-50 flex flex-col items-end gap-2" title={title}>
      {/* 桌面端：保持可见的三段式切换，避免额外点击 */}
      <div className="hidden md:flex items-center gap-2 rounded-full border border-gray-200 bg-white/80 px-3 py-2 text-xs shadow-lg backdrop-blur">
        <span className="text-gray-500 font-semibold">外观</span>
        <div className="flex items-center gap-1">
          {COLOR_MODE_OPTIONS.map((option) => {
            const isActive = option.value === preference;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setPreference(option.value)}
                aria-pressed={isActive}
                className={
                  isActive
                    ? 'rounded-full bg-pink-600 px-2.5 py-1 text-white shadow-sm'
                    : 'rounded-full px-2.5 py-1 text-gray-600 transition-colors hover:bg-gray-100'
                }
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 移动端：默认折叠为图标，避免遮挡页面操作区域 */}
      <div className="md:hidden relative">
        <button
          type="button"
          aria-label="切换外观"
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          onClick={() => setIsMenuOpen((value) => !value)}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white/80 shadow-lg backdrop-blur transition-colors hover:bg-white/90"
        >
          {currentIcon}
        </button>

        {isMenuOpen && (
          <div
            role="menu"
            aria-label="外观选择"
            className="absolute right-0 mt-2 flex items-center gap-2 rounded-2xl border border-gray-200 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur"
          >
            <span className="text-gray-500 font-semibold">外观</span>
            <div className="flex items-center gap-1">
              {COLOR_MODE_OPTIONS.map((option) => {
                const isActive = option.value === preference;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleSelect(option.value)}
                    aria-pressed={isActive}
                    className={
                      isActive
                        ? 'rounded-full bg-pink-600 px-2.5 py-1 text-white shadow-sm'
                        : 'rounded-full px-2.5 py-1 text-gray-600 transition-colors hover:bg-gray-100'
                    }
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
