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
 * 字段写入路径：逐段键名。
 *
 * 键本身可能含 `.`（`{"profile.name": "…"}` 是合法 JSON），把结构编码进点分字符串
 * 会无法区分"一个叫 `profile.name` 的键"与"`profile` 下的 `name`"，写入时会改错字段。
 * 展示用的点分形式（如敏感词附件路径）由 UI 边界单独序列化，不进入写入路径。
 */
export type DataCardFieldPath = readonly string[];

/** 与旧实现一致的中间容器类型推断：下一段看着像数组下标就补数组，否则补对象。 */
const isNumericPathKey = (key: string): boolean => !Number.isNaN(parseInt(key, 10));

/** 只复制当前一层容器；非容器输入按空对象处理（路径上的中间段缺失走同一入口）。 */
const clonePathContainer = (node: unknown): Record<string, unknown> | unknown[] => {
  if (Array.isArray(node)) return [...node];
  if (isEditableRecord(node)) return { ...node };
  return {};
};

const writeAtPath = (node: unknown, path: DataCardFieldPath, index: number, value: unknown): unknown => {
  const container = clonePathContainer(node) as Record<string, unknown>;
  const key = path[index]!;
  if (index === path.length - 1) {
    container[key] = value;
    return container;
  }
  const child = (Array.isArray(node) || isEditableRecord(node))
    ? (node as Record<string, unknown>)[key]
    : undefined;
  // 中间段类型不匹配时整个替换（与原语义一致：宁可丢弃也不把对象塞进数组形状不符的槽位）。
  const nextContainer = isNumericPathKey(path[index + 1]!)
    ? (Array.isArray(child) ? child : [])
    : (isEditableRecord(child) ? child : {});
  container[key] = writeAtPath(nextContainer, path, index + 1, value);
  return container;
};

/**
 * 按字段路径写入一个值，返回新对象；不修改输入。
 *
 * 只复制路径上的容器（copy-on-write），未触及的子树保持原引用——每次击键都深拷贝整卡
 * 在 MiB 级输入下是可感知的主线程开销。中间段缺失时按下一段是否为数字创建数组或对象。
 * 顶层 `templateId` 不能经由字段编辑改写，返回原对象。
 */
export const setDataCardFieldValue = <T>(data: T, path: DataCardFieldPath, value: unknown): T => {
  if (path.length === 0) return data;
  if (path.length === 1 && path[0] === 'templateId') return data;
  return writeAtPath(data, path, 0, value) as T;
};

/** 表单元素的统一 DOM id，路径中的非安全字符折叠为 `_`。 */
export const toDataCardFieldId = (path: string): string =>
  `editor-field-${path.replace(/\./g, '__').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
