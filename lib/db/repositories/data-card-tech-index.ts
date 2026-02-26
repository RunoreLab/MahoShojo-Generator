import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { arenaRatings, dataCardMetrics, dataCards } from '@/lib/db/schema';

export type ScriptDataCardType = 'character' | 'scenario' | 'history' | 'questionnaire';
export type ScriptReviewStatus = 'pending' | 'approved' | 'rejected' | null;
export type ScriptArenaQueue = 'strict' | 'free';

export type NativeBackfillFilter = {
  type?: ScriptDataCardType | null;
  publicOnly?: boolean;
  approvedOnly?: boolean;
  startAfterId?: string;
};

export type NativeBackfillRow = {
  id: string;
  data: string;
  isNative: number | null;
};

export type TechIndexBackfillFilter = {
  type?: ScriptDataCardType | null;
  publicOnly?: boolean;
  approvedOnly?: boolean;
  force?: boolean;
  startAfterId?: string;
};

export type TechIndexBackfillRow = {
  id: string;
  type: ScriptDataCardType;
  isPublic: number;
  reviewStatus: ScriptReviewStatus;
  updatedAt: string;
  data: string;
  metricsUpdatedAt: string | null;
  metricsIsNative: number | null;
};

export type RatedPublicCharacterRow = {
  dataCardId: string;
  rating: number;
  games: number;
  updatedAt: string;
};

export type DataCardPayloadRow = {
  id: string;
  name: string | null;
  type: ScriptDataCardType;
  data: string;
  updatedAt: string | null;
};

const toInt = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
};

const asDataCardType = (value: unknown): ScriptDataCardType => {
  if (value === 'scenario' || value === 'history' || value === 'questionnaire') return value;
  return 'character';
};

const asReviewStatus = (value: unknown): ScriptReviewStatus => {
  if (value === 'approved' || value === 'pending' || value === 'rejected') return value;
  return null;
};

const normalizeIds = (ids: string[]): string[] => {
  return Array.from(
    new Set(
      ids
        .map((id) => (typeof id === 'string' ? id.trim() : ''))
        .filter(Boolean),
    ),
  );
};

const normalizeStartAfterId = (value: string | undefined): string => {
  return typeof value === 'string' ? value.trim() : '';
};

const buildBaseCardConditions = (filter: {
  type?: ScriptDataCardType | null;
  publicOnly?: boolean;
  approvedOnly?: boolean;
  startAfterId?: string;
}): SQL[] => {
  const conditions: SQL[] = [isNull(dataCards.deletedAt)];

  if (filter.type) {
    conditions.push(eq(dataCards.type, filter.type));
  }

  if (filter.publicOnly) {
    conditions.push(eq(dataCards.isPublic, true));
  }

  if (filter.approvedOnly) {
    conditions.push(eq(dataCards.reviewStatus, 'approved'));
  }

  const startAfterId = normalizeStartAfterId(filter.startAfterId);
  if (startAfterId) {
    conditions.push(gt(dataCards.id, startAfterId));
  }

  return conditions;
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

export const countNativeBackfillCandidates = async (db: AppDrizzleDb, filter: NativeBackfillFilter): Promise<number> => {
  const conditions = buildBaseCardConditions(filter);
  conditions.push(or(like(dataCards.data, '%"signature"%'), eq(dataCardMetrics.isNative, true))!);

  const rows = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(dataCards)
    .innerJoin(dataCardMetrics, eq(dataCardMetrics.dataCardId, dataCards.id))
    .where(and(...conditions));

  return Math.max(0, toInt(rows[0]?.total, 0));
};

export const listNativeBackfillCandidateBatch = async (
  db: AppDrizzleDb,
  filter: NativeBackfillFilter,
  limit: number,
): Promise<NativeBackfillRow[]> => {
  const conditions = buildBaseCardConditions(filter);
  conditions.push(or(like(dataCards.data, '%"signature"%'), eq(dataCardMetrics.isNative, true))!);
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));

  const rows = await db
    .select({
      id: dataCards.id,
      data: dataCards.data,
      isNative: sql<number | null>`CAST(${dataCardMetrics.isNative} AS INTEGER)`,
    })
    .from(dataCards)
    .innerJoin(dataCardMetrics, eq(dataCardMetrics.dataCardId, dataCards.id))
    .where(and(...conditions))
    .orderBy(asc(dataCards.id))
    .limit(safeLimit);

  return rows.map((row) => ({
    id: typeof row.id === 'string' ? row.id : '',
    data: typeof row.data === 'string' ? row.data : '',
    isNative: row.isNative == null ? null : toInt(row.isNative, 0),
  }));
};

export const updateNativeFlagsByDataCardIds = async (
  db: AppDrizzleDb,
  rows: Array<{ id: string; isNative: boolean }>,
  nowIso: string,
): Promise<void> => {
  const updates = rows
    .map((row) => ({
      id: typeof row.id === 'string' ? row.id.trim() : '',
      isNative: Boolean(row.isNative),
    }))
    .filter((row) => row.id);
  if (updates.length === 0) return;

  await db.transaction(async (tx) => {
    for (const row of updates) {
      await tx
        .update(dataCardMetrics)
        .set({
          isNative: row.isNative,
          updatedAt: nowIso,
        })
        .where(eq(dataCardMetrics.dataCardId, row.id));
    }
  });
};

export const countTechIndexBackfillCandidates = async (
  db: AppDrizzleDb,
  filter: TechIndexBackfillFilter,
): Promise<number> => {
  const conditions = buildBaseCardConditions(filter);
  if (!filter.force) {
    conditions.push(or(isNull(dataCardMetrics.dataCardId), ne(dataCardMetrics.dataCardUpdatedAt, dataCards.updatedAt))!);
  }

  const rows = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(dataCards)
    .leftJoin(dataCardMetrics, eq(dataCardMetrics.dataCardId, dataCards.id))
    .where(and(...conditions));

  return Math.max(0, toInt(rows[0]?.total, 0));
};

const techIndexBackfillSelect = {
  id: dataCards.id,
  type: dataCards.type,
  isPublic: sql<number>`CAST(${dataCards.isPublic} AS INTEGER)`,
  reviewStatus: dataCards.reviewStatus,
  updatedAt: dataCards.updatedAt,
  data: dataCards.data,
  metricsUpdatedAt: dataCardMetrics.dataCardUpdatedAt,
  metricsIsNative: sql<number | null>`CAST(${dataCardMetrics.isNative} AS INTEGER)`,
};

const mapTechIndexBackfillRow = (row: Record<string, unknown>): TechIndexBackfillRow => ({
  id: typeof row.id === 'string' ? row.id : '',
  type: asDataCardType(row.type),
  isPublic: Math.max(0, toInt(row.isPublic, 0)),
  reviewStatus: asReviewStatus(row.reviewStatus),
  updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : '',
  data: typeof row.data === 'string' ? row.data : '',
  metricsUpdatedAt: typeof row.metricsUpdatedAt === 'string' ? row.metricsUpdatedAt : null,
  metricsIsNative: row.metricsIsNative == null ? null : toInt(row.metricsIsNative, 0),
});

export const listTechIndexBackfillCandidateBatch = async (
  db: AppDrizzleDb,
  filter: TechIndexBackfillFilter,
  limit: number,
): Promise<TechIndexBackfillRow[]> => {
  const conditions = buildBaseCardConditions(filter);
  if (!filter.force) {
    conditions.push(or(isNull(dataCardMetrics.dataCardId), ne(dataCardMetrics.dataCardUpdatedAt, dataCards.updatedAt))!);
  }
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));

  const rows = await db
    .select(techIndexBackfillSelect)
    .from(dataCards)
    .leftJoin(dataCardMetrics, eq(dataCardMetrics.dataCardId, dataCards.id))
    .where(and(...conditions))
    .orderBy(asc(dataCards.id))
    .limit(safeLimit);

  return rows.map((row) => mapTechIndexBackfillRow(row as Record<string, unknown>));
};

export const listTechIndexBackfillCandidatesByIds = async (
  db: AppDrizzleDb,
  filter: Omit<TechIndexBackfillFilter, 'startAfterId'>,
  dataCardIds: string[],
): Promise<TechIndexBackfillRow[]> => {
  const ids = normalizeIds(dataCardIds);
  if (ids.length === 0) return [];

  const conditions = buildBaseCardConditions({ ...filter, startAfterId: '' });
  conditions.push(inArray(dataCards.id, ids));
  if (!filter.force) {
    conditions.push(or(isNull(dataCardMetrics.dataCardId), ne(dataCardMetrics.dataCardUpdatedAt, dataCards.updatedAt))!);
  }

  const rows = await db
    .select(techIndexBackfillSelect)
    .from(dataCards)
    .leftJoin(dataCardMetrics, eq(dataCardMetrics.dataCardId, dataCards.id))
    .where(and(...conditions))
    .orderBy(asc(dataCards.id));

  return rows.map((row) => mapTechIndexBackfillRow(row as Record<string, unknown>));
};

export const listArenaRatedPublicCharacterCards = async (
  db: AppDrizzleDb,
  input: { queue: ScriptArenaQueue; minGames: number; limit?: number | null },
): Promise<RatedPublicCharacterRow[]> => {
  const safeMinGames = Math.max(0, Math.floor(input.minGames));
  const conditions: SQL[] = [
    eq(arenaRatings.queue, input.queue),
    eq(arenaRatings.entityType, 'data_card'),
    isNotNull(dataCards.id),
    eq(dataCards.type, 'character'),
    eq(dataCards.isPublic, true),
    eq(dataCards.reviewStatus, 'approved'),
    isNull(dataCards.deletedAt),
    gte(arenaRatings.games, safeMinGames),
  ];

  if (input.queue === 'strict') {
    conditions.push(buildStrictPublicSinceClause());
  }

  const baseQuery = db
    .select({
      dataCardId: arenaRatings.entityId,
      rating: arenaRatings.rating,
      games: arenaRatings.games,
      updatedAt: arenaRatings.updatedAt,
    })
    .from(arenaRatings)
    .leftJoin(dataCards, and(eq(arenaRatings.entityType, 'data_card'), eq(dataCards.id, arenaRatings.entityId)))
    .where(and(...conditions))
    .orderBy(desc(arenaRatings.rating), desc(arenaRatings.games), desc(arenaRatings.updatedAt), asc(arenaRatings.entityId));

  const safeLimit =
    typeof input.limit === 'number' && Number.isFinite(input.limit)
      ? Math.max(1, Math.min(1000, Math.floor(input.limit)))
      : null;
  const rows = safeLimit ? await baseQuery.limit(safeLimit) : await baseQuery;

  return rows.map((row) => ({
    dataCardId: typeof row.dataCardId === 'string' ? row.dataCardId : '',
    rating: toInt(row.rating, 0),
    games: Math.max(0, toInt(row.games, 0)),
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : '',
  }));
};

export const listDataCardPayloadRowsByIds = async (
  db: AppDrizzleDb,
  dataCardIds: string[],
): Promise<DataCardPayloadRow[]> => {
  const ids = normalizeIds(dataCardIds);
  if (ids.length === 0) return [];

  const rows = await db
    .select({
      id: dataCards.id,
      name: dataCards.name,
      type: dataCards.type,
      data: dataCards.data,
      updatedAt: dataCards.updatedAt,
    })
    .from(dataCards)
    .where(and(inArray(dataCards.id, ids), isNull(dataCards.deletedAt)))
    .orderBy(asc(dataCards.id));

  return rows.map((row) => ({
    id: typeof row.id === 'string' ? row.id : '',
    name: typeof row.name === 'string' ? row.name : null,
    type: asDataCardType(row.type),
    data: typeof row.data === 'string' ? row.data : '',
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null,
  }));
};

export const getDataCardPayloadRowById = async (
  db: AppDrizzleDb,
  dataCardId: string,
): Promise<DataCardPayloadRow | null> => {
  const rows = await listDataCardPayloadRowsByIds(db, [dataCardId]);
  return rows[0] ?? null;
};

