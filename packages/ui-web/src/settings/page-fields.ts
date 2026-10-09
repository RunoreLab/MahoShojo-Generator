/**
 * 各页记忆偏好的字段登记（DESK-SET-007「AI 与生成」组）。
 *
 * 这里只放**两端共用的字段语义**——标签、选项、说明与空态默认。存储键
 * 与 blob/fields 形态由宿主在装配 adapter 时注入（Web 的偏好键在页面侧
 * 定义，Desktop 的草稿键归 `features/<page>/session.ts`），共享层不抢占
 * 持久化所有权。
 *
 * `defaultValue` 是「页面未显式写入时的生效默认」，用于设置页空态如实
 * 展示——保存方式与页面同一 UA 推导（`recommendedSaveModes`），不存在
 * 第二套「设置页默认」。
 */
import { ARENA_HISTORY_RETENTION_LABELS } from '@mahoshojo/domain/sublimation';
import { recommendedSaveModes } from '../details-controls/save-mode-defaults';
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
  defaultValue: 'non-stream',
};

export const SELECTED_LANGUAGE_FIELD: PagePreferenceField = {
  key: 'selectedLanguage',
  label: '生成语言',
  description: '语言代码（如 zh-CN、en-US）。',
  kind: 'text',
  defaultValue: 'zh-CN',
};

export const IMAGE_SAVE_MODE_FIELD: PagePreferenceField = {
  key: 'imageSaveMode',
  label: '设定长图保存方式',
  kind: 'select',
  options: [
    { value: 'download', label: '一键下载' },
    { value: 'modal', label: '预览弹窗保存' },
  ],
  // 与生成页同一 UA 推导：移动端推荐弹窗，其余一键下载。
  defaultValue: () => recommendedSaveModes().imageSaveMode,
};

export const JSON_SAVE_MODE_FIELD: PagePreferenceField = {
  key: 'jsonSaveMode',
  label: '设定文件保存方式',
  kind: 'select',
  options: [
    { value: 'download', label: '下载 JSON' },
    { value: 'text', label: '复制原始数据' },
  ],
  // 与生成页同一 UA 推导：移动端推荐复制，其余下载 JSON。
  defaultValue: () => recommendedSaveModes().jsonSaveMode,
};

export const SHOW_FIELD_GUIDE_FIELD: PagePreferenceField = {
  key: 'showFieldGuide',
  label: '默认展开「字段速览」',
  kind: 'boolean',
  defaultValue: false,
};

export const SHOW_LANGUAGE_SECTION_FIELD: PagePreferenceField = {
  key: 'showLanguageSection',
  label: '默认展开「生成语言」',
  kind: 'boolean',
  defaultValue: false,
};

export const SHOW_BULK_FILL_FIELD: PagePreferenceField = {
  key: 'showBulkFillSection',
  label: '默认展开「一键填充」',
  kind: 'boolean',
  defaultValue: false,
};

export const SHOW_ANSWER_REVIEW_FIELD: PagePreferenceField = {
  key: 'showAnswerReview',
  label: '默认展开「回答回顾」',
  kind: 'boolean',
  defaultValue: false,
};

export const SHOW_DETAILS_FIELD: PagePreferenceField = {
  key: 'showDetails',
  label: '默认展开「设定说明」',
  kind: 'boolean',
  defaultValue: false,
};

export const ALLOW_MULTIPLE_QUESTIONNAIRES_FIELD: PagePreferenceField = {
  key: 'allowMultipleQuestionnaires',
  label: '允许同时回答多份问卷',
  kind: 'boolean',
  defaultValue: false,
};

export const SHOW_QUESTIONNAIRE_SETTINGS_FIELD: PagePreferenceField = {
  key: 'showQuestionnaireSettings',
  label: '默认展开「问卷设置」',
  kind: 'boolean',
  defaultValue: false,
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
  // 与问卷草稿领域层默认一致（QUESTIONNAIRE_DRAFT_DEFAULT_LANGUAGE）。
  defaultValue: 'zh-CN',
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

/** 三个已迁生成页的既有高级选项展开偏好。 */
export const ADVANCED_VISIBLE_FIELD: PagePreferenceField = {
  key: 'isAdvancedVisible', label: '默认展开「高级选项」', kind: 'boolean', defaultValue: false,
};

/** 标签/选项共用；默认与 reset 值由真实 owner 注入，避免第二套策略默认。 */
export const SUBLIMATION_HISTORY_STATE_FIELDS: readonly PagePreferenceField[] = [
  { key: 'readArenaHistory', label: '升华时读取历战记录', kind: 'boolean' },
  { key: 'writeArenaHistory', label: '升华后写入历战记录', kind: 'boolean' },
  { key: 'readCurrentState', label: '升华时读取当前状态', kind: 'boolean' },
  { key: 'writeCurrentState', label: '升华后写入当前状态', kind: 'boolean', description: '流式升华仍仅保留原卡状态；此偏好保留供非流式使用。' },
  {
    key: 'arenaHistoryRetentionStrategy', label: '历史保留策略', kind: 'select',
    description: '开启历史写入后，于升华结果中应用此策略；设置本身不会清除任何历史。',
    options: Object.entries(ARENA_HISTORY_RETENTION_LABELS).map(([value, label]) => ({ value, label })),
  },
];
