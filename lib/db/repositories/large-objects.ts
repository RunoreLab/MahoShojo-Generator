import { and, eq } from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { largeObjects } from '@/lib/db/schema';

export type LargeObjectDbRow = {
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

const toIntOrNull = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
};

const mapLargeObjectRow = (row: {
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
  createdAt: string;
  updatedAt: string;
}): LargeObjectDbRow => ({
  id: row.id,
  kind: row.kind,
  owner_ref_id: row.ownerRefId,
  owner_user_id: toIntOrNull(row.ownerUserId),
  r2_key: row.r2Key,
  bytes: toIntOrNull(row.bytes) ?? 0,
  stored_bytes: toIntOrNull(row.storedBytes),
  sha256: typeof row.sha256 === 'string' ? row.sha256 : null,
  content_type: typeof row.contentType === 'string' ? row.contentType : null,
  content_encoding: typeof row.contentEncoding === 'string' ? row.contentEncoding : null,
  created_at: row.createdAt,
  updated_at: row.updatedAt,
});

const selectLargeObjectFields = {
  id: largeObjects.id,
  kind: largeObjects.kind,
  ownerRefId: largeObjects.ownerRefId,
  ownerUserId: largeObjects.ownerUserId,
  r2Key: largeObjects.r2Key,
  bytes: largeObjects.bytes,
  storedBytes: largeObjects.storedBytes,
  sha256: largeObjects.sha256,
  contentType: largeObjects.contentType,
  contentEncoding: largeObjects.contentEncoding,
  createdAt: largeObjects.createdAt,
  updatedAt: largeObjects.updatedAt,
};

export const getLargeObjectByKindAndOwnerRef = async (
  db: AppDrizzleDb,
  kind: string,
  ownerRefId: string,
): Promise<LargeObjectDbRow | null> => {
  const rows = await db
    .select(selectLargeObjectFields)
    .from(largeObjects)
    .where(and(eq(largeObjects.kind, kind), eq(largeObjects.ownerRefId, ownerRefId)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return mapLargeObjectRow(row);
};

export const upsertLargeObjectByKindAndOwnerRef = async (
  db: AppDrizzleDb,
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
): Promise<void> => {
  await db
    .insert(largeObjects)
    .values({
      id: input.id,
      kind: input.kind,
      ownerRefId: input.ownerRefId,
      ownerUserId: input.ownerUserId,
      r2Key: input.r2Key,
      bytes: input.bytes,
      storedBytes: input.storedBytes,
      sha256: input.sha256,
      contentType: input.contentType,
      contentEncoding: input.contentEncoding,
      createdAt: input.nowIso,
      updatedAt: input.nowIso,
    })
    .onConflictDoUpdate({
      target: [largeObjects.kind, largeObjects.ownerRefId],
      set: {
        ownerUserId: input.ownerUserId,
        r2Key: input.r2Key,
        bytes: input.bytes,
        storedBytes: input.storedBytes,
        sha256: input.sha256,
        contentType: input.contentType,
        contentEncoding: input.contentEncoding,
        updatedAt: input.nowIso,
      },
    });
};
