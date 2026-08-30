import { getDeckVisibilityValue } from '@/lib/deck-status';

type DeckVisibilityValue = -1 | 0 | 1;

export type DeckReadDto = {
  id: string;
  userId: number;
  username?: string;
  name: string;
  description: string | null;
  isPublic: DeckVisibilityValue;
  likeCount: number;
  favoriteCount: number;
  cardCount: number;
  createdAt: string | null;
  updatedAt: string | null;
  favoritedAt?: string | null;
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
    if (Number.isFinite(numeric)) return Math.floor(numeric);
  }
  return null;
};

const normalizeText = (value: string | null): string | null => {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeRequiredText = (value: string | null, fallback: string): string => {
  const normalized = normalizeText(value);
  return normalized ?? fallback;
};

const normalizeOptionalCount = (value: number | null): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value as number));
};

const normalizeOptionalTime = (value: string | null): string | null => {
  const normalized = normalizeText(value);
  return normalized ?? null;
};

export const mapDeckReadRow = (rowInput: unknown): DeckReadDto => {
  const row = toRecord(rowInput) ?? {};

  const id = normalizeRequiredText(readString(row, ['id']), '');
  const userId = normalizeOptionalCount(readNumber(row, ['user_id', 'userId']));
  const username = normalizeText(readString(row, ['username']));
  const name = normalizeRequiredText(readString(row, ['name']), '未命名卡组');
  const description = normalizeText(readString(row, ['description']));
  const isPublic = getDeckVisibilityValue(row);
  const likeCount = normalizeOptionalCount(readNumber(row, ['like_count', 'likeCount']));
  const favoriteCount = normalizeOptionalCount(readNumber(row, ['favorite_count', 'favoriteCount']));
  const cardCount = normalizeOptionalCount(readNumber(row, ['card_count', 'cardCount']));
  const createdAt = normalizeOptionalTime(readString(row, ['created_at', 'createdAt']));
  const updatedAt = normalizeOptionalTime(readString(row, ['updated_at', 'updatedAt']));
  const favoritedAt = normalizeOptionalTime(readString(row, ['favorited_at', 'favoritedAt']));

  return {
    id,
    userId,
    ...(username ? { username } : {}),
    name,
    description,
    isPublic,
    likeCount,
    favoriteCount,
    cardCount,
    createdAt,
    updatedAt,
    ...(favoritedAt !== null ? { favoritedAt } : {}),
  };
};

export const mapDeckReadRows = (rowsInput: unknown): DeckReadDto[] => {
  if (!Array.isArray(rowsInput)) return [];
  return rowsInput.map((row) => mapDeckReadRow(row));
};

