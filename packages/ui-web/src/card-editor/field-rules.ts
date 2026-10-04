/**
 * 数据卡字段编辑的纯规则。
 *
 * 从 Web 角色管理的递归表单原样提取（D3.2b-1），两端共用同一套字段顺序、隐藏规则与路径写入语义；
 * 模板转换、schema 校验、原生性与敏感词仍由宿主负责。
 */

export const isEditableRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** 渲染顺序：基本信息 → 外观 → 魔装 → 奇境 → 繁开 → 分析 → 问卷 → 历战记录。 */
const KEY_ORDER = [
  'templateId', 'codename', 'name', 'title', 'appearance', 'magicConstruct', 'wonderlandRule',
  'blooming', 'analysis', 'content', 'userAnswers', 'elements', 'arena_history', 'current_state', 'adjudicationEvents',
];

export const orderDataCardFieldKeys = (keys: readonly string[]): string[] =>
  [...keys].sort((a, b) => {
    const indexA = KEY_ORDER.indexOf(a);
    const indexB = KEY_ORDER.indexOf(b);
    if (indexA === -1 && indexB === -1) return a.localeCompare(b);
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });

/**
 * 不在通用表单里编辑的字段：内部字段、签名、预设标记、历战/当前状态/裁定事件（各有专用入口或只读），
 * 以及模板 ID（模板切换走转换流程，不能被当成普通字符串改写）。
 */
const HIDDEN_KEYS = new Set(['signature', 'isPreset', 'arena_history', 'current_state', 'adjudicationEvents', 'templateId']);

export const isHiddenDataCardField = (key: string): boolean => key.startsWith('_') || HIDDEN_KEYS.has(key);

/** `magicConstruct` → `magic Construct`；与 Web 原表单的标签一致（另配 `capitalize` 样式）。 */
export const formatDataCardFieldLabel = (key: string): string => key.replace(/([A-Z])/g, ' $1');

/** 代号与名称的输入上限，沿用 Web 角色管理的产品规则。 */
export const DATA_CARD_NAME_MAX_LENGTH = 20;

/**
 * 按点分路径写入一个值，返回新对象；不修改输入。
 *
 * 中间段缺失时按下一段是否为数字创建数组或对象。`templateId` 不能经由字段编辑改写，返回原对象。
 */
export const setDataCardFieldValue = <T>(data: T, path: string, value: unknown): T => {
  if (path === 'templateId') return data;
  const next = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
  let current: Record<string, unknown> = next;
  const keys = path.split('.');
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!;
    const nextKey = keys[i + 1]!;
    const isNextKeyNumeric = !Number.isNaN(parseInt(nextKey, 10));
    if (isNextKeyNumeric && !Array.isArray(current[key])) {
      current[key] = [];
    } else if (!isNextKeyNumeric && !isEditableRecord(current[key])) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]!] = value;
  return next as T;
};

/** 表单元素的统一 DOM id，路径中的非安全字符折叠为 `_`。 */
export const toDataCardFieldId = (path: string): string =>
  `editor-field-${path.replace(/\./g, '__').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
