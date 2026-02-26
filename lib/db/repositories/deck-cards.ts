import { and, asc, eq, inArray, isNull, notExists, or, sql } from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { dataCards, deckCards, decks, users } from '@/lib/db/schema';

export type DeckCardWithAccessRawRow = {
  deck_id: string;
  data_card_id: string;
  card_name_snapshot: string | null;
  card_type_snapshot: string | null;
  sort_order: number;
  rel_created_at: string | null;
  card_id: string | null;
  card_user_id: number | null;
  card_type: string | null;
  card_name: string | null;
  card_description: string | null;
  card_data: string | null;
  card_is_public: number | null;
  usage_count: number | null;
  like_count: number | null;
  favorite_count: number | null;
  card_review_status: string | null;
  card_created_at: string | null;
  card_updated_at: string | null;
  card_deleted_at: string | null;
  username: string | null;
};

export type DeckAddCardCandidate = {
  id: string;
  user_id: number;
  type: string | null;
  name: string | null;
  is_public: number;
  review_status: string | null;
  deleted_at: string | null;
};

const toInt = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
};

const toIntOrNull = (value: unknown): number | null => {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
};

export const listDeckCardsWithCardContextByDeckId = async (
  db: AppDrizzleDb,
  deckId: string,
): Promise<DeckCardWithAccessRawRow[]> => {
  const rows = await db
    .select({
      deckId: deckCards.deckId,
      dataCardId: deckCards.dataCardId,
      cardNameSnapshot: deckCards.cardNameSnapshot,
      cardTypeSnapshot: deckCards.cardTypeSnapshot,
      sortOrder: deckCards.sortOrder,
      relCreatedAt: deckCards.createdAt,
      cardId: dataCards.id,
      cardUserId: dataCards.userId,
      cardType: dataCards.type,
      cardName: dataCards.name,
      cardDescription: dataCards.description,
      cardData: dataCards.data,
      cardIsPublic: sql<number | null>`CAST(${dataCards.isPublic} AS INTEGER)`,
      usageCount: dataCards.usageCount,
      likeCount: dataCards.likeCount,
      favoriteCount: dataCards.favoriteCount,
      cardReviewStatus: dataCards.reviewStatus,
      cardCreatedAt: dataCards.createdAt,
      cardUpdatedAt: dataCards.updatedAt,
      cardDeletedAt: dataCards.deletedAt,
      username: users.username,
    })
    .from(deckCards)
    .leftJoin(dataCards, eq(deckCards.dataCardId, dataCards.id))
    .leftJoin(users, eq(dataCards.userId, users.id))
    .where(eq(deckCards.deckId, deckId))
    .orderBy(asc(deckCards.sortOrder), asc(deckCards.createdAt));

  return rows.map((row) => ({
    deck_id: row.deckId,
    data_card_id: row.dataCardId,
    card_name_snapshot: typeof row.cardNameSnapshot === 'string' ? row.cardNameSnapshot : null,
    card_type_snapshot: typeof row.cardTypeSnapshot === 'string' ? row.cardTypeSnapshot : null,
    sort_order: toInt(row.sortOrder, 0),
    rel_created_at: typeof row.relCreatedAt === 'string' ? row.relCreatedAt : null,
    card_id: typeof row.cardId === 'string' ? row.cardId : null,
    card_user_id: toIntOrNull(row.cardUserId),
    card_type: typeof row.cardType === 'string' ? row.cardType : null,
    card_name: typeof row.cardName === 'string' ? row.cardName : null,
    card_description: typeof row.cardDescription === 'string' ? row.cardDescription : null,
    card_data: typeof row.cardData === 'string' ? row.cardData : null,
    card_is_public: toIntOrNull(row.cardIsPublic),
    usage_count: toIntOrNull(row.usageCount),
    like_count: toIntOrNull(row.likeCount),
    favorite_count: toIntOrNull(row.favoriteCount),
    card_review_status: typeof row.cardReviewStatus === 'string' ? row.cardReviewStatus : null,
    card_created_at: typeof row.cardCreatedAt === 'string' ? row.cardCreatedAt : null,
    card_updated_at: typeof row.cardUpdatedAt === 'string' ? row.cardUpdatedAt : null,
    card_deleted_at: typeof row.cardDeletedAt === 'string' ? row.cardDeletedAt : null,
    username: typeof row.username === 'string' ? row.username : null,
  }));
};

export const getDeckCardMaxSortOrder = async (
  db: AppDrizzleDb,
  deckId: string,
): Promise<number> => {
  const rows = await db
    .select({
      maxSort: sql<number>`COALESCE(MAX(${deckCards.sortOrder}), 0)`,
    })
    .from(deckCards)
    .where(eq(deckCards.deckId, deckId));

  return Math.max(0, toInt(rows[0]?.maxSort, 0));
};

export const listDataCardsForDeckMutationByIds = async (
  db: AppDrizzleDb,
  cardIds: string[],
): Promise<DeckAddCardCandidate[]> => {
  if (cardIds.length === 0) return [];
  const uniqueIds = Array.from(
    new Set(cardIds.map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean)),
  );
  if (uniqueIds.length === 0) return [];

  const rows = await db
    .select({
      id: dataCards.id,
      userId: dataCards.userId,
      type: dataCards.type,
      name: dataCards.name,
      isPublic: sql<number>`CAST(${dataCards.isPublic} AS INTEGER)`,
      reviewStatus: dataCards.reviewStatus,
      deletedAt: dataCards.deletedAt,
    })
    .from(dataCards)
    .where(inArray(dataCards.id, uniqueIds));

  return rows.map((row) => ({
    id: row.id,
    user_id: toInt(row.userId, 0),
    type: typeof row.type === 'string' ? row.type : null,
    name: typeof row.name === 'string' ? row.name : null,
    is_public: toInt(row.isPublic, 0),
    review_status: typeof row.reviewStatus === 'string' ? row.reviewStatus : null,
    deleted_at: typeof row.deletedAt === 'string' ? row.deletedAt : null,
  }));
};

export const insertDeckCardIgnore = async (
  db: AppDrizzleDb,
  payload: {
    deckId: string;
    dataCardId: string;
    cardNameSnapshot: string;
    cardTypeSnapshot: string;
    sortOrder: number;
  },
): Promise<boolean> => {
  const inserted = await db
    .insert(deckCards)
    .values({
      deckId: payload.deckId,
      dataCardId: payload.dataCardId,
      cardNameSnapshot: payload.cardNameSnapshot,
      cardTypeSnapshot: payload.cardTypeSnapshot,
      sortOrder: payload.sortOrder,
    })
    .onConflictDoNothing()
    .returning({
      deckId: deckCards.deckId,
    });

  return inserted.length > 0;
};

export const deleteDeckCardsByDeckIdAndCardIds = async (
  db: AppDrizzleDb,
  deckId: string,
  cardIds: string[],
): Promise<number> => {
  const uniqueIds = Array.from(
    new Set(cardIds.map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean)),
  );
  if (uniqueIds.length === 0) return 0;

  const deleted = await db
    .delete(deckCards)
    .where(and(eq(deckCards.deckId, deckId), inArray(deckCards.dataCardId, uniqueIds)))
    .returning({
      dataCardId: deckCards.dataCardId,
    });

  return deleted.length;
};

export const isDeckOwnedByUser = async (
  db: AppDrizzleDb,
  deckId: string,
  userId: number,
): Promise<boolean> => {
  const rows = await db
    .select({
      id: decks.id,
    })
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
    .limit(1);

  return rows.length > 0;
};

export const pruneDeckInaccessibleCardsByDeckId = async (
  db: AppDrizzleDb,
  deckId: string,
  ownerUserId: number,
): Promise<number> => {
  const accessibleCardSubquery = db
    .select({
      one: sql<number>`1`,
    })
    .from(dataCards)
    .where(
      and(
        eq(dataCards.id, deckCards.dataCardId),
        isNull(dataCards.deletedAt),
        or(
          eq(dataCards.userId, ownerUserId),
          and(eq(dataCards.isPublic, true), eq(dataCards.reviewStatus, 'approved')),
        )!,
      ),
    );

  const deleted = await db
    .delete(deckCards)
    .where(and(eq(deckCards.deckId, deckId), notExists(accessibleCardSubquery)))
    .returning({
      dataCardId: deckCards.dataCardId,
    });

  return deleted.length;
};
