import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  ARENA_PLACEMENT_GAMES,
  ARENA_QUEEN_MIN_SCEPTER_COUNT,
  ARENA_SCEPTER_MIN_RATING,
  type ArenaEntityRef,
  type ArenaQueue,
} from '@/lib/arena/tier';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { arenaRatings, dataCardMetrics, dataCards } from '@/lib/db/schema';

export type DataCardMetaCardRow = {
  id: string;
  userId: number;
  type: 'character' | 'scenario' | 'history' | 'questionnaire';
  isPublic: boolean;
  reviewStatus: 'pending' | 'approved' | 'rejected' | null;
  updatedAt: string | null;
  data: string;
};

export type DataCardMetricsRow = {
  dataCardId: string;
  techScore: number;
  techLevel: string;
  isNative: boolean | null;
  dataCardUpdatedAt: string;
};

export type DataCardArenaRatingRow = {
  dataCardId: string;
  queue: 'strict' | 'free';
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  updatedAt: string;
  lastDelta: number | null;
  lastAppliedAt: string | null;
};

const QUEEN_CACHE_TTL_MS = 30_000;
const queenCache = new Map<ArenaQueue, { value: ArenaEntityRef | null; expiresAt: number }>();

const asDataCardType = (value: unknown): DataCardMetaCardRow['type'] => {
  if (value === 'scenario' || value === 'history' || value === 'questionnaire') return value;
  return 'character';
};

const asDataCardReviewStatus = (value: unknown): DataCardMetaCardRow['reviewStatus'] => {
  if (value === 'approved' || value === 'rejected') return value;
  if (value === 'pending') return value;
  return null;
};

const mapMetaCardRow = (row: {
  id: string;
  userId: number;
  type: unknown;
  isPublic: boolean;
  reviewStatus: unknown;
  updatedAt: string | null;
  data: string;
}): DataCardMetaCardRow => ({
  id: row.id,
  userId: row.userId,
  type: asDataCardType(row.type),
  isPublic: Boolean(row.isPublic),
  reviewStatus: asDataCardReviewStatus(row.reviewStatus),
  updatedAt: row.updatedAt,
  data: row.data,
});

export const getDataCardMetaCardById = async (
  db: AppDrizzleDb,
  dataCardId: string,
): Promise<DataCardMetaCardRow | null> => {
  const rows = await db
    .select({
      id: dataCards.id,
      userId: dataCards.userId,
      type: dataCards.type,
      isPublic: dataCards.isPublic,
      reviewStatus: dataCards.reviewStatus,
      updatedAt: dataCards.updatedAt,
      data: dataCards.data,
    })
    .from(dataCards)
    .where(and(eq(dataCards.id, dataCardId), isNull(dataCards.deletedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return mapMetaCardRow(row);
};

export const getDataCardMetaCardsByIds = async (
  db: AppDrizzleDb,
  dataCardIds: string[],
): Promise<DataCardMetaCardRow[]> => {
  if (dataCardIds.length === 0) return [];

  const rows = await db
    .select({
      id: dataCards.id,
      userId: dataCards.userId,
      type: dataCards.type,
      isPublic: dataCards.isPublic,
      reviewStatus: dataCards.reviewStatus,
      updatedAt: dataCards.updatedAt,
      data: dataCards.data,
    })
    .from(dataCards)
    .where(and(inArray(dataCards.id, dataCardIds), isNull(dataCards.deletedAt)));

  return rows.map(mapMetaCardRow);
};

export const getDataCardMetricsByDataCardId = async (
  db: AppDrizzleDb,
  dataCardId: string,
): Promise<DataCardMetricsRow | null> => {
  const rows = await db
    .select({
      dataCardId: dataCardMetrics.dataCardId,
      techScore: dataCardMetrics.techScore,
      techLevel: dataCardMetrics.techLevel,
      isNative: dataCardMetrics.isNative,
      dataCardUpdatedAt: dataCardMetrics.dataCardUpdatedAt,
    })
    .from(dataCardMetrics)
    .where(eq(dataCardMetrics.dataCardId, dataCardId))
    .limit(1);

  return rows[0] ?? null;
};

export const getDataCardMetricsByDataCardIds = async (
  db: AppDrizzleDb,
  dataCardIds: string[],
): Promise<Map<string, DataCardMetricsRow>> => {
  const map = new Map<string, DataCardMetricsRow>();
  if (dataCardIds.length === 0) return map;

  const rows = await db
    .select({
      dataCardId: dataCardMetrics.dataCardId,
      techScore: dataCardMetrics.techScore,
      techLevel: dataCardMetrics.techLevel,
      isNative: dataCardMetrics.isNative,
      dataCardUpdatedAt: dataCardMetrics.dataCardUpdatedAt,
    })
    .from(dataCardMetrics)
    .where(inArray(dataCardMetrics.dataCardId, dataCardIds));

  rows.forEach((row) => {
    if (!row?.dataCardId) return;
    map.set(row.dataCardId, row);
  });
  return map;
};

export const getArenaRatingsByDataCardId = async (
  db: AppDrizzleDb,
  dataCardId: string,
  queues: Array<'strict' | 'free'> = ['strict', 'free'],
): Promise<DataCardArenaRatingRow[]> => {
  if (queues.length === 0) return [];

  return db
    .select({
      dataCardId: arenaRatings.entityId,
      queue: arenaRatings.queue,
      rating: arenaRatings.rating,
      games: arenaRatings.games,
      wins: arenaRatings.wins,
      losses: arenaRatings.losses,
      draws: arenaRatings.draws,
      updatedAt: arenaRatings.updatedAt,
      lastDelta: arenaRatings.lastDelta,
      lastAppliedAt: arenaRatings.lastAppliedAt,
    })
    .from(arenaRatings)
    .where(
      and(
        eq(arenaRatings.entityType, 'data_card'),
        eq(arenaRatings.entityId, dataCardId),
        inArray(arenaRatings.queue, queues),
      ),
    );
};

export const getStrictArenaRatingsByDataCardIds = async (
  db: AppDrizzleDb,
  dataCardIds: string[],
): Promise<Array<Pick<DataCardArenaRatingRow, 'dataCardId' | 'queue' | 'rating' | 'games' | 'updatedAt'>>> => {
  if (dataCardIds.length === 0) return [];

  return db
    .select({
      dataCardId: arenaRatings.entityId,
      queue: arenaRatings.queue,
      rating: arenaRatings.rating,
      games: arenaRatings.games,
      updatedAt: arenaRatings.updatedAt,
    })
    .from(arenaRatings)
    .where(
      and(
        eq(arenaRatings.entityType, 'data_card'),
        eq(arenaRatings.queue, 'strict'),
        inArray(arenaRatings.entityId, dataCardIds),
      ),
    );
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

export const queryArenaPublicQueenEntityByQueue = async (
  db: AppDrizzleDb,
  queue: ArenaQueue,
): Promise<ArenaEntityRef | null> => {
  const now = Date.now();
  const cached = queenCache.get(queue);
  if (cached && cached.expiresAt > now) return cached.value;

  const dataCardConditions: SQL[] = [
    isNotNull(dataCards.id),
    eq(dataCards.type, 'character'),
    eq(dataCards.isPublic, true),
    eq(dataCards.reviewStatus, 'approved'),
    isNull(dataCards.deletedAt),
  ];

  if (queue === 'strict') {
    dataCardConditions.push(buildStrictPublicSinceClause());
  }

  const dataCardEligible = and(...dataCardConditions);
  if (!dataCardEligible) {
    queenCache.set(queue, { value: null, expiresAt: now + QUEEN_CACHE_TTL_MS });
    return null;
  }

  const rows = await db
    .select({
      entityType: arenaRatings.entityType,
      entityId: arenaRatings.entityId,
    })
    .from(arenaRatings)
    .leftJoin(dataCards, and(eq(arenaRatings.entityType, 'data_card'), eq(dataCards.id, arenaRatings.entityId)))
    .where(
      and(
        eq(arenaRatings.queue, queue),
        or(eq(arenaRatings.entityType, 'preset'), dataCardEligible),
        gte(arenaRatings.games, ARENA_PLACEMENT_GAMES),
        gte(arenaRatings.rating, ARENA_SCEPTER_MIN_RATING),
      ),
    )
    .orderBy(
      desc(arenaRatings.rating),
      desc(arenaRatings.games),
      desc(arenaRatings.updatedAt),
      asc(arenaRatings.entityType),
      asc(arenaRatings.entityId),
    )
    .limit(ARENA_QUEEN_MIN_SCEPTER_COUNT);

  if (rows.length < ARENA_QUEEN_MIN_SCEPTER_COUNT) {
    queenCache.set(queue, { value: null, expiresAt: now + QUEEN_CACHE_TTL_MS });
    return null;
  }

  const first = rows[0];
  if (!first) {
    queenCache.set(queue, { value: null, expiresAt: now + QUEEN_CACHE_TTL_MS });
    return null;
  }

  const entityType =
    first.entityType === 'data_card' || first.entityType === 'preset' ? first.entityType : null;
  const entityId = typeof first.entityId === 'string' ? first.entityId.trim() : '';
  if (!entityType || !entityId) {
    queenCache.set(queue, { value: null, expiresAt: now + QUEEN_CACHE_TTL_MS });
    return null;
  }

  const value: ArenaEntityRef = {
    entityType,
    entityId,
  };
  queenCache.set(queue, { value, expiresAt: now + QUEEN_CACHE_TTL_MS });
  return value;
};
