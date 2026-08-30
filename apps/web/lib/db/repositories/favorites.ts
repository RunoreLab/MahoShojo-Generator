import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { OnlineDataCardTypeSchema, type OnlineDataCardType } from '@mahoshojo/contracts/data-cards';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { dataCards, favorites, users } from '@/lib/db/schema';

export type FavoriteCardType = OnlineDataCardType;

export type UserFavoriteRow = {
  id: string;
  user_id: number;
  type: FavoriteCardType | null;
  name: string;
  description: string | null;
  data: string;
  is_public: number;
  public_since: string | null;
  usage_count: number;
  like_count: number;
  favorite_count: number;
  review_status: string | null;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
  username: string;
  favorited_at: string | null;
  tag_ids: string | null;
};

const toInt = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
};

const toFavoriteCardType = (value: unknown): FavoriteCardType | null => {
  const result = OnlineDataCardTypeSchema.safeParse(value);
  return result.success ? result.data : null;
};

export const isDataCardFavoritable = async (
  db: AppDrizzleDb,
  cardId: string,
): Promise<boolean> => {
  const rows = await db
    .select({
      id: dataCards.id,
    })
    .from(dataCards)
    .where(
      and(
        eq(dataCards.id, cardId),
        eq(dataCards.isPublic, true),
        eq(dataCards.reviewStatus, 'approved'),
        isNull(dataCards.deletedAt),
      ),
    )
    .limit(1);

  return rows.length > 0;
};

export const hasFavoriteRecord = async (
  db: AppDrizzleDb,
  userId: number,
  cardId: string,
): Promise<boolean> => {
  const rows = await db
    .select({
      userId: favorites.userId,
    })
    .from(favorites)
    .where(and(eq(favorites.userId, userId), eq(favorites.dataCardId, cardId)))
    .limit(1);

  return rows.length > 0;
};

export const insertFavoriteIgnore = async (
  db: AppDrizzleDb,
  userId: number,
  cardId: string,
): Promise<boolean> => {
  const inserted = await db
    .insert(favorites)
    .values({
      userId,
      dataCardId: cardId,
      createdAt: sql`CURRENT_TIMESTAMP`,
    })
    .onConflictDoNothing()
    .returning({
      userId: favorites.userId,
    });

  return inserted.length > 0;
};

export const incrementDataCardFavoriteCount = async (
  db: AppDrizzleDb,
  cardId: string,
): Promise<void> => {
  await db
    .update(dataCards)
    .set({
      favoriteCount: sql`COALESCE(${dataCards.favoriteCount}, 0) + 1`,
    })
    .where(eq(dataCards.id, cardId));
};

export const deleteFavoriteRecord = async (
  db: AppDrizzleDb,
  userId: number,
  cardId: string,
): Promise<number> => {
  const deleted = await db
    .delete(favorites)
    .where(and(eq(favorites.userId, userId), eq(favorites.dataCardId, cardId)))
    .returning({
      userId: favorites.userId,
    });

  return deleted.length;
};

export const decrementDataCardFavoriteCount = async (
  db: AppDrizzleDb,
  cardId: string,
): Promise<void> => {
  await db
    .update(dataCards)
    .set({
      favoriteCount: sql`CASE WHEN COALESCE(${dataCards.favoriteCount}, 0) > 0 THEN ${dataCards.favoriteCount} - 1 ELSE 0 END`,
    })
    .where(eq(dataCards.id, cardId));
};

export const listUserFavoritesWithCards = async (
  db: AppDrizzleDb,
  userId: number,
  type?: FavoriteCardType,
): Promise<UserFavoriteRow[]> => {
  const rows = await db
    .select({
      id: dataCards.id,
      userId: dataCards.userId,
      type: dataCards.type,
      name: dataCards.name,
      description: dataCards.description,
      data: dataCards.data,
      isPublic: sql<number>`CAST(${dataCards.isPublic} AS INTEGER)`,
      publicSince: dataCards.publicSince,
      usageCount: dataCards.usageCount,
      likeCount: dataCards.likeCount,
      favoriteCount: dataCards.favoriteCount,
      reviewStatus: dataCards.reviewStatus,
      createdAt: dataCards.createdAt,
      updatedAt: dataCards.updatedAt,
      deletedAt: dataCards.deletedAt,
      username: users.username,
      favoritedAt: favorites.createdAt,
      tagIds: sql<string | null>`(
        SELECT group_concat(DISTINCT dct.tag_id)
        FROM data_card_tags dct
        WHERE dct.data_card_id = ${dataCards.id}
      )`,
    })
    .from(favorites)
    .innerJoin(dataCards, eq(favorites.dataCardId, dataCards.id))
    .innerJoin(users, eq(dataCards.userId, users.id))
    .where(
      and(
        eq(favorites.userId, userId),
        eq(dataCards.isPublic, true),
        eq(dataCards.reviewStatus, 'approved'),
        isNull(dataCards.deletedAt),
        type ? eq(dataCards.type, type) : undefined,
      ),
    )
    .orderBy(desc(favorites.createdAt));

  return rows.map((row) => ({
    id: row.id,
    user_id: toInt(row.userId, 0),
    type: toFavoriteCardType(row.type),
    name: row.name,
    description: typeof row.description === 'string' ? row.description : null,
    data: row.data,
    is_public: toInt(row.isPublic, 0),
    public_since: typeof row.publicSince === 'string' ? row.publicSince : null,
    usage_count: toInt(row.usageCount, 0),
    like_count: toInt(row.likeCount, 0),
    favorite_count: toInt(row.favoriteCount, 0),
    review_status: typeof row.reviewStatus === 'string' ? row.reviewStatus : null,
    created_at: typeof row.createdAt === 'string' ? row.createdAt : null,
    updated_at: typeof row.updatedAt === 'string' ? row.updatedAt : null,
    deleted_at: typeof row.deletedAt === 'string' ? row.deletedAt : null,
    username: row.username,
    favorited_at: typeof row.favoritedAt === 'string' ? row.favoritedAt : null,
    tag_ids: typeof row.tagIds === 'string' ? row.tagIds : null,
  }));
};

export const listUserFavoriteCardIds = async (
  db: AppDrizzleDb,
  userId: number,
  type?: FavoriteCardType,
): Promise<string[]> => {
  if (type) {
    const rows = await db
      .select({
        dataCardId: favorites.dataCardId,
      })
      .from(favorites)
      .innerJoin(dataCards, eq(favorites.dataCardId, dataCards.id))
      .where(
        and(
          eq(favorites.userId, userId),
          eq(dataCards.type, type),
          isNull(dataCards.deletedAt),
        ),
      );

    return rows
      .map((row) => (typeof row.dataCardId === 'string' ? row.dataCardId : ''))
      .filter(Boolean);
  }

  const rows = await db
    .select({
      dataCardId: favorites.dataCardId,
    })
    .from(favorites)
    .where(eq(favorites.userId, userId));

  return rows
    .map((row) => (typeof row.dataCardId === 'string' ? row.dataCardId : ''))
    .filter(Boolean);
};
