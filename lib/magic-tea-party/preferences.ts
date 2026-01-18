import type {
  MagicTeaPartyChoiceCount,
  MagicTeaPartyPreferences,
  MagicTeaPartyOutputPlan,
  MagicTeaPartyOutputPlanMode,
} from '@/lib/magic-tea-party/types';
import {
  MAGIC_TEA_PARTY_CACHE_DEFAULT_MAX_BYTES,
  MAGIC_TEA_PARTY_CACHE_DEFAULT_MAX_GLOBAL,
  MAGIC_TEA_PARTY_CACHE_DEFAULT_MAX_PER_SESSION,
} from '@/lib/magic-tea-party/cache';

const STORAGE_KEY = 'magic-tea-party:preferences';
const LEGACY_STORAGE_KEY = 'magic-tavern:preferences';

export const DEFAULT_MAGIC_TEA_PARTY_PREFERENCES: MagicTeaPartyPreferences = {
  outputFormat: 'jsonl',
  outputPlan: {
    choices: 'auto',
    summary: 'off',
    updates: 'auto',
  },
  enableChoices: true,
  choiceCount: 4,
  language: 'zh-CN',
  userDisplayName: '旅人',
  enableSummary: true,
  updateApplyMode: 'auto',
  readArenaHistory: true,
  readArenaHistoryLimit: 3,
  isArenaHistoryUnlimited: false,
  readCurrentState: true,
  writeArenaHistory: true,
  writeCurrentState: true,
  tachieCacheMaxPerSession: MAGIC_TEA_PARTY_CACHE_DEFAULT_MAX_PER_SESSION,
  tachieCacheMaxGlobal: MAGIC_TEA_PARTY_CACHE_DEFAULT_MAX_GLOBAL,
  tachieCacheMaxBytes: MAGIC_TEA_PARTY_CACHE_DEFAULT_MAX_BYTES,
  presetCharacterPanelCollapsed: true,
  sessionRetentionDays: 60,
  maxSessions: 200,
};

const CHOICE_COUNT_MIN = 2;
const CHOICE_COUNT_MAX = 16;
const normalizeChoiceCount = (value: unknown, fallback: MagicTeaPartyChoiceCount): MagicTeaPartyChoiceCount => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const clamped = Math.max(CHOICE_COUNT_MIN, Math.min(CHOICE_COUNT_MAX, Math.floor(value)));
    return clamped as MagicTeaPartyChoiceCount;
  }
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    const clamped = Math.max(CHOICE_COUNT_MIN, Math.min(CHOICE_COUNT_MAX, Math.floor(Number(value))));
    return clamped as MagicTeaPartyChoiceCount;
  }
  return fallback;
};
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isOutputPlanMode = (value: unknown): value is MagicTeaPartyOutputPlanMode =>
  value === 'off' || value === 'auto' || value === 'on';
const sanitizeOutputPlan = (value: unknown, fallback: MagicTeaPartyOutputPlan): MagicTeaPartyOutputPlan => {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  if (!record) return fallback;
  return {
    choices: isOutputPlanMode(record.choices) ? record.choices : fallback.choices,
    summary: isOutputPlanMode(record.summary) ? record.summary : fallback.summary,
    updates: isOutputPlanMode(record.updates) ? record.updates : fallback.updates,
  };
};
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
const clampRetentionDays = (value: unknown): number => {
  if (isFiniteNumber(value)) return Math.max(1, Math.min(3650, Math.floor(value)));
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Math.max(1, Math.min(3650, Math.floor(Number(value))));
  }
  return DEFAULT_MAGIC_TEA_PARTY_PREFERENCES.sessionRetentionDays;
};
const clampMaxSessions = (value: unknown): number => {
  if (isFiniteNumber(value)) return Math.max(10, Math.min(1000, Math.floor(value)));
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Math.max(10, Math.min(1000, Math.floor(Number(value))));
  }
  return DEFAULT_MAGIC_TEA_PARTY_PREFERENCES.maxSessions;
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
    const outputPlan = sanitizeOutputPlan(parsed.outputPlan, DEFAULT_MAGIC_TEA_PARTY_PREFERENCES.outputPlan);
    const enableChoices = typeof parsed.enableChoices === 'boolean' ? parsed.enableChoices : DEFAULT_MAGIC_TEA_PARTY_PREFERENCES.enableChoices;
    const choiceCount = normalizeChoiceCount(parsed.choiceCount, DEFAULT_MAGIC_TEA_PARTY_PREFERENCES.choiceCount);
    const language = parsed.language === 'ja-JP' || parsed.language === 'en-US' ? parsed.language : 'zh-CN';
    const userDisplayName =
      typeof parsed.userDisplayName === 'string'
        ? parsed.userDisplayName.trim().slice(0, 20)
        : DEFAULT_MAGIC_TEA_PARTY_PREFERENCES.userDisplayName;
    const enableSummary = typeof parsed.enableSummary === 'boolean' ? parsed.enableSummary : DEFAULT_MAGIC_TEA_PARTY_PREFERENCES.enableSummary;
    const updateApplyMode = parsed.updateApplyMode === 'confirm' || parsed.updateApplyMode === 'draft' ? parsed.updateApplyMode : 'auto';

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
    const presetCharacterPanelCollapsed =
      typeof parsed.presetCharacterPanelCollapsed === 'boolean'
        ? parsed.presetCharacterPanelCollapsed
        : DEFAULT_MAGIC_TEA_PARTY_PREFERENCES.presetCharacterPanelCollapsed;
    const sessionRetentionDays = clampRetentionDays(parsed.sessionRetentionDays);
    const maxSessions = clampMaxSessions(parsed.maxSessions);

    return {
      outputFormat,
      outputPlan,
      enableChoices,
      choiceCount,
      language,
      userDisplayName,
      enableSummary,
      updateApplyMode,
      readArenaHistory,
      readArenaHistoryLimit,
      isArenaHistoryUnlimited,
      readCurrentState,
      writeArenaHistory,
      writeCurrentState,
      tachieCacheMaxPerSession,
      tachieCacheMaxGlobal,
      tachieCacheMaxBytes,
      presetCharacterPanelCollapsed,
      sessionRetentionDays,
      maxSessions,
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
  const nextOutputPlan = patch.outputPlan ? sanitizeOutputPlan(patch.outputPlan, current.outputPlan) : current.outputPlan;
  const nextReadArenaHistoryLimit =
    typeof patch.readArenaHistoryLimit !== 'undefined' ? clampHistoryLimit(patch.readArenaHistoryLimit) : current.readArenaHistoryLimit;
  const nextRetentionDays =
    typeof patch.sessionRetentionDays !== 'undefined' ? clampRetentionDays(patch.sessionRetentionDays) : current.sessionRetentionDays;
  const nextMaxSessions =
    typeof patch.maxSessions !== 'undefined' ? clampMaxSessions(patch.maxSessions) : current.maxSessions;
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
    outputPlan: nextOutputPlan,
    choiceCount: normalizeChoiceCount(patch.choiceCount, current.choiceCount),
    readArenaHistoryLimit: nextReadArenaHistoryLimit,
    tachieCacheMaxPerSession: nextCacheMaxPerSession,
    tachieCacheMaxGlobal: nextCacheMaxGlobal,
    tachieCacheMaxBytes: nextCacheMaxBytes,
    sessionRetentionDays: nextRetentionDays,
    maxSessions: nextMaxSessions,
    enableSummary: typeof patch.enableSummary === 'boolean' ? patch.enableSummary : current.enableSummary,
    updateApplyMode:
      patch.updateApplyMode === 'confirm' || patch.updateApplyMode === 'draft'
        ? patch.updateApplyMode
        : patch.updateApplyMode === 'auto'
          ? 'auto'
          : current.updateApplyMode,
  };
  writeMagicTeaPartyPreferences(next);
  return next;
}
