import { useEffect, useSyncExternalStore } from 'react';

import {
  DEFAULT_READING_PREFERENCES,
  READING_PREFERENCE_STORAGE_KEY,
  normalizeReadingPreferences,
  parseReadingPreferencesText,
  type ReadingPreferences,
} from './reading-init';

export interface ReadingPreferenceState {
  readonly preferences: ReadingPreferences;
  readonly isHydrated: boolean;
  readonly saveError: string | null;
}

const SERVER_STATE: ReadingPreferenceState = {
  preferences: DEFAULT_READING_PREFERENCES,
  isHydrated: false,
  saveError: null,
};

export const applyReadingPreferencesToDocument = (preferences: ReadingPreferences): void => {
  if (typeof document === 'undefined') return;
  const data = document.documentElement.dataset;
  data.readingSize = String(preferences.sizePercent);
  data.readingFont = preferences.font;
  data.readingLineHeight = preferences.lineHeight;
  data.readingWidth = preferences.width;
};

type ReadingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** 单一设备偏好状态：同页多个设置面/预览订阅同一实例，存储错误保留本次可读结果。 */
export class ReadingPreferenceStore {
  private state: ReadingPreferenceState = SERVER_STATE;
  private readonly listeners = new Set<() => void>();
  private readonly getStorage: () => ReadingStorage;
  private readonly apply: (preferences: ReadingPreferences) => void;
  private readonly eventTarget: Pick<Window, 'addEventListener' | 'removeEventListener'> | undefined;

  constructor(deps?: {
    getStorage?: () => ReadingStorage;
    apply?: (preferences: ReadingPreferences) => void;
    eventTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  }) {
    this.getStorage = deps?.getStorage ?? (() => window.localStorage);
    this.apply = deps?.apply ?? applyReadingPreferencesToDocument;
    this.eventTarget = deps?.eventTarget ?? (typeof window === 'undefined' ? undefined : window);
  }

  getSnapshot = (): ReadingPreferenceState => this.state;
  getServerSnapshot = (): ReadingPreferenceState => SERVER_STATE;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(preferences: ReadingPreferences, saveError: string | null): void {
    this.state = { preferences, isHydrated: true, saveError };
    this.apply(preferences);
    this.listeners.forEach((listener) => listener());
  }

  private read = (): void => {
    try {
      this.publish(parseReadingPreferencesText(this.getStorage().getItem(READING_PREFERENCE_STORAGE_KEY)), null);
    } catch {
      this.publish(DEFAULT_READING_PREFERENCES, '无法读取本机阅读设置，已使用默认显示；可以重新选择并保存。');
    }
  };

  private handleStorage = (event: Event): void => {
    const storageEvent = event as StorageEvent;
    if (storageEvent.key === READING_PREFERENCE_STORAGE_KEY || storageEvent.key === null) this.read();
  };

  ready = (): void => {
    if (this.state.isHydrated) return;
    this.read();
    this.eventTarget?.addEventListener('storage', this.handleStorage);
  };

  setPreferences = (patch: Partial<ReadingPreferences>): void => {
    this.ready();
    const preferences = normalizeReadingPreferences({ ...this.state.preferences, ...patch });
    let saveError: string | null = null;
    try {
      this.getStorage().setItem(READING_PREFERENCE_STORAGE_KEY, JSON.stringify({ version: 1, ...preferences }));
    } catch {
      saveError = '本次阅读设置已生效，但未能保存在本机，重启后可能丢失。';
    }
    this.publish(preferences, saveError);
  };

  reset = (): void => {
    this.ready();
    let saveError: string | null = null;
    try {
      this.getStorage().removeItem(READING_PREFERENCE_STORAGE_KEY);
    } catch {
      saveError = '本次已恢复默认阅读显示，但未能保存在本机，重启后可能恢复旧设置。';
    }
    this.publish(DEFAULT_READING_PREFERENCES, saveError);
  };

  dispose = (): void => {
    this.eventTarget?.removeEventListener('storage', this.handleStorage);
    this.listeners.clear();
  };
}

let sharedReadingStore: ReadingPreferenceStore | undefined;
export const getReadingPreferenceStore = (): ReadingPreferenceStore => {
  sharedReadingStore ??= new ReadingPreferenceStore();
  return sharedReadingStore;
};

export const useReadingPreferences = (store = getReadingPreferenceStore()) => {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  useEffect(() => store.ready(), [store]);
  return { ...state, setPreferences: store.setPreferences, reset: store.reset };
};
