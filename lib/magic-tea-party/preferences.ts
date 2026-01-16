import type { MagicTeaPartyPreferences } from '@/lib/magic-tea-party/types';
import {
  MAGIC_TEA_PARTY_CACHE_DEFAULT_MAX_BYTES,
  MAGIC_TEA_PARTY_CACHE_DEFAULT_MAX_GLOBAL,
  MAGIC_TEA_PARTY_CACHE_DEFAULT_MAX_PER_SESSION,
} from '@/lib/magic-tea-party/cache';

const STORAGE_KEY = 'magic-tea-party:preferences';
const LEGACY_STORAGE_KEY = 'magic-tavern:preferences';

export const DEFAULT_MAGIC_TEA_PARTY_PREFERENCES: MagicTeaPartyPreferences = {
  outputFormat: 'jsonl',
  enableChoices: false,
  choiceCount: 3,
  language: 'zh-CN',
  userDisplayName: '旅人',
  enableSummary: true,
  readArenaHistory: true,
  readArenaHistoryLimit: 3,
  isArenaHistoryUnlimited: false,
  readCurrentState: true,
  writeArenaHistory: false,
  writeCurrentState: false,
  tachieCacheMaxPerSession: MAGIC_TEA_PARTY_CACHE_DEFAULT_MAX_PER_SESSION,
  tachieCacheMaxGlobal: MAGIC_TEA_PARTY_CACHE_DEFAULT_MAX_GLOBAL,
  tachieCacheMaxBytes: MAGIC_TEA_PARTY_CACHE_DEFAULT_MAX_BYTES,
};

const isChoiceCount = (value: unknown): value is 2 | 3 | 4 => value === 2 || value === 3 || value === 4;
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clampCacheCount = (value: unknown, fallback: number, min: number, max: number): number => {
  if (isFiniteNumber(value)) return Math.max(min, Math.min(max, Math.floor(value)));
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Math.max(min, Math.min(max, Math.floor(Number(value))));
  }
  return fallback;
};
const clampCacheBytes = (value: unknown, fallback: number): number => {
  const min = 32 * 1024 * 1024;
  const max = 5 * 1024 * 1024 * 1024;
  if (isFiniteNumber(value)) return Math.max(min, Math.min(max, Math.floor(value)));
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Math.max(min, Math.min(max, Math.floor(Number(value))));
  }
  return fallback;
};
const clampHistoryLimit = (value: unknown): number => {
  if (isFiniteNumber(value)) return Math.max(1, Math.min(999, Math.floor(value)));
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Math.max(1, Math.min(999, Math.floor(Number(value))));
  }
  return DEFAULT_MAGIC_TEA_PARTY_PREFERENCES.readArenaHistoryLimit;
};

export function readMagicTeaPartyPreferences(): MagicTeaPartyPreferences {
  if (typeof window === 'undefined') return DEFAULT_MAGIC_TEA_PARTY_PREFERENCES;
  try {
    const raw =
      window.localStorage.getItem(STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw && !window.localStorage.getItem(STORAGE_KEY)) {
      window.localStorage.setItem(STORAGE_KEY, raw);
    }
    if (!raw) return DEFAULT_MAGIC_TEA_PARTY_PREFERENCES;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_MAGIC_TEA_PARTY_PREFERENCES;

    const outputFormat = parsed.outputFormat === 'markdown' ? 'markdown' : 'jsonl';
    const enableChoices = typeof parsed.enableChoices === 'boolean' ? parsed.enableChoices : DEFAULT_MAGIC_TEA_PARTY_PREFERENCES.enableChoices;
    const choiceCount = isChoiceCount(parsed.choiceCount) ? parsed.choiceCount : DEFAULT_MAGIC_TEA_PARTY_PREFERENCES.choiceCount;
    const language = parsed.language === 'ja-JP' || parsed.language === 'en-US' ? parsed.language : 'zh-CN';
    const userDisplayName =
      typeof parsed.userDisplayName === 'string' && parsed.userDisplayName.trim()
        ? parsed.userDisplayName.trim().slice(0, 20)
        : DEFAULT_MAGIC_TEA_PARTY_PREFERENCES.userDisplayName;
    const enableSummary = typeof parsed.enableSummary === 'boolean' ? parsed.enableSummary : DEFAULT_MAGIC_TEA_PARTY_PREFERENCES.enableSummary;

    const lastPresetId = typeof parsed.lastPresetId === 'string' && parsed.lastPresetId.trim() ? parsed.lastPresetId.trim() : undefined;
    const lastWorldbookPresetId =
      typeof parsed.lastWorldbookPresetId === 'string' && parsed.lastWorldbookPresetId.trim() ? parsed.lastWorldbookPresetId.trim() : undefined;

    const readArenaHistory = typeof parsed.readArenaHistory === 'boolean' ? parsed.readArenaHistory : DEFAULT_MAGIC_TEA_PARTY_PREFERENCES.readArenaHistory;
    const readArenaHistoryLimit = clampHistoryLimit(parsed.readArenaHistoryLimit);
    const isArenaHistoryUnlimited =
      typeof parsed.isArenaHistoryUnlimited === 'boolean' ? parsed.isArenaHistoryUnlimited : DEFAULT_MAGIC_TEA_PARTY_PREFERENCES.isArenaHistoryUnlimited;
    const readCurrentState = typeof parsed.readCurrentState === 'boolean' ? parsed.readCurrentState : DEFAULT_MAGIC_TEA_PARTY_PREFERENCES.readCurrentState;
    const writeArenaHistory = typeof parsed.writeArenaHistory === 'boolean' ? parsed.writeArenaHistory : DEFAULT_MAGIC_TEA_PARTY_PREFERENCES.writeArenaHistory;
    const writeCurrentState = typeof parsed.writeCurrentState === 'boolean' ? parsed.writeCurrentState : DEFAULT_MAGIC_TEA_PARTY_PREFERENCES.writeCurrentState;
    const tachieCacheMaxPerSession = clampCacheCount(
      parsed.tachieCacheMaxPerSession,
      DEFAULT_MAGIC_TEA_PARTY_PREFERENCES.tachieCacheMaxPerSession,
      1,
      200
    );
    const tachieCacheMaxGlobal = clampCacheCount(
      parsed.tachieCacheMaxGlobal,
      DEFAULT_MAGIC_TEA_PARTY_PREFERENCES.tachieCacheMaxGlobal,
      tachieCacheMaxPerSession,
      1000
    );
    const tachieCacheMaxBytes = clampCacheBytes(
      parsed.tachieCacheMaxBytes,
      DEFAULT_MAGIC_TEA_PARTY_PREFERENCES.tachieCacheMaxBytes
    );

    return {
      outputFormat,
      enableChoices,
      choiceCount,
      language,
      userDisplayName,
      enableSummary,
      readArenaHistory,
      readArenaHistoryLimit,
      isArenaHistoryUnlimited,
      readCurrentState,
      writeArenaHistory,
      writeCurrentState,
      tachieCacheMaxPerSession,
      tachieCacheMaxGlobal,
      tachieCacheMaxBytes,
      ...(lastPresetId ? { lastPresetId } : {}),
      ...(lastWorldbookPresetId ? { lastWorldbookPresetId } : {}),
    };
  } catch {
    return DEFAULT_MAGIC_TEA_PARTY_PREFERENCES;
  }
}

export function writeMagicTeaPartyPreferences(prefs: MagicTeaPartyPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export function patchMagicTeaPartyPreferences(patch: Partial<MagicTeaPartyPreferences>): MagicTeaPartyPreferences {
  const current = readMagicTeaPartyPreferences();
  const nextReadArenaHistoryLimit =
    typeof patch.readArenaHistoryLimit !== 'undefined' ? clampHistoryLimit(patch.readArenaHistoryLimit) : current.readArenaHistoryLimit;
  const nextCacheMaxPerSession =
    typeof patch.tachieCacheMaxPerSession !== 'undefined'
      ? clampCacheCount(patch.tachieCacheMaxPerSession, current.tachieCacheMaxPerSession, 1, 200)
      : current.tachieCacheMaxPerSession;
  const nextCacheMaxGlobal =
    typeof patch.tachieCacheMaxGlobal !== 'undefined'
      ? clampCacheCount(patch.tachieCacheMaxGlobal, current.tachieCacheMaxGlobal, nextCacheMaxPerSession, 1000)
      : current.tachieCacheMaxGlobal;
  const nextCacheMaxBytes =
    typeof patch.tachieCacheMaxBytes !== 'undefined'
      ? clampCacheBytes(patch.tachieCacheMaxBytes, current.tachieCacheMaxBytes)
      : current.tachieCacheMaxBytes;
  const next: MagicTeaPartyPreferences = {
    ...current,
    ...patch,
    choiceCount: isChoiceCount(patch.choiceCount) ? patch.choiceCount : current.choiceCount,
    readArenaHistoryLimit: nextReadArenaHistoryLimit,
    tachieCacheMaxPerSession: nextCacheMaxPerSession,
    tachieCacheMaxGlobal: nextCacheMaxGlobal,
    tachieCacheMaxBytes: nextCacheMaxBytes,
    enableSummary: typeof patch.enableSummary === 'boolean' ? patch.enableSummary : current.enableSummary,
  };
  writeMagicTeaPartyPreferences(next);
  return next;
}
