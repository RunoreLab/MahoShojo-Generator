import {
  and,
  count,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { dataCardMetrics, dataCards, dataCardTags, dataCardUpdates, users } from '@/lib/db/schema';

export type DataCardType = 'character' | 'scenario' | 'history' | 'questionnaire';
export type DataCardSortBy = 'likes' | 'usage' | 'favorites' | 'created_at';

export type DataCardDbRow = {
  id: string;
  user_id: number;
  type: DataCardType;
  name: string;
  description: string | null;
  data: string;
  is_public: number;
  public_since: string | null;
  usage_count: number;
  like_count: number;
  favorite_count: number;
  review_status: string | null;
  is_recommended: number;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
};

export type UserDataCardDbRow = DataCardDbRow & {
  pending_data: string | null;
  pending_name: string | null;
  pending_description: string | null;
  pending_updated_at: string | null;
  tag_ids: string | null;
};

export type DataCardUpdateDbRow = {
  id: string;
  data_card_id: string;
  user_id: number;
  name: string | null;
  description: string | null;
  data: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type DataCardByIdDbRow = DataCardDbRow & {
  username: string;
  tag_ids: string | null;
};

export type PublicDataCardsQuery = {
  limit: number;
  offset: number;
  type?: DataCardType;
  search?: string;
  sortBy?: DataCardSortBy;
  tagIds?: string[];
  tagMatch?: 'any' | 'all';
  author?: string;
  minLikes?: number;
  maxLikes?: number;
  minUsage?: number;
  maxUsage?: number;
  minFavorites?: number;
  maxFavorites?: number;
  recommendedOnly?: boolean;
  nativeOnly?: boolean;
  nativeAllowedOnly?: boolean;
};

export type RandomPublicCardQuery = {
  type: DataCardType;
  excludeIds?: string[];
  minLikeCount?: number | null;
  maxLikeCount?: number | null;
  minUsageCount?: number | null;
  maxUsageCount?: number | null;
  minFavoriteCount?: number | null;
  maxFavoriteCount?: number | null;
};

export type DataCardStatsRow = {
  id: string;
  is_public: number;
  usage_count: number;
  like_count: number;
  favorite_count: number;
};

export type UserTopDataCardRow = {
  id: string;
  type: DataCardType;
  name: string;
  description: string | null;
  is_public: number;
  review_status: string | null;
  usage_count: number;
  like_count: number;
  favorite_count: number;
  created_at: string | null;
  updated_at: string | null;
};

export type UserProfileCardStatsRow = {
  type: DataCardType;
  data: string;
  is_public: number;
  like_count: number;
  favorite_count: number;
  usage_count: number;
};

type InsertDataCardInput = {
  id: string;
  userId: number;
  type: DataCardType;
  name: string;
  description: string;
  data: string;
  isPublic: number;
  reviewStatus?: 'pending' | 'approved' | 'rejected';
};

type UpdateDataCardInput = {
  id: string;
  userId: number;
  name: string;
  description: string;
  isPublic?: number;
  reviewStatus?: 'pending' | 'approved' | 'rejected';
};

type EnforceDataCardModerationOutcomeInput = {
  cardId: string;
  reviewStatus: 'rejected';
  isPublic: -1;
  now: string;
};

type UpsertDataCardUpdateInput = {
  id: string;
  dataCardId: string;
  userId: number;
  payload: {
    name?: string;
    description?: string;
    data?: string;
  };
};

const toInt = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
};

const toNullableString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const asDataCardType = (value: unknown): DataCardType => {
  if (value === 'scenario' || value === 'history' || value === 'questionnaire') return value;
  return 'character';
};

const normalizeStringIds = (ids: string[], limit?: number): string[] => {
  const normalized = Array.from(
    new Set(ids.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)),
  );
  if (typeof limit === 'number' && Number.isFinite(limit)) {
    return normalized.slice(0, Math.max(0, Math.floor(limit)));
  }
  return normalized;
};

const toNonNegativeInt = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.floor(value));
};

const dataCardBaseSelect = {
  id: dataCards.id,
  user_id: dataCards.userId,
  type: dataCards.type,
  name: dataCards.name,
  description: dataCards.description,
  data: dataCards.data,
  is_public: sql<number>`CAST(${dataCards.isPublic} AS INTEGER)`,
  public_since: dataCards.publicSince,
  usage_count: dataCards.usageCount,
  like_count: dataCards.likeCount,
  favorite_count: dataCards.favoriteCount,
  review_status: dataCards.reviewStatus,
  is_recommended: sql<number>`CAST(COALESCE(${dataCards.isRecommended}, 0) AS INTEGER)`,
  created_at: dataCards.createdAt,
  updated_at: dataCards.updatedAt,
  deleted_at: dataCards.deletedAt,
};

const mapDataCardDbRow = (row: Record<string, unknown>): DataCardDbRow => ({
  id: typeof row.id === 'string' ? row.id : '',
  user_id: toInt(row.user_id, 0),
  type: asDataCardType(row.type),
  name: typeof row.name === 'string' ? row.name : '',
  description: toNullableString(row.description),
  data: typeof row.data === 'string' ? row.data : '',
  is_public: toInt(row.is_public, 0),
  public_since: toNullableString(row.public_since),
  usage_count: toInt(row.usage_count, 0),
  like_count: toInt(row.like_count, 0),
  favorite_count: toInt(row.favorite_count, 0),
  review_status: toNullableString(row.review_status),
  is_recommended: toInt(row.is_recommended, 0),
  created_at: toNullableString(row.created_at),
  updated_at: toNullableString(row.updated_at),
  deleted_at: toNullableString(row.deleted_at),
});

export const enforceDataCardModerationOutcome = async (
  db: AppDrizzleDb,
  input: EnforceDataCardModerationOutcomeInput,
): Promise<{ found: boolean; changed: boolean }> => {
  const rows = await db
    .select({
      id: dataCards.id,
      isPublic: sql<number>`CAST(${dataCards.isPublic} AS INTEGER)`,
      reviewStatus: dataCards.reviewStatus,
    })
    .from(dataCards)
    .where(and(eq(dataCards.id, input.cardId), isNull(dataCards.deletedAt)))
    .limit(1);

  const current = rows[0];
  if (!current) {
    return { found: false, changed: false };
  }

  if (current.reviewStatus === input.reviewStatus && Number(current.isPublic) === input.isPublic) {
    return { found: true, changed: false };
  }

  await db
    .update(dataCards)
    .set({
      reviewStatus: input.reviewStatus,
      isPublic: sql`${input.isPublic}`,
      publicSince: null,
      updatedAt: input.now,
    })
    .where(and(eq(dataCards.id, input.cardId), isNull(dataCards.deletedAt)))
    .returning({ id: dataCards.id });

  return { found: true, changed: true };
};

const buildExcludeIdsClause = (ids: string[]): SQL | undefined => {
  if (ids.length === 0) return undefined;
  return sql`${dataCards.id} NOT IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`;
};

const buildTagIdsAggregate = (cardId: typeof dataCards.id): SQL<string | null> =>
  sql<string | null>`(
    SELECT group_concat(DISTINCT ${dataCardTags.tagId})
    FROM ${dataCardTags}
    WHERE ${dataCardTags.dataCardId} = ${cardId}
  )`;

export const countPublicDataCardsByNameType = async (
  db: AppDrizzleDb,
  name: string,
  type: DataCardType,
): Promise<number> => {
  const rows = await db
    .select({ count: count() })
    .from(dataCards)
    .where(
      and(
        eq(dataCards.name, name),
        eq(dataCards.type, type),
        eq(dataCards.isPublic, true),
        isNull(dataCards.deletedAt),
      ),
    );

  return Math.max(0, toInt(rows[0]?.count, 0));
};

export const insertDataCard = async (
  db: AppDrizzleDb,
  input: InsertDataCardInput,
): Promise<boolean> => {
  const values: Record<string, unknown> = {
    id: input.id,
    userId: input.userId,
    type: input.type,
    name: input.name,
    description: input.description,
    data: input.data,
    isPublic: sql`${input.isPublic}`,
    publicSince: input.isPublic === 1 ? sql`CURRENT_TIMESTAMP` : null,
    usageCount: 0,
    likeCount: 0,
    favoriteCount: 0,
    isRecommended: false,
    createdAt: sql`CURRENT_TIMESTAMP`,
    updatedAt: sql`CURRENT_TIMESTAMP`,
  };

  if (input.reviewStatus) {
    values.reviewStatus = input.reviewStatus;
  }

  const inserted = await db
    .insert(dataCards)
    .values(values as never)
    .returning({ id: dataCards.id });

  return inserted.length > 0;
};

export const listUserDataCards = async (
  db: AppDrizzleDb,
  input: { userId: number; search?: string; sortBy?: DataCardSortBy },
): Promise<UserDataCardDbRow[]> => {
  const conditions: SQL[] = [eq(dataCards.userId, input.userId), isNull(dataCards.deletedAt)];
  if (input.search) {
    const keyword = `%${input.search}%`;
    conditions.push(or(like(dataCards.name, keyword), like(dataCards.description, keyword))!);
  }

  const updatedSortKey = sql`COALESCE(${dataCards.updatedAt}, ${dataCards.createdAt})`;
  const createdSortKey = sql`COALESCE(${dataCards.createdAt}, ${dataCards.updatedAt})`;
  const idSortKey = dataCards.id;

  let orderBy: SQL[] = [desc(updatedSortKey), desc(idSortKey)];
  if (input.sortBy === 'likes') {
    orderBy = [desc(dataCards.likeCount), desc(updatedSortKey), desc(idSortKey)];
  } else if (input.sortBy === 'usage') {
    orderBy = [desc(dataCards.usageCount), desc(updatedSortKey), desc(idSortKey)];
  } else if (input.sortBy === 'favorites') {
    orderBy = [desc(dataCards.favoriteCount), desc(updatedSortKey), desc(idSortKey)];
  } else if (input.sortBy === 'created_at') {
    orderBy = [desc(createdSortKey), desc(idSortKey)];
  }

  const rows = await db
    .select({
      ...dataCardBaseSelect,
      pending_data: dataCardUpdates.data,
      pending_name: dataCardUpdates.name,
      pending_description: dataCardUpdates.description,
      pending_updated_at: dataCardUpdates.updatedAt,
      tag_ids: buildTagIdsAggregate(dataCards.id),
    })
    .from(dataCards)
    .leftJoin(dataCardUpdates, eq(dataCardUpdates.dataCardId, dataCards.id))
    .where(and(...conditions))
    .orderBy(...orderBy);

  return rows.map((row) => ({
    ...mapDataCardDbRow(row),
    pending_data: toNullableString(row.pending_data),
    pending_name: toNullableString(row.pending_name),
    pending_description: toNullableString(row.pending_description),
    pending_updated_at: toNullableString(row.pending_updated_at),
    tag_ids: toNullableString(row.tag_ids),
  }));
};

export const updateDataCardByIdAndUser = async (
  db: AppDrizzleDb,
  input: UpdateDataCardInput,
): Promise<number> => {
  const setValues: Record<string, unknown> = {
    name: input.name,
    description: input.description,
    updatedAt: sql`CURRENT_TIMESTAMP`,
  };

  if (typeof input.isPublic === 'number') {
    setValues.isPublic = sql`${input.isPublic}`;
    setValues.publicSince = sql`CASE
      WHEN CAST(${dataCards.isPublic} AS INTEGER) <> ${input.isPublic}
      THEN (CASE WHEN ${input.isPublic} = 1 THEN CURRENT_TIMESTAMP ELSE NULL END)
      ELSE ${dataCards.publicSince}
    END`;
  }

  if (input.reviewStatus) {
    setValues.reviewStatus = input.reviewStatus;
  }

  const updated = await db
    .update(dataCards)
    .set(setValues as never)
    .where(and(eq(dataCards.id, input.id), eq(dataCards.userId, input.userId), isNull(dataCards.deletedAt)))
    .returning({ id: dataCards.id });

  return updated.length;
};

export const updateDataCardContentByIdAndUserWithChanges = async (
  db: AppDrizzleDb,
  dataCardId: string,
  userId: number,
  dataJsonString: string,
): Promise<number> => {
  const updated = await db
    .update(dataCards)
    .set({
      data: dataJsonString,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(dataCards.id, dataCardId), eq(dataCards.userId, userId)))
    .returning({ id: dataCards.id });

  return updated.length;
};

export const upsertDataCardUpdateByDataCardId = async (
  db: AppDrizzleDb,
  input: UpsertDataCardUpdateInput,
): Promise<boolean> => {
  const insertValues: Record<string, unknown> = {
    id: input.id,
    dataCardId: input.dataCardId,
    userId: input.userId,
    createdAt: sql`CURRENT_TIMESTAMP`,
    updatedAt: sql`CURRENT_TIMESTAMP`,
  };
  const updateValues: Record<string, unknown> = {
    userId: input.userId,
    createdAt: sql`COALESCE(${dataCardUpdates.createdAt}, CURRENT_TIMESTAMP)`,
    updatedAt: sql`CURRENT_TIMESTAMP`,
  };

  if (input.payload.name !== undefined) {
    insertValues.name = input.payload.name;
    updateValues.name = input.payload.name;
  }
  if (input.payload.description !== undefined) {
    insertValues.description = input.payload.description;
    updateValues.description = input.payload.description;
  }
  if (input.payload.data !== undefined) {
    insertValues.data = input.payload.data;
    updateValues.data = input.payload.data;
  }

  const upserted = await db
    .insert(dataCardUpdates)
    .values(insertValues as never)
    .onConflictDoUpdate({
      target: dataCardUpdates.dataCardId,
      set: updateValues as never,
    })
    .returning({ id: dataCardUpdates.id });

  return upserted.length > 0;
};

export const countUserUsedDataCardSlots = async (
  db: AppDrizzleDb,
  userId: number,
): Promise<number> => {
  const rows = await db
    .select({ count: count() })
    .from(dataCards)
    .where(
      and(
        eq(dataCards.userId, userId),
        isNull(dataCards.deletedAt),
        sql`NOT (COALESCE(${dataCards.favoriteCount}, 0) > 10 AND COALESCE(${dataCards.usageCount}, 0) > 30)`,
      ),
    );

  return Math.max(0, toInt(rows[0]?.count, 0));
};

export const getDataCardUpdateByDataCardId = async (
  db: AppDrizzleDb,
  dataCardId: string,
): Promise<DataCardUpdateDbRow | null> => {
  const rows = await db
    .select({
      id: dataCardUpdates.id,
      data_card_id: dataCardUpdates.dataCardId,
      user_id: dataCardUpdates.userId,
      name: dataCardUpdates.name,
      description: dataCardUpdates.description,
      data: dataCardUpdates.data,
      created_at: dataCardUpdates.createdAt,
      updated_at: dataCardUpdates.updatedAt,
    })
    .from(dataCardUpdates)
    .where(eq(dataCardUpdates.dataCardId, dataCardId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    data_card_id: row.data_card_id,
    user_id: toInt(row.user_id, 0),
    name: toNullableString(row.name),
    description: toNullableString(row.description),
    data: toNullableString(row.data),
    created_at: toNullableString(row.created_at),
    updated_at: toNullableString(row.updated_at),
  };
};

export const deleteDataCardUpdateByDataCardId = async (
  db: AppDrizzleDb,
  dataCardId: string,
): Promise<void> => {
  await db.delete(dataCardUpdates).where(eq(dataCardUpdates.dataCardId, dataCardId));
};

export const softDeleteDataCardByIdAndUser = async (
  db: AppDrizzleDb,
  cardId: string,
  userId: number,
): Promise<number> => {
  const updated = await db
    .update(dataCards)
    .set({
      deletedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(dataCards.id, cardId), eq(dataCards.userId, userId), isNull(dataCards.deletedAt)))
    .returning({ id: dataCards.id });

  return updated.length;
};

export const permanentlyDeleteDataCardsByUserAndIds = async (
  db: AppDrizzleDb,
  userId: number,
  ids: string[],
): Promise<number> => {
  const safeIds = normalizeStringIds(ids);
  if (safeIds.length === 0) return 0;

  const deleted = await db
    .delete(dataCards)
    .where(and(eq(dataCards.userId, userId), inArray(dataCards.id, safeIds)))
    .returning({ id: dataCards.id });

  return deleted.length;
};

export const listUserRecycleBinDataCards = async (
  db: AppDrizzleDb,
  userId: number,
): Promise<DataCardDbRow[]> => {
  const rows = await db
    .select(dataCardBaseSelect)
    .from(dataCards)
    .where(and(eq(dataCards.userId, userId), isNotNull(dataCards.deletedAt)))
    .orderBy(desc(dataCards.deletedAt));

  return rows.map(mapDataCardDbRow);
};

export const listUserRecycleBinDataCardIds = async (
  db: AppDrizzleDb,
  userId: number,
): Promise<string[]> => {
  const rows = await db
    .select({ id: dataCards.id })
    .from(dataCards)
    .where(and(eq(dataCards.userId, userId), isNotNull(dataCards.deletedAt)))
    .orderBy(desc(dataCards.deletedAt));

  return rows.map((row) => row.id).filter((id) => typeof id === 'string' && id.length > 0);
};

export const restoreDataCardByIdAndUser = async (
  db: AppDrizzleDb,
  cardId: string,
  userId: number,
): Promise<number> => {
  const updated = await db
    .update(dataCards)
    .set({
      deletedAt: null,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(dataCards.id, cardId), eq(dataCards.userId, userId), isNotNull(dataCards.deletedAt)))
    .returning({ id: dataCards.id });

  return updated.length;
};

export const hasDataCardOwnership = async (
  db: AppDrizzleDb,
  cardId: string,
  userId: number,
): Promise<boolean> => {
  const rows = await db
    .select({ id: dataCards.id })
    .from(dataCards)
    .where(and(eq(dataCards.id, cardId), eq(dataCards.userId, userId)))
    .limit(1);

  return rows.length > 0;
};

export const getDataCardByIdWithAuthorAndTags = async (
  db: AppDrizzleDb,
  input: { cardId: string; publicOnly: boolean },
): Promise<DataCardByIdDbRow | null> => {
  const conditions: SQL[] = [eq(dataCards.id, input.cardId), isNull(dataCards.deletedAt)];
  if (input.publicOnly) {
    conditions.push(eq(dataCards.isPublic, true), eq(dataCards.reviewStatus, 'approved'));
  }

  const rows = await db
    .select({
      ...dataCardBaseSelect,
      username: users.username,
      tag_ids: buildTagIdsAggregate(dataCards.id),
    })
    .from(dataCards)
    .innerJoin(users, eq(dataCards.userId, users.id))
    .where(and(...conditions))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    ...mapDataCardDbRow(row),
    username: row.username,
    tag_ids: toNullableString(row.tag_ids),
  };
};

export const incrementPublicApprovedDataCardLikeCount = async (
  db: AppDrizzleDb,
  cardId: string,
): Promise<number> => {
  const updated = await db
    .update(dataCards)
    .set({
      likeCount: sql`COALESCE(${dataCards.likeCount}, 0) + 1`,
    })
    .where(
      and(
        eq(dataCards.id, cardId),
        eq(dataCards.isPublic, true),
        eq(dataCards.reviewStatus, 'approved'),
        isNull(dataCards.deletedAt),
      ),
    )
    .returning({ id: dataCards.id });

  return updated.length;
};

export const incrementPublicApprovedDataCardUsageCount = async (
  db: AppDrizzleDb,
  cardId: string,
): Promise<number> => {
  const updated = await db
    .update(dataCards)
    .set({
      usageCount: sql`COALESCE(${dataCards.usageCount}, 0) + 1`,
    })
    .where(
      and(
        eq(dataCards.id, cardId),
        eq(dataCards.isPublic, true),
        eq(dataCards.reviewStatus, 'approved'),
        isNull(dataCards.deletedAt),
      ),
    )
    .returning({ id: dataCards.id });

  return updated.length;
};

export const listPublicDataCardsWithFilters = async (
  db: AppDrizzleDb,
  input: PublicDataCardsQuery,
): Promise<DataCardByIdDbRow[]> => {
  const safeLimit = Math.max(0, Math.floor(input.limit));
  const safeOffset = Math.max(0, Math.floor(input.offset));
  if (safeLimit <= 0) return [];

  const conditions: SQL[] = [eq(dataCards.isPublic, true), eq(dataCards.reviewStatus, 'approved'), isNull(dataCards.deletedAt)];

  if (input.type) {
    conditions.push(eq(dataCards.type, input.type));
  }
  if (input.search) {
    const keyword = `%${input.search}%`;
    conditions.push(or(like(dataCards.name, keyword), like(dataCards.description, keyword))!);
  }

  const safeTagIds = normalizeStringIds(input.tagIds ?? []);
  if (safeTagIds.length > 0) {
    if (input.tagMatch === 'all') {
      conditions.push(sql`(
        SELECT COUNT(DISTINCT ${dataCardTags.tagId})
        FROM ${dataCardTags}
        WHERE ${dataCardTags.dataCardId} = ${dataCards.id}
          AND ${inArray(dataCardTags.tagId, safeTagIds)}
      ) = ${safeTagIds.length}`);
    } else {
      const tagMatched = db
        .select({ one: sql<number>`1` })
        .from(dataCardTags)
        .where(and(eq(dataCardTags.dataCardId, dataCards.id), inArray(dataCardTags.tagId, safeTagIds)));
      conditions.push(exists(tagMatched));
    }
  }

  if (input.author) {
    conditions.push(eq(users.username, input.author));
  }

  if (input.minLikes !== undefined && input.minLikes !== null) {
    conditions.push(gte(dataCards.likeCount, Math.floor(input.minLikes)));
  }
  if (input.maxLikes !== undefined && input.maxLikes !== null) {
    conditions.push(lte(dataCards.likeCount, Math.floor(input.maxLikes)));
  }
  if (input.minUsage !== undefined && input.minUsage !== null) {
    conditions.push(gte(dataCards.usageCount, Math.floor(input.minUsage)));
  }
  if (input.maxUsage !== undefined && input.maxUsage !== null) {
    conditions.push(lte(dataCards.usageCount, Math.floor(input.maxUsage)));
  }
  if (input.minFavorites !== undefined && input.minFavorites !== null) {
    conditions.push(gte(dataCards.favoriteCount, Math.floor(input.minFavorites)));
  }
  if (input.maxFavorites !== undefined && input.maxFavorites !== null) {
    conditions.push(lte(dataCards.favoriteCount, Math.floor(input.maxFavorites)));
  }
  if (input.recommendedOnly) {
    conditions.push(eq(dataCards.isRecommended, true));
  }
  if (input.nativeOnly) {
    const nativeRows = db
      .select({ one: sql<number>`1` })
      .from(dataCardMetrics)
      .where(and(eq(dataCardMetrics.dataCardId, dataCards.id), eq(dataCardMetrics.isNative, true)));
    conditions.push(exists(nativeRows));
  }
  if (input.nativeAllowedOnly) {
    conditions.push(
      eq(dataCards.type, 'questionnaire'),
      sql`(
        CASE
          WHEN json_valid(${dataCards.data}) = 1
          THEN COALESCE(
            json_extract(${dataCards.data}, '$.nativeAllowed'),
            json_extract(${dataCards.data}, '$.native_allowed'),
            0
          )
          ELSE 0
        END
      ) = 1`,
    );
  }

  let orderBy: SQL[] = [desc(dataCards.createdAt)];
  if (input.sortBy === 'likes') {
    orderBy = [desc(dataCards.likeCount), desc(dataCards.createdAt)];
  } else if (input.sortBy === 'usage') {
    orderBy = [desc(dataCards.usageCount), desc(dataCards.createdAt)];
  } else if (input.sortBy === 'favorites') {
    orderBy = [desc(dataCards.favoriteCount), desc(dataCards.createdAt)];
  }
  if (input.recommendedOnly && input.sortBy !== 'favorites') {
    orderBy = [desc(dataCards.updatedAt), desc(dataCards.createdAt)];
  }

  const rows = await db
    .select({
      ...dataCardBaseSelect,
      username: users.username,
      tag_ids: buildTagIdsAggregate(dataCards.id),
    })
    .from(dataCards)
    .innerJoin(users, eq(dataCards.userId, users.id))
    .where(and(...conditions))
    .orderBy(...orderBy)
    .limit(safeLimit)
    .offset(safeOffset);

  return rows.map((row) => ({
    ...mapDataCardDbRow(row),
    username: row.username,
    tag_ids: toNullableString(row.tag_ids),
  }));
};

export const getRandomPublicDataCardWithFilters = async (
  db: AppDrizzleDb,
  input: RandomPublicCardQuery,
): Promise<(DataCardDbRow & { username: string }) | null> => {
  const conditions: SQL[] = [
    eq(dataCards.isPublic, true),
    eq(dataCards.type, input.type),
    eq(dataCards.reviewStatus, 'approved'),
    isNull(dataCards.deletedAt),
  ];

  const minLike = toNonNegativeInt(input.minLikeCount);
  const maxLike = toNonNegativeInt(input.maxLikeCount);
  const minUsage = toNonNegativeInt(input.minUsageCount);
  const maxUsage = toNonNegativeInt(input.maxUsageCount);
  const minFavorite = toNonNegativeInt(input.minFavoriteCount);
  const maxFavorite = toNonNegativeInt(input.maxFavoriteCount);

  if (minLike !== null) conditions.push(gte(dataCards.likeCount, minLike));
  if (maxLike !== null) conditions.push(lte(dataCards.likeCount, maxLike));
  if (minUsage !== null) conditions.push(gte(dataCards.usageCount, minUsage));
  if (maxUsage !== null) conditions.push(lte(dataCards.usageCount, maxUsage));
  if (minFavorite !== null) conditions.push(gte(dataCards.favoriteCount, minFavorite));
  if (maxFavorite !== null) conditions.push(lte(dataCards.favoriteCount, maxFavorite));

  const excludeIds = normalizeStringIds(input.excludeIds ?? [], 800);
  const excludeClause = buildExcludeIdsClause(excludeIds);
  if (excludeClause) {
    conditions.push(excludeClause);
  }

  const rows = await db
    .select({
      ...dataCardBaseSelect,
      username: users.username,
    })
    .from(dataCards)
    .innerJoin(users, eq(dataCards.userId, users.id))
    .where(and(...conditions))
    .orderBy(sql`RANDOM()`)
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    ...mapDataCardDbRow(row),
    username: row.username,
  };
};

export const getDataCardStatsRowsByIds = async (
  db: AppDrizzleDb,
  ids: string[],
): Promise<DataCardStatsRow[]> => {
  const safeIds = normalizeStringIds(ids);
  if (safeIds.length === 0) return [];

  const rows = await db
    .select({
      id: dataCards.id,
      is_public: sql<number>`CAST(${dataCards.isPublic} AS INTEGER)`,
      usage_count: dataCards.usageCount,
      like_count: dataCards.likeCount,
      favorite_count: dataCards.favoriteCount,
    })
    .from(dataCards)
    .where(inArray(dataCards.id, safeIds));

  return rows.map((row) => ({
    id: row.id,
    is_public: toInt(row.is_public, 0),
    usage_count: toInt(row.usage_count, 0),
    like_count: toInt(row.like_count, 0),
    favorite_count: toInt(row.favorite_count, 0),
  }));
};

export const listUserTopDataCardsByEngagement = async (
  db: AppDrizzleDb,
  userId: number,
  type: 'character' | 'scenario',
  limit: number,
): Promise<UserTopDataCardRow[]> => {
  const safeLimit = Math.max(1, Math.min(10, Math.floor(limit)));
  const rows = await db
    .select({
      id: dataCards.id,
      type: dataCards.type,
      name: dataCards.name,
      description: dataCards.description,
      is_public: sql<number>`CAST(${dataCards.isPublic} AS INTEGER)`,
      review_status: dataCards.reviewStatus,
      usage_count: dataCards.usageCount,
      like_count: dataCards.likeCount,
      favorite_count: dataCards.favoriteCount,
      created_at: dataCards.createdAt,
      updated_at: dataCards.updatedAt,
    })
    .from(dataCards)
    .where(and(eq(dataCards.userId, userId), eq(dataCards.type, type), isNull(dataCards.deletedAt)))
    .orderBy(
      desc(sql`COALESCE(${dataCards.usageCount}, 0) + COALESCE(${dataCards.likeCount}, 0) + COALESCE(${dataCards.favoriteCount}, 0)`),
      desc(dataCards.updatedAt),
    )
    .limit(safeLimit);

  return rows.map((row) => ({
    id: row.id,
    type: asDataCardType(row.type),
    name: typeof row.name === 'string' ? row.name : '',
    description: toNullableString(row.description),
    is_public: toInt(row.is_public, 0),
    review_status: toNullableString(row.review_status),
    usage_count: toInt(row.usage_count, 0),
    like_count: toInt(row.like_count, 0),
    favorite_count: toInt(row.favorite_count, 0),
    created_at: toNullableString(row.created_at),
    updated_at: toNullableString(row.updated_at),
  }));
};

export const listUserProfileCardStatsRows = async (
  db: AppDrizzleDb,
  userId: number,
): Promise<UserProfileCardStatsRow[]> => {
  const rows = await db
    .select({
      type: dataCards.type,
      data: dataCards.data,
      is_public: sql<number>`CAST(${dataCards.isPublic} AS INTEGER)`,
      like_count: dataCards.likeCount,
      favorite_count: dataCards.favoriteCount,
      usage_count: dataCards.usageCount,
    })
    .from(dataCards)
    .where(and(eq(dataCards.userId, userId), isNull(dataCards.deletedAt)));

  return rows.map((row) => ({
    type: asDataCardType(row.type),
    data: typeof row.data === 'string' ? row.data : '',
    is_public: toInt(row.is_public, 0),
    like_count: toInt(row.like_count, 0),
    favorite_count: toInt(row.favorite_count, 0),
    usage_count: toInt(row.usage_count, 0),
  }));
};
