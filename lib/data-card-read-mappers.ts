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

export type DataCardSourceMeta = {
  dataCardId?: string;
  dataCardName?: string;
  dataCardAuthor?: string;
};

export type DataCardRuntimeSourceInfo = {
  sourceDataCardId?: string;
  sourceDataCardName?: string;
  sourceDataCardDescription?: string;
  sourceDataCardCreatedAt?: string;
  sourceDataCardUpdatedAt?: string;
  sourceIsPublic?: boolean;
  sourceAuthor?: string;
  sourceDataCardLikeCount?: number;
  sourceDataCardFavoriteCount?: number;
  sourceDataCardUsageCount?: number;
};

const BATTLE_SELECTION_TRANSPORT_META_KEYS = new Set([
  '_cardId',
  '_cardName',
  '_cardDescription',
  '_cardType',
  '_isPublic',
  '_updatedAt',
  '_createdAt',
  '_author',
  '_authorName',
  '_likeCount',
  '_favoriteCount',
  '_usageCount',
]);

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

const normalizeOptionalText = (value: string | null): string | undefined => {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeCardType = (raw: string | null): DataCardType => {
  if (raw === 'scenario' || raw === 'history' || raw === 'questionnaire') return raw;
  return 'character';
};

export const normalizePublicVisibilityValue = (source: Record<string, unknown>): boolean | number => {
  const numeric = readNumber(source, ['is_public', 'isPublic', '_isPublic']);
  if (numeric !== null) return Math.floor(numeric);
  const bool = readBoolean(source, ['is_public', 'isPublic', '_isPublic']);
  if (bool !== null) return bool;
  return false;
};

export const isPublicVisibility = (value: unknown): boolean => value === 1 || value === true;

export const mapDataCardSourceMeta = (rowInput: unknown): DataCardSourceMeta => {
  const row = toRecord(rowInput) ?? {};
  return {
    dataCardId: normalizeOptionalText(readString(row, ['_cardId', 'dataCardId', 'id'])),
    dataCardName: normalizeOptionalText(readString(row, ['_cardName', 'dataCardName', 'name'])),
    dataCardAuthor: normalizeOptionalText(readString(row, ['_author', '_authorName', 'dataCardAuthor', 'username', 'author'])),
  };
};

export const mapDataCardRuntimeSourceInfo = (rowInput: unknown): DataCardRuntimeSourceInfo => {
  const row = toRecord(rowInput) ?? {};
  const sourceMeta = mapDataCardSourceMeta(row);

  const numericVisibility = readNumber(row, ['_isPublic', 'is_public', 'isPublic']);
  const boolVisibility = readBoolean(row, ['_isPublic', 'is_public', 'isPublic']);
  const sourceIsPublic =
    numericVisibility !== null
      ? Math.floor(numericVisibility) === 1
      : boolVisibility !== null
        ? boolVisibility
        : undefined;

  return {
    sourceDataCardId: sourceMeta.dataCardId,
    sourceDataCardName: sourceMeta.dataCardName,
    sourceDataCardDescription: readString(row, ['_cardDescription', 'description']) ?? undefined,
    sourceDataCardCreatedAt: normalizeOptionalText(readString(row, ['_createdAt', 'created_at', 'createdAt'])),
    sourceDataCardUpdatedAt: normalizeOptionalText(readString(row, ['_updatedAt', 'updated_at', 'updatedAt'])),
    sourceIsPublic,
    sourceAuthor: sourceMeta.dataCardAuthor,
    sourceDataCardLikeCount: normalizeOptionalCounter(readNumber(row, ['_likeCount', 'like_count', 'likeCount'])),
    sourceDataCardFavoriteCount: normalizeOptionalCounter(readNumber(row, ['_favoriteCount', 'favorite_count', 'favoriteCount'])),
    sourceDataCardUsageCount: normalizeOptionalCounter(readNumber(row, ['_usageCount', 'usage_count', 'usageCount'])),
  };
};

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

export const stripBattleSelectionTransportMeta = <T>(input: T): T => {
  if (Array.isArray(input)) {
    return input.map((item) => stripBattleSelectionTransportMeta(item)) as T;
  }
  const record = toRecord(input);
  if (!record) return input;

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (BATTLE_SELECTION_TRANSPORT_META_KEYS.has(key)) {
      continue;
    }
    cleaned[key] = stripBattleSelectionTransportMeta(value);
  }
  return cleaned as T;
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
  const sourceMeta = mapDataCardSourceMeta(row);
  const cardId = sourceMeta.dataCardId ?? '';
  const cardName = sourceMeta.dataCardName ?? '未命名数据卡';
  const description = readString(row, ['description']) ?? '';
  const visibility = normalizePublicVisibilityValue(row);
  const author = sourceMeta.dataCardAuthor ?? '未知';

  return {
    ...dataObject,
    _cardId: cardId,
    _cardName: cardName,
    _cardDescription: description,
    _cardType: normalizeCardType(readString(row, ['type'])),
    _isPublic: visibility,
    _updatedAt: readString(row, ['updated_at', 'updatedAt']) ?? undefined,
    _createdAt: readString(row, ['created_at', 'createdAt']) ?? undefined,
    _author: author,
    _likeCount: normalizeOptionalCounter(readNumber(row, ['like_count', 'likeCount'])),
    _favoriteCount: normalizeOptionalCounter(readNumber(row, ['favorite_count', 'favoriteCount'])),
    _usageCount: normalizeOptionalCounter(readNumber(row, ['usage_count', 'usageCount'])),
  };
};
