import type { StoredPageDraft } from '@/lib/page-draft-storage';
import type { SettingsStorageLike } from '@mahoshojo/ui-web/settings';
import { SCENARIO_OPTIONAL_FIELDS } from '@mahoshojo/ui-web/scenario';

export const SCENARIO_PREFERENCE_KEY = 'mahoshojo.scenario.preferences.v1';
export const SCENARIO_PAGE_DRAFT_KEY = 'mahoshojo.scenario.page-draft.v1';
export const SCENARIO_PAGE_DRAFT_VERSION = 1;
export const SCENARIO_PAGE_DRAFT_TTL_MS = 1000 * 60 * 60 * 24 * 30;

type ScenarioGenerationMode = 'stream' | 'non-stream';

export type ScenarioPageDraftPayload = {
  answers: Record<string, string>;
  scenarioTitleHint: string;
  fieldsToKeepEmpty: string[];
  isAdvancedVisible: boolean;
  selectedLanguage: string;
  generationMode: ScenarioGenerationMode;
  generalScenarioDraft: Record<string, unknown> | null;
  generalScenarioDraftEdited: boolean;
};

type ScenarioPageDraftInput = {
  answers: Record<string, string>;
  scenarioTitleHint: string;
  fieldsToKeepEmpty: string[];
  isAdvancedVisible: boolean;
  selectedLanguage: string;
  generationMode: ScenarioGenerationMode;
  generalScenarioDraft: Record<string, unknown> | null;
  generalScenarioDraftEdited: boolean;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeAnswers = (value: unknown): Record<string, string> => {
  if (!isPlainObject(value)) return {};

  const answers: Record<string, string> = {};
  for (const [key, answer] of Object.entries(value)) {
    if (typeof key === 'string' && typeof answer === 'string' && answer.trim()) {
      answers[key] = answer;
    }
  }
  return answers;
};

const normalizeGeneralScenarioDraft = (value: unknown): Record<string, unknown> | null => {
  if (!isPlainObject(value)) return null;

  const nextDraft: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    if (typeof fieldValue === 'string' || Array.isArray(fieldValue) || isPlainObject(fieldValue) || typeof fieldValue === 'number' || typeof fieldValue === 'boolean' || fieldValue === null) {
      nextDraft[key] = fieldValue;
    }
  }

  return Object.keys(nextDraft).length > 0 ? nextDraft : null;
};

const normalizeScenarioPageDraftPayload = (input: unknown): ScenarioPageDraftPayload | null => {
  if (!isPlainObject(input)) return null;

  const answers = normalizeAnswers(input.answers);
  const scenarioTitleHint = typeof input.scenarioTitleHint === 'string' ? input.scenarioTitleHint.trim() : '';
  const fieldsToKeepEmpty = Array.isArray(input.fieldsToKeepEmpty)
    ? input.fieldsToKeepEmpty.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const isAdvancedVisible = input.isAdvancedVisible === true;
  const selectedLanguage = typeof input.selectedLanguage === 'string' && input.selectedLanguage.trim()
    ? input.selectedLanguage
    : 'zh-CN';
  const generationMode = input.generationMode === 'stream' ? 'stream' : 'non-stream';
  const generalScenarioDraft = normalizeGeneralScenarioDraft(input.generalScenarioDraft);
  const generalScenarioDraftEdited = input.generalScenarioDraftEdited === true;

  const hasMeaningfulContent =
    Object.keys(answers).length > 0 ||
    scenarioTitleHint.length > 0 ||
    fieldsToKeepEmpty.length > 0 ||
    isAdvancedVisible ||
    selectedLanguage !== 'zh-CN' ||
    generationMode !== 'non-stream' ||
    generalScenarioDraft !== null ||
    generalScenarioDraftEdited;

  if (!hasMeaningfulContent) return null;

  return {
    answers,
    scenarioTitleHint,
    fieldsToKeepEmpty,
    isAdvancedVisible,
    selectedLanguage,
    generationMode,
    generalScenarioDraft,
    generalScenarioDraftEdited,
  };
};

export const buildScenarioPageDraftPayload = (input: ScenarioPageDraftInput): ScenarioPageDraftPayload | null =>
  normalizeScenarioPageDraftPayload(input);

export const restoreScenarioPageDraft = (input: unknown): ScenarioPageDraftPayload | null =>
  normalizeScenarioPageDraftPayload(input);


const MAX_SCENARIO_DRAFT_CHARACTERS = 4 * 1024 * 1024;
const getStorage = (): SettingsStorageLike | null => {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
};

/** 只沿页面原来认可的 legacy 初值建立空壳；既有 canonical 文档从不重建。 */
export const createEmptyScenarioPageDraftDocument = (legacy: Record<string, unknown> = {}) => ({
  version: SCENARIO_PAGE_DRAFT_VERSION,
  updatedAt: Date.now(),
  payload: {
    answers: {},
    scenarioTitleHint: typeof legacy.scenarioTitleHint === 'string' ? legacy.scenarioTitleHint : '',
    fieldsToKeepEmpty: Array.isArray(legacy.fieldsToKeepEmpty)
      ? legacy.fieldsToKeepEmpty.filter((value): value is string => typeof value === 'string' && SCENARIO_OPTIONAL_FIELDS.some((field) => field.value === value)) : [],
    isAdvancedVisible: false,
    selectedLanguage: typeof legacy.selectedLanguage === 'string' ? legacy.selectedLanguage : 'zh-CN',
    generationMode: legacy.generationMode === 'stream' ? 'stream' as const : 'non-stream' as const,
    generalScenarioDraft: null,
    generalScenarioDraftEdited: false,
  },
});

type ScenarioDraftDocument = StoredPageDraft<Omit<ScenarioPageDraftPayload, 'isAdvancedVisible'> & { isAdvancedVisible?: boolean } & Record<string, unknown>> & Record<string, unknown>;
/** 页面恢复与设置手术的同一 validator；返回原对象，不以规范化结果替换原文。 */
export const parseScenarioPageDraftDocument = (raw: string): ScenarioDraftDocument => {
  if (raw.length > MAX_SCENARIO_DRAFT_CHARACTERS) throw new Error('草稿超过大小限制');
  const parsed: unknown = JSON.parse(raw);
  if (!isPlainObject(parsed) || parsed.version !== SCENARIO_PAGE_DRAFT_VERSION
    || typeof parsed.updatedAt !== 'number' || !Number.isFinite(parsed.updatedAt)
    || Date.now() - parsed.updatedAt > SCENARIO_PAGE_DRAFT_TTL_MS || !isPlainObject(parsed.payload)) throw new Error('草稿无法读取');
  const source = parsed.payload;
  if (!isPlainObject(source.answers) || !Object.values(source.answers).every((value) => typeof value === 'string') ||
    typeof source.scenarioTitleHint !== 'string' || !Array.isArray(source.fieldsToKeepEmpty) || !source.fieldsToKeepEmpty.every((value) => typeof value === 'string') ||
    typeof source.selectedLanguage !== 'string' || !['stream', 'non-stream'].includes(String(source.generationMode)) ||
    (source.isAdvancedVisible !== undefined && typeof source.isAdvancedVisible !== 'boolean') ||
    (source.generalScenarioDraftEdited !== undefined && typeof source.generalScenarioDraftEdited !== 'boolean') ||
    (source.generalScenarioDraft != null && (!isPlainObject(source.generalScenarioDraft) || typeof source.generalScenarioDraft.title !== 'string' || typeof source.generalScenarioDraft.content !== 'string'))) throw new Error('草稿无法读取');
  return parsed as ScenarioDraftDocument;
};

export const readScenarioLegacyPreferences = (storage: SettingsStorageLike): Record<string, unknown> => {
  const raw = storage.getItem(SCENARIO_PREFERENCE_KEY);
  if (raw === null) return {};
  if (raw.length > MAX_SCENARIO_DRAFT_CHARACTERS) throw new Error('旧偏好超过大小限制');
  const parsed: unknown = JSON.parse(raw);
  if (!isPlainObject(parsed) || (parsed.isAdvancedVisible !== undefined && typeof parsed.isAdvancedVisible !== 'boolean')) throw new Error('旧偏好无法读取');
  return parsed;
};

/** canonical 成功写入后才清 legacy 同字段；清理失败不推翻 canonical。 */
export const removeLegacyScenarioAdvancedPreference = (storage: SettingsStorageLike): boolean => {
  try {
    const legacy = readScenarioLegacyPreferences(storage);
    if (!Object.prototype.hasOwnProperty.call(legacy, 'isAdvancedVisible')) return true;
    const { isAdvancedVisible: _advanced, ...rest } = legacy;
    if (Object.keys(rest).length) storage.setItem(SCENARIO_PREFERENCE_KEY, JSON.stringify(rest));
    else storage.removeItem(SCENARIO_PREFERENCE_KEY);
    return true;
  } catch { return false; }
};

/** 缺字段才迁移；显式 false 也权威。失败仍返回 legacy 值供页面保留内存选择。 */
export const migrateScenarioAdvancedPreference = (storage: SettingsStorageLike | null = getStorage()): { value?: boolean; failed: boolean } => {
  if (!storage) return { failed: true };
  let legacy: Record<string, unknown> = {};
  let canonical: ScenarioDraftDocument | null = null;
  try {
    const raw = storage.getItem(SCENARIO_PAGE_DRAFT_KEY);
    if (raw !== null) canonical = parseScenarioPageDraftDocument(raw);
    if (canonical && typeof canonical.payload.isAdvancedVisible === 'boolean') {
      removeLegacyScenarioAdvancedPreference(storage);
      return { value: canonical.payload.isAdvancedVisible, failed: false };
    }
    legacy = readScenarioLegacyPreferences(storage);
    if (typeof legacy.isAdvancedVisible !== 'boolean') return { failed: false };
    const base = canonical ?? createEmptyScenarioPageDraftDocument(legacy);
    const document = { ...base, payload: { ...base.payload, isAdvancedVisible: legacy.isAdvancedVisible } };
    const serialized = JSON.stringify(document);
    parseScenarioPageDraftDocument(serialized);
    storage.setItem(SCENARIO_PAGE_DRAFT_KEY, serialized);
    removeLegacyScenarioAdvancedPreference(storage);
    return { value: legacy.isAdvancedVisible, failed: false };
  } catch {
    // 即使 canonical 损坏，旧字段也只可用于本次内存展示，绝不覆盖坏草稿。
    try { legacy = readScenarioLegacyPreferences(storage); } catch { /* 保留不可读原文 */ }
    return { ...(typeof legacy.isAdvancedVisible === 'boolean' ? { value: legacy.isAdvancedVisible } : {}), failed: true };
  }
};

export type ScenarioPageDraftReadResult =
  | { status: 'empty'; stored: null }
  | { status: 'restored'; stored: StoredPageDraft<ScenarioPageDraftPayload> }
  | { status: 'unreadable'; stored: null };

/** 本页保留旧草稿原文；显式 false 即使无正文也不能归并为缺失。 */
export const readScenarioPageDraftState = (storage: SettingsStorageLike | null = getStorage()): ScenarioPageDraftReadResult => {
  if (!storage) return { status: 'unreadable', stored: null };
  try {
    const raw = storage.getItem(SCENARIO_PAGE_DRAFT_KEY);
    if (raw === null) return { status: 'empty', stored: null };
    const parsed = parseScenarioPageDraftDocument(raw);
    const payload = restoreScenarioPageDraft(parsed.payload);
    if (!payload && typeof parsed.payload.isAdvancedVisible !== 'boolean') return { status: 'empty', stored: null };
    return { status: 'restored', stored: { ...parsed, payload: payload ?? { ...createEmptyScenarioPageDraftDocument().payload, isAdvancedVisible: parsed.payload.isAdvancedVisible === true } } };
  } catch { return { status: 'unreadable', stored: null }; }
};
export const readScenarioPageDraft = (): StoredPageDraft<ScenarioPageDraftPayload> | null => readScenarioPageDraftState().stored;

/** 页面保存也保留未识别扩展；默认空内容保留显式 false，禁止 legacy true 复活。 */
export const writeScenarioPageDraft = (input: ScenarioPageDraftInput, storage: SettingsStorageLike | null = getStorage()): StoredPageDraft<ScenarioPageDraftPayload> | null => {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SCENARIO_PAGE_DRAFT_KEY);
    const current = raw === null ? createEmptyScenarioPageDraftDocument() : parseScenarioPageDraftDocument(raw);
    const payload = buildScenarioPageDraftPayload(input) ?? createEmptyScenarioPageDraftDocument().payload;
    const document = { ...current, updatedAt: Date.now(), payload: { ...current.payload, ...payload } };
    const serialized = JSON.stringify(document);
    parseScenarioPageDraftDocument(serialized);
    storage.setItem(SCENARIO_PAGE_DRAFT_KEY, serialized);
    removeLegacyScenarioAdvancedPreference(storage);
    return document;
  } catch { return null; }
};

/** 清空输入后保留 canonical false；legacy 清理失败也不能让展开项复活。 */
export const clearScenarioPageDraft = (): boolean => writeScenarioPageDraft(createEmptyScenarioPageDraftDocument().payload) !== null;
