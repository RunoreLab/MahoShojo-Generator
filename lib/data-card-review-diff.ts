import { getFieldDisplayName } from '@/lib/fieldTranslations';

export type DataCardReviewDiffChangeType = 'added' | 'removed' | 'changed';

export type DataCardReviewDiffEntry = {
  path: string;
  fieldLabel: string;
  changeType: DataCardReviewDiffChangeType;
  beforeValue: string;
  afterValue: string;
};

export type DataCardReviewDiffResult = {
  total: number;
  added: number;
  removed: number;
  changed: number;
  entries: DataCardReviewDiffEntry[];
};

type CompareValue = null | boolean | number | string | [] | Record<string, never>;

const EMPTY_OBJECT: Record<string, never> = {};
const CARD_NAME_PATH = '__card.name';
const CARD_DESCRIPTION_PATH = '__card.description';
const CARD_DATA_FALLBACK_PATH = '__card.data';

const isIgnoredKey = (key: string): boolean => key.startsWith('_') || key === 'metadata' || key === 'userAnswers';

const splitPathSegments = (path: string): string[] =>
  path
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);

const formatFieldLabel = (path: string): string => {
  if (path === CARD_NAME_PATH) return '卡片名称';
  if (path === CARD_DESCRIPTION_PATH) return '卡片简介';
  if (path === CARD_DATA_FALLBACK_PATH) return '卡片数据原文';
  if (!path) return '内容';
  return splitPathSegments(path)
    .map((segment) => {
      const normalized = segment.replace(/\[\d+\]/g, '');
      if (!normalized) return segment;
      const label = getFieldDisplayName(normalized);
      return segment.replace(normalized, label);
    })
    .join(' / ');
};

const formatValueForDisplay = (value: CompareValue | undefined): string => {
  if (value === undefined) return '—';
  if (value === null) return 'null';
  if (Array.isArray(value)) return '[]';
  if (typeof value === 'object') return '{}';
  if (typeof value === 'string') return value.trim() ? value : '（空字符串）';
  return String(value);
};

const serializeForCompare = (value: CompareValue | undefined): string => {
  if (value === undefined) return '__undefined__';
  return JSON.stringify(value);
};

const collectComparableValues = (
  value: unknown,
  path: string,
  output: Map<string, CompareValue>,
): void => {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    output.set(path, value);
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      output.set(path, []);
      return;
    }

    value.forEach((item, index) => {
      const nextPath = path ? `${path}[${index}]` : `[${index}]`;
      collectComparableValues(item, nextPath, output);
    });
    return;
  }

  if (!value || typeof value !== 'object') {
    output.set(path, String(value));
    return;
  }

  const entries = Object.entries(value).filter(([key]) => !isIgnoredKey(key));
  if (entries.length === 0) {
    output.set(path, EMPTY_OBJECT);
    return;
  }

  entries.forEach(([key, child]) => {
    const nextPath = path ? `${path}.${key}` : key;
    collectComparableValues(child, nextPath, output);
  });
};

const parseJsonText = (value: string): unknown | null => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

export const buildDataCardReviewDiff = (input: {
  originalName: string;
  originalDescription: string;
  originalData: string;
  updatedName: string;
  updatedDescription: string;
  updatedData: string;
}): DataCardReviewDiffResult => {
  const before = new Map<string, CompareValue>();
  const after = new Map<string, CompareValue>();

  before.set(CARD_NAME_PATH, input.originalName);
  before.set(CARD_DESCRIPTION_PATH, input.originalDescription);
  after.set(CARD_NAME_PATH, input.updatedName);
  after.set(CARD_DESCRIPTION_PATH, input.updatedDescription);

  const beforeJson = parseJsonText(input.originalData);
  const afterJson = parseJsonText(input.updatedData);

  if (beforeJson !== null && afterJson !== null) {
    collectComparableValues(beforeJson, '', before);
    collectComparableValues(afterJson, '', after);
  } else {
    before.set(CARD_DATA_FALLBACK_PATH, input.originalData);
    after.set(CARD_DATA_FALLBACK_PATH, input.updatedData);
  }

  const keys = Array.from(new Set([...before.keys(), ...after.keys()])).sort((left, right) =>
    left.localeCompare(right, 'zh-CN'),
  );

  const entries: DataCardReviewDiffEntry[] = [];
  for (const key of keys) {
    const beforeValue = before.get(key);
    const afterValue = after.get(key);
    const beforeSerialized = serializeForCompare(beforeValue);
    const afterSerialized = serializeForCompare(afterValue);
    if (beforeSerialized === afterSerialized) continue;

    const changeType: DataCardReviewDiffChangeType =
      beforeValue === undefined ? 'added' : afterValue === undefined ? 'removed' : 'changed';

    entries.push({
      path: key || 'data',
      fieldLabel: formatFieldLabel(key || 'data'),
      changeType,
      beforeValue: formatValueForDisplay(beforeValue),
      afterValue: formatValueForDisplay(afterValue),
    });
  }

  return {
    total: entries.length,
    added: entries.filter((entry) => entry.changeType === 'added').length,
    removed: entries.filter((entry) => entry.changeType === 'removed').length,
    changed: entries.filter((entry) => entry.changeType === 'changed').length,
    entries,
  };
};
