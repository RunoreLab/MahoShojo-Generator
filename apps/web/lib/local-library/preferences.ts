'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * 「导入时保存到本地库」是**设备偏好**，不是本地库数据本身。
 *
 * ADR-local-library-data-ownership §4 禁止把本地库内容放进 localStorage；偏好开关不属于
 * 库内容，且必须在 IndexedDB 打不开时仍然可用（否则用户连"不要再自动保存"都选不了）。
 * 读写的都是同一个 `mahoshojo.local-library.preferences.v1` 键，不与任何本地库记录共用。
 *
 * 用模块级 store + `useSyncExternalStore`，而不是 `useState` + updater 里写副作用：
 * updater 会被 React 重放，在里面写 localStorage 并同步通知其它组件等于在渲染期做副作用。
 * `lib/web-package/trust.ts` 的同源授权用的是同一套形状。
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

const normalize = (raw: unknown): LocalLibraryPreferences => {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_LOCAL_LIBRARY_PREFERENCES;
  const parsed = raw as Partial<LocalLibraryPreferences>;
  return {
    saveImportedDataCards: parsed.saveImportedDataCards === true,
    saveImportedWebPackages: parsed.saveImportedWebPackages === true,
  };
};

/**
 * 快照缓存。
 *
 * 每次 `getSnapshot` 都重新读一遍原始字符串：模块加载时读一次的做法在
 * localStorage 被别处直接写入后就会一直给旧值。缓存原始串而不是解析结果，
 * React 拿到的引用在存储没变时保持稳定。
 */
let cachedRaw: string | null | undefined;
let cachedPreferences: LocalLibraryPreferences = DEFAULT_LOCAL_LIBRARY_PREFERENCES;

const readRaw = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(LOCAL_LIBRARY_PREFERENCE_STORAGE_KEY);
  } catch {
    return null;
  }
};

const resolveSnapshot = (): LocalLibraryPreferences => {
  const raw = readRaw();
  if (raw === cachedRaw) return cachedPreferences;
  cachedRaw = raw;
  cachedPreferences = raw === null
    ? DEFAULT_LOCAL_LIBRARY_PREFERENCES
    : normalize(JSON.parse(raw) as unknown);
  return cachedPreferences;
};

const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of [...listeners]) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== 'undefined') {
    // 同一浏览器的其它标签页改了偏好，本页也要跟着变。
    window.addEventListener('storage', onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
    }
  };
};

function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== LOCAL_LIBRARY_PREFERENCE_STORAGE_KEY) return;
  emit();
}

const getSnapshot = (): LocalLibraryPreferences => {
  try {
    return resolveSnapshot();
  } catch {
    return DEFAULT_LOCAL_LIBRARY_PREFERENCES;
  }
};
const getServerSnapshot = (): LocalLibraryPreferences => DEFAULT_LOCAL_LIBRARY_PREFERENCES;

export const writeLocalLibraryPreference = <K extends keyof LocalLibraryPreferences>(
  key: K,
  value: LocalLibraryPreferences[K],
): void => {
  const current = getSnapshot();
  const next = { ...current, [key]: value };
  if (next[key] === current[key]) return;
  if (typeof window !== 'undefined') {
    try {
      const raw = JSON.stringify(next);
      window.localStorage.setItem(LOCAL_LIBRARY_PREFERENCE_STORAGE_KEY, raw);
      cachedRaw = raw;
      cachedPreferences = next;
    } catch {
      // 隐私模式可能拒绝写入。偏好退化为本次会话有效，UI 会在提示中说明。
      cachedRaw = undefined;
    }
  }
  emit();
};

export const useLocalLibraryPreferences = (): {
  preferences: LocalLibraryPreferences;
  setPreference: <K extends keyof LocalLibraryPreferences>(key: K, value: LocalLibraryPreferences[K]) => void;
} => {
  const preferences = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setPreference = useCallback(<K extends keyof LocalLibraryPreferences>(
    key: K,
    value: LocalLibraryPreferences[K],
  ) => writeLocalLibraryPreference(key, value), []);
  return { preferences, setPreference };
};

/** 测试用：丢弃模块级缓存，下一次读取重新解析存储。 */
export const resetLocalLibraryPreferencesCache = (): void => {
  cachedRaw = undefined;
  cachedPreferences = DEFAULT_LOCAL_LIBRARY_PREFERENCES;
};
