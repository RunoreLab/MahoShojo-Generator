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
} from '@mahoshojo/ui-web/settings';

import { createEmptyFreeDraftDocument, FREE_DRAFT_KEY, parseFreeDraftDocument } from '../free/draft';

export const DETAILS_PREFERENCES_STORAGE_KEY = 'mahoshojo.details.preferences.v1';
export const CANSHOU_PREFERENCES_STORAGE_KEY = 'mahoshojo.canshou.preferences.v1';

export const WEB_DETAILS_PREFERENCES: PagePreferenceSource = {
  pageId: 'details',
  title: '魔法少女生成（/details）',
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

export const WEB_PAGE_PREFERENCE_SOURCES: readonly PagePreferenceSource[] = [
  WEB_DETAILS_PREFERENCES,
  WEB_CANSHOU_PREFERENCES,
  WEB_FREE_PREFERENCES,
];

export const createWebPagePreferenceAdapters = () =>
  WEB_PAGE_PREFERENCE_SOURCES.map((source) => createPagePreferencesAdapter(source));
