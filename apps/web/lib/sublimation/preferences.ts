import {
  DEFAULT_ARENA_HISTORY_RETENTION_STRATEGY,
  normalizeArenaHistoryRetentionStrategy,
  type ArenaHistoryRetentionStrategy,
} from '@/lib/sublimation/arena-history';

type PreferencesStorageReader = Pick<Storage, 'getItem'>;
type PreferencesStorageWriter = Pick<Storage, 'getItem' | 'setItem'>;

export const SUBLIMATION_STATE_PREF_KEY = 'sublimation-history-state-preferences-v1';
export const SUBLIMATION_PREFERENCE_KEY = 'mahoshojo.sublimation.preferences.v1';
const MAX_PREFERENCES_CHARACTERS = 4 * 1024 * 1024;

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
): boolean => {
  const normalized = normalizeSublimationStatePreferences(value);
  try {
    const raw = storage.getItem(key);
    const previous = raw === null ? {} : parseSublimationStatePreferencesDocument(raw);
    const serialized = JSON.stringify({ ...previous, ...normalized });
    parseSublimationStatePreferencesDocument(serialized);
    storage.setItem(key, serialized);
    return true;
  } catch { return false; }
};


const parsePreferenceObject = (raw: string): Record<string, unknown> => {
  if (raw.length > MAX_PREFERENCES_CHARACTERS) throw new Error('偏好超过大小限制');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('偏好损坏');
  return value as Record<string, unknown>;
};

/** 既有无 version 对象；未知扩展（包括 version）不新增协议语义。 */
export const parseSublimationStatePreferencesDocument = (raw: string): Record<string, unknown> => {
  const record = parsePreferenceObject(raw);
  for (const key of ['readArenaHistory', 'writeArenaHistory', 'readCurrentState', 'writeCurrentState']) {
    if (record[key] !== undefined && typeof record[key] !== 'boolean') throw new Error('历史/状态偏好损坏');
  }
  if (record.arenaHistoryRetentionStrategy !== undefined && normalizeArenaHistoryRetentionStrategy(record.arenaHistoryRetentionStrategy) !== record.arenaHistoryRetentionStrategy) throw new Error('历史保留策略损坏');
  return record;
};

/** general preferences 混有用户内容，验证后只允许字段级合并，不能整键清除。 */
export const parseSublimationPreferencesDocument = (raw: string): Record<string, unknown> => {
  const record = parsePreferenceObject(raw);
  for (const key of ['isAdvancedVisible', 'allowReshapeNames', 'showQuestionnaireSettings']) {
    if (record[key] !== undefined && typeof record[key] !== 'boolean') throw new Error('展开偏好损坏');
  }
  for (const key of ['selectedLanguage', 'userGuidance']) {
    if (record[key] !== undefined && typeof record[key] !== 'string') throw new Error('升华偏好损坏');
  }
  if ((record.generationMode !== undefined && !['stream', 'non-stream'].includes(String(record.generationMode)))
    || (record.targetTemplate !== undefined && !['magical-girl', 'canshou', 'general'].includes(String(record.targetTemplate)))
    || (record.fieldsToPreserve !== undefined && (!Array.isArray(record.fieldsToPreserve) || !record.fieldsToPreserve.every((field) => typeof field === 'string')))
    || (record.questionnaireSelections !== undefined && !Array.isArray(record.questionnaireSelections))) throw new Error('升华偏好损坏');
  return record;
};

export const writeSublimationPreferences = (storage: PreferencesStorageWriter, value: Record<string, unknown>): boolean => {
  try {
    const raw = storage.getItem(SUBLIMATION_PREFERENCE_KEY);
    const previous = raw === null ? {} : parseSublimationPreferencesDocument(raw);
    const serialized = JSON.stringify({ ...previous, ...value });
    parseSublimationPreferencesDocument(serialized);
    storage.setItem(SUBLIMATION_PREFERENCE_KEY, serialized);
    return true;
  } catch { return false; }
};
