import { queryFromD1 } from './core';

export type AdminArenaRatingsSortBy = 'rating' | 'games' | 'updated_at';
export type AdminArenaRatingsSortOrder = 'asc' | 'desc';

export interface AdminArenaRatingsListFilters {
  page?: number;
  limit?: number;
  sortBy?: AdminArenaRatingsSortBy;
  sortOrder?: AdminArenaRatingsSortOrder;

  queue?: 'strict' | 'free';
  entityType?: 'data_card' | 'preset';

  search?: string;
  ownerUserId?: number;

  minRating?: number;
  maxRating?: number;
  minGames?: number;
  maxGames?: number;

  isPublic?: -1 | 0 | 1;
  reviewStatus?: 'pending' | 'approved' | 'rejected';
}

export interface AdminArenaRatingRow {
  entity_type: 'data_card' | 'preset';
  entity_id: string;
  queue: 'strict' | 'free';
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  created_at: string;
  updated_at: string;

  data_card_name: string | null;
  data_card_user_id: number | null;
  data_card_is_public: number | null;
  data_card_review_status: string | null;
  data_card_deleted_at: string | null;
  owner_username: string | null;

  tech_score: number | null;
  tech_level: string | null;
  is_native: number | null;
  tag_ids: string | null;
}

const sortableColumns: Record<AdminArenaRatingsSortBy, string> = {
  rating: 'ar.rating',
  games: 'ar.games',
  updated_at: 'ar.updated_at',
};

const readRows = <T>(result: any): T[] => {
  const rows = result?.result?.[0]?.results;
  return Array.isArray(rows) ? (rows as T[]) : [];
};

function buildWhereClause(filters: AdminArenaRatingsListFilters): { whereSql: string; params: (string | number)[] } {
  const whereParts: string[] = [];
  const params: (string | number)[] = [];

  if (filters.queue) {
    whereParts.push('ar.queue = ?');
    params.push(filters.queue);
  }

  if (filters.entityType) {
    whereParts.push('ar.entity_type = ?');
    params.push(filters.entityType);
  }

  if (typeof filters.ownerUserId === 'number' && Number.isFinite(filters.ownerUserId)) {
    whereParts.push("ar.entity_type = 'data_card' AND dc.user_id = ?");
    params.push(Math.floor(filters.ownerUserId));
  }

  if (typeof filters.minRating === 'number' && Number.isFinite(filters.minRating)) {
    whereParts.push('ar.rating >= ?');
    params.push(Math.floor(filters.minRating));
  }

  if (typeof filters.maxRating === 'number' && Number.isFinite(filters.maxRating)) {
    whereParts.push('ar.rating <= ?');
    params.push(Math.floor(filters.maxRating));
  }

  if (typeof filters.minGames === 'number' && Number.isFinite(filters.minGames)) {
    whereParts.push('ar.games >= ?');
    params.push(Math.floor(filters.minGames));
  }

  if (typeof filters.maxGames === 'number' && Number.isFinite(filters.maxGames)) {
    whereParts.push('ar.games <= ?');
    params.push(Math.floor(filters.maxGames));
  }

  if (typeof filters.isPublic === 'number' && Number.isFinite(filters.isPublic)) {
    whereParts.push("ar.entity_type = 'data_card' AND dc.is_public = ?");
    params.push(Math.floor(filters.isPublic));
  }

  if (filters.reviewStatus) {
    whereParts.push("ar.entity_type = 'data_card' AND dc.review_status = ?");
    params.push(filters.reviewStatus);
  }

  if (filters.search) {
    const term = `%${filters.search}%`;
    whereParts.push(`(
      ar.entity_id LIKE ?
      OR dc.id LIKE ?
      OR dc.name LIKE ?
      OR u.username LIKE ?
    )`);
    params.push(term, term, term, term);
  }

  const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
  return { whereSql, params };
}

export async function getAdminArenaRatings(
  filters: AdminArenaRatingsListFilters
): Promise<{ records: AdminArenaRatingRow[]; total: number }> {
  const page = typeof filters.page === 'number' && Number.isFinite(filters.page) ? Math.max(1, Math.floor(filters.page)) : 1;
  const limit = typeof filters.limit === 'number' && Number.isFinite(filters.limit) ? Math.max(1, Math.min(200, Math.floor(filters.limit))) : 50;
  const offset = (page - 1) * limit;
  const sortBy: AdminArenaRatingsSortBy = filters.sortBy ?? 'rating';
  const sortOrder: AdminArenaRatingsSortOrder = filters.sortOrder === 'asc' ? 'asc' : 'desc';

  const sortColumn = sortableColumns[sortBy] || sortableColumns.rating;
  const orderSql = sortOrder === 'asc' ? 'ASC' : 'DESC';

  const { whereSql, params } = buildWhereClause(filters);

  const dataSql = `
    SELECT
      ar.entity_type,
      ar.entity_id,
      ar.queue,
      ar.rating,
      ar.games,
      ar.wins,
      ar.losses,
      ar.draws,
      ar.created_at,
      ar.updated_at,

      dc.name AS data_card_name,
      dc.user_id AS data_card_user_id,
      dc.is_public AS data_card_is_public,
      dc.review_status AS data_card_review_status,
      dc.deleted_at AS data_card_deleted_at,
      u.username AS owner_username,

      dcm.tech_score AS tech_score,
      dcm.tech_level AS tech_level,
      dcm.is_native AS is_native,
      group_concat(DISTINCT dct.tag_id) AS tag_ids
    FROM arena_ratings ar
    LEFT JOIN data_cards dc
      ON ar.entity_type = 'data_card' AND dc.id = ar.entity_id
    LEFT JOIN users u
      ON dc.user_id = u.id
    LEFT JOIN data_card_metrics dcm
      ON ar.entity_type = 'data_card' AND dcm.data_card_id = ar.entity_id
    LEFT JOIN data_card_tags dct
      ON ar.entity_type = 'data_card' AND dct.data_card_id = ar.entity_id
    ${whereSql}
    GROUP BY ar.entity_type, ar.entity_id, ar.queue
    ORDER BY ${sortColumn} ${orderSql}, ar.entity_type ASC, ar.entity_id ASC, ar.queue ASC
    LIMIT ? OFFSET ?;
  `;

  const countSql = `
    SELECT COUNT(*) AS total
    FROM arena_ratings ar
    LEFT JOIN data_cards dc
      ON ar.entity_type = 'data_card' AND dc.id = ar.entity_id
    LEFT JOIN users u
      ON dc.user_id = u.id
    ${whereSql};
  `;

  const [dataResult, countResult] = await Promise.all([
    queryFromD1(dataSql, [...params, limit, offset]),
    queryFromD1(countSql, params),
  ]);

  const records = readRows<AdminArenaRatingRow>(dataResult as any);
  const totalRow = readRows<{ total: number }>(countResult as any)[0];
  const total = typeof totalRow?.total === 'number' ? totalRow.total : 0;

  return { records, total };
}

