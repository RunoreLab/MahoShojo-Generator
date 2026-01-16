import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GripVertical, Monitor, Moon, Sun, X } from 'lucide-react';

import type { ColorModePreference } from '@/lib/color-mode';
import { COLOR_MODE_OPTIONS, useColorModePreference } from '@/lib/color-mode';

export function ColorModeSwitcher() {
  const { preference, resolvedMode, setPreference, isHydrated } = useColorModePreference();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);

  const storagePositionKey = 'mahoshojo.color-mode-switcher.position';
  const storageMinimizedKey = 'mahoshojo.color-mode-switcher.minimized';
  const edgePadding = 12;

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

  const clampPosition = useCallback(
    (next: { x: number; y: number }) => {
      if (typeof window === 'undefined') {
        return next;
      }
      const rect = rootRef.current?.getBoundingClientRect();
      const width = rect?.width ?? 0;
      const height = rect?.height ?? 0;
      const maxX = Math.max(edgePadding, window.innerWidth - width - edgePadding);
      const maxY = Math.max(edgePadding, window.innerHeight - height - edgePadding);
      return {
        x: Math.min(Math.max(next.x, edgePadding), maxX),
        y: Math.min(Math.max(next.y, edgePadding), maxY),
      };
    },
    [edgePadding]
  );

  const readStoredPosition = useCallback(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    try {
      const stored = window.localStorage.getItem(storagePositionKey);
      if (!stored) {
        return null;
      }
      const parsed = JSON.parse(stored) as { x?: number; y?: number };
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        return parsed;
      }
    } catch {
      // localStorage 在受限环境下可能不可用，忽略即可
    }
    return null;
  }, [storagePositionKey]);

  const storePosition = useCallback(
    (next: { x: number; y: number }) => {
      if (typeof window === 'undefined') {
        return;
      }
      try {
        window.localStorage.setItem(storagePositionKey, JSON.stringify(next));
      } catch {
        // localStorage 在受限环境下可能不可用，忽略即可
      }
    },
    [storagePositionKey]
  );

  const readStoredMinimized = useCallback(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    try {
      return window.localStorage.getItem(storageMinimizedKey) === '1';
    } catch {
      // localStorage 在受限环境下可能不可用，忽略即可
    }
    return false;
  }, [storageMinimizedKey]);

  const updateMinimizedState = useCallback(
    (value: boolean) => {
      setIsMinimized(value);
      if (typeof window === 'undefined') {
        return;
      }
      try {
        window.localStorage.setItem(storageMinimizedKey, value ? '1' : '0');
      } catch {
        // localStorage 在受限环境下可能不可用，忽略即可
      }
    },
    [storageMinimizedKey]
  );

  const handleMinimize = () => {
    setIsMenuOpen(false);
    updateMinimizedState(true);
  };

  const handleRestore = () => {
    updateMinimizedState(false);
  };

  const handleDragStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!position) {
      return;
    }
    setIsMenuOpen(false);
    setIsDragging(true);
    dragOffsetRef.current = {
      x: event.clientX - position.x,
      y: event.clientY - position.y,
    };
  };

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    setIsMinimized(readStoredMinimized());
    const stored = readStoredPosition();
    if (stored) {
      setPosition(clampPosition(stored));
      return;
    }
    if (typeof window === 'undefined') {
      return;
    }
    const rect = rootRef.current?.getBoundingClientRect();
    const width = rect?.width ?? 220;
    const defaultPosition = clampPosition({
      x: window.innerWidth - width - edgePadding,
      y: edgePadding,
    });
    setPosition(defaultPosition);
  }, [clampPosition, edgePadding, isHydrated, readStoredMinimized, readStoredPosition]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    if (!position || isDragging) {
      return;
    }
    storePosition(position);
  }, [isDragging, isHydrated, position, storePosition]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    if (!isDragging) {
      return;
    }
    const handleMove = (event: PointerEvent) => {
      if (!dragOffsetRef.current) {
        return;
      }
      const next = clampPosition({
        x: event.clientX - dragOffsetRef.current.x,
        y: event.clientY - dragOffsetRef.current.y,
      });
      setPosition(next);
    };
    const handleUp = () => {
      setIsDragging(false);
      dragOffsetRef.current = null;
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [clampPosition, isDragging, isHydrated]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    if (!position || isDragging) {
      return;
    }
    const handleResize = () => {
      setPosition((prev) => (prev ? clampPosition(prev) : prev));
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [clampPosition, isHydrated, position]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    if (!position) {
      return;
    }
    const handle = window.requestAnimationFrame(() => {
      setPosition((prev) => (prev ? clampPosition(prev) : prev));
    });
    return () => {
      window.cancelAnimationFrame(handle);
    };
  }, [clampPosition, isDragging, isHydrated, isMinimized, position]);

  if (!isHydrated) {
    return null;
  }

  return (
    <div
      ref={rootRef}
      className={`fixed z-50 flex flex-col items-end gap-2 select-none ${
        position ? '' : 'right-4 top-4'
      }`}
      style={position ? { left: position.x, top: position.y } : undefined}
      title={title}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="拖动外观切换"
          onPointerDown={handleDragStart}
          className={`flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white/80 shadow-lg backdrop-blur transition-colors hover:bg-white/90 touch-none ${
            isDragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
        >
          <GripVertical className="h-4 w-4 text-gray-500" aria-hidden="true" />
        </button>
        {!isMinimized && (
          <button
            type="button"
            aria-label="隐藏外观切换"
            onClick={handleMinimize}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white/80 shadow-lg backdrop-blur transition-colors hover:bg-white/90"
          >
            <X className="h-4 w-4 text-gray-500" aria-hidden="true" />
          </button>
        )}
      </div>

      {isMinimized ? (
        <button
          type="button"
          aria-label="展开外观切换"
          onClick={handleRestore}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white/80 shadow-lg backdrop-blur transition-colors hover:bg-white/90"
        >
          {currentIcon}
        </button>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
