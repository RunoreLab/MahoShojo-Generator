import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  isNull,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import {
  arenaRatings,
  dataCardMetrics,
  dataCards,
  dataCardTags,
  users,
} from '@/lib/db/schema';

export type SeasonArchiveQueue = 'strict' | 'free';

export type SeasonArchiveLeaderboardSort = 'rating_desc' | 'rating_asc';

export type SeasonArchiveLeaderboardRow = {
  entityType: 'data_card' | 'preset';
  entityId: string;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  ratingUpdatedAt: string | null;
  seasonPeakRating: number | null;
  seasonPeakGames: number | null;
  seasonPeakAt: string | null;
  seasonPeakTier: string | null;
  seasonLowRating: number | null;
  seasonLowGames: number | null;
  seasonLowAt: string | null;
  dataCardName: string | null;
  dataCardDescription: string | null;
  authorName: string | null;
  authorId: number | null;
  usageCount: number | null;
  likeCount: number | null;
  favoriteCount: number | null;
  dataCardCreatedAt: string | null;
  dataCardUpdatedAt: string | null;
  techScore: number | null;
  techLevel: string | null;
  isNative: number | null;
  tagIds: string | null;
};

const toInteger = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
};

const toNullableInteger = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
};

const toNullableString = (value: unknown): string | null => {
  return typeof value === 'string' ? value : null;
};

const toNullableIsNative = (value: unknown): number | null => {
  if (value === true || value === 1 || value === '1') return 1;
  if (value === false || value === 0 || value === '0') return 0;
  return null;
};

const normalizeLimit = (value: number, min = 1, max = 2000): number => {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
};

const normalizeOffset = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
};

const buildStrictPublicSinceClause = (): SQL =>
  sql`(
    ${dataCards.publicSince} IS NULL
    OR ${dataCards.publicSince} <= datetime('now', '-3 days')
    OR (
      ${dataCards.createdAt} IS NOT NULL
      AND ${dataCards.publicSince} IS NOT NULL
      AND ABS(strftime('%s', ${dataCards.publicSince}) - strftime('%s', ${dataCards.createdAt})) <= 600
    )
  )`;

const buildPublicDataCardCondition = (queue: SeasonArchiveQueue): SQL => {
  const conditions: SQL[] = [
    isNotNull(dataCards.id),
    eq(dataCards.type, 'character'),
    eq(dataCards.isPublic, true),
    eq(dataCards.reviewStatus, 'approved'),
    isNull(dataCards.deletedAt),
  ];
  if (queue === 'strict') {
    conditions.push(buildStrictPublicSinceClause());
  }
  return and(...conditions)!;
};

const buildLeaderboardWhereCondition = (queue: SeasonArchiveQueue): SQL => {
  return and(
    eq(arenaRatings.queue, queue),
    sql`(
      ${arenaRatings.entityType} = 'preset'
      OR (
        ${arenaRatings.entityType} = 'data_card'
        AND ${buildPublicDataCardCondition(queue)}
      )
    )`,
  )!;
};

export const countSeasonArchiveEligibleRows = async (
  db: AppDrizzleDb,
  queue: SeasonArchiveQueue,
): Promise<number> => {
  const rows = await db
    .select({
      count: sql<number>`COUNT(*)`,
    })
    .from(arenaRatings)
    .leftJoin(dataCards, and(eq(arenaRatings.entityType, 'data_card'), eq(dataCards.id, arenaRatings.entityId)))
    .where(buildLeaderboardWhereCondition(queue));

  return Math.max(0, toInteger(rows[0]?.count, 0));
};

export const listSeasonArchiveLeaderboardRows = async (
  db: AppDrizzleDb,
  input: {
    queue: SeasonArchiveQueue;
    sort: SeasonArchiveLeaderboardSort;
    limit: number;
    offset: number;
  },
): Promise<SeasonArchiveLeaderboardRow[]> => {
  const safeLimit = normalizeLimit(input.limit, 1, 2000);
  const safeOffset = normalizeOffset(input.offset);

  const ratingExpr = sql<number>`MAX(${arenaRatings.rating})`;
  const gamesExpr = sql<number>`MAX(${arenaRatings.games})`;
  const updatedExpr = sql<string>`MAX(${arenaRatings.updatedAt})`;
  const orderByRating = input.sort === 'rating_asc' ? asc(ratingExpr) : desc(ratingExpr);

  const rows = await db
    .select({
      entityType: arenaRatings.entityType,
      entityId: arenaRatings.entityId,
      rating: ratingExpr,
      games: gamesExpr,
      wins: sql<number>`MAX(${arenaRatings.wins})`,
      losses: sql<number>`MAX(${arenaRatings.losses})`,
      draws: sql<number>`MAX(${arenaRatings.draws})`,
      ratingUpdatedAt: updatedExpr,
      seasonPeakRating: sql<number | null>`MAX(${arenaRatings.seasonPeakRating})`,
      seasonPeakGames: sql<number | null>`MAX(${arenaRatings.seasonPeakGames})`,
      seasonPeakAt: sql<string | null>`MAX(${arenaRatings.seasonPeakAt})`,
      seasonPeakTier: sql<string | null>`MAX(${arenaRatings.seasonPeakTier})`,
      seasonLowRating: sql<number | null>`MAX(${arenaRatings.seasonLowRating})`,
      seasonLowGames: sql<number | null>`MAX(${arenaRatings.seasonLowGames})`,
      seasonLowAt: sql<string | null>`MAX(${arenaRatings.seasonLowAt})`,
      dataCardName: sql<string | null>`MAX(${dataCards.name})`,
      dataCardDescription: sql<string | null>`MAX(${dataCards.description})`,
      authorId: sql<number | null>`MAX(${dataCards.userId})`,
      authorName: sql<string | null>`MAX(${users.username})`,
      usageCount: sql<number | null>`MAX(${dataCards.usageCount})`,
      likeCount: sql<number | null>`MAX(${dataCards.likeCount})`,
      favoriteCount: sql<number | null>`MAX(${dataCards.favoriteCount})`,
      dataCardCreatedAt: sql<string | null>`MAX(${dataCards.createdAt})`,
      dataCardUpdatedAt: sql<string | null>`MAX(${dataCards.updatedAt})`,
      techScore: sql<number | null>`MAX(${dataCardMetrics.techScore})`,
      techLevel: sql<string | null>`MAX(${dataCardMetrics.techLevel})`,
      isNative: sql<number | null>`MAX(${dataCardMetrics.isNative})`,
      tagIds: sql<string | null>`group_concat(DISTINCT ${dataCardTags.tagId})`,
    })
    .from(arenaRatings)
    .leftJoin(dataCards, and(eq(arenaRatings.entityType, 'data_card'), eq(dataCards.id, arenaRatings.entityId)))
    .leftJoin(users, eq(dataCards.userId, users.id))
    .leftJoin(
      dataCardMetrics,
      and(eq(arenaRatings.entityType, 'data_card'), eq(dataCardMetrics.dataCardId, arenaRatings.entityId)),
    )
    .leftJoin(
      dataCardTags,
      and(eq(arenaRatings.entityType, 'data_card'), eq(dataCardTags.dataCardId, arenaRatings.entityId)),
    )
    .where(buildLeaderboardWhereCondition(input.queue))
    .groupBy(arenaRatings.entityType, arenaRatings.entityId, arenaRatings.queue)
    .orderBy(orderByRating, desc(gamesExpr), desc(updatedExpr), asc(arenaRatings.entityType), asc(arenaRatings.entityId))
    .limit(safeLimit)
    .offset(safeOffset);

  return rows.map((row) => ({
    entityType: row.entityType === 'preset' ? 'preset' : 'data_card',
    entityId: typeof row.entityId === 'string' ? row.entityId : '',
    rating: toInteger(row.rating, 0),
    games: Math.max(0, toInteger(row.games, 0)),
    wins: Math.max(0, toInteger(row.wins, 0)),
    losses: Math.max(0, toInteger(row.losses, 0)),
    draws: Math.max(0, toInteger(row.draws, 0)),
    ratingUpdatedAt: toNullableString(row.ratingUpdatedAt),
    seasonPeakRating: toNullableInteger(row.seasonPeakRating),
    seasonPeakGames: toNullableInteger(row.seasonPeakGames),
    seasonPeakAt: toNullableString(row.seasonPeakAt),
    seasonPeakTier: toNullableString(row.seasonPeakTier),
    seasonLowRating: toNullableInteger(row.seasonLowRating),
    seasonLowGames: toNullableInteger(row.seasonLowGames),
    seasonLowAt: toNullableString(row.seasonLowAt),
    dataCardName: toNullableString(row.dataCardName),
    dataCardDescription: toNullableString(row.dataCardDescription),
    authorName: toNullableString(row.authorName),
    authorId: toNullableInteger(row.authorId),
    usageCount: toNullableInteger(row.usageCount),
    likeCount: toNullableInteger(row.likeCount),
    favoriteCount: toNullableInteger(row.favoriteCount),
    dataCardCreatedAt: toNullableString(row.dataCardCreatedAt),
    dataCardUpdatedAt: toNullableString(row.dataCardUpdatedAt),
    techScore: toNullableInteger(row.techScore),
    techLevel: toNullableString(row.techLevel),
    isNative: toNullableIsNative(row.isNative),
    tagIds: toNullableString(row.tagIds),
  }));
};
