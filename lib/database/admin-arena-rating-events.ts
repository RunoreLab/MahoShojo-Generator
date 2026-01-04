import { queryFromD1 } from './core';
import type { ArenaQueue, ArenaRatingEventStatus } from './arena-ratings';

export type AdminArenaRatingEventsSortBy = 'created_at' | 'applied_at';
export type AdminArenaRatingEventsSortOrder = 'asc' | 'desc';

export interface AdminArenaRatingEventsListFilters {
  page?: number;
  limit?: number;
  sortBy?: AdminArenaRatingEventsSortBy;
  sortOrder?: AdminArenaRatingEventsSortOrder;

  queue?: ArenaQueue;
  status?: ArenaRatingEventStatus;
  userId?: number;
  generationId?: string;
  entityId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

export interface AdminArenaRatingEventRow {
  id: string;
  generation_id: string;
  queue: ArenaQueue;
  status: ArenaRatingEventStatus;
  skip_reason: string | null;
  user_id: number | null;
  username: string | null;
  ip_anonymized: string | null;
  pair_key: string;

  a_entity_type: 'data_card' | 'preset';
  a_entity_id: string;
  b_entity_type: 'data_card' | 'preset';
  b_entity_id: string;
  winner_slot: number;

  a_before_rating: number | null;
  a_after_rating: number | null;
  a_delta: number | null;
  a_before_games: number | null;
  a_after_games: number | null;

  b_before_rating: number | null;
  b_after_rating: number | null;
  b_delta: number | null;
  b_before_games: number | null;
  b_after_games: number | null;

  details_json: unknown;
  created_at: string;
  applied_at: string | null;

  generation_started_at: string | null;
}

const sortableColumns: Record<AdminArenaRatingEventsSortBy, string> = {
  created_at: 'are.created_at',
  applied_at: 'are.applied_at',
};

const readRows = <T>(result: any): T[] => {
  const rows = result?.result?.[0]?.results;
  return Array.isArray(rows) ? (rows as T[]) : [];
};

const parseJson = (value: unknown): unknown => {
  if (typeof value !== 'string') return value ?? null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

function buildWhereClause(filters: AdminArenaRatingEventsListFilters): { whereSql: string; params: (string | number)[] } {
  const whereParts: string[] = [];
  const params: (string | number)[] = [];

  if (filters.queue) {
    whereParts.push('are.queue = ?');
    params.push(filters.queue);
  }

  if (filters.status) {
    whereParts.push('are.status = ?');
    params.push(filters.status);
  }

  if (typeof filters.userId === 'number' && Number.isFinite(filters.userId)) {
    whereParts.push('are.user_id = ?');
    params.push(Math.floor(filters.userId));
  }

  if (filters.generationId) {
    whereParts.push('are.generation_id = ?');
    params.push(filters.generationId);
  }

  if (filters.entityId) {
    whereParts.push('(are.a_entity_id = ? OR are.b_entity_id = ?)');
    params.push(filters.entityId, filters.entityId);
  }

  if (filters.dateFrom) {
    whereParts.push('DATE(are.created_at) >= DATE(?)');
    params.push(filters.dateFrom);
  }

  if (filters.dateTo) {
    whereParts.push('DATE(are.created_at) <= DATE(?)');
    params.push(filters.dateTo);
  }

  if (filters.search) {
    const term = `%${filters.search}%`;
    const numeric = Number(filters.search);
    const orParts: string[] = [
      'are.id LIKE ?',
      'are.generation_id LIKE ?',
      'are.pair_key LIKE ?',
      'are.ip_anonymized LIKE ?',
      'are.skip_reason LIKE ?',
      'are.a_entity_id LIKE ?',
      'are.b_entity_id LIKE ?',
      'u.username LIKE ?',
    ];
    const baseParams: (string | number)[] = [term, term, term, term, term, term, term, term];
    if (Number.isFinite(numeric) && Number.isInteger(numeric)) {
      orParts.push('are.user_id = ?');
      baseParams.push(numeric);
    }
    whereParts.push(`(${orParts.join(' OR ')})`);
    params.push(...baseParams);
  }

  const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
  return { whereSql, params };
}

export async function getAdminArenaRatingEvents(
  filters: AdminArenaRatingEventsListFilters
): Promise<{ records: AdminArenaRatingEventRow[]; total: number }> {
  const page = typeof filters.page === 'number' && Number.isFinite(filters.page) ? Math.max(1, Math.floor(filters.page)) : 1;
  const limit = typeof filters.limit === 'number' && Number.isFinite(filters.limit) ? Math.max(1, Math.min(200, Math.floor(filters.limit))) : 50;
  const offset = (page - 1) * limit;
  const sortBy: AdminArenaRatingEventsSortBy = filters.sortBy ?? 'created_at';
  const sortOrder: AdminArenaRatingEventsSortOrder = filters.sortOrder === 'asc' ? 'asc' : 'desc';
  const sortColumn = sortableColumns[sortBy] || sortableColumns.created_at;
  const orderSql = sortOrder === 'asc' ? 'ASC' : 'DESC';

  const { whereSql, params } = buildWhereClause(filters);

  const dataSql = `
    SELECT
      are.*,
      u.username AS username,
      brg.started_at AS generation_started_at
    FROM arena_rating_events are
    LEFT JOIN users u ON u.id = are.user_id
    LEFT JOIN battle_report_generations brg ON brg.id = are.generation_id
    ${whereSql}
    ORDER BY ${sortColumn} ${orderSql}, are.id ASC
    LIMIT ? OFFSET ?;
  `;

  const countSql = `
    SELECT COUNT(*) AS total
    FROM arena_rating_events are
    LEFT JOIN users u ON u.id = are.user_id
    ${whereSql};
  `;

  const [dataResult, countResult] = await Promise.all([
    queryFromD1(dataSql, [...params, limit, offset]),
    queryFromD1(countSql, params),
  ]);

  const recordsRaw = readRows<any>(dataResult as any);
  const totalRow = readRows<{ total: number }>(countResult as any)[0];
  const total = typeof totalRow?.total === 'number' ? totalRow.total : 0;

  const records: AdminArenaRatingEventRow[] = recordsRaw.map((row) => ({
    ...row,
    details_json: parseJson(row.details_json),
  }));

  return { records, total };
}

