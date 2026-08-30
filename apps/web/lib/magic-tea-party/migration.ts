const LEGACY_PREFIX = 'magic-tavern';
const NEW_PREFIX = 'magic-tea-party';
const LOCAL_STORAGE_MIGRATION_KEY = 'magic-tea-party:migrated-local-storage-v1';

const safeGet = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeSet = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
};

export const migrateMagicTeaPartyLocalStorage = (): void => {
  if (typeof window === 'undefined') return;
  if (!('localStorage' in window)) return;
  if (safeGet(LOCAL_STORAGE_MIGRATION_KEY)) return;

  const copyIfMissing = (from: string, to: string) => {
    if (safeGet(to) !== null) return;
    const legacyValue = safeGet(from);
    if (legacyValue === null) return;
    safeSet(to, legacyValue);
  };

  copyIfMissing(`${LEGACY_PREFIX}:preferences`, `${NEW_PREFIX}:preferences`);
  copyIfMissing(`${LEGACY_PREFIX}:recent-session`, `${NEW_PREFIX}:recent-session`);
  copyIfMissing(`${LEGACY_PREFIX}:tachie-workflow.v1`, `${NEW_PREFIX}:tachie-workflow.v1`);

  let keys: string[] = [];
  try {
    keys = Array.from({ length: window.localStorage.length })
      .map((_, index) => window.localStorage.key(index))
      .filter((key): key is string => Boolean(key));
  } catch {
    keys = [];
  }

  for (const key of keys) {
    if (key.startsWith(`${LEGACY_PREFIX}.customProvider.`)) {
      const nextKey = key.replace(`${LEGACY_PREFIX}.customProvider.`, `${NEW_PREFIX}.customProvider.`);
      copyIfMissing(key, nextKey);
      continue;
    }

    if (key.startsWith(`${LEGACY_PREFIX}:drafts:`)) {
      const nextKey = key.replace(`${LEGACY_PREFIX}:drafts:`, `${NEW_PREFIX}:drafts:`);
      copyIfMissing(key, nextKey);
      continue;
    }
  }

  safeSet(LOCAL_STORAGE_MIGRATION_KEY, new Date().toISOString());
};
