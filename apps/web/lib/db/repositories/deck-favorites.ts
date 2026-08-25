import { and, desc, eq, sql } from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { deckFavorites, decks, users } from '@/lib/db/schema';

export type UserDeckFavoriteRow = {
  id: string;
  user_id: number;
  name: string;
  description: string | null;
  is_public: number;
  like_count: number;
  favorite_count: number;
  created_at: string | null;
  updated_at: string | null;
  username: string;
  favorited_at: string | null;
  card_count: number;
};

const toInt = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
};

const cardCountExpr = sql<number>`(
  SELECT COUNT(*)
  FROM deck_cards dc
  WHERE dc.deck_id = ${decks.id}
)`;

export const isDeckFavoritable = async (
  db: AppDrizzleDb,
  deckId: string,
): Promise<boolean> => {
  const rows = await db
    .select({
      id: decks.id,
    })
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.isPublic, 1)))
    .limit(1);

  return rows.length > 0;
};

export const hasDeckFavoriteRecord = async (
  db: AppDrizzleDb,
  userId: number,
  deckId: string,
): Promise<boolean> => {
  const rows = await db
    .select({
      userId: deckFavorites.userId,
    })
    .from(deckFavorites)
    .where(and(eq(deckFavorites.userId, userId), eq(deckFavorites.deckId, deckId)))
    .limit(1);

  return rows.length > 0;
};

export const insertDeckFavoriteIgnore = async (
  db: AppDrizzleDb,
  userId: number,
  deckId: string,
): Promise<boolean> => {
  const inserted = await db
    .insert(deckFavorites)
    .values({
      userId,
      deckId,
      createdAt: sql`CURRENT_TIMESTAMP`,
    })
    .onConflictDoNothing()
    .returning({
      userId: deckFavorites.userId,
    });

  return inserted.length > 0;
};

export const incrementDeckFavoriteCount = async (
  db: AppDrizzleDb,
  deckId: string,
): Promise<void> => {
  await db
    .update(decks)
    .set({
      favoriteCount: sql`COALESCE(${decks.favoriteCount}, 0) + 1`,
    })
    .where(eq(decks.id, deckId));
};

export const deleteDeckFavoriteRecord = async (
  db: AppDrizzleDb,
  userId: number,
  deckId: string,
): Promise<number> => {
  const deleted = await db
    .delete(deckFavorites)
    .where(and(eq(deckFavorites.userId, userId), eq(deckFavorites.deckId, deckId)))
    .returning({
      userId: deckFavorites.userId,
    });

  return deleted.length;
};

export const decrementDeckFavoriteCount = async (
  db: AppDrizzleDb,
  deckId: string,
): Promise<void> => {
  await db
    .update(decks)
    .set({
      favoriteCount: sql`CASE WHEN COALESCE(${decks.favoriteCount}, 0) > 0 THEN ${decks.favoriteCount} - 1 ELSE 0 END`,
    })
    .where(eq(decks.id, deckId));
};

export const listUserDeckFavoritesWithDeck = async (
  db: AppDrizzleDb,
  userId: number,
): Promise<UserDeckFavoriteRow[]> => {
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
      favoritedAt: deckFavorites.createdAt,
      cardCount: cardCountExpr,
    })
    .from(deckFavorites)
    .innerJoin(decks, eq(deckFavorites.deckId, decks.id))
    .innerJoin(users, eq(decks.userId, users.id))
    .where(and(eq(deckFavorites.userId, userId), eq(decks.isPublic, 1)))
    .orderBy(desc(deckFavorites.createdAt));

  return rows.map((row) => ({
    id: row.id,
    user_id: toInt(row.userId, 0),
    name: row.name,
    description: typeof row.description === 'string' ? row.description : null,
    is_public: toInt(row.isPublic, 0),
    like_count: toInt(row.likeCount, 0),
    favorite_count: toInt(row.favoriteCount, 0),
    created_at: typeof row.createdAt === 'string' ? row.createdAt : null,
    updated_at: typeof row.updatedAt === 'string' ? row.updatedAt : null,
    username: row.username,
    favorited_at: typeof row.favoritedAt === 'string' ? row.favoritedAt : null,
    card_count: toInt(row.cardCount, 0),
  }));
};

export const listUserDeckFavoriteDeckIds = async (
  db: AppDrizzleDb,
  userId: number,
): Promise<string[]> => {
  const rows = await db
    .select({
      deckId: deckFavorites.deckId,
    })
    .from(deckFavorites)
    .where(eq(deckFavorites.userId, userId));

  return rows
    .map((row) => (typeof row.deckId === 'string' ? row.deckId : ''))
    .filter(Boolean);
};
