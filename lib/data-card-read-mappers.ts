type DataCardType = 'character' | 'scenario' | 'history' | 'questionnaire';

export type PublicDataCardCompatRow = Record<string, unknown>;

export type DataCardDetailsModalCard = {
  id: string;
  name: string;
  description: string;
  type: DataCardType;
  data: string;
  isPublic: boolean;
  usageCount?: number;
  likeCount?: number;
  favoriteCount?: number;
  author?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type BattleSelectionPayload = Record<string, unknown> & {
  _cardId: string;
  _cardName: string;
  _cardDescription: string;
  _isPublic: boolean | number;
  _updatedAt?: string;
  _createdAt?: string;
  _author: string;
  _likeCount?: number;
  _favoriteCount?: number;
  _usageCount?: number;
};

const toRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const readString = (source: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string') return value;
  }
  return null;
};

const readNumber = (source: Record<string, unknown>, keys: string[]): number | null => {
  for (const key of keys) {
    const value = source[key];
    const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
};

const readBoolean = (source: Record<string, unknown>, keys: string[]): boolean | null => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'boolean') return value;
  }
  return null;
};

const normalizeOptionalCounter = (value: number | null): number | undefined => {
  if (!Number.isFinite(value)) return undefined;
  return Math.max(0, Math.floor(value as number));
};

const normalizeCardType = (raw: string | null): DataCardType => {
  if (raw === 'scenario' || raw === 'history' || raw === 'questionnaire') return raw;
  return 'character';
};

export const normalizePublicVisibilityValue = (source: Record<string, unknown>): boolean | number => {
  const numeric = readNumber(source, ['is_public', 'isPublic']);
  if (numeric !== null) return Math.floor(numeric);
  const bool = readBoolean(source, ['is_public', 'isPublic']);
  if (bool !== null) return bool;
  return false;
};

export const isPublicVisibility = (value: unknown): boolean => value === 1 || value === true;

const parseDataCardDataObject = (source: Record<string, unknown>): Record<string, unknown> => {
  const raw = source.data ?? source.dataJson ?? source.data_json ?? source.dataJSON ?? null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) throw new Error('数据卡内容为空或格式不受支持。');
    const parsed = JSON.parse(trimmed) as unknown;
    const parsedRecord = toRecord(parsed);
    if (!parsedRecord) throw new Error('数据卡内容为空或格式不受支持。');
    return parsedRecord;
  }
  const rawRecord = toRecord(raw);
  if (rawRecord) return rawRecord;
  throw new Error('数据卡内容为空或格式不受支持。');
};

export const mapPublicDataCardRowToDetailsCard = (
  rowInput: unknown,
  fallback: { id: string; name: string; author: string },
): DataCardDetailsModalCard => {
  const row = toRecord(rowInput) ?? {};
  const id = (readString(row, ['id']) ?? fallback.id).trim() || fallback.id;
  const name = (readString(row, ['name']) ?? '').trim() || fallback.name;
  const description = readString(row, ['description']) ?? '';
  const type = normalizeCardType(readString(row, ['type']));
  const dataObject = parseDataCardDataObject(row);
  const visibility = normalizePublicVisibilityValue(row);

  const author =
    (readString(row, ['username']) ?? '').trim() ||
    (readString(row, ['author']) ?? '').trim() ||
    fallback.author;

  return {
    id,
    name,
    description,
    type,
    data: JSON.stringify(dataObject, null, 2),
    isPublic: isPublicVisibility(visibility),
    usageCount: normalizeOptionalCounter(readNumber(row, ['usage_count', 'usageCount'])),
    likeCount: normalizeOptionalCounter(readNumber(row, ['like_count', 'likeCount'])),
    favoriteCount: normalizeOptionalCounter(readNumber(row, ['favorite_count', 'favoriteCount'])),
    author,
    createdAt: readString(row, ['created_at', 'createdAt']) ?? undefined,
    updatedAt: readString(row, ['updated_at', 'updatedAt']) ?? undefined,
  };
};

export const mapPublicDataCardRowToBattleSelectionPayload = (rowInput: unknown): BattleSelectionPayload => {
  const row = toRecord(rowInput) ?? {};
  const dataObject = parseDataCardDataObject(row);
  const cardId = readString(row, ['id']) ?? '';
  const cardName = readString(row, ['name']) ?? '未命名数据卡';
  const description = readString(row, ['description']) ?? '';
  const visibility = normalizePublicVisibilityValue(row);
  const author =
    (readString(row, ['username']) ?? '').trim() ||
    (readString(row, ['author']) ?? '').trim() ||
    '未知';

  return {
    ...dataObject,
    _cardId: cardId,
    _cardName: cardName,
    _cardDescription: description,
    _isPublic: visibility,
    _updatedAt: readString(row, ['updated_at', 'updatedAt']) ?? undefined,
    _createdAt: readString(row, ['created_at', 'createdAt']) ?? undefined,
    _author: author,
    _likeCount: normalizeOptionalCounter(readNumber(row, ['like_count', 'likeCount'])),
    _favoriteCount: normalizeOptionalCounter(readNumber(row, ['favorite_count', 'favoriteCount'])),
    _usageCount: normalizeOptionalCounter(readNumber(row, ['usage_count', 'usageCount'])),
  };
};
