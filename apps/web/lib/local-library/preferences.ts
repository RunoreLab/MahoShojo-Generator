'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * 「导入时保存到本地库」是**设备偏好**，不是本地库数据本身。
 *
 * ADR-local-library-data-ownership §4 禁止把本地库内容放进 localStorage；偏好开关不属于
 * 库内容，且必须在 IndexedDB 打不开时仍然可用（否则用户连"不要再自动保存"都选不了）。
 * 读写的都是同一个 `mahoshojo.local-library.preferences.v1` 键，不与任何本地库记录共用。
 */

export const LOCAL_LIBRARY_PREFERENCE_STORAGE_KEY = 'mahoshojo.local-library.preferences.v1' as const;

export interface LocalLibraryPreferences {
  /** 本地导入的数据卡自动写入本地库。 */
  saveImportedDataCards: boolean;
  /** 本地导入的 Web 包自动写入本地库。 */
  saveImportedWebPackages: boolean;
}

export const DEFAULT_LOCAL_LIBRARY_PREFERENCES: LocalLibraryPreferences = {
  saveImportedDataCards: false,
  saveImportedWebPackages: false,
};

const readStoredPreferences = (): LocalLibraryPreferences => {
  if (typeof window === 'undefined') return DEFAULT_LOCAL_LIBRARY_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(LOCAL_LIBRARY_PREFERENCE_STORAGE_KEY);
    if (!raw) return DEFAULT_LOCAL_LIBRARY_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<LocalLibraryPreferences>;
    return {
      saveImportedDataCards: parsed.saveImportedDataCards === true,
      saveImportedWebPackages: parsed.saveImportedWebPackages === true,
    };
  } catch {
    return DEFAULT_LOCAL_LIBRARY_PREFERENCES;
  }
};

const writeStoredPreferences = (preferences: LocalLibraryPreferences): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCAL_LIBRARY_PREFERENCE_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // 隐私模式可能拒绝写入。偏好退化为本次会话有效，UI 会在提示中说明。
  }
};

const listeners = new Set<() => void>();
const emit = (): void => {
  for (const listener of listeners) listener();
};

export const useLocalLibraryPreferences = (): {
  preferences: LocalLibraryPreferences;
  setPreference: <K extends keyof LocalLibraryPreferences>(key: K, value: LocalLibraryPreferences[K]) => void;
} => {
  const [preferences, setPreferences] = useState<LocalLibraryPreferences>(DEFAULT_LOCAL_LIBRARY_PREFERENCES);

  useEffect(() => {
    const sync = (): void => setPreferences(readStoredPreferences());
    sync();
    // 同一浏览器的其它标签页改了偏好，本页也要跟着变。
    const onStorage = (event: StorageEvent): void => {
      if (event.key === null || event.key === LOCAL_LIBRARY_PREFERENCE_STORAGE_KEY) sync();
    };
    window.addEventListener('storage', onStorage);
    listeners.add(sync);
    return () => {
      window.removeEventListener('storage', onStorage);
      listeners.delete(sync);
    };
  }, []);

  const setPreference = useCallback(<K extends keyof LocalLibraryPreferences>(key: K, value: LocalLibraryPreferences[K]) => {
    setPreferences((current) => {
      if (current[key] === value) return current;
      const next = { ...current, [key]: value };
      writeStoredPreferences(next);
      emit();
      return next;
    });
  }, []);

  return { preferences, setPreference };
};
