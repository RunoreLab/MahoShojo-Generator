/**
 * 各页记忆偏好的字段登记（DESK-SET-007「AI 与生成」组）。
 *
 * 这里只放**两端共用的字段语义**——标签、选项、说明。存储键与 blob/fields
 * 形态由宿主在装配 adapter 时注入（Web 的偏好键在页面侧定义，Desktop 的
 * 草稿键归 `features/<page>/session.ts`），共享层不抢占持久化所有权。
 */
import type { PagePreferenceField } from './page-preferences';

export const GENERATION_MODE_FIELD: PagePreferenceField = {
  key: 'generationMode',
  label: '生成模式',
  description: '流式输出逐步显示正文；非流式等待完整结果后一次呈现。',
  kind: 'select',
  options: [
    { value: 'non-stream', label: '非流式' },
    { value: 'stream', label: '流式' },
  ],
};

export const SELECTED_LANGUAGE_FIELD: PagePreferenceField = {
  key: 'selectedLanguage',
  label: '生成语言',
  description: '语言代码（如 zh-CN、en-US）。',
  kind: 'text',
};

export const IMAGE_SAVE_MODE_FIELD: PagePreferenceField = {
  key: 'imageSaveMode',
  label: '设定长图保存方式',
  kind: 'select',
  options: [
    { value: 'download', label: '一键下载' },
    { value: 'modal', label: '预览弹窗保存' },
  ],
};

export const JSON_SAVE_MODE_FIELD: PagePreferenceField = {
  key: 'jsonSaveMode',
  label: '设定文件保存方式',
  kind: 'select',
  options: [
    { value: 'download', label: '下载 JSON' },
    { value: 'text', label: '复制原始数据' },
  ],
};

export const SHOW_LANGUAGE_SECTION_FIELD: PagePreferenceField = {
  key: 'showLanguageSection',
  label: '默认展开「生成语言」',
  kind: 'boolean',
};

export const SHOW_BULK_FILL_FIELD: PagePreferenceField = {
  key: 'showBulkFillSection',
  label: '默认展开「一键填充」',
  kind: 'boolean',
};

export const SHOW_ANSWER_REVIEW_FIELD: PagePreferenceField = {
  key: 'showAnswerReview',
  label: '默认展开「回答回顾」',
  kind: 'boolean',
};

export const SHOW_DETAILS_FIELD: PagePreferenceField = {
  key: 'showDetails',
  label: '默认展开「设定说明」',
  kind: 'boolean',
};

export const ALLOW_MULTIPLE_QUESTIONNAIRES_FIELD: PagePreferenceField = {
  key: 'allowMultipleQuestionnaires',
  label: '允许同时回答多份问卷',
  kind: 'boolean',
};

export const SHOW_QUESTIONNAIRE_SETTINGS_FIELD: PagePreferenceField = {
  key: 'showQuestionnaireSettings',
  label: '默认展开「问卷设置」',
  kind: 'boolean',
};

/** 记住的问卷选择集——只展示计数，修改在页面内进行。 */
export const QUESTIONNAIRE_SELECTIONS_FIELD: PagePreferenceField = {
  key: 'questionnaireSelections',
  label: '记住的问卷选择',
  description: '页面记住的问卷勾选；重置偏好会一并清除。',
  kind: 'count',
  format: (value) => (Array.isArray(value) ? `${value.length} 项` : '未设置'),
};

/**
 * Desktop 草稿自有的语言字段（`language` 而非 `selectedLanguage`）：它是
 * 草稿必填字段而非偏好键——设置页只读展示，页面内修改，重置偏好不动它。
 */
export const DRAFT_LANGUAGE_FIELD: PagePreferenceField = {
  key: 'language',
  label: '生成语言',
  description: '随草稿保存；请在生成页修改。重置偏好不会影响它。',
  kind: 'readonly',
  notResettable: true,
};

export const formatPagePreferenceValue = (
  field: PagePreferenceField,
  value: unknown,
): string => {
  if (field.format) return field.format(value);
  if (value === undefined) return '未设置';
  if (field.kind === 'boolean') return value === true ? '开' : '关';
  if (field.kind === 'select') {
    return field.options?.find((option) => option.value === value)?.label ?? String(value);
  }
  return typeof value === 'string' ? value : '未设置';
};
