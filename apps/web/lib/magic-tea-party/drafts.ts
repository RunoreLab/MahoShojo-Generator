const STORAGE_PREFIX = 'magic-tea-party:drafts:';
const MAX_DRAFT_CHARS = 20_000;

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

const safeRemove = (key: string): void => {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
};

const buildKey = (sessionId: string): string => `${STORAGE_PREFIX}${sessionId}`;

export const readMagicTeaPartyDraft = (sessionId: string): string | null => {
  if (typeof window === 'undefined') return null;
  if (!sessionId) return null;
  return safeGet(buildKey(sessionId));
};

export const writeMagicTeaPartyDraft = (sessionId: string, value: string): void => {
  if (typeof window === 'undefined') return;
  if (!sessionId) return;
  const capped = value.length > MAX_DRAFT_CHARS ? value.slice(0, MAX_DRAFT_CHARS) : value;
  safeSet(buildKey(sessionId), capped);
};

export const clearMagicTeaPartyDraft = (sessionId: string): void => {
  if (typeof window === 'undefined') return;
  if (!sessionId) return;
  safeRemove(buildKey(sessionId));
};
