import { queryFromD1 } from './core';
import type { LargeObjectAssetFamily } from '@/lib/admin/large-object-insights';

export type AdminLargeObjectRow = {
  id: string;
  kind: string;
  owner_ref_id: string;
  owner_user_id: number | null;
  owner_username: string | null;
  r2_key: string;
  bytes: number;
  stored_bytes: number | null;
  sha256: string | null;
  content_type: string | null;
  content_encoding: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminLargeObjectKindSummary = {
  kind: string;
  total: number;
  bytes: number;
  storedBytes: number;
  lastCreatedAt: string | null;
};

export type AdminLargeObjectFamilySummary = {
  family: LargeObjectAssetFamily;
  total: number;
  bytes: number;
  storedBytes: number;
};

export interface AdminLargeObjectListFilters {
  page?: number;
  limit?: number;
  kind?: string;
  search?: string;
  ownerUserId?: number;
  dateFrom?: string;
  dateTo?: string;
  minBytes?: number;
  maxBytes?: number;
  family?: LargeObjectAssetFamily;
}

const readRows = <T>(result: unknown): T[] => {
  const rows = (result as { result?: Array<{ results?: T[] }> })?.result?.[0]?.results;
  return Array.isArray(rows) ? rows : [];
};

const readInt = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return 0;
};

const readNullableInt = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return null;
};

const readNullableString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const mapLargeObjectRow = (row: Record<string, unknown>): AdminLargeObjectRow => ({
  id: typeof row.id === 'string' ? row.id : '',
  kind: typeof row.kind === 'string' ? row.kind : '',
  owner_ref_id: typeof row.owner_ref_id === 'string' ? row.owner_ref_id : '',
  owner_user_id: readNullableInt(row.owner_user_id),
  owner_username: readNullableString(row.owner_username),
  r2_key: typeof row.r2_key === 'string' ? row.r2_key : '',
  bytes: readInt(row.bytes),
  stored_bytes: readNullableInt(row.stored_bytes),
  sha256: readNullableString(row.sha256),
  content_type: readNullableString(row.content_type),
  content_encoding: readNullableString(row.content_encoding),
  created_at: typeof row.created_at === 'string' ? row.created_at : '',
  updated_at: typeof row.updated_at === 'string' ? row.updated_at : '',
});

const buildFamilyWhereClause = (family: LargeObjectAssetFamily): string => {
  if (family === 'image') {
    return `(
      lo.content_type LIKE 'image/%'
      OR lower(lo.kind) IN ('portrait', 'illustration')
      OR lower(lo.kind) LIKE '%_image'
      OR lower(lo.kind) LIKE '%_illustration'
      OR lower(lo.kind) LIKE '%_portrait'
    )`;
  }
  if (family === 'text') {
    return `(
      lo.kind = 'battle_report_generation_output'
      OR lo.content_type LIKE 'text/%'
      OR lo.content_type LIKE '%json%'
      OR lo.content_type LIKE '%markdown%'
      OR lo.content_type LIKE '%xml%'
    )`;
  }
  return `NOT ${buildFamilyWhereClause('image')} AND NOT ${buildFamilyWhereClause('text')}`;
};

function buildWhereClause(filters: AdminLargeObjectListFilters): {
  whereSql: string;
  params: Array<string | number>;
} {
  const whereParts: string[] = [];
  const params: Array<string | number> = [];

  if (filters.kind) {
    whereParts.push('lo.kind = ?');
    params.push(filters.kind);
  }

  if (typeof filters.ownerUserId === 'number' && Number.isFinite(filters.ownerUserId)) {
    whereParts.push('lo.owner_user_id = ?');
    params.push(Math.floor(filters.ownerUserId));
  }

  if (typeof filters.minBytes === 'number' && Number.isFinite(filters.minBytes)) {
    whereParts.push('lo.bytes >= ?');
    params.push(Math.max(0, Math.floor(filters.minBytes)));
  }

  if (typeof filters.maxBytes === 'number' && Number.isFinite(filters.maxBytes)) {
    whereParts.push('lo.bytes <= ?');
    params.push(Math.max(0, Math.floor(filters.maxBytes)));
  }

  if (filters.dateFrom) {
    whereParts.push('DATE(lo.created_at) >= DATE(?)');
    params.push(filters.dateFrom);
  }

  if (filters.dateTo) {
    whereParts.push('DATE(lo.created_at) <= DATE(?)');
    params.push(filters.dateTo);
  }

  if (filters.search) {
    whereParts.push(`(
      lo.id LIKE ?
      OR lo.kind LIKE ?
      OR lo.owner_ref_id LIKE ?
      OR lo.r2_key LIKE ?
      OR u.username LIKE ?
    )`);
    const term = `%${filters.search}%`;
    params.push(term, term, term, term, term);
  }

  if (filters.family) {
    whereParts.push(buildFamilyWhereClause(filters.family));
  }

  return {
    whereSql: whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '',
    params,
  };
}

export async function listAdminLargeObjects(
  filters: AdminLargeObjectListFilters,
): Promise<{
  rows: AdminLargeObjectRow[];
  total: number;
  kindSummaries: AdminLargeObjectKindSummary[];
  familySummaries: AdminLargeObjectFamilySummary[];
}> {
  const page = typeof filters.page === 'number' && Number.isFinite(filters.page) ? Math.max(1, Math.floor(filters.page)) : 1;
  const limit = typeof filters.limit === 'number' && Number.isFinite(filters.limit) ? Math.max(1, Math.min(200, Math.floor(filters.limit))) : 50;
  const offset = (page - 1) * limit;
  const { whereSql, params } = buildWhereClause(filters);

  const fromSql = `
    FROM large_objects lo
    LEFT JOIN users u ON u.id = lo.owner_user_id
    ${whereSql}
  `;

  const dataSql = `
    SELECT
      lo.*,
      u.username AS owner_username
    ${fromSql}
    ORDER BY datetime(lo.created_at) DESC, lo.id DESC
    LIMIT ? OFFSET ?;
  `;

  const countSql = `
    SELECT COUNT(*) AS total
    ${fromSql};
  `;

  const kindSummarySql = `
    SELECT
      lo.kind,
      COUNT(*) AS total,
      COALESCE(SUM(lo.bytes), 0) AS bytes,
      COALESCE(SUM(COALESCE(lo.stored_bytes, lo.bytes)), 0) AS stored_bytes,
      MAX(lo.created_at) AS last_created_at
    ${fromSql}
    GROUP BY lo.kind
    ORDER BY total DESC, lo.kind ASC
    LIMIT 12;
  `;

  const familySummarySql = `
    SELECT
      CASE
        WHEN (
          lo.content_type LIKE 'image/%'
          OR lower(lo.kind) IN ('portrait', 'illustration')
          OR lower(lo.kind) LIKE '%_image'
          OR lower(lo.kind) LIKE '%_illustration'
          OR lower(lo.kind) LIKE '%_portrait'
        ) THEN 'image'
        WHEN (
          lo.kind = 'battle_report_generation_output'
          OR lo.content_type LIKE 'text/%'
          OR lo.content_type LIKE '%json%'
          OR lo.content_type LIKE '%markdown%'
          OR lo.content_type LIKE '%xml%'
        ) THEN 'text'
        ELSE 'other'
      END AS family,
      COUNT(*) AS total,
      COALESCE(SUM(lo.bytes), 0) AS bytes,
      COALESCE(SUM(COALESCE(lo.stored_bytes, lo.bytes)), 0) AS stored_bytes
    ${fromSql}
    GROUP BY family;
  `;

  const [dataResult, countResult, kindSummaryResult, familySummaryResult] = await Promise.all([
    queryFromD1(dataSql, [...params, limit, offset]),
    queryFromD1(countSql, params),
    queryFromD1(kindSummarySql, params),
    queryFromD1(familySummarySql, params),
  ]);

  const rows = readRows<Record<string, unknown>>(dataResult).map(mapLargeObjectRow);
  const total = readInt(readRows<Record<string, unknown>>(countResult)[0]?.total);
  const kindSummaries: AdminLargeObjectKindSummary[] = readRows<Record<string, unknown>>(kindSummaryResult).map((row) => ({
    kind: typeof row.kind === 'string' ? row.kind : '',
    total: readInt(row.total),
    bytes: readInt(row.bytes),
    storedBytes: readInt(row.stored_bytes),
    lastCreatedAt: readNullableString(row.last_created_at),
  }));

  const familyMap = new Map<LargeObjectAssetFamily, AdminLargeObjectFamilySummary>();
  for (const row of readRows<Record<string, unknown>>(familySummaryResult)) {
    const familyRaw = typeof row.family === 'string' ? row.family : 'other';
    const family: LargeObjectAssetFamily =
      familyRaw === 'image' || familyRaw === 'text' || familyRaw === 'other' ? familyRaw : 'other';
    familyMap.set(family, {
      family,
      total: readInt(row.total),
      bytes: readInt(row.bytes),
      storedBytes: readInt(row.stored_bytes),
    });
  }

  const familySummaries = (['text', 'image', 'other'] as LargeObjectAssetFamily[]).map((family) => (
    familyMap.get(family) ?? { family, total: 0, bytes: 0, storedBytes: 0 }
  ));

  return { rows, total, kindSummaries, familySummaries };
}

export async function getAdminLargeObjectById(id: string): Promise<AdminLargeObjectRow | null> {
  const safeId = typeof id === 'string' ? id.trim() : '';
  if (!safeId) return null;

  const sql = `
    SELECT
      lo.*,
      u.username AS owner_username
    FROM large_objects lo
    LEFT JOIN users u ON u.id = lo.owner_user_id
    WHERE lo.id = ?
    LIMIT 1;
  `;

  const row = readRows<Record<string, unknown>>(await queryFromD1(sql, [safeId]))[0];
  return row ? mapLargeObjectRow(row) : null;
}

export async function deleteAdminLargeObjectById(id: string): Promise<{ ok: boolean; changes: number; error?: string }> {
  const safeId = typeof id === 'string' ? id.trim() : '';
  if (!safeId) return { ok: false, changes: 0, error: '缺少 id' };

  try {
    const result = await queryFromD1('DELETE FROM large_objects WHERE id = ?;', [safeId]);
    const changes = readInt((result as { result?: Array<{ meta?: { changes?: number } }> })?.result?.[0]?.meta?.changes);
    return { ok: true, changes };
  } catch (error) {
    return {
      ok: false,
      changes: 0,
      error: error instanceof Error ? error.message : '删除 large_objects 失败',
    };
  }
}
