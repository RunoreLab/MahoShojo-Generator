/**
 * 各页「记忆偏好」的设置页适配器（DESK-SET-007 / DESK-SET-003）。
 *
 * ## 所有权模型
 *
 * 每页的记忆偏好只有一个持久化 owner——**页面现有的存储**。设置页不新建
 * 全局默认，也不复制字段到第二处：它通过本适配器直接读写页面自己的键，
 * 因此「页面内修改」与「设置页修改」必然是同一个值。
 *
 * 两种存储形态：
 *
 * - `blob`：整个 JSON blob 就是偏好对象（Web `mahoshojo.details.preferences.v1`
 *   等）。`reset()` = removeItem——blob 内没有草稿/结果可以误伤。
 * - `fields`：偏好字段嵌在更大的文档里（Desktop 草稿键，与 answers/output
 *   同存）。`reset()` 只删除登记的偏好键，`version`/`answers`/`output` 与
 *   任何未知字段原样保留（DESK-SET-003：未知字段不得被静默删掉）。
 *   文档损坏无法解析时拒绝修改/重置——字段级手术要求先读懂文档，
 *   宁可在设置页报错，也不碰看不懂的草稿。
 *
 * 适配器是同步 localStorage 读写：设备级偏好离线可用，不触发任何账号
 * 或网络请求（DESK-SET-001「未登录可以改设备外观/本地偏好」）。
 */

export interface SettingsStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type PagePreferenceFieldKind = 'boolean' | 'select' | 'text' | 'count' | 'readonly';

export interface PagePreferenceField {
  /** 存储文档内的字段名。 */
  key: string;
  label: string;
  description?: string;
  kind: PagePreferenceFieldKind;
  /** `select` 的合法取值；写入校验只允许落在其中。 */
  options?: ReadonlyArray<{ value: string; label: string }>;
  /** `count`/`readonly` 的展示格式化；缺省原样转字符串。 */
  format?: (value: unknown) => string;
  /**
   * 未写入持久值时页面实际生效的默认——空存储态控件如实显示它，而
   * 不是第二套「设置页默认」。可为惰性函数（如按终端形态推导的值），
   * 每次渲染控件时解析一次。缺省视为「未设置」。
   */
  defaultValue?: unknown | (() => unknown);
  /** `fields` 形态且不可由设置页清除（如草稿自有字段）。缺省视为偏好键。 */
  notResettable?: boolean;
}

export interface PagePreferenceSource {
  /** 页面标识（'details' / 'canshou'）。 */
  pageId: string;
  title: string;
  /** 对应产品路径，供「前往页面」链接使用。 */
  pagePath: string;
  storageKey: string;
  scope: 'blob' | 'fields';
  fields: readonly PagePreferenceField[];
  /**
   * `fields` 形态对空存储做首写时建立合法文档的工厂——必须由字段 owner
   * 的领域层提供（如问卷草稿的 `version`/`answers`/`language` 必填面），
   * 设置页自己不复制文档结构。缺省时 `fields` 空态写入返回 `false`
   * （fail-closed）：宁可在设置页报错，也不伪造看不懂的宿主文档。
   * `blob` 形态不需要——整 blob 即偏好对象，`{key: value}` 天然合法。
   */
  createDocumentForFirstWrite?: () => Record<string, unknown>;
  /** Owner 原有的版本/结构校验；抛错即拒绝手术，不能用规范化结果覆盖原文档。 */
  validateDocument?: (raw: string) => void;
}

export type PagePreferencesReadResult =
  | { readonly status: 'empty' }
  | { readonly status: 'corrupted' }
  | { readonly status: 'ready'; readonly values: Record<string, unknown> };

export interface PagePreferencesAdapter {
  readonly source: PagePreferenceSource;
  read(): PagePreferencesReadResult;
  /**
   * 写入单个字段。返回 `false` = 存储不可用或写入失败；
   * 值不符合字段登记时抛 `Error`（不该发生的 UI 路径 bug）。
   */
  writeField(key: string, value: unknown): boolean;
  /**
   * 清除该页偏好。`blob` 形态删除整个键；`fields` 形态只删登记字段，
   * 草稿/结果与未知字段原样保留。文档损坏且需要手术时拒绝并返回
   * `false`（`blob` 形态损坏则可安全整键移除）。
   */
  reset(): boolean;
  /** 本标签页写入与同 key 的 `storage` 事件都会触发。 */
  subscribe(listener: () => void): () => void;
}

const TEXT_VALUE_MAX_LENGTH = 64;

const getDefaultStorage = (): SettingsStorageLike | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const validateFieldValue = (field: PagePreferenceField, value: unknown): void => {
  switch (field.kind) {
    case 'boolean':
      if (typeof value !== 'boolean') throw new Error(`字段 ${field.key} 只接受布尔值`);
      return;
    case 'select':
      if (!field.options?.some((option) => option.value === value)) {
        throw new Error(`字段 ${field.key} 的值不在登记选项内`);
      }
      return;
    case 'text':
      if (typeof value !== 'string' || value.length === 0 || value.length > TEXT_VALUE_MAX_LENGTH) {
        throw new Error(`字段 ${field.key} 只接受长度 1-${TEXT_VALUE_MAX_LENGTH} 的文本`);
      }
      return;
    default:
      throw new Error(`字段 ${field.key} 不支持从设置页修改`);
  }
};

const preferenceKeysOf = (source: PagePreferenceSource): string[] =>
  source.fields.filter((field) => field.notResettable !== true).map((field) => field.key);

/** 解析字段的空态展示默认：惰性函数每次调用解析，静态值原样返回。 */
export const resolvePagePreferenceFieldDefault = (
  field: PagePreferenceField,
): unknown =>
  typeof field.defaultValue === 'function' ? field.defaultValue() : field.defaultValue;

/**
 * 按登记的字段清单裁剪值：读取只暴露声明字段，未声明的 blob 键（如未来版本
 * 新增项）不进 `values`，也不会因为读取而被触碰。
 */
const pickDeclaredValues = (
  source: PagePreferenceSource,
  document_: Record<string, unknown>,
): Record<string, unknown> => {
  const values: Record<string, unknown> = {};
  for (const field of source.fields) {
    if (field.key in document_) values[field.key] = document_[field.key];
  }
  return values;
};

export const createPagePreferencesAdapter = (
  source: PagePreferenceSource,
  storage: SettingsStorageLike | null = getDefaultStorage(),
): PagePreferencesAdapter => {
  const listeners = new Set<() => void>();

  const readDocument = (): { kind: 'empty' } | { kind: 'corrupted' } | { kind: 'ready'; document: Record<string, unknown> } => {
    if (storage === null) return { kind: 'corrupted' };
    let raw: string | null;
    try {
      raw = storage.getItem(source.storageKey);
    } catch {
      return { kind: 'corrupted' };
    }
    if (raw === null) return { kind: 'empty' };
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isPlainObject(parsed)) return { kind: 'corrupted' };
      source.validateDocument?.(raw);
      return { kind: 'ready', document: parsed };
    } catch {
      return { kind: 'corrupted' };
    }
  };

  const writeDocument = (document: Record<string, unknown>): boolean => {
    if (storage === null) return false;
    try {
      const serialized = JSON.stringify(document);
      source.validateDocument?.(serialized);
      storage.setItem(source.storageKey, serialized);
      return true;
    } catch {
      return false;
    }
  };

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  return {
    source,

    read() {
      const document_ = readDocument();
      if (document_.kind !== 'ready') return { status: document_.kind };
      return { status: 'ready', values: pickDeclaredValues(source, document_.document) };
    },

    writeField(key, value) {
      const field = source.fields.find((candidate) => candidate.key === key);
      if (!field) throw new Error(`未登记的字段 ${key}`);
      validateFieldValue(field, value);
      const document_ = readDocument();
      if (document_.kind === 'corrupted') return false;
      let nextDocument: Record<string, unknown>;
      if (document_.kind === 'ready') {
        nextDocument = { ...document_.document };
      } else if (source.scope === 'blob') {
        // 整 blob 即偏好对象，首写只含本字段即合法。
        nextDocument = {};
      } else {
        // fields 文档嵌在更大宿主文档里：首写必须经 owner 领域层工厂
        // 建立合法空壳，缺失工厂时 fail-closed 而不是裸写偏好键。
        if (!source.createDocumentForFirstWrite) return false;
        nextDocument = source.createDocumentForFirstWrite();
      }
      nextDocument[key] = value;
      if (!writeDocument(nextDocument)) return false;
      notify();
      return true;
    },

    reset() {
      const document_ = readDocument();
      if (document_.kind === 'empty') return true;
      if (document_.kind === 'corrupted' && source.scope === 'fields') return false;
      let ok: boolean;
      if (source.scope === 'blob' || document_.kind === 'corrupted') {
        if (storage === null) return false;
        try {
          storage.removeItem(source.storageKey);
          ok = true;
        } catch {
          ok = false;
        }
      } else {
        const nextDocument = { ...document_.document };
        for (const key of preferenceKeysOf(source)) {
          delete nextDocument[key];
        }
        ok = writeDocument(nextDocument);
      }
      if (ok) notify();
      return ok;
    },

    subscribe(listener) {
      listeners.add(listener);
      const onStorage = (event: StorageEvent) => {
        if (event.key === source.storageKey) listener();
      };
      if (typeof window !== 'undefined') {
        window.addEventListener('storage', onStorage);
      }
      return () => {
        listeners.delete(listener);
        if (typeof window !== 'undefined') {
          window.removeEventListener('storage', onStorage);
        }
      };
    },
  };
};
