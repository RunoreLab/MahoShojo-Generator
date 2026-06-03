import { useEffect, useState } from 'react';

import { COLOR_MODE_STORAGE_KEY } from '@/lib/color-mode-init';

export type ColorModePreference = 'system' | 'light' | 'dark';
export type ResolvedColorMode = 'light' | 'dark';

export { COLOR_MODE_STORAGE_KEY } from '@/lib/color-mode-init';

export const COLOR_MODE_OPTIONS: Array<{ value: ColorModePreference; label: string }> = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

const isColorModePreference = (value: string | null): value is ColorModePreference => {
  return value === 'system' || value === 'light' || value === 'dark';
};

const getSystemResolvedMode = (): ResolvedColorMode => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const resolveColorMode = (
  preference: ColorModePreference,
  systemMode: ResolvedColorMode
): ResolvedColorMode => (preference === 'system' ? systemMode : preference);

export const readStoredColorModePreference = (): ColorModePreference => {
  if (typeof window === 'undefined') {
    return 'system';
  }
  try {
    const stored = window.localStorage.getItem(COLOR_MODE_STORAGE_KEY);
    if (isColorModePreference(stored)) {
      return stored;
    }
  } catch {
    // localStorage 在受限环境下可能不可用，忽略即可
  }
  return 'system';
};

export const storeColorModePreference = (preference: ColorModePreference): void => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, preference);
  } catch {
    // localStorage 在受限环境下可能不可用，忽略即可
  }
};

export const applyColorModeToDocument = (mode: ResolvedColorMode): void => {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.dataset.colorMode = mode;
};

export const useColorModePreference = (): {
  preference: ColorModePreference;
  resolvedMode: ResolvedColorMode;
  setPreference: (value: ColorModePreference) => void;
  isHydrated: boolean;
} => {
  const [preference, setPreference] = useState<ColorModePreference>('system');
  const [resolvedMode, setResolvedMode] = useState<ResolvedColorMode>('light');
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setIsHydrated(true);
    const storedPreference = readStoredColorModePreference();
    setPreference(storedPreference);
    const systemMode = getSystemResolvedMode();
    const resolved = resolveColorMode(storedPreference, systemMode);
    setResolvedMode(resolved);
    applyColorModeToDocument(resolved);
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    storeColorModePreference(preference);
    const systemMode = getSystemResolvedMode();
    const resolved = resolveColorMode(preference, systemMode);
    setResolvedMode(resolved);
    applyColorModeToDocument(resolved);
  }, [isHydrated, preference]);

  useEffect(() => {
    if (!isHydrated || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => {
      if (preference !== 'system') {
        return;
      }
      const nextResolved: ResolvedColorMode = event.matches ? 'dark' : 'light';
      setResolvedMode(nextResolved);
      applyColorModeToDocument(nextResolved);
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
    } else {
      mediaQuery.addListener(handleChange);
    }

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleChange);
      } else {
        mediaQuery.removeListener(handleChange);
      }
    };
  }, [isHydrated, preference]);

  return {
    preference,
    resolvedMode,
    setPreference,
    isHydrated,
  };
};
