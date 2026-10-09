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

const clearDraftWithStorage = (storage: StorageLike, key: string): boolean => {
  try {
    storage.removeItem(key);
    return true;
  } catch {
    // localStorage 在受限环境下可能不可用
    return false;
  }
};

/** 返回是否确认清除成功——存储不可用或 removeItem 抛错时为 `false`，调用方不得报告「已清空」。 */
export const clearPageDraft = (key: string): boolean => {
  const storage = getLocalStorage();
  if (!storage) return false;
  return clearDraftWithStorage(storage, key);
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


export type PageDraftBlockedReason = 'read-failed' | 'invalid' | 'version-mismatch' | 'expired';
export type PageDraftReadState<T> =
  | { readonly kind: 'missing' }
  | { readonly kind: 'ready'; readonly stored: StoredPageDraft<T> }
  | { readonly kind: 'blocked'; readonly reason: PageDraftBlockedReason };

/** 非破坏读取：损坏、陌生版本、过期及不可读都保留原字节，交由调用方显式清理。 */
export const readPageDraftState = <T>(key: string, options: ReadPageDraftOptions): PageDraftReadState<T> => {
  const storage = getLocalStorage();
  if (!storage) return { kind: 'blocked', reason: 'read-failed' };
  let raw: string | null;
  try { raw = storage.getItem(key); }
  catch { return { kind: 'blocked', reason: 'read-failed' }; }
  if (raw === null) return { kind: 'missing' };
  let parsed: Partial<StoredPageDraft<T>> | null;
  try { parsed = JSON.parse(raw) as Partial<StoredPageDraft<T>> | null; }
  catch { return { kind: 'blocked', reason: 'invalid' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || typeof parsed.version !== 'number' || !Number.isFinite(parsed.version)
    || typeof parsed.updatedAt !== 'number' || !Number.isFinite(parsed.updatedAt) || !('payload' in parsed)) {
    return { kind: 'blocked', reason: 'invalid' };
  }
  if (parsed.version !== options.version) return { kind: 'blocked', reason: 'version-mismatch' };
  if (Date.now() - parsed.updatedAt > options.ttlMs) return { kind: 'blocked', reason: 'expired' };
  return { kind: 'ready', stored: parsed as StoredPageDraft<T> };
};
