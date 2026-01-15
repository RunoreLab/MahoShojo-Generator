import { COLOR_MODE_OPTIONS, useColorModePreference } from '@/lib/color-mode';

export function ColorModeSwitcher() {
  const { preference, resolvedMode, setPreference, isHydrated } = useColorModePreference();

  if (!isHydrated) {
    return null;
  }

  const resolvedLabel = resolvedMode === 'dark' ? '深色' : '浅色';
  const title = preference === 'system' ? `当前：${resolvedLabel}（系统）` : `当前：${resolvedLabel}`;

  return (
    <div className="fixed right-4 top-4 z-50" title={title}>
      <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-white/80 px-3 py-2 text-xs shadow-lg backdrop-blur">
        <span className="hidden sm:inline text-gray-500 font-semibold">外观</span>
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
    </div>
  );
}
