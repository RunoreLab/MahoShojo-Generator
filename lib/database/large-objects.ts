import { generateUUID } from './core';

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

type LargeObjectsRepoBundle = {
  db: unknown;
  getLargeObjectByKindAndOwnerRef: (db: unknown, kind: string, ownerRefId: string) => Promise<LargeObjectRow | null>;
  upsertLargeObjectByKindAndOwnerRef: (
    db: unknown,
    input: {
      id: string;
      kind: string;
      ownerRefId: string;
      ownerUserId: number | null;
      r2Key: string;
      bytes: number;
      storedBytes: number | null;
      sha256: string | null;
      contentType: string | null;
      contentEncoding: string | null;
      nowIso: string;
    },
  ) => Promise<void>;
};

const readLargeObjectsRepoBundle = async (): Promise<LargeObjectsRepoBundle | null> => {
  try {
    const [{ getDrizzleDbFromRuntime }, repo] = await Promise.all([
      import('@/lib/db/drizzle'),
      import('@/lib/db/repositories/large-objects'),
    ]);
    const db = getDrizzleDbFromRuntime();
    if (!db) return null;

    return {
      db,
      getLargeObjectByKindAndOwnerRef:
        repo.getLargeObjectByKindAndOwnerRef as LargeObjectsRepoBundle['getLargeObjectByKindAndOwnerRef'],
      upsertLargeObjectByKindAndOwnerRef:
        repo.upsertLargeObjectByKindAndOwnerRef as LargeObjectsRepoBundle['upsertLargeObjectByKindAndOwnerRef'],
    };
  } catch {
    return null;
  }
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
  const ownerUserId =
    typeof input.ownerUserId === 'number' && Number.isFinite(input.ownerUserId) && input.ownerUserId > 0
      ? Math.floor(input.ownerUserId)
      : null;

  if (!kind || !ownerRefId || !r2Key) return { ok: false, id: null, error: '参数无效' };

  try {
    const bundle = await readLargeObjectsRepoBundle();
    if (!bundle) return { ok: false, id: null, error: '数据库不可用' };

    const now = new Date().toISOString();
    const id = generateUUID();

    await bundle.upsertLargeObjectByKindAndOwnerRef(bundle.db, {
      id,
      kind,
      ownerRefId,
      ownerUserId,
      r2Key,
      bytes,
      storedBytes,
      sha256: input.sha256 ?? null,
      contentType: input.contentType ?? null,
      contentEncoding: input.contentEncoding ?? null,
      nowIso: now,
    });

    const row = await bundle.getLargeObjectByKindAndOwnerRef(bundle.db, kind, ownerRefId);
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
    const bundle = await readLargeObjectsRepoBundle();
    if (!bundle) return null;

    return await bundle.getLargeObjectByKindAndOwnerRef(bundle.db, safeKind, safeOwnerRefId);
  } catch {
    return null;
  }
}
