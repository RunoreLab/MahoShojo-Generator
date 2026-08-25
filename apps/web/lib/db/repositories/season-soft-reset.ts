import type { AppDrizzleDb } from '@/lib/db/drizzle';

export type SeasonSoftResetQueue = 'strict' | 'free' | 'all';
export type SeasonSoftResetArenaQueue = 'strict' | 'free';

export type SeasonSoftResetQueueStatsRow = {
  queue: string;
  count: number;
  minRating: number;
  maxRating: number;
};

export type SeasonSoftResetRatingSampleRow = {
  entityType: string;
  entityId: string;
  queue: SeasonSoftResetArenaQueue;
  rating: number;
  games: number;
  updatedAt: string;
};

export type SeasonSoftResetAutoSummaryRow = {
  total: number;
  played: number;
  maxRatingPlayed: number | null;
  top20AvgRatingPlayed: number | null;
  aboveMaxStartPlayed: number;
  inactive30DaysPlayed: number;
};

type D1PreparedStatementLike = {
  bind: (...params: unknown[]) => D1PreparedStatementLike;
  all: () => Promise<unknown>;
  run: () => Promise<unknown>;
};

type D1ClientLike = {
  prepare: (sql: string) => D1PreparedStatementLike;
};

type D1LikeStatementResult = {
  success?: boolean;
  results?: unknown;
  meta?: unknown;
  error?: unknown;
};

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const toInteger = (value: unknown, fallback = 0): number => {
  const num = toFiniteNumber(value);
  if (num == null) return fallback;
  return Math.trunc(num);
};

const toNullableInteger = (value: unknown): number | null => {
  const num = toFiniteNumber(value);
  if (num == null) return null;
  return Math.trunc(num);
};

const toStringOrEmpty = (value: unknown): string => (typeof value === 'string' ? value : '');

const getD1Client = (db: AppDrizzleDb): D1ClientLike => {
  const client = (db as unknown as { $client?: unknown }).$client;
  const prepare = asObject(client)?.prepare;
  if (typeof prepare !== 'function') {
    throw new Error('Drizzle D1 client 不可用：未检测到 prepare 方法');
  }
  return client as D1ClientLike;
};

const parseStatementResult = (value: unknown): {
  rows: Record<string, unknown>[];
  meta: Record<string, unknown>;
  success: boolean;
  error: string | null;
} => {
  const result = (asObject(value) ?? {}) as D1LikeStatementResult;
  const rows = asArray(result.results)
    .map((row) => asObject(row))
    .filter((row): row is Record<string, unknown> => Boolean(row));
  const meta = asObject(result.meta) ?? {};
  const success = result.success !== false;
  const error = typeof result.error === 'string' ? result.error : null;
  return { rows, meta, success, error };
};

const executeAll = async (
  db: AppDrizzleDb,
  sqlText: string,
  params: unknown[] = [],
): Promise<Record<string, unknown>[]> => {
  const client = getD1Client(db);
  const statement = client.prepare(sqlText).bind(...params);
  const raw = await statement.all();
  const parsed = parseStatementResult(raw);
  if (!parsed.success) {
    throw new Error(parsed.error || 'D1 查询失败');
  }
  return parsed.rows;
};

const executeRun = async (
  db: AppDrizzleDb,
  sqlText: string,
  params: unknown[] = [],
): Promise<number> => {
  const client = getD1Client(db);
  const statement = client.prepare(sqlText).bind(...params);
  const raw = await statement.run();
  const parsed = parseStatementResult(raw);
  if (!parsed.success) {
    throw new Error(parsed.error || 'D1 执行失败');
  }
  const changes = toFiniteNumber(parsed.meta.changes);
  return changes == null ? 0 : Math.max(0, Math.floor(changes));
};

export const listSeasonSoftResetQueueStats = async (
  db: AppDrizzleDb,
  queue: SeasonSoftResetQueue,
): Promise<SeasonSoftResetQueueStatsRow[]> => {
  const where = queue === 'all' ? '' : 'WHERE queue = ?';
  const params: unknown[] = queue === 'all' ? [] : [queue];
  const sqlText = `SELECT queue, COUNT(*) as count, MIN(rating) as minRating, MAX(rating) as maxRating
    FROM arena_ratings
    ${where}
    GROUP BY queue
    ORDER BY queue ASC;`;
  const rows = await executeAll(db, sqlText, params);
  return rows.map((row) => ({
    queue: toStringOrEmpty(row.queue),
    count: Math.max(0, toInteger(row.count, 0)),
    minRating: toInteger(row.minRating, 0),
    maxRating: toInteger(row.maxRating, 0),
  }));
};

export const listSeasonSoftResetRatingSamples = async (
  db: AppDrizzleDb,
  input: {
    queue: SeasonSoftResetArenaQueue;
    limit: number;
    order: 'asc' | 'desc';
  },
): Promise<SeasonSoftResetRatingSampleRow[]> => {
  const safeLimit = Number.isFinite(input.limit) ? Math.max(0, Math.min(50, Math.floor(input.limit))) : 0;
  if (safeLimit <= 0) return [];

  const orderBy = input.order === 'asc'
    ? 'ORDER BY rating ASC, games DESC, updated_at DESC, entity_type ASC, entity_id ASC'
    : 'ORDER BY rating DESC, games DESC, updated_at DESC, entity_type ASC, entity_id ASC';

  const sqlText = `SELECT entity_type as entityType, entity_id as entityId, queue, rating, games, updated_at as updatedAt
    FROM arena_ratings
    WHERE queue = ?
    ${orderBy}
    LIMIT ?;`;

  const rows = await executeAll(db, sqlText, [input.queue, safeLimit]);
  return rows.map((row) => ({
    entityType: toStringOrEmpty(row.entityType),
    entityId: toStringOrEmpty(row.entityId),
    queue: row.queue === 'free' ? 'free' : 'strict',
    rating: toInteger(row.rating, 0),
    games: Math.max(0, toInteger(row.games, 0)),
    updatedAt: toStringOrEmpty(row.updatedAt),
  }));
};

export const getSeasonSoftResetAutoSummary = async (
  db: AppDrizzleDb,
  input: {
    queue: SeasonSoftResetArenaQueue;
    nowIso: string;
    maxStartRating: number;
  },
): Promise<SeasonSoftResetAutoSummaryRow> => {
  const rows = await executeAll(
    db,
    `SELECT
      (SELECT COUNT(*) FROM arena_ratings WHERE queue = ?) as total,
      (SELECT COUNT(*) FROM arena_ratings WHERE queue = ? AND games > 0) as played,
      (SELECT MAX(rating) FROM arena_ratings WHERE queue = ? AND games > 0) as maxRatingPlayed,
      (SELECT AVG(rating) FROM (SELECT rating FROM arena_ratings WHERE queue = ? AND games > 0 ORDER BY rating DESC LIMIT 20)) as top20AvgRatingPlayed,
      (SELECT COUNT(*) FROM arena_ratings WHERE queue = ? AND games > 0 AND rating >= ?) as aboveMaxStartPlayed,
      (SELECT COUNT(*) FROM arena_ratings WHERE queue = ? AND games > 0 AND (julianday(?) - julianday(updated_at)) >= 30) as inactive30DaysPlayed`,
    [input.queue, input.queue, input.queue, input.queue, input.queue, input.maxStartRating, input.queue, input.nowIso],
  );

  const row = rows[0] ?? {};
  return {
    total: Math.max(0, toInteger(row.total, 0)),
    played: Math.max(0, toInteger(row.played, 0)),
    maxRatingPlayed: toNullableInteger(row.maxRatingPlayed),
    top20AvgRatingPlayed: toFiniteNumber(row.top20AvgRatingPlayed),
    aboveMaxStartPlayed: Math.max(0, toInteger(row.aboveMaxStartPlayed, 0)),
    inactive30DaysPlayed: Math.max(0, toInteger(row.inactive30DaysPlayed, 0)),
  };
};

export const countSeasonSoftResetPlayedRows = async (
  db: AppDrizzleDb,
  queue: SeasonSoftResetArenaQueue,
): Promise<number> => {
  const rows = await executeAll(
    db,
    `SELECT COUNT(*) as n
     FROM arena_ratings
     WHERE queue = ? AND games > 0;`,
    [queue],
  );
  return Math.max(0, toInteger(rows[0]?.n, 0));
};

export const getSeasonSoftResetGamesValueAtOffset = async (
  db: AppDrizzleDb,
  input: { queue: SeasonSoftResetArenaQueue; offset: number },
): Promise<number | null> => {
  const rows = await executeAll(
    db,
    `SELECT games as value
     FROM arena_ratings
     WHERE queue = ? AND games > 0
     ORDER BY games ASC
     LIMIT 1 OFFSET ?;`,
    [input.queue, Math.max(0, Math.floor(input.offset))],
  );
  return toNullableInteger(rows[0]?.value);
};

export const getSeasonSoftResetInactiveDaysValueAtOffset = async (
  db: AppDrizzleDb,
  input: { queue: SeasonSoftResetArenaQueue; nowIso: string; offset: number },
): Promise<number | null> => {
  const rows = await executeAll(
    db,
    `SELECT (julianday(?) - julianday(updated_at)) as inactiveDays
     FROM arena_ratings
     WHERE queue = ? AND games > 0
     ORDER BY inactiveDays ASC
     LIMIT 1 OFFSET ?;`,
    [input.nowIso, input.queue, Math.max(0, Math.floor(input.offset))],
  );
  return toFiniteNumber(rows[0]?.inactiveDays);
};

export const buildSeasonSoftResetUpdateSql = (
  input: {
    queue: SeasonSoftResetArenaQueue;
    ratingExpr: string;
    ratingParams: unknown[];
    nowIso: string;
    includeLegacyColumns: boolean;
  },
): { sql: string; params: unknown[] } => {
  const legacyClauses = input.includeLegacyColumns
    ? `last_delta = NULL,
          last_applied_at = NULL,`
    : '';

  if (input.queue === 'strict') {
    return {
      sql: `UPDATE arena_ratings
      SET rating = ${input.ratingExpr},
          games = 0,
          wins = 0,
          losses = 0,
          draws = 0,
          ${legacyClauses}
          season_peak_rating = ${input.ratingExpr},
          season_peak_games = 0,
          season_peak_at = ?,
          season_peak_tier = '无牌',
          season_low_rating = ${input.ratingExpr},
          season_low_games = 0,
          season_low_at = ?,
          updated_at = ?
      WHERE queue = ?;`,
      params: [
        ...input.ratingParams,
        ...input.ratingParams,
        input.nowIso,
        ...input.ratingParams,
        input.nowIso,
        input.nowIso,
        input.queue,
      ],
    };
  }

  return {
    sql: `UPDATE arena_ratings
      SET rating = ${input.ratingExpr},
          games = 0,
          wins = 0,
          losses = 0,
          draws = 0,
          ${legacyClauses}
          updated_at = ?
      WHERE queue = ?;`,
    params: [...input.ratingParams, input.nowIso, input.queue],
  };
};

export const executeSeasonSoftResetQueueUpdate = async (
  db: AppDrizzleDb,
  input: {
    queue: SeasonSoftResetArenaQueue;
    ratingExpr: string;
    ratingParams: unknown[];
    nowIso: string;
    includeLegacyColumns: boolean;
  },
): Promise<number> => {
  const update = buildSeasonSoftResetUpdateSql(input);
  return executeRun(db, update.sql, update.params);
};
