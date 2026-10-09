/**
 * Web 各页记忆偏好的字段归属与存储键（DESK-SET-007 / DESK-SET-003）。
 *
 * 存储键是页面自己的持久化 owner——`/details`（含 `/creator` 工作台）与
 * `/canshou` 的整 blob 都是偏好对象，草稿另存于 `*AnswersDraft` 键。
 * `/free` 的偏好嵌在原草稿文档中，键和校验归 free/draft owner。
 * 页面与设置页读写同一个键：本文件是键的唯一来源，页面组件从这里
 * import，不再各自内联字面量。
 */
import {
  ADVANCED_VISIBLE_FIELD,
  SUBLIMATION_HISTORY_STATE_FIELDS,
  ALLOW_MULTIPLE_QUESTIONNAIRES_FIELD,
  createPagePreferencesAdapter,
  GENERATION_MODE_FIELD,
  IMAGE_SAVE_MODE_FIELD,
  JSON_SAVE_MODE_FIELD,
  QUESTIONNAIRE_SELECTIONS_FIELD,
  SELECTED_LANGUAGE_FIELD,
  SHOW_ANSWER_REVIEW_FIELD,
  SHOW_BULK_FILL_FIELD,
  SHOW_DETAILS_FIELD,
  SHOW_FIELD_GUIDE_FIELD,
  SHOW_LANGUAGE_SECTION_FIELD,
  SHOW_QUESTIONNAIRE_SETTINGS_FIELD,
  type PagePreferenceSource,
  type PagePreferencesAdapter,
  type SettingsStorageLike,
} from '@mahoshojo/ui-web/settings';

import { createEmptyScenarioPageDraftDocument, migrateScenarioAdvancedPreference, parseScenarioPageDraftDocument, readScenarioLegacyPreferences, removeLegacyScenarioAdvancedPreference, SCENARIO_PAGE_DRAFT_KEY } from '../scenario-page-draft';
import { DEFAULT_SUBLIMATION_STATE_PREFERENCES, SUBLIMATION_PREFERENCE_KEY, SUBLIMATION_STATE_PREF_KEY, parseSublimationPreferencesDocument, parseSublimationStatePreferencesDocument } from '../sublimation/preferences';
import { createEmptyFreeDraftDocument, FREE_DRAFT_KEY, parseFreeDraftDocument } from '../free/draft';

export const DETAILS_PREFERENCES_STORAGE_KEY = 'mahoshojo.details.preferences.v1';
export const CANSHOU_PREFERENCES_STORAGE_KEY = 'mahoshojo.canshou.preferences.v1';

export const WEB_DETAILS_PREFERENCES: PagePreferenceSource = {
  pageId: 'details',
  title: '魔法少女生成（/details）',
  description: '这些偏好由 /details 与 /creator 共用；在任一页面或此处修改都会共同生效。',
  pagePath: '/details',
  storageKey: DETAILS_PREFERENCES_STORAGE_KEY,
  scope: 'blob',
  fields: [
    GENERATION_MODE_FIELD,
    SELECTED_LANGUAGE_FIELD,
    IMAGE_SAVE_MODE_FIELD,
    JSON_SAVE_MODE_FIELD,
    SHOW_LANGUAGE_SECTION_FIELD,
    SHOW_BULK_FILL_FIELD,
    SHOW_ANSWER_REVIEW_FIELD,
    SHOW_DETAILS_FIELD,
    ALLOW_MULTIPLE_QUESTIONNAIRES_FIELD,
    SHOW_QUESTIONNAIRE_SETTINGS_FIELD,
    QUESTIONNAIRE_SELECTIONS_FIELD,
  ],
};

export const WEB_CANSHOU_PREFERENCES: PagePreferenceSource = {
  pageId: 'canshou',
  title: '残兽生成（/canshou）',
  pagePath: '/canshou',
  storageKey: CANSHOU_PREFERENCES_STORAGE_KEY,
  scope: 'blob',
  fields: [
    GENERATION_MODE_FIELD,
    SELECTED_LANGUAGE_FIELD,
    IMAGE_SAVE_MODE_FIELD,
    JSON_SAVE_MODE_FIELD,
    SHOW_LANGUAGE_SECTION_FIELD,
    SHOW_BULK_FILL_FIELD,
    SHOW_ANSWER_REVIEW_FIELD,
    ALLOW_MULTIPLE_QUESTIONNAIRES_FIELD,
    SHOW_QUESTIONNAIRE_SETTINGS_FIELD,
    QUESTIONNAIRE_SELECTIONS_FIELD,
  ],
};

export const WEB_FREE_PREFERENCES: PagePreferenceSource = {
  pageId: 'free',
  title: '自由生成（/free）',
  pagePath: '/free',
  storageKey: FREE_DRAFT_KEY,
  scope: 'fields',
  fields: [SHOW_FIELD_GUIDE_FIELD, SHOW_LANGUAGE_SECTION_FIELD],
  createDocumentForFirstWrite: createEmptyFreeDraftDocument,
  validateDocument: parseFreeDraftDocument,
};

export const WEB_SCENARIO_PREFERENCES: PagePreferenceSource = {
  pageId: 'scenario', title: '情景生成（/scenario）', pagePath: '/scenario',
  storageKey: SCENARIO_PAGE_DRAFT_KEY, scope: 'fields', fieldsContainer: 'payload',
  fields: [{ ...ADVANCED_VISIBLE_FIELD, resetValue: false }],
  createDocumentForFirstWrite: createEmptyScenarioPageDraftDocument,
  validateDocument: parseScenarioPageDraftDocument,
};

export const WEB_SUBLIMATION_PREFERENCES: PagePreferenceSource = {
  pageId: 'sublimation', title: '升华（/sublimation）', pagePath: '/sublimation',
  storageKey: SUBLIMATION_PREFERENCE_KEY, scope: 'fields', fields: [ADVANCED_VISIBLE_FIELD],
  createDocumentForFirstWrite: () => ({}), validateDocument: parseSublimationPreferencesDocument,
};
export const WEB_SUBLIMATION_STATE_PREFERENCES: PagePreferenceSource = {
  pageId: 'sublimation-state', title: '升华历史与状态策略', pagePath: '/sublimation',
  storageKey: SUBLIMATION_STATE_PREF_KEY, scope: 'fields',
  fields: SUBLIMATION_HISTORY_STATE_FIELDS.map((field) => ({
    ...field,
    defaultValue: DEFAULT_SUBLIMATION_STATE_PREFERENCES[field.key as keyof typeof DEFAULT_SUBLIMATION_STATE_PREFERENCES],
  })),
  createDocumentForFirstWrite: () => ({}), validateDocument: parseSublimationStatePreferencesDocument,
};

const getStorage = (): SettingsStorageLike | null => {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
};

/** Scenario 的一次性兼容只在 owner 层，通用设置 adapter 不认识 legacy 键。 */
export const createScenarioPagePreferenceAdapter = (storage: SettingsStorageLike | null = getStorage()): PagePreferencesAdapter => {
  const adapter = createPagePreferencesAdapter({
    ...WEB_SCENARIO_PREFERENCES,
    createDocumentForFirstWrite: () => createEmptyScenarioPageDraftDocument(storage ? readScenarioLegacyPreferences(storage) : {}),
  }, storage);
  return {
    ...adapter,
    read() {
      const migrated = migrateScenarioAdvancedPreference(storage);
      const result = adapter.read();
      if (result.status === 'corrupted' || migrated.value === undefined) return result;
      return { status: 'ready', values: { ...(result.status === 'ready' ? result.values : {}), isAdvancedVisible: migrated.value } };
    },
    writeField(key, value) {
      const saved = adapter.writeField(key, value);
      if (saved && storage) removeLegacyScenarioAdvancedPreference(storage);
      return saved;
    },
    reset() {
      // 空 canonical 仍需写 false；不能把 legacy true 当成没有可重置的字段。
      const saved = adapter.writeField('isAdvancedVisible', false);
      if (saved && storage) removeLegacyScenarioAdvancedPreference(storage);
      return saved;
    },
  };
};

export const WEB_PAGE_PREFERENCE_SOURCES: readonly PagePreferenceSource[] = [
  WEB_DETAILS_PREFERENCES,
  WEB_CANSHOU_PREFERENCES,
  WEB_FREE_PREFERENCES,
  WEB_SCENARIO_PREFERENCES,
  WEB_SUBLIMATION_PREFERENCES,
  WEB_SUBLIMATION_STATE_PREFERENCES,
];

export const createWebPagePreferenceAdapters = () =>
  WEB_PAGE_PREFERENCE_SOURCES.map((source) => source === WEB_SCENARIO_PREFERENCES
    ? createScenarioPagePreferenceAdapter() : createPagePreferencesAdapter(source));
