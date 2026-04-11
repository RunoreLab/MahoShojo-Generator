import {
  DEFAULT_ARENA_HISTORY_RETENTION_STRATEGY,
  normalizeArenaHistoryRetentionStrategy,
  type ArenaHistoryRetentionStrategy,
} from '@/lib/sublimation/arena-history';

type PreferencesStorageReader = Pick<Storage, 'getItem'>;
type PreferencesStorageWriter = Pick<Storage, 'setItem'>;

export type SublimationStatePreferences = {
  readArenaHistory: boolean;
  writeArenaHistory: boolean;
  readCurrentState: boolean;
  writeCurrentState: boolean;
  arenaHistoryRetentionStrategy: ArenaHistoryRetentionStrategy;
};

export const DEFAULT_SUBLIMATION_STATE_PREFERENCES: SublimationStatePreferences = {
  readArenaHistory: true,
  writeArenaHistory: true,
  readCurrentState: true,
  writeCurrentState: true,
  arenaHistoryRetentionStrategy: DEFAULT_ARENA_HISTORY_RETENTION_STRATEGY,
};

const toObjectRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const readBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

const normalizeSublimationStatePreferences = (value: unknown): SublimationStatePreferences => {
  const record = toObjectRecord(value);
  return {
    readArenaHistory: readBoolean(
      record.readArenaHistory,
      DEFAULT_SUBLIMATION_STATE_PREFERENCES.readArenaHistory,
    ),
    writeArenaHistory: readBoolean(
      record.writeArenaHistory,
      DEFAULT_SUBLIMATION_STATE_PREFERENCES.writeArenaHistory,
    ),
    readCurrentState: readBoolean(
      record.readCurrentState,
      DEFAULT_SUBLIMATION_STATE_PREFERENCES.readCurrentState,
    ),
    writeCurrentState: readBoolean(
      record.writeCurrentState,
      DEFAULT_SUBLIMATION_STATE_PREFERENCES.writeCurrentState,
    ),
    arenaHistoryRetentionStrategy: normalizeArenaHistoryRetentionStrategy(
      record.arenaHistoryRetentionStrategy,
    ),
  };
};

export const readSublimationStatePreferences = (
  storage: PreferencesStorageReader,
  key: string,
): SublimationStatePreferences => {
  try {
    const raw = storage.getItem(key);
    if (!raw) return DEFAULT_SUBLIMATION_STATE_PREFERENCES;
    const parsed = JSON.parse(raw);
    return normalizeSublimationStatePreferences(parsed);
  } catch {
    return DEFAULT_SUBLIMATION_STATE_PREFERENCES;
  }
};

export const writeSublimationStatePreferences = (
  storage: PreferencesStorageWriter,
  key: string,
  value: SublimationStatePreferences,
): void => {
  const normalized = normalizeSublimationStatePreferences(value);
  try {
    storage.setItem(key, JSON.stringify(normalized));
  } catch {
    // localStorage 可能不可用，忽略写入错误
  }
};
