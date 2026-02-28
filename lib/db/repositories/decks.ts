import { and, count, desc, eq, like, or, sql, type SQL } from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { deckCards, decks, users } from '@/lib/db/schema';

export type DeckSortBy = 'likes' | 'favorites' | 'created_at';

export type DeckDbRow = {
  id: string;
  user_id: number;
  name: string;
  description: string | null;
  is_public: number;
  like_count: number;
  favorite_count: number;
  created_at: string | null;
  updated_at: string | null;
};

export type DeckWithCardCountRow = DeckDbRow & {
  card_count: number;
};

export type DeckWithAuthorAndCardCountRow = DeckWithCardCountRow & {
  username: string;
};

export type DeckUpdatePayload = {
  name?: string;
  description?: string;
  isPublic?: number;
};

const toInt = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
};

const clampLimit = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
};

const clampOffset = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
};

const cardCountExpr = sql<number>`(
  SELECT COUNT(*)
  FROM deck_cards dc
  WHERE dc.deck_id = ${decks.id}
)`;

const mapDeckBaseRow = (row: {
  id: string;
  userId: number;
  name: string;
  description: string | null;
  isPublic: number;
  likeCount: number | null;
  favoriteCount: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}): DeckDbRow => ({
  id: row.id,
  user_id: toInt(row.userId, 0),
  name: row.name,
  description: typeof row.description === 'string' ? row.description : null,
  is_public: toInt(row.isPublic, 0),
  like_count: toInt(row.likeCount, 0),
  favorite_count: toInt(row.favoriteCount, 0),
  created_at: typeof row.createdAt === 'string' ? row.createdAt : null,
  updated_at: typeof row.updatedAt === 'string' ? row.updatedAt : null,
});

export const countDecksByUserId = async (
  db: AppDrizzleDb,
  userId: number,
): Promise<number> => {
  const rows = await db
    .select({ count: count() })
    .from(decks)
    .where(eq(decks.userId, userId));

  return Math.max(0, toInt(rows[0]?.count, 0));
};

export const insertDeck = async (
  db: AppDrizzleDb,
  payload: {
    id: string;
    userId: number;
    name: string;
    description: string;
    isPublic: number;
  },
): Promise<boolean> => {
  const inserted = await db
    .insert(decks)
    .values({
      id: payload.id,
      userId: payload.userId,
      name: payload.name,
      description: payload.description,
      isPublic: payload.isPublic,
      likeCount: 0,
      favoriteCount: 0,
      createdAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .returning({
      id: decks.id,
    });

  return inserted.length > 0;
};

export const listDecksByUserIdWithCardCount = async (
  db: AppDrizzleDb,
  userId: number,
): Promise<DeckWithCardCountRow[]> => {
  const rows = await db
    .select({
      id: decks.id,
      userId: decks.userId,
      name: decks.name,
      description: decks.description,
      isPublic: decks.isPublic,
      likeCount: decks.likeCount,
      favoriteCount: decks.favoriteCount,
      createdAt: decks.createdAt,
      updatedAt: decks.updatedAt,
      cardCount: cardCountExpr,
    })
    .from(decks)
    .where(eq(decks.userId, userId))
    .orderBy(desc(decks.updatedAt), desc(decks.createdAt));

  return rows.map((row) => ({
    ...mapDeckBaseRow(row),
    card_count: toInt(row.cardCount, 0),
  }));
};

export const listPublicDecksWithAuthor = async (
  db: AppDrizzleDb,
  params: {
    limit: number;
    offset: number;
    search?: string;
    sortBy?: DeckSortBy;
  },
): Promise<DeckWithAuthorAndCardCountRow[]> => {
  const conditions = [eq(decks.isPublic, 1)];
  const search = typeof params.search === 'string' ? params.search.trim() : '';
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(or(like(decks.name, pattern), like(decks.description, pattern))!);
  }

  const orderBy: SQL[] =
    params.sortBy === 'likes'
      ? [desc(decks.likeCount), desc(decks.createdAt)]
      : params.sortBy === 'favorites'
        ? [desc(decks.favoriteCount), desc(decks.createdAt)]
        : [desc(decks.createdAt)];

  const rows = await db
    .select({
      id: decks.id,
      userId: decks.userId,
      name: decks.name,
      description: decks.description,
      isPublic: decks.isPublic,
      likeCount: decks.likeCount,
      favoriteCount: decks.favoriteCount,
      createdAt: decks.createdAt,
      updatedAt: decks.updatedAt,
      username: users.username,
      cardCount: cardCountExpr,
    })
    .from(decks)
    .innerJoin(users, eq(decks.userId, users.id))
    .where(and(...conditions))
    .orderBy(...orderBy)
    .limit(clampLimit(params.limit, 1, 100))
    .offset(clampOffset(params.offset));

  return rows.map((row) => ({
    ...mapDeckBaseRow(row),
    username: row.username,
    card_count: toInt(row.cardCount, 0),
  }));
};

export const getDeckByIdWithAuthor = async (
  db: AppDrizzleDb,
  deckId: string,
): Promise<DeckWithAuthorAndCardCountRow | null> => {
  const rows = await db
    .select({
      id: decks.id,
      userId: decks.userId,
      name: decks.name,
      description: decks.description,
      isPublic: decks.isPublic,
      likeCount: decks.likeCount,
      favoriteCount: decks.favoriteCount,
      createdAt: decks.createdAt,
      updatedAt: decks.updatedAt,
      username: users.username,
      cardCount: cardCountExpr,
    })
    .from(decks)
    .innerJoin(users, eq(decks.userId, users.id))
    .where(eq(decks.id, deckId))
    .limit(1);

  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    ...mapDeckBaseRow(row),
    username: row.username,
    card_count: toInt(row.cardCount, 0),
  };
};

export const updateDeckByIdOwnedByUser = async (
  db: AppDrizzleDb,
  deckId: string,
  userId: number,
  payload: DeckUpdatePayload,
): Promise<number> => {
  const setPayload: {
    updatedAt: SQL;
    name?: string;
    description?: string;
    isPublic?: number;
  } = {
    updatedAt: sql`CURRENT_TIMESTAMP`,
  };

  if (payload.name !== undefined) setPayload.name = payload.name;
  if (payload.description !== undefined) setPayload.description = payload.description;
  if (payload.isPublic !== undefined) setPayload.isPublic = payload.isPublic;

  const updated = await db
    .update(decks)
    .set(setPayload)
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
    .returning({
      id: decks.id,
    });

  return updated.length;
};

export const deleteDeckByIdOwnedByUser = async (
  db: AppDrizzleDb,
  deckId: string,
  userId: number,
): Promise<number> => {
  const deleted = await db
    .delete(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
    .returning({
      id: decks.id,
    });

  return deleted.length;
};

export const incrementPublicDeckLikeCountById = async (
  db: AppDrizzleDb,
  deckId: string,
): Promise<number> => {
  const updated = await db
    .update(decks)
    .set({
      likeCount: sql`COALESCE(${decks.likeCount}, 0) + 1`,
    })
    .where(and(eq(decks.id, deckId), eq(decks.isPublic, 1)))
    .returning({
      id: decks.id,
    });

  return updated.length;
};

export const touchDeckUpdatedAt = async (
  db: AppDrizzleDb,
  deckId: string,
): Promise<void> => {
  await db
    .update(decks)
    .set({
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(decks.id, deckId));
};

export const getDeckVisibilityById = async (
  db: AppDrizzleDb,
  deckId: string,
): Promise<number | null> => {
  const rows = await db
    .select({
      isPublic: decks.isPublic,
    })
    .from(decks)
    .where(eq(decks.id, deckId))
    .limit(1);

  if (rows.length === 0) return null;
  return toInt(rows[0]?.isPublic, 0);
};

export const countDeckCardsByDeckId = async (
  db: AppDrizzleDb,
  deckId: string,
): Promise<number> => {
  const rows = await db
    .select({
      count: count(),
    })
    .from(deckCards)
    .where(eq(deckCards.deckId, deckId));

  return Math.max(0, toInt(rows[0]?.count, 0));
};
