import { queryFromD1 } from '@/lib/database/core';

type Queue = 'strict' | 'free' | 'all';
type ArenaQueue = 'strict' | 'free';

type QueueStatsRow = {
  queue: string;
  count: number;
  minRating: number;
  maxRating: number;
};

type RatingSampleRow = {
  entityType: string;
  entityId: string;
  queue: ArenaQueue;
  rating: number;
  games: number;
  updatedAt: string;
};

type AutoSummaryRow = {
  total: number;
  played: number;
  maxRatingPlayed: number | null;
  top20AvgRatingPlayed: number | null;
  aboveMaxStartPlayed: number;
  inactive30DaysPlayed: number;
};

type SeasonSoftResetRepoBundle = {
  db: unknown;
  listSeasonSoftResetQueueStats: (db: unknown, queue: Queue) => Promise<QueueStatsRow[]>;
  listSeasonSoftResetRatingSamples: (
    db: unknown,
    input: { queue: ArenaQueue; limit: number; order: 'asc' | 'desc' },
  ) => Promise<RatingSampleRow[]>;
  getSeasonSoftResetAutoSummary: (
    db: unknown,
    input: { queue: ArenaQueue; nowIso: string; maxStartRating: number },
  ) => Promise<AutoSummaryRow>;
  countSeasonSoftResetPlayedRows: (db: unknown, queue: ArenaQueue) => Promise<number>;
  getSeasonSoftResetGamesValueAtOffset: (
    db: unknown,
    input: { queue: ArenaQueue; offset: number },
  ) => Promise<number | null>;
  getSeasonSoftResetInactiveDaysValueAtOffset: (
    db: unknown,
    input: { queue: ArenaQueue; nowIso: string; offset: number },
  ) => Promise<number | null>;
  executeSeasonSoftResetQueueUpdate: (
    db: unknown,
    input: {
      queue: ArenaQueue;
      ratingExpr: string;
      ratingParams: unknown[];
      nowIso: string;
      includeLegacyColumns: boolean;
    },
  ) => Promise<number>;
};

const readSeasonSoftResetRepoBundle = async (): Promise<SeasonSoftResetRepoBundle | null> => {
  try {
    const [{ getDrizzleDbFromRuntime }, repo] = await Promise.all([
      import('@/lib/db/drizzle'),
      import('@/lib/db/repositories/season-soft-reset'),
    ]);
    const db = getDrizzleDbFromRuntime();
    if (!db) return null;

    return {
      db,
      listSeasonSoftResetQueueStats:
        repo.listSeasonSoftResetQueueStats as SeasonSoftResetRepoBundle['listSeasonSoftResetQueueStats'],
      listSeasonSoftResetRatingSamples:
        repo.listSeasonSoftResetRatingSamples as SeasonSoftResetRepoBundle['listSeasonSoftResetRatingSamples'],
      getSeasonSoftResetAutoSummary:
        repo.getSeasonSoftResetAutoSummary as SeasonSoftResetRepoBundle['getSeasonSoftResetAutoSummary'],
      countSeasonSoftResetPlayedRows:
        repo.countSeasonSoftResetPlayedRows as SeasonSoftResetRepoBundle['countSeasonSoftResetPlayedRows'],
      getSeasonSoftResetGamesValueAtOffset:
        repo.getSeasonSoftResetGamesValueAtOffset as SeasonSoftResetRepoBundle['getSeasonSoftResetGamesValueAtOffset'],
      getSeasonSoftResetInactiveDaysValueAtOffset:
        repo.getSeasonSoftResetInactiveDaysValueAtOffset as SeasonSoftResetRepoBundle['getSeasonSoftResetInactiveDaysValueAtOffset'],
      executeSeasonSoftResetQueueUpdate:
        repo.executeSeasonSoftResetQueueUpdate as SeasonSoftResetRepoBundle['executeSeasonSoftResetQueueUpdate'],
    };
  } catch {
    return null;
  }
};

const requireSeasonSoftResetRepoBundle = async (): Promise<SeasonSoftResetRepoBundle> => {
  const bundle = await readSeasonSoftResetRepoBundle();
  if (bundle) return bundle;
  return {
    db: null,
    listSeasonSoftResetQueueStats: async (_db, queue) => {
      const where = queue === 'all' ? '' : 'WHERE queue = ?';
      const params: unknown[] = queue === 'all' ? [] : [queue];
      const result = await queryFromD1(
        `SELECT queue, COUNT(*) as count, MIN(rating) as minRating, MAX(rating) as maxRating
         FROM arena_ratings
         ${where}
         GROUP BY queue
         ORDER BY queue ASC;`,
        params,
      );
      const rows = (result as any)?.result?.[0]?.results;
      return Array.isArray(rows) ? (rows as QueueStatsRow[]) : [];
    },
    listSeasonSoftResetRatingSamples: async (_db, input) => {
      const safeLimit = Number.isFinite(input.limit) ? Math.max(0, Math.min(50, Math.floor(input.limit))) : 0;
      if (safeLimit <= 0) return [];
      const orderBy =
        input.order === 'asc'
          ? 'ORDER BY rating ASC, games DESC, updated_at DESC, entity_type ASC, entity_id ASC'
          : 'ORDER BY rating DESC, games DESC, updated_at DESC, entity_type ASC, entity_id ASC';
      const result = await queryFromD1(
        `SELECT entity_type as entityType, entity_id as entityId, queue, rating, games, updated_at as updatedAt
         FROM arena_ratings
         WHERE queue = ?
         ${orderBy}
         LIMIT ?;`,
        [input.queue, safeLimit],
      );
      const rows = (result as any)?.result?.[0]?.results;
      return Array.isArray(rows) ? (rows as RatingSampleRow[]) : [];
    },
    getSeasonSoftResetAutoSummary: async (_db, input) => {
      const result = await queryFromD1(
        `SELECT
          (SELECT COUNT(*) FROM arena_ratings WHERE queue = ?) as total,
          (SELECT COUNT(*) FROM arena_ratings WHERE queue = ? AND games > 0) as played,
          (SELECT MAX(rating) FROM arena_ratings WHERE queue = ? AND games > 0) as maxRatingPlayed,
          (SELECT AVG(rating) FROM (SELECT rating FROM arena_ratings WHERE queue = ? AND games > 0 ORDER BY rating DESC LIMIT 20)) as top20AvgRatingPlayed,
          (SELECT COUNT(*) FROM arena_ratings WHERE queue = ? AND games > 0 AND rating >= ?) as aboveMaxStartPlayed,
          (SELECT COUNT(*) FROM arena_ratings WHERE queue = ? AND games > 0 AND (julianday(?) - julianday(updated_at)) >= 30) as inactive30DaysPlayed`,
        [input.queue, input.queue, input.queue, input.queue, input.queue, input.maxStartRating, input.queue, input.nowIso],
      );
      const row = (result as any)?.result?.[0]?.results?.[0] ?? {};
      return row as AutoSummaryRow;
    },
    countSeasonSoftResetPlayedRows: async (_db, queue) => {
      const result = await queryFromD1(
        `SELECT COUNT(*) as n
         FROM arena_ratings
         WHERE queue = ? AND games > 0;`,
        [queue],
      );
      const row = (result as any)?.result?.[0]?.results?.[0];
      const n = typeof row?.n === 'number' ? row.n : Number(row?.n ?? 0);
      return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    },
    getSeasonSoftResetGamesValueAtOffset: async (_db, input) => {
      const result = await queryFromD1(
        `SELECT games as value
         FROM arena_ratings
         WHERE queue = ? AND games > 0
         ORDER BY games ASC
         LIMIT 1 OFFSET ?;`,
        [input.queue, Math.max(0, Math.floor(input.offset))],
      );
      const row = (result as any)?.result?.[0]?.results?.[0];
      const value = typeof row?.value === 'number' ? row.value : Number(row?.value);
      return Number.isFinite(value) ? Math.floor(value) : null;
    },
    getSeasonSoftResetInactiveDaysValueAtOffset: async (_db, input) => {
      const result = await queryFromD1(
        `SELECT (julianday(?) - julianday(updated_at)) as inactiveDays
         FROM arena_ratings
         WHERE queue = ? AND games > 0
         ORDER BY inactiveDays ASC
         LIMIT 1 OFFSET ?;`,
        [input.nowIso, input.queue, Math.max(0, Math.floor(input.offset))],
      );
      const row = (result as any)?.result?.[0]?.results?.[0];
      const value = typeof row?.inactiveDays === 'number' ? row.inactiveDays : Number(row?.inactiveDays);
      return Number.isFinite(value) ? value : null;
    },
    executeSeasonSoftResetQueueUpdate: async (_db, input) => {
      const legacyClauses = input.includeLegacyColumns
        ? `last_delta = NULL,
          last_applied_at = NULL,`
        : '';
      const hasSeasonColumns = input.queue === 'strict';
      const sql = hasSeasonColumns
        ? `UPDATE arena_ratings
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
           WHERE queue = ?;`
        : `UPDATE arena_ratings
           SET rating = ${input.ratingExpr},
               games = 0,
               wins = 0,
               losses = 0,
               draws = 0,
               ${legacyClauses}
               updated_at = ?
           WHERE queue = ?;`;

      const params = hasSeasonColumns
        ? [
            ...input.ratingParams,
            ...input.ratingParams,
            input.nowIso,
            ...input.ratingParams,
            input.nowIso,
            input.nowIso,
            input.queue,
          ]
        : [...input.ratingParams, input.nowIso, input.queue];

      const result = await queryFromD1(sql, params);
      const changes = (result as any)?.result?.[0]?.meta?.changes;
      return typeof changes === 'number' && Number.isFinite(changes) ? Math.max(0, Math.floor(changes)) : 0;
    },
  };
};

export async function listSeasonSoftResetQueueStats(queue: Queue): Promise<QueueStatsRow[]> {
  const bundle = await requireSeasonSoftResetRepoBundle();
  return bundle.listSeasonSoftResetQueueStats(bundle.db, queue);
}

export async function listSeasonSoftResetRatingSamples(input: {
  queue: ArenaQueue;
  limit: number;
  order: 'asc' | 'desc';
}): Promise<RatingSampleRow[]> {
  const bundle = await requireSeasonSoftResetRepoBundle();
  return bundle.listSeasonSoftResetRatingSamples(bundle.db, input);
}

export async function getSeasonSoftResetAutoSummary(input: {
  queue: ArenaQueue;
  nowIso: string;
  maxStartRating: number;
}): Promise<AutoSummaryRow> {
  const bundle = await requireSeasonSoftResetRepoBundle();
  return bundle.getSeasonSoftResetAutoSummary(bundle.db, input);
}

export async function countSeasonSoftResetPlayedRows(queue: ArenaQueue): Promise<number> {
  const bundle = await requireSeasonSoftResetRepoBundle();
  return bundle.countSeasonSoftResetPlayedRows(bundle.db, queue);
}

export async function getSeasonSoftResetGamesValueAtOffset(input: {
  queue: ArenaQueue;
  offset: number;
}): Promise<number | null> {
  const bundle = await requireSeasonSoftResetRepoBundle();
  return bundle.getSeasonSoftResetGamesValueAtOffset(bundle.db, input);
}

export async function getSeasonSoftResetInactiveDaysValueAtOffset(input: {
  queue: ArenaQueue;
  nowIso: string;
  offset: number;
}): Promise<number | null> {
  const bundle = await requireSeasonSoftResetRepoBundle();
  return bundle.getSeasonSoftResetInactiveDaysValueAtOffset(bundle.db, input);
}

export async function executeSeasonSoftResetQueueUpdate(input: {
  queue: ArenaQueue;
  ratingExpr: string;
  ratingParams: unknown[];
  nowIso: string;
  includeLegacyColumns: boolean;
}): Promise<number> {
  const bundle = await requireSeasonSoftResetRepoBundle();
  return bundle.executeSeasonSoftResetQueueUpdate(bundle.db, input);
}
