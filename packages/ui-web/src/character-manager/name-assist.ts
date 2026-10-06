/**
 * 「随机代号 / 一键替换曾用名」的纯规则（自 Web `CharacterManagerPage` 抽取）。
 *
 * 替换用的新基础名称超过 `NAME_REPLACE_NATIVE_MAX_CHARS` 字时仍可执行，
 * 但在 Web 的原生性语义下视为「衍生数据」（保存时移除原生签名）。
 */
export const NAME_REPLACE_NATIVE_MAX_CHARS = 32;

export const getDisplayCharCount = (text: string): number => {
  return Array.from((text ?? '').trim()).length;
};

/** 顶层名称字段：魔法少女用 `codename`，残兽/通用卡用 `name`（与 Web 的 `||` 回退一致）。 */
export const cardTopName = (data: unknown): string | undefined => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const record = data as Record<string, unknown>;
  const value = record.codename || record.name;
  return typeof value === 'string' ? value : undefined;
};

/** 完整名称中去掉「称号」后缀的基础名。 */
export const extractCardBaseName = (name: string): string => name.split('「')[0];

const escapeRegExp = (str: string): string => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const isObject = (item: unknown): item is Record<string, unknown> => {
  return Boolean(item) && typeof item === 'object' && !Array.isArray(item);
};

/**
 * 递归地在数据对象中替换所有出现的旧基础名称（「称号」部分保留）。
 * 输入不被原地修改；返回新的引用树。
 */
export const replaceAllNamesInData = <T>(data: T, oldBaseName: string, newBaseName: string): T => {
  if (typeof data === 'string') {
    const regex = new RegExp(escapeRegExp(oldBaseName) + '(「[^」]+」)?', 'g');
    return data.replace(regex, `${newBaseName}$1`) as T;
  }
  if (Array.isArray(data)) {
    return data.map(item => replaceAllNamesInData(item, oldBaseName, newBaseName)) as T;
  }
  if (isObject(data)) {
    const newData: Record<string, unknown> = {};
    for (const key in data) {
      newData[key] = replaceAllNamesInData(data[key], oldBaseName, newBaseName);
    }
    return newData as T;
  }
  return data;
};

/** 「一键替换」按钮的出现条件：原始数据与当前数据的顶层名称都已存在且不同。 */
export const shouldOfferNameReplace = (originalData: unknown, currentData: unknown): boolean => {
  const originalName = cardTopName(originalData);
  const currentName = cardTopName(currentData);
  return originalName !== undefined && currentName !== undefined && originalName !== currentName;
};

/**
 * 判断一次「一键替换」是否保持 Web 的原生性语义：
 * 新基础名超过上限时返回 `false`——宿主此时只应同步顶层名称字段而不做全文替换，
 * 从而强制触发原生性丧失。
 */
export const nameReplacePreservesNativeness = (newBaseName: string): boolean =>
  getDisplayCharCount(newBaseName) <= NAME_REPLACE_NATIVE_MAX_CHARS;
