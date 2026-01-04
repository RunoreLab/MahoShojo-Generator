import { generateUUID, queryFromD1 } from './core';

export type LargeObjectKind = string;

export type LargeObjectRow = {
  id: string;
  kind: string;
  owner_ref_id: string;
  owner_user_id: number | null;
  r2_key: string;
  bytes: number;
  stored_bytes: number | null;
  sha256: string | null;
  content_type: string | null;
  content_encoding: string | null;
  created_at: string;
  updated_at: string;
};

export type LargeObjectAdminRow = LargeObjectRow & {
  owner_username: string | null;
};

const readRow = (result: any): any | null => {
  const row = result?.result?.[0]?.results?.[0];
  return row && typeof row === 'object' ? row : null;
};

const readRows = <T>(result: any): T[] => {
  const rows = result?.result?.[0]?.results;
  return Array.isArray(rows) ? (rows as T[]) : [];
};

const readChanges = (result: any): number => {
  const changes = result?.result?.[0]?.meta?.changes;
  return typeof changes === 'number' && Number.isFinite(changes) ? Math.max(0, Math.floor(changes)) : 0;
};

export async function upsertLargeObjectByOwnerRef(input: {
  kind: LargeObjectKind;
  ownerRefId: string;
  ownerUserId?: number | null;
  r2Key: string;
  bytes: number;
  storedBytes?: number | null;
  sha256?: string | null;
  contentType?: string | null;
  contentEncoding?: string | null;
}): Promise<{ ok: boolean; id: string | null; error?: string }> {
  const kind = String(input.kind || '').trim();
  const ownerRefId = String(input.ownerRefId || '').trim();
  const r2Key = String(input.r2Key || '').trim();
  const bytes = Number.isFinite(input.bytes) ? Math.max(0, Math.floor(input.bytes)) : 0;
  const storedBytes = Number.isFinite(input.storedBytes) ? Math.max(0, Math.floor(input.storedBytes as number)) : null;
  const ownerUserId = typeof input.ownerUserId === 'number' && Number.isFinite(input.ownerUserId) && input.ownerUserId > 0
    ? Math.floor(input.ownerUserId)
    : null;

  if (!kind || !ownerRefId || !r2Key) return { ok: false, id: null, error: '参数无效' };

  try {
    const now = new Date().toISOString();
    const id = generateUUID();
    const result = await queryFromD1(
      `INSERT INTO large_objects (
        id, kind, owner_ref_id, owner_user_id, r2_key,
        bytes, stored_bytes, sha256, content_type, content_encoding,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(kind, owner_ref_id) DO UPDATE SET
        owner_user_id = excluded.owner_user_id,
        r2_key = excluded.r2_key,
        bytes = excluded.bytes,
        stored_bytes = excluded.stored_bytes,
        sha256 = excluded.sha256,
        content_type = excluded.content_type,
        content_encoding = excluded.content_encoding,
        updated_at = excluded.updated_at`,
      [
        id,
        kind,
        ownerRefId,
        ownerUserId,
        r2Key,
        bytes,
        storedBytes,
        input.sha256 ?? null,
        input.contentType ?? null,
        input.contentEncoding ?? null,
        now,
        now,
      ]
    ) as any;

    if (!result?.success) return { ok: false, id: null, error: '写入失败' };
    const row = await getLargeObjectByOwnerRef(kind, ownerRefId);
    return { ok: true, id: row?.id ?? null, error: undefined };
  } catch (error) {
    // 兼容：尚未执行建表/迁移时，这里会失败。上层应降级为仅写 D1。
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, id: null, error: message || '未知错误' };
  }
}

export async function getLargeObjectByOwnerRef(kind: LargeObjectKind, ownerRefId: string): Promise<LargeObjectRow | null> {
  const safeKind = String(kind || '').trim();
  const safeOwnerRefId = String(ownerRefId || '').trim();
  if (!safeKind || !safeOwnerRefId) return null;

  try {
    const result = await queryFromD1(
      `SELECT
        id, kind, owner_ref_id, owner_user_id, r2_key,
        bytes, stored_bytes, sha256, content_type, content_encoding,
        created_at, updated_at
       FROM large_objects
       WHERE kind = ? AND owner_ref_id = ?
       LIMIT 1`,
      [safeKind, safeOwnerRefId]
    ) as any;

    const row = readRow(result);
    return row ? (row as LargeObjectRow) : null;
  } catch {
    return null;
  }
}

export async function getLargeObjectById(id: string): Promise<LargeObjectAdminRow | null> {
  const safeId = String(id || '').trim();
  if (!safeId) return null;
  try {
    const result = (await queryFromD1(
      `SELECT
        lo.id, lo.kind, lo.owner_ref_id, lo.owner_user_id, lo.r2_key,
        lo.bytes, lo.stored_bytes, lo.sha256, lo.content_type, lo.content_encoding,
        lo.created_at, lo.updated_at,
        u.username AS owner_username
       FROM large_objects lo
       LEFT JOIN users u ON u.id = lo.owner_user_id
       WHERE lo.id = ?
       LIMIT 1`,
      [safeId]
    )) as any;
    const row = readRow(result);
    return row ? (row as LargeObjectAdminRow) : null;
  } catch {
    return null;
  }
}

export async function listLargeObjects(filters: {
  page?: number;
  limit?: number;
  kind?: string;
  ownerUserId?: number;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  minBytes?: number;
  maxBytes?: number;
}): Promise<{ rows: LargeObjectAdminRow[]; total: number }> {
  const page = typeof filters.page === 'number' && Number.isFinite(filters.page) ? Math.max(1, Math.floor(filters.page)) : 1;
  const limit = typeof filters.limit === 'number' && Number.isFinite(filters.limit) ? Math.max(1, Math.min(200, Math.floor(filters.limit))) : 50;
  const offset = (page - 1) * limit;
  const kind = typeof filters.kind === 'string' ? filters.kind.trim() : '';
  const search = typeof filters.search === 'string' ? filters.search.trim() : '';
  const dateFrom = typeof filters.dateFrom === 'string' ? filters.dateFrom.trim() : '';
  const dateTo = typeof filters.dateTo === 'string' ? filters.dateTo.trim() : '';
  const ownerUserId = typeof filters.ownerUserId === 'number' && Number.isFinite(filters.ownerUserId) ? Math.floor(filters.ownerUserId) : null;
  const minBytes = typeof filters.minBytes === 'number' && Number.isFinite(filters.minBytes) ? Math.max(0, Math.floor(filters.minBytes)) : null;
  const maxBytes = typeof filters.maxBytes === 'number' && Number.isFinite(filters.maxBytes) ? Math.max(0, Math.floor(filters.maxBytes)) : null;

  const whereParts: string[] = [];
  const params: unknown[] = [];

  if (kind) {
    whereParts.push('lo.kind = ?');
    params.push(kind);
  }
  if (ownerUserId != null) {
    whereParts.push('lo.owner_user_id = ?');
    params.push(ownerUserId);
  }
  if (dateFrom) {
    whereParts.push('DATE(lo.created_at) >= DATE(?)');
    params.push(dateFrom);
  }
  if (dateTo) {
    whereParts.push('DATE(lo.created_at) <= DATE(?)');
    params.push(dateTo);
  }
  if (minBytes != null) {
    whereParts.push('lo.bytes >= ?');
    params.push(minBytes);
  }
  if (maxBytes != null) {
    whereParts.push('lo.bytes <= ?');
    params.push(maxBytes);
  }
  if (search) {
    const term = `%${search}%`;
    whereParts.push('(lo.id LIKE ? OR lo.owner_ref_id LIKE ? OR lo.r2_key LIKE ? OR lo.kind LIKE ? OR u.username LIKE ?)');
    params.push(term, term, term, term, term);
  }

  const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  try {
    const dataSql = `
      SELECT
        lo.id, lo.kind, lo.owner_ref_id, lo.owner_user_id, lo.r2_key,
        lo.bytes, lo.stored_bytes, lo.sha256, lo.content_type, lo.content_encoding,
        lo.created_at, lo.updated_at,
        u.username AS owner_username
      FROM large_objects lo
      LEFT JOIN users u ON u.id = lo.owner_user_id
      ${whereSql}
      ORDER BY lo.created_at DESC, lo.id ASC
      LIMIT ? OFFSET ?;
    `;

    const countSql = `
      SELECT COUNT(*) AS total
      FROM large_objects lo
      LEFT JOIN users u ON u.id = lo.owner_user_id
      ${whereSql};
    `;

    const [dataResult, countResult] = await Promise.all([
      queryFromD1(dataSql, [...params, limit, offset]),
      queryFromD1(countSql, params),
    ]);

    const rows = readRows<LargeObjectAdminRow>(dataResult as any);
    const totalRow = readRows<{ total: number }>(countResult as any)[0];
    const total = typeof totalRow?.total === 'number' ? totalRow.total : 0;
    return { rows, total };
  } catch (error) {
    console.error('读取 large_objects 失败:', error);
    return { rows: [], total: 0 };
  }
}

export async function deleteLargeObjectById(id: string): Promise<{ ok: boolean; changes: number; error?: string }> {
  const safeId = String(id || '').trim();
  if (!safeId) return { ok: false, changes: 0, error: '缺少 id' };
  try {
    const result = (await queryFromD1('DELETE FROM large_objects WHERE id = ?', [safeId])) as any;
    const changes = readChanges(result);
    return { ok: Boolean(result?.success), changes };
  } catch (error) {
    console.error('删除 large_objects 失败:', error);
    return { ok: false, changes: 0, error: error instanceof Error ? error.message : '未知错误' };
  }
}
