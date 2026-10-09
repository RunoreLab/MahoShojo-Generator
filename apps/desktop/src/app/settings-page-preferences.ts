/**
 * Desktop 各页记忆偏好的字段归属（DESK-SET-007 / DESK-SET-003）。
 *
 * 独立成纯模块而不挂在 `settings-page.tsx` 里：跨层回归测试要直接拿真实
 * 装配（存储键 + fields 首写工厂）喂给会话层验证，不应为两个常量拉进
 * React/Router/面板的整条依赖链。
 *
 * Desktop 的偏好字段与草稿同存在一个文档里（`mahoshojo.desktop.*.draft.v1`），
 * 因此 scope 是 `fields`：设置页经同一 adapter 读写/重置这些字段，重置只删
 * 登记的偏好键，`version`/`answers`/`language`/`output` 与未知字段原样保留——
 * 草稿与已保存结果不受「重置偏好」影响。
 *
 * 问卷页的 `generationMode`（流式/非流式）不落盘，所以不登记——
 * 没有持久化值的字段进设置页只会伪造出一个「第二默认值」。
 *
 * `/free` 本片仅登记两个展开开关；模式/语言/schema 仍由原页面管理。
 * 问卷空草稿键的首写经 `createEmptyQuestionnaireDraftDocument` 建立合法草稿
 * 空壳（version/answers/language 必填面），而不是设置页自造结构——产物
 * 通过 `parseDraft`，被 `isResidueDraft` 判为残余，不触发恢复门禁。
 */
import {
  ALLOW_MULTIPLE_QUESTIONNAIRES_FIELD,
  DRAFT_LANGUAGE_FIELD,
  IMAGE_SAVE_MODE_FIELD,
  JSON_SAVE_MODE_FIELD,
  QUESTIONNAIRE_SELECTIONS_FIELD,
  SHOW_DETAILS_FIELD,
  SHOW_FIELD_GUIDE_FIELD,
  SHOW_LANGUAGE_SECTION_FIELD,
  type PagePreferenceField,
  type PagePreferenceSource,
} from '@mahoshojo/ui-web/settings';

import { CANSHOU_DRAFT_KEY, validateCanshouDraftDocument } from '../features/canshou/session';
import { createEmptyFreeDraftDocument, FREE_DRAFT_KEY, validateFreeDraftDocument } from '../features/free/session';
import { DETAILS_DRAFT_KEY, validateDetailsDraftDocument } from '../features/details/session';
import { createEmptyQuestionnaireDraftDocument } from '../features/questionnaire/session';

const QUESTIONNAIRE_DRAFT_PREFERENCE_FIELDS: readonly PagePreferenceField[] = [
  DRAFT_LANGUAGE_FIELD,
  IMAGE_SAVE_MODE_FIELD,
  JSON_SAVE_MODE_FIELD,
  SHOW_DETAILS_FIELD,
  ALLOW_MULTIPLE_QUESTIONNAIRES_FIELD,
  QUESTIONNAIRE_SELECTIONS_FIELD,
];

export const DESKTOP_DETAILS_PREFERENCES: PagePreferenceSource = {
  pageId: 'details',
  title: '设定生成（/details）',
  pagePath: '/details',
  storageKey: DETAILS_DRAFT_KEY,
  scope: 'fields',
  fields: QUESTIONNAIRE_DRAFT_PREFERENCE_FIELDS,
  createDocumentForFirstWrite: createEmptyQuestionnaireDraftDocument,
  validateDocument: validateDetailsDraftDocument,
};

export const DESKTOP_CANSHOU_PREFERENCES: PagePreferenceSource = {
  pageId: 'canshou',
  title: '残兽生成（/canshou）',
  pagePath: '/canshou',
  storageKey: CANSHOU_DRAFT_KEY,
  scope: 'fields',
  fields: QUESTIONNAIRE_DRAFT_PREFERENCE_FIELDS,
  createDocumentForFirstWrite: createEmptyQuestionnaireDraftDocument,
  validateDocument: validateCanshouDraftDocument,
};

export const DESKTOP_FREE_PREFERENCES: PagePreferenceSource = {
  pageId: 'free',
  title: '自由生成（/free）',
  pagePath: '/free',
  storageKey: FREE_DRAFT_KEY,
  scope: 'fields',
  fields: [SHOW_FIELD_GUIDE_FIELD, SHOW_LANGUAGE_SECTION_FIELD],
  createDocumentForFirstWrite: createEmptyFreeDraftDocument,
  validateDocument: validateFreeDraftDocument,
};

export const DESKTOP_PAGE_PREFERENCE_SOURCES: readonly PagePreferenceSource[] = [
  DESKTOP_DETAILS_PREFERENCES,
  DESKTOP_CANSHOU_PREFERENCES,
  DESKTOP_FREE_PREFERENCES,
];
