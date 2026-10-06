type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type StoredPageDraft<T> = {
  version: number;
  updatedAt: number;
  payload: T;
};

type ReadPageDraftOptions = {
  version: number;
  ttlMs: number;
};

type WritePageDraftOptions = {
  version: number;
};

const getLocalStorage = (): StorageLike | null => {
  if (typeof window === 'undefined') return null;

  try {
    const storage = (globalThis as typeof globalThis & { localStorage?: StorageLike }).localStorage;
    if (!storage) return null;
    return storage;
  } catch {
    return null;
  }
};

const clearDraftWithStorage = (storage: StorageLike, key: string) => {
  try {
    storage.removeItem(key);
  } catch {
    // localStorage 在受限环境下可能不可用，忽略即可
  }
};

export const clearPageDraft = (key: string) => {
  const storage = getLocalStorage();
  if (!storage) return;
  clearDraftWithStorage(storage, key);
};

export const writePageDraft = <T>(key: string, payload: T, options: WritePageDraftOptions): StoredPageDraft<T> | null => {
  const storage = getLocalStorage();
  if (!storage) return null;

  const stored: StoredPageDraft<T> = {
    version: options.version,
    updatedAt: Date.now(),
    payload,
  };

  try {
    storage.setItem(key, JSON.stringify(stored));
    return stored;
  } catch {
    return null;
  }
};

export const readPageDraft = <T>(key: string, options: ReadPageDraftOptions): StoredPageDraft<T> | null => {
  const storage = getLocalStorage();
  if (!storage) return null;

  let raw: string | null = null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredPageDraft<T>> | null;
    if (!parsed || typeof parsed !== 'object') {
      clearDraftWithStorage(storage, key);
      return null;
    }

    if (parsed.version !== options.version || typeof parsed.updatedAt !== 'number' || !('payload' in parsed)) {
      clearDraftWithStorage(storage, key);
      return null;
    }

    if (Date.now() - parsed.updatedAt > options.ttlMs) {
      clearDraftWithStorage(storage, key);
      return null;
    }

    return parsed as StoredPageDraft<T>;
  } catch {
    clearDraftWithStorage(storage, key);
    return null;
  }
};
