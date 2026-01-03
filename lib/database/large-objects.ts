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

const readRow = (result: any): any | null => {
  const row = result?.result?.[0]?.results?.[0];
  return row && typeof row === 'object' ? row : null;
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
